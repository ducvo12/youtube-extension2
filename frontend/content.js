function updateSidebarTitle() {
  const titleNode = document.getElementById(TITLE_ID);

  if (!titleNode) {
    return;
  }

  titleNode.textContent = getVideoTitle();
}

function setTranscriptStatus(message) {
  const statusNode = document.getElementById(TRANSCRIPT_STATUS_ID);

  if (statusNode) {
    statusNode.textContent = message;
  }
}

function setPlayerCaptureButtonVisible(visible) {
  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);

  if (button) {
    button.hidden = !visible;
  }
}

function setInitialTranscriptPrompt() {
  const videoId = getVideoId();

  if (!videoId || loadedTranscriptVideoId === videoId || activePlayerCaptionCaptureVideoId === videoId) {
    return;
  }

  currentTranscriptSegments = [];
  currentCaptionIndex = -1;
  renderCaptionRiver(-1);

  if (userAllowedCaptionCapture) {
    setPlayerCaptureButtonVisible(false);
    loadTranscriptFromPlayerCaptions(true);
    return;
  }

  setTranscriptStatus("Click below to load transcript. Captions will be enabled briefly.");
  setPlayerCaptureButtonVisible(true);
}

function getActiveCaptionIndex(currentTimeMs) {
  if (!currentTranscriptSegments.length) {
    return -1;
  }

  const lookupMs = currentTimeMs + CAPTION_START_LEAD_MS;
  let activeIndex = -1;

  for (let index = 0; index < currentTranscriptSegments.length; index += 1) {
    const segment = currentTranscriptSegments[index];
    const startMs = segment.startMs || 0;

    if (startMs > lookupMs) {
      break;
    }

    activeIndex = index;
  }

  if (activeIndex < 0) {
    return -1;
  }

  const segment = currentTranscriptSegments[activeIndex];
  const nextSegment = currentTranscriptSegments[activeIndex + 1];
  const startMs = segment.startMs || 0;
  const durationMs = segment.durationMs || 0;
  const durationEndMs = durationMs > 0 ? startMs + durationMs : startMs + 4000;
  const nextStartMs = nextSegment?.startMs;
  const endMs = Number.isFinite(nextStartMs)
    ? Math.max(durationEndMs, nextStartMs)
    : durationEndMs;

  if (currentTimeMs - CAPTION_END_GRACE_MS > endMs && nextSegment) {
    return -1;
  }

  return activeIndex;
}

function clampCaptionIndex(index) {
  if (!currentTranscriptSegments.length) {
    return -1;
  }

  return Math.max(0, Math.min(index, currentTranscriptSegments.length - 1));
}

function getDisplayCaptionIndex(activeIndex) {
  if (activeIndex < 0) {
    return activeIndex;
  }

  return clampCaptionIndex(activeIndex + CAPTION_DISPLAY_SEGMENT_OFFSET);
}

function getCaptionWordSegments(text) {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

    return Array.from(segmenter.segment(text)).map((segment) => ({
      text: segment.segment,
      isWordLike: segment.isWordLike,
    }));
  }

  return text.match(/\s+|\S+/g)?.map((segment) => ({
    text: segment,
    isWordLike: !/^\s+$/.test(segment),
  })) || [];
}

function appendCaptionText(line, text, segmentIndex) {
  const segments = getCaptionWordSegments(text);
  let wordIndex = 0;

  for (const segment of segments) {
    if (!segment.isWordLike) {
      line.appendChild(document.createTextNode(segment.text));
      continue;
    }

    const word = document.createElement("span");
    word.className = "yt-translator-caption-word";
    word.dataset.captionSegmentIndex = String(segmentIndex);
    word.dataset.captionWordIndex = String(wordIndex);
    word.textContent = segment.text;
    line.appendChild(word);
    wordIndex += 1;
  }
}

