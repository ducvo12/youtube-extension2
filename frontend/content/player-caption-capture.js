/*
 * Player-caption capture flow.
 *
 * This module owns the extension's active caption retrieval path. Instead of
 * building transcript URLs directly, it briefly toggles YouTube's own captions
 * control and captures the caption network response made by the player. That
 * captured response already contains the request details YouTube requires.
 *
 * Public entry point:
 *
 *   loadTranscriptFromPlayerCaptions()
 *
 * That function is called by sidebar.js when the user clicks the transcript
 * load button, or automatically after the user has already allowed caption
 * capture on a previous video. content.js does not call it directly; content.js
 * bootstraps the extension, while sidebar.js wires the UI to this module.
 *
 * Function interaction:
 *
 *   loadTranscriptFromPlayerCaptions()
 *     -> getVideoId() to identify the current YouTube video
 *     -> getCaptionButton() and isCaptionButtonEnabled() to inspect the player
 *     -> captureNextPlayerCaptionRequest() to wait for the next caption response
 *       -> ensurePageCaptionCapturerInjected() to inject page-caption-capturer.js
 *       -> postMessage("START_PLAYER_CAPTION_CAPTURE") to arm the page capturer
 *       -> triggerPlayerCaptionLoad() when capture starts
 *         -> getCaptionButton() to find YouTube's captions button
 *         -> wait() between player-control clicks when needed
 *     -> parseTranscriptBodyAuto() to normalize the captured caption body
 *     -> renderTranscript() to hand parsed segments to the caption river
 *     -> restorePlayerCaptionState() in finally so captions return to their
 *        original enabled/disabled state
 *
 * The end result is that sidebar.js can call one high-level function and receive
 * the full behavior: capture YouTube's player transcript request, parse the
 * response, render captions, surface errors, and restore the player UI.
 */

// Internal helper for captureNextPlayerCaptionRequest.
// Injects the page-context script that observes YouTube caption network requests.
function ensurePageCaptionCapturerInjected() {
  if (pageCaptionCapturerReady) {
    return pageCaptionCapturerReady;
  }

  if (pageCaptionCapturerInjected || window.__ytTranslatorCaptionCapturerRequested) {
    pageCaptionCapturerInjected = true;
    pageCaptionCapturerReady = Promise.resolve();
    return pageCaptionCapturerReady;
  }

  window.__ytTranslatorCaptionCapturerRequested = true;
  pageCaptionCapturerReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "yt-translator-page-caption-capturer";
    script.src = chrome.runtime.getURL("page-caption-capturer.js");
    script.onload = () => {
      script.remove();
      pageCaptionCapturerInjected = true;
      resolve();
    };
    script.onerror = () => {
      pageCaptionCapturerReady = null;
      window.__ytTranslatorCaptionCapturerRequested = false;
      reject(new Error("Unable to inject page caption capturer"));
    };
    (document.head || document.documentElement).appendChild(script);
  });

  return pageCaptionCapturerReady;
}

