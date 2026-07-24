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

    const segments = parseTranscriptBodyAuto(captured.body);

    if (!segments.length) {
      throw new Error("Captured YouTube caption response, but no transcript text was found.");
    }

    loadedTranscriptVideoId = videoId;
    renderTranscript(segments);
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