function snapCaptionSelectionToWords() {
  if (isSnappingCaptionSelection) {
    return;
  }

  const riverNode = document.getElementById(CAPTION_RIVER_ID);
  const selection = window.getSelection();

  if (!riverNode || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const selectionRange = selection.getRangeAt(0);
  const selectionTouchesCaptionRiver = riverNode.contains(selectionRange.commonAncestorContainer)
    || riverNode.contains(selection.anchorNode)
    || riverNode.contains(selection.focusNode);

  if (!selectionTouchesCaptionRiver) {
    return;
  }

  const words = Array.from(riverNode.querySelectorAll(".yt-translator-caption-word"));
  const selectedWords = words.filter((word) => selection.containsNode(word, true));

  if (!selectedWords.length) {
    return;
  }

  const snappedRange = document.createRange();
  snappedRange.setStartBefore(selectedWords[0]);
  snappedRange.setEndAfter(selectedWords[selectedWords.length - 1]);

  isSnappingCaptionSelection = true;
  selection.removeAllRanges();
  selection.addRange(snappedRange);
  isSnappingCaptionSelection = false;

  selectedCaptionText = snappedRange.toString().replace(/\s+/g, " ").trim();
  renderSelectedCaptionPill();
}

function scheduleCaptionSelectionSnap() {
  window.setTimeout(snapCaptionSelectionToWords, 0);
}

function renderCaptionRiver(activeIndex) {
  const riverNode = document.getElementById(CAPTION_RIVER_ID);

  if (!riverNode) {
    return;
  }

  riverNode.textContent = "";

  if (!currentTranscriptSegments.length) {
    riverNode.textContent = "Current caption will appear after captions load.";
    currentCaptionIndex = -1;
    return;
  }

  if (activeIndex < 0) {
    riverNode.textContent = "Waiting for playback...";
    currentCaptionIndex = -1;
    return;
  }

  const fragment = document.createDocumentFragment();
  const startIndex = Math.max(0, activeIndex - 3);

  for (let index = startIndex; index <= activeIndex; index += 1) {
    const line = document.createElement("p");
    line.className = index === activeIndex
      ? "yt-translator-caption-river__line yt-translator-caption-river__line--active"
      : "yt-translator-caption-river__line";
    appendCaptionText(line, currentTranscriptSegments[index].text, index);
    fragment.appendChild(line);
  }

  riverNode.appendChild(fragment);
  currentCaptionIndex = activeIndex;
}

function updateCaptionRiver() {
  const riverNode = document.getElementById(CAPTION_RIVER_ID);

  if (isAdShowing()) {
    if (!isCaptionRiverPausedForAd) {
      isCaptionRiverPausedForAd = true;
      currentCaptionIndex = -1;
      setTranscriptStatus("Ad playing. Caption river paused until the video resumes.");

      if (riverNode) {
        riverNode.textContent = "Ad playing. Caption river paused.";
      }
    }

    return;
  }

  if (isCaptionRiverPausedForAd) {
    isCaptionRiverPausedForAd = false;
    currentCaptionIndex = -1;

    if (currentTranscriptSegments.length) {
      setTranscriptStatus("Captions loaded.");
    }
  }

  const currentTimeMs = getPlaybackTimeMs();

  if (currentTimeMs === null) {
    renderCaptionRiver(-1);
    return;
  }

  const activeIndex = getDisplayCaptionIndex(getActiveCaptionIndex(currentTimeMs));

  if (activeIndex !== currentCaptionIndex) {
    renderCaptionRiver(activeIndex);
  }
}

function startCaptionRiverUpdates() {
  window.clearInterval(captionRiverTimer);
  updateCaptionRiver();
  captionRiverTimer = window.setInterval(updateCaptionRiver, 250);
}

function renderTranscript(segments) {
  currentTranscriptSegments = segments;
  currentCaptionIndex = -1;

  if (!segments.length) {
    setTranscriptStatus("No transcript text found.");
    renderCaptionRiver(-1);
    return;
  }

  setPlayerCaptureButtonVisible(false);
  startCaptionRiverUpdates();
  setTranscriptStatus("Captions loaded.");
}

function getCaptionTracksFromBackground(videoId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "GET_CAPTION_TRACKS", videoId }, (response) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Caption track request failed"));
        return;
      }

      resolve(response.tracks || []);
    });
  });
}