// Internal helper for loadTranscriptFromPlayerCaptions.
// Starts a one-shot capture and resolves with the next caption response body.
async function captureNextPlayerCaptionRequest(expectedVideoId, onCaptureStarted = () => { }) {
  await ensurePageCaptionCapturerInjected();

  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${playerCaptionCaptureRequestId += 1}`;
    let settled = false;
    let captureStarted = false;

    function cancelPageCapture() {
      window.postMessage({
        source: "yt-translator-content",
        type: "CANCEL_PLAYER_CAPTION_CAPTURE",
        requestId,
      }, "*");
    }

    function cleanup() {
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
    }

    function rejectCapture(error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      cancelPageCapture();
      reject(error instanceof Error ? error : new Error(error));
    }

    const timeout = window.setTimeout(() => {
      rejectCapture(new Error("Timed out waiting for YouTube caption request"));
    }, 14000);

    function handleMessage(event) {
      if (event.source !== window
        || event.data?.source !== "yt-translator-caption-capturer"
        || event.data.requestId !== requestId) {
        return;
      }

      if (event.data.type === "PLAYER_CAPTION_CAPTURE_STARTED") {
        if (captureStarted) {
          return;
        }

        captureStarted = true;
        Promise.resolve(onCaptureStarted()).catch(rejectCapture);
        return;
      }

      if (event.data.type !== "PLAYER_CAPTION_CAPTURE_RESULT") {
        return;
      }

      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (!event.data.ok) {
        reject(new Error(event.data.error || "Player caption capture failed"));
        return;
      }

      resolve({ body: event.data.body || "", url: event.data.url || "" });
    }

    window.addEventListener("message", handleMessage);
    window.postMessage({
      source: "yt-translator-content",
      type: "START_PLAYER_CAPTION_CAPTURE",
      requestId,
      expectedVideoId,
      timeoutMs: 12000,
    }, "*");
  });
}

// Internal helper for triggerPlayerCaptionLoad, restorePlayerCaptionState, and loadTranscriptFromPlayerCaptions.
// Finds YouTube's captions toggle button in the player controls.
function getCaptionButton() {
  return document.querySelector(".ytp-subtitles-button")
    || document.querySelector("button[aria-keyshortcuts='c']");
}

// Internal helper for restorePlayerCaptionState and loadTranscriptFromPlayerCaptions.
// Checks whether YouTube captions are currently enabled.
function isCaptionButtonEnabled(button) {
  return button?.getAttribute("aria-pressed") === "true"
    || button?.classList.contains("ytp-button-active");
}

// Internal helper for triggerPlayerCaptionLoad and restorePlayerCaptionState.
// Waits for a short delay between YouTube player control interactions.
function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Internal helper for loadTranscriptFromPlayerCaptions.
// Defers transcript capture until YouTube has switched from an ad to the video.
function waitForAdToFinishBeforeCaptionCapture(videoId, requestId, attempt) {
  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);

  pendingPlayerCaptionCaptureVideoId = videoId;
  setPlayerCaptureButtonVisible(false);
  setTranscriptStatus("Ad playing. Transcript will load after the video resumes.");

  if (button) {
    button.disabled = true;
  }

  window.clearTimeout(pendingPlayerCaptionCaptureTimer);
  pendingPlayerCaptionCaptureTimer = window.setTimeout(() => {
    pendingPlayerCaptionCaptureTimer = null;

    if (requestId !== activeTranscriptRequest || videoId !== getVideoId()) {
      pendingPlayerCaptionCaptureVideoId = null;

      if (button) {
        button.disabled = false;
      }

      return;
    }

    if (isAdShowing()) {
      waitForAdToFinishBeforeCaptionCapture(videoId, requestId, attempt);
      return;
    }

    pendingPlayerCaptionCaptureVideoId = null;
    loadTranscriptFromPlayerCaptions(true, attempt, requestId);
  }, 500);
}

// Internal helper for loadTranscriptFromPlayerCaptions.
// Toggles captions to make YouTube issue a caption request that can be captured.
async function triggerPlayerCaptionLoad(wasEnabled) {
  const button = getCaptionButton();

  if (!button) {
    throw new Error("YouTube CC button was not found. Try enabling captions manually, then click this button again.");
  }

  if (wasEnabled) {
    button.click();
    await wait(250);
  }

  button.click();
}

// Internal helper for loadTranscriptFromPlayerCaptions.
// Restores the YouTube captions button to its original enabled/disabled state.
async function restorePlayerCaptionState(wasEnabled) {
  const button = getCaptionButton();

  if (!button) {
    return;
  }

  await wait(500);

  if (isCaptionButtonEnabled(button) !== wasEnabled) {
    button.click();
  }
}

// Internal helper for loadTranscriptFromSelectedCaptionTrack.
// Finds the currently selected normalized caption track.
function getSelectedCaptionTrack() {
  return availableCaptionTracks.find((track) => track.key === selectedCaptionTrackKey) || null;
}

// Internal helper for loadTranscriptFromPlayerCaptions.
// Matches a captured YouTube caption URL to the normalized source track in the selector.
function getCaptionTrackForCaptionUrl(captionUrl) {
  if (!availableCaptionTracks.length && typeof refreshAvailableCaptionTracks === "function") {
    refreshAvailableCaptionTracks();
  }

  const identity = getCaptionTrackIdentity(captionUrl);
  const trackUrl = getCaptionTrackUrlString(captionUrl);

  if (!trackUrl) {
    return null;
  }

  return availableCaptionTracks.find((track) => track.identity === identity)
    || availableCaptionTracks.find((track) => track.trackUrl === trackUrl)
    || availableCaptionTracks.find((track) => track.sourceIdentity === getCaptionSourceIdentity(captionUrl)
      && !isTranslatedCaptionTrack(track))
    || null;
}

// Internal helper for loadTranscriptFromPlayerCaptions.
// Builds an untranslated source-track request for an auto-generated translated caption URL.
function getUntranslatedAutoGeneratedTrack(captionUrl, matchedTrack) {
  const capturedTrack = createCaptionTrackFromUrl(captionUrl);

  if (!capturedTrack || !isTranslatedCaptionTrack(capturedTrack)) {
    return null;
  }

  const isAutoGenerated = isAutoGeneratedCaptionTrack(capturedTrack)
    || isAutoGeneratedCaptionTrack(matchedTrack);

  if (!isAutoGenerated) {
    return null;
  }

  return availableCaptionTracks.find((track) => track.sourceIdentity === capturedTrack.sourceIdentity
      && !isTranslatedCaptionTrack(track))
    || createSourceCaptionTrackFromUrl(captionUrl, matchedTrack?.label || capturedTrack.label);
}

// Internal helper for getCaptionTrackFetchBaseUrl.
// Reuses token/client params from the player-generated caption URL when selected tracks omit them.
function applyCapturedCaptionRequestParams(url) {
  if (!lastCapturedPlayerCaptionUrl) {
    return;
  }

  let capturedUrl = null;

  try {
    capturedUrl = new URL(lastCapturedPlayerCaptionUrl, window.location.href);
  } catch (_error) {
    return;
  }

  for (const param of [
    "pot",
    "potc",
    "po_token",
    "xorb",
    "xobt",
    "xovt",
    "c",
    "cver",
    "cplayer",
    "cbr",
    "cbrver",
    "cos",
    "cosver",
    "cplatform",
  ]) {
    const value = capturedUrl.searchParams.get(param);

    if (value && !url.searchParams.has(param)) {
      url.searchParams.set(param, value);
    }
  }
}

// Internal helper for getCaptionTrackRequestUrls.
// Builds a selected track URL while preserving an explicitly selected translation target.
function getCaptionTrackFetchBaseUrl(track) {
  const url = new URL(track.trackUrl || track.baseUrl, window.location.href);

  url.searchParams.delete("fmt");
  applyCapturedCaptionRequestParams(url);

  return url;
}

// Internal helper for loadTranscriptFromSelectedCaptionTrack.
// Tries likely YouTube caption formats for an explicit selected track.
function getCaptionTrackRequestUrls(track) {
  const baseUrl = getCaptionTrackFetchBaseUrl(track);
  const urls = [baseUrl.toString()];

  for (const format of ["json3", "srv3", "vtt"]) {
    const url = new URL(baseUrl.toString());
    url.searchParams.set("fmt", format);
    urls.push(url.toString());
  }

  return Array.from(new Set(urls));
}

// Internal helper for loadTranscriptFromSelectedCaptionTrack.
// Fetches and parses one explicit YouTube caption track instead of using the player's default.
async function fetchCaptionTrackTranscript(track) {
  let lastError = null;

  for (const url of getCaptionTrackRequestUrls(track)) {
    try {
      const response = await fetch(url, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`YouTube returned ${response.status}`);
      }

      const body = await response.text();
      const segments = parseTranscriptBodyAuto(body);

      if (segments.length) {
        return segments;
      }

      lastError = new Error("response did not contain transcript text");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(lastError
    ? `Selected YouTube caption track could not be parsed (${lastError.message}).`
    : "Selected YouTube caption track could not be parsed.");
}

// Internal helper for loadTranscriptFromPlayerCaptions.
// Reuses YouTube's captured timedtext URL when the first captured body is not caption text.
async function parseOrRefetchCapturedTranscript(captured) {
  const segments = parseTranscriptBodyAuto(captured.body || "");

  if (segments.length) {
    return segments;
  }

  const capturedTrack = createCaptionTrackFromUrl(captured.url);

  if (!capturedTrack) {
    return [];
  }

  return fetchCaptionTrackTranscript(capturedTrack);
}

// Internal helper for loadTranscriptFromSelectedCaptionTrack.
// Captures one player caption URL so selected-track fetches can reuse YouTube's current request params.
async function primeCaptionTrackRequestParams(videoId, captionRequestId, trackLabel) {
  if (lastCapturedPlayerCaptionUrl) {
    return;
  }

  if (isAdShowing()) {
    return;
  }

  const captionButton = getCaptionButton();

  if (!captionButton) {
    return;
  }

  const wasEnabled = isCaptionButtonEnabled(captionButton);

  activePlayerCaptionCaptureVideoId = videoId;
  setTranscriptStatus(`Preparing ${trackLabel} captions...`);

  try {
    const captured = await captureNextPlayerCaptionRequest(videoId, () => triggerPlayerCaptionLoad(wasEnabled));

    if (captionRequestId !== activeTranscriptRequest || videoId !== getVideoId()) {
      return;
    }

    lastCapturedPlayerCaptionUrl = captured.url;

    if (typeof refreshAvailableCaptionTracks === "function") {
      refreshAvailableCaptionTracks();
      renderCaptionTrackSelector();
    }
  } finally {
    await restorePlayerCaptionState(wasEnabled);
    activePlayerCaptionCaptureVideoId = null;
  }
}

// Called externally by sidebar.js.
// Loads the transcript for the caption track selected in the sidebar.
async function loadTranscriptFromSelectedCaptionTrack(isAutomatic = false, options = {}) {
  const videoId = getVideoId();
  const track = getSelectedCaptionTrack();
  const shouldPrimeWithPlayerCapture = options.primeWithPlayerCapture && !lastCapturedPlayerCaptionUrl;

  if (!track) {
    await loadTranscriptFromPlayerCaptions(isAutomatic);
    return;
  }

  if (!videoId) {
    setTranscriptStatus("Open a video page before loading captions.");
    return;
  }

  if (loadedTranscriptVideoId === videoId && loadedTranscriptTrackKey === track.key) {
    return;
  }

  if (!isAutomatic) {
    userAllowedCaptionCapture = true;
  }

  const captionRequestId = activeTranscriptRequest += 1;
  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);
  const select = document.getElementById(CAPTION_TRACK_SELECT_ID);

  setPlayerCaptureButtonVisible(false);
  setTranscriptStatus(`Loading ${track.label} captions...`);

  if (button) {
    button.disabled = true;
  }

  if (select) {
    select.disabled = true;
  }

  try {
    if (shouldPrimeWithPlayerCapture) {
      try {
        await primeCaptionTrackRequestParams(videoId, captionRequestId, track.label);
      } catch (error) {
        console.warn("Unable to prepare caption request params before selected-track fetch", error);
      }

      if (select) {
        select.disabled = true;
      }
    }

    if (captionRequestId !== activeTranscriptRequest || videoId !== getVideoId()) {
      return;
    }

    const refreshedTrack = getSelectedCaptionTrack() || track;
    const segments = await fetchCaptionTrackTranscript(refreshedTrack);

    if (captionRequestId !== activeTranscriptRequest || videoId !== getVideoId()) {
      return;
    }

    loadedTranscriptVideoId = videoId;
    loadedTranscriptTrackKey = refreshedTrack.key;
    renderTranscript(segments, refreshedTrack.label);
  } catch (error) {
    console.error("Unable to load selected caption track", error);
    setTranscriptStatus(`Unable to load selected captions: ${error.message}`);
    setPlayerCaptureButtonVisible(true);
  } finally {
    if (button) {
      button.disabled = false;
    }

    if (select) {
      select.disabled = availableCaptionTracks.length <= 1;
    }
  }
}

// Called externally by sidebar.js.
// Captures YouTube player's caption response, parses it, and renders transcript segments.
async function loadTranscriptFromPlayerCaptions(isAutomatic = false, attempt = 0, requestId = null) {
  const videoId = getVideoId();

  if (!videoId) {
    setTranscriptStatus("Open a video page before loading captions.");
    return;
  }

  if (loadedTranscriptVideoId === videoId
    || activePlayerCaptionCaptureVideoId === videoId
    || (pendingPlayerCaptionCaptureVideoId === videoId && requestId === null)) {
    return;
  }

  const captionRequestId = requestId || (activeTranscriptRequest += 1);

  if (captionRequestId !== activeTranscriptRequest) {
    return;
  }

  if (!isAutomatic) {
    userAllowedCaptionCapture = true;
  }

  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);

  if (isAdShowing()) {
    waitForAdToFinishBeforeCaptionCapture(videoId, captionRequestId, attempt);
    return;
  }

  activePlayerCaptionCaptureVideoId = videoId;

  const captionButton = getCaptionButton();

  if (!captionButton) {
    activePlayerCaptionCaptureVideoId = null;

    if (isAutomatic && attempt < 20 && videoId === getVideoId()) {
      setTranscriptStatus("Waiting for YouTube captions control...");
      window.setTimeout(() => loadTranscriptFromPlayerCaptions(true, attempt + 1), 500);
      return;
    }

    setTranscriptStatus("YouTube CC button was not found. Try enabling captions manually, then click this button again.");
    setPlayerCaptureButtonVisible(true);
    return;
  }

  const wasEnabled = isCaptionButtonEnabled(captionButton);

  setPlayerCaptureButtonVisible(false);
  setTranscriptStatus("Enabling captions briefly to capture YouTube's transcript request...");

  if (button) {
    button.disabled = true;
  }

  try {
    const captured = await captureNextPlayerCaptionRequest(videoId, () => triggerPlayerCaptionLoad(wasEnabled));

    if (captionRequestId !== activeTranscriptRequest || videoId !== getVideoId()) {
      return;
    }

    if (isAdShowing()) {
      waitForAdToFinishBeforeCaptionCapture(videoId, captionRequestId, attempt);
      return;
    }

    lastCapturedPlayerCaptionUrl = captured.url;

    if (typeof refreshAvailableCaptionTracks === "function") {
      refreshAvailableCaptionTracks();
    }

    const capturedTrack = getCaptionTrackForCaptionUrl(captured.url);
    const untranslatedTrack = getUntranslatedAutoGeneratedTrack(captured.url, capturedTrack);
    const segments = untranslatedTrack
      ? await fetchCaptionTrackTranscript(untranslatedTrack)
      : await parseOrRefetchCapturedTranscript(captured);

    if (!segments.length) {
      throw new Error("Captured YouTube caption response, but no transcript text was found.");
    }

    loadedTranscriptVideoId = videoId;
    const loadedTrack = untranslatedTrack || capturedTrack;

    if (loadedTrack) {
      selectedCaptionTrackKey = loadedTrack.key;
      loadedTranscriptTrackKey = loadedTrack.key;
      renderCaptionTrackSelector();
      renderTranscript(segments, loadedTrack.label);
    } else {
      loadedTranscriptTrackKey = "";
      renderTranscript(segments);
    }
  } catch (error) {
    console.error("Unable to capture player captions", error);
    setTranscriptStatus(`Unable to capture player captions: ${error.message}`);
    setPlayerCaptureButtonVisible(true);
  } finally {
    await restorePlayerCaptionState(wasEnabled);
    activePlayerCaptionCaptureVideoId = null;

    if (button) {
      button.disabled = false;
    }
  }
}