async function getCaptionTracks(videoId) {
  try {
    const tracks = await getCaptionTracksFromBackground(videoId);

    if (tracks.length) {
      return tracks;
    }
  } catch (error) {
    console.warn("Unable to load caption tracks from background", error);
  }

  return getCaptionTracksFromPage();
}

function selectCaptionTrack(tracks) {
  if (!tracks.length) {
    return null;
  }

  const manualTracks = tracks.filter((track) => track.kind !== "asr");
  const autoTracks = tracks.filter((track) => track.kind === "asr");

  return manualTracks.find((track) => track.defaultAudioTrack)
    || manualTracks.find((track) => track.vssId?.startsWith("."))
    || manualTracks[0]
    || autoTracks[0]
    || tracks[0];
}

function buildTranscriptUrl(baseUrl, format) {
  const url = new URL(baseUrl);
  url.searchParams.set("c", "WEB");

  if (format) {
    url.searchParams.set("fmt", format);
  } else {
    url.searchParams.delete("fmt");
  }

  return url.toString();
}

function isSupportedTranscriptUrl(url) {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.protocol === "https:"
      && (parsedUrl.hostname === "youtube.com"
        || parsedUrl.hostname.endsWith(".youtube.com")
        || parsedUrl.hostname.endsWith(".googlevideo.com"));
  } catch (_error) {
    return false;
  }
}

function ensurePageFetcherInjected() {
  if (pageFetcherReady) {
    return pageFetcherReady;
  }

  if (pageFetcherInjected || document.getElementById("yt-translator-page-fetcher")) {
    pageFetcherInjected = true;
    pageFetcherReady = Promise.resolve();
    return pageFetcherReady;
  }

  pageFetcherReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "yt-translator-page-fetcher";
    script.src = chrome.runtime.getURL("page-fetcher.js");
    script.onload = () => {
      script.remove();
      pageFetcherInjected = true;
      resolve();
    };
    script.onerror = () => {
      pageFetcherReady = null;
      reject(new Error("Unable to inject page caption fetcher"));
    };
    (document.head || document.documentElement).appendChild(script);
  });

  return pageFetcherReady;
}

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

async function captureNextPlayerCaptionRequest(onCaptureStarted = () => { }) {
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
      timeoutMs: 12000,
    }, "*");
  });
}

function getCaptionButton() {
  return document.querySelector(".ytp-subtitles-button")
    || document.querySelector("button[aria-keyshortcuts='c']");
}

function isCaptionButtonEnabled(button) {
  return button?.getAttribute("aria-pressed") === "true"
    || button?.classList.contains("ytp-button-active");
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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

async function loadTranscriptFromPlayerCaptions(isAutomatic = false, attempt = 0) {
  const videoId = getVideoId();

  if (!videoId) {
    setTranscriptStatus("Open a video page before loading captions.");
    return;
  }

  if (loadedTranscriptVideoId === videoId || activePlayerCaptionCaptureVideoId === videoId) {
    return;
  }

  if (!isAutomatic) {
    userAllowedCaptionCapture = true;
  }

  activePlayerCaptionCaptureVideoId = videoId;

  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);
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
    const captured = await captureNextPlayerCaptionRequest(() => triggerPlayerCaptionLoad(wasEnabled));
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

async function fetchTranscriptInPage(url) {
  if (!isSupportedTranscriptUrl(url)) {
    return Promise.reject(new Error("Unsupported transcript URL"));
  }

  await ensurePageFetcherInjected();

  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${pageFetchRequestId += 1}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("Page caption request timed out"));
    }, 10000);

    function handleMessage(event) {
      if (event.source !== window
        || event.data?.source !== "yt-translator-page"
        || event.data.type !== "FETCH_TRANSCRIPT_IN_PAGE_RESULT"
        || event.data.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);

      if (!event.data.ok) {
        reject(new Error(event.data.error || "Page caption request failed"));
        return;
      }

      resolve(event.data.body || "");
    }

    window.addEventListener("message", handleMessage);
    window.postMessage({
      source: "yt-translator-content",
      type: "FETCH_TRANSCRIPT_IN_PAGE",
      requestId,
      url,
    }, "*");
  });
}

function fetchTranscript(url) {
  const backgroundFetch = new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "FETCH_TRANSCRIPT", url }, (response) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || "Caption request failed"));
        return;
      }

      resolve(response.body || "");
    });
  });

  return backgroundFetch
    .then(async (body) => {
      if (body.trim()) {
        return body;
      }

      const pageBody = await fetchTranscriptInPage(url);
      return pageBody.trim() ? pageBody : body;
    })
    .catch(async (backgroundError) => {
      try {
        return await fetchTranscriptInPage(url);
      } catch (pageError) {
        throw new Error(`${backgroundError.message}; page fallback: ${pageError.message}`);
      }
    });
}

async function fetchTranscriptSegments(baseUrl) {
  const formats = ["json3", "vtt", "srv3", null];
  const errors = [];

  for (const format of formats) {
    const label = format || "default";

    try {
      const body = await fetchTranscript(buildTranscriptUrl(baseUrl, format));

      if (!body.trim()) {
        throw new Error(`Empty ${label} transcript response`);
      }

      const segments = parseTranscriptBody(body, format);

      if (segments.length) {
        return segments;
      }

      throw new Error(`No text in ${label} transcript response`);
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }

  if (errors.every((error) => error.includes("Empty "))) {
    throw new Error("YouTube returned empty caption responses. Current YouTube web subtitle requests may require a video-bound PoToken (`pot`) in addition to `c=WEB`.");
  }

  throw new Error(errors.join(" | ") || "No transcript format could be loaded");
}

async function loadTranscript(attempt = 0) {
  const videoId = getVideoId();

  if (!videoId || loadedTranscriptVideoId === videoId) {
    return;
  }

  loadedTranscriptVideoId = videoId;
  const requestId = activeTranscriptRequest + 1;
  activeTranscriptRequest = requestId;

  renderTranscript([]);
  setTranscriptStatus("Loading transcript...");

  const tracks = await getCaptionTracks(videoId);
  const selectedTrack = selectCaptionTrack(tracks);

  if (!selectedTrack?.baseUrl) {
    if (attempt < 8) {
      setTranscriptStatus("Looking for captions...");

      window.setTimeout(() => {
        if (videoId === getVideoId()) {
          loadedTranscriptVideoId = null;
          loadTranscript(attempt + 1);
        }
      }, 500);

      return;
    }

    setTranscriptStatus("No captions available for this video.");
    return;
  }

  try {
    const segments = await fetchTranscriptSegments(selectedTrack.baseUrl);

    if (requestId !== activeTranscriptRequest || videoId !== getVideoId()) {
      return;
    }

    renderTranscript(segments);
  } catch (error) {
    console.error("Unable to load transcript", error);

    if (requestId === activeTranscriptRequest) {
      setTranscriptStatus(`Unable to load transcript: ${error.message}`);
      setPlayerCaptureButtonVisible(true);
    }
  }
}

function setupSidebarActions() {
  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);

  if (button && button.dataset.initialized !== "true") {
    button.dataset.initialized = "true";
    button.addEventListener("click", () => loadTranscriptFromPlayerCaptions(false));
  }

  if (document.documentElement.dataset.ytTranslatorCaptionSelectionInitialized !== "true") {
    document.documentElement.dataset.ytTranslatorCaptionSelectionInitialized = "true";
    document.addEventListener("mouseup", scheduleCaptionSelectionSnap);
    document.addEventListener("touchend", scheduleCaptionSelectionSnap);
    document.addEventListener("keyup", scheduleCaptionSelectionSnap);
  }

  const form = document.getElementById(CHAT_FORM_ID);
  const input = document.getElementById(CHAT_INPUT_ID);

  if (!form || form.dataset.initialized === "true") {
    return;
  }

  form.dataset.initialized = "true";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitChatPrompt();
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitChatPrompt();
    }
  });
}

function removeSidebar() {
  document.getElementById(SIDEBAR_ID)?.remove();
  window.clearInterval(captionRiverTimer);
}

function createSidebar() {
  if (!isWatchPage()) {
    removeSidebar();
    return;
  }

  if (document.getElementById(SIDEBAR_ID)) {
    updateSidebarTitle();
    setupSidebarActions();
    renderChatRiver();
    renderSelectedCaptionPill();
    setInitialTranscriptPrompt();
    return;
  }

  const recommendationsColumn = getRecommendationsColumn();

  if (!recommendationsColumn) {
    if (retryCount < 10) {
      retryCount += 1;
      scheduleSidebarUpdate();
    }

    return;
  }

  retryCount = 0;

  const sidebar = document.createElement("aside");
  sidebar.id = SIDEBAR_ID;
  sidebar.innerHTML = `
    <div class="yt-translator-sidebar__eyebrow">Language Assistant</div>
    <div class="yt-translator-sidebar__section">
      <h3 class="yt-translator-sidebar__subheading">Current Caption</h3>
      <p id="${TRANSCRIPT_STATUS_ID}" class="yt-translator-sidebar__status">Loading transcript...</p>
      <button id="${PLAYER_CAPTURE_BUTTON_ID}" class="yt-translator-sidebar__button" type="button" hidden>
        Load transcript by enabling captions briefly
      </button>
      <div class="yt-translator-caption-river-wrap">
        <div class="yt-translator-sidebar__label">Now Playing</div>
        <div id="${CAPTION_RIVER_ID}" class="yt-translator-caption-river">Current caption will appear after captions load.</div>
      </div>
      <div id="${SELECTED_CAPTION_ID}" class="yt-translator-selected-caption" hidden></div>
    </div>
    <div class="yt-translator-sidebar__section">
      <h3 class="yt-translator-sidebar__subheading">Ask</h3>
      <div id="${CHAT_RIVER_ID}" class="yt-translator-chat-river"></div>
      <form id="${CHAT_FORM_ID}" class="yt-translator-chat-form">
        <textarea
          id="${CHAT_INPUT_ID}"
          class="yt-translator-chat-form__input"
          rows="3"
          maxlength="1200"
          placeholder="Ask about the current phrase, tone, grammar, or slang..."
        ></textarea>
        <button id="${CHAT_SEND_BUTTON_ID}" class="yt-translator-chat-form__send" type="submit">Send</button>
      </form>
    </div>
  `;

  recommendationsColumn.prepend(sidebar);
  setupSidebarActions();
  renderChatRiver();
  renderSelectedCaptionPill();
  updateSidebarTitle();
  setInitialTranscriptPrompt();
}

function scheduleSidebarUpdate() {
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(createSidebar, 500);
}

function handleNavigation() {
  loadedTranscriptVideoId = null;
  activePlayerCaptionCaptureVideoId = null;
  currentTranscriptSegments = [];
  currentCaptionIndex = -1;
  chatMessages = [];
  selectedCaptionText = "";
  isChatWaitingForReply = false;
  activeChatRequest += 1;
  isCaptionRiverPausedForAd = false;
  window.clearInterval(captionRiverTimer);
  scheduleSidebarUpdate();
}

createSidebar();

window.addEventListener("yt-navigate-finish", handleNavigation);
window.addEventListener("yt-page-data-updated", handleNavigation);
window.addEventListener("popstate", handleNavigation);
