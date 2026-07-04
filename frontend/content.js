const SIDEBAR_ID = "yt-translator-sidebar";
const TITLE_ID = "yt-translator-video-title";
const TRANSCRIPT_STATUS_ID = "yt-translator-transcript-status";
const TRANSCRIPT_ID = "yt-translator-transcript";
const CAPTION_RIVER_ID = "yt-translator-caption-river";
const PLAYER_CAPTURE_BUTTON_ID = "yt-translator-player-capture-button";
let updateTimer = null;
let captionRiverTimer = null;
let retryCount = 0;
let activeTranscriptRequest = 0;
let loadedTranscriptVideoId = null;
let currentTranscriptSegments = [];
let currentCaptionIndex = -1;
let isCaptionRiverPausedForAd = false;
let userAllowedCaptionCapture = false;
let activePlayerCaptionCaptureVideoId = null;
let pageFetcherInjected = false;
let pageFetcherReady = null;
let pageFetchRequestId = 0;
let pageCaptionCapturerInjected = false;
let pageCaptionCapturerReady = null;
let playerCaptionCaptureRequestId = 0;

function getVideoTitle() {
  const titleElement = document.querySelector("h1.ytd-watch-metadata yt-formatted-string")
    || document.querySelector("h1.ytd-watch-metadata")
    || document.querySelector("h1.title");

  const title = titleElement?.textContent?.trim();

  if (title) {
    return title;
  }

  return document.title.replace(/ - YouTube$/, "").trim() || "Untitled video";
}

function updateSidebarTitle() {
  const titleNode = document.getElementById(TITLE_ID);

  if (!titleNode) {
    return;
  }

  titleNode.textContent = getVideoTitle();
}

function getVideoId() {
  return new URLSearchParams(window.location.search).get("v");
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
  const transcriptNode = document.getElementById(TRANSCRIPT_ID);

  if (transcriptNode) {
    transcriptNode.textContent = "";
  }

  renderCaptionRiver(-1);

  if (userAllowedCaptionCapture) {
    setPlayerCaptureButtonVisible(false);
    loadTranscriptFromPlayerCaptions(true);
    return;
  }

  setTranscriptStatus("Click below to load transcript. Captions will be enabled briefly.");
  setPlayerCaptureButtonVisible(true);
}

function getVideoElement() {
  return document.querySelector("video.html5-main-video") || document.querySelector("video");
}

function isAdShowing() {
  const player = document.getElementById("movie_player");

  return Boolean(player?.classList.contains("ad-showing")
    || player?.classList.contains("ad-interrupting")
    || document.querySelector(".ytp-ad-player-overlay")
    || document.querySelector(".ytp-ad-text"));
}

function getActiveCaptionIndex(currentTimeMs) {
  if (!currentTranscriptSegments.length) {
    return -1;
  }

  let fallbackIndex = -1;

  for (let index = 0; index < currentTranscriptSegments.length; index += 1) {
    const segment = currentTranscriptSegments[index];
    const startMs = segment.startMs || 0;
    const durationMs = segment.durationMs || 0;
    const endMs = durationMs > 0 ? startMs + durationMs : startMs + 4000;

    if (currentTimeMs >= startMs && currentTimeMs < endMs) {
      return index;
    }

    if (currentTimeMs >= startMs) {
      fallbackIndex = index;
    }

    if (startMs > currentTimeMs) {
      break;
    }
  }

  return fallbackIndex;
}

function renderCaptionRiver(activeIndex) {
  const riverNode = document.getElementById(CAPTION_RIVER_ID);

  if (!riverNode) {
    return;
  }

  riverNode.textContent = "";

  if (!currentTranscriptSegments.length) {
    riverNode.textContent = "Caption river will appear after transcript loads.";
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
    line.textContent = currentTranscriptSegments[index].text;
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
      setTranscriptStatus(`${currentTranscriptSegments.length} transcript lines loaded.`);
    }
  }

  const video = getVideoElement();

  if (!video) {
    renderCaptionRiver(-1);
    return;
  }

  const activeIndex = getActiveCaptionIndex(video.currentTime * 1000);

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
  const transcriptNode = document.getElementById(TRANSCRIPT_ID);

  if (!transcriptNode) {
    return;
  }

  transcriptNode.textContent = "";
  currentTranscriptSegments = segments;
  currentCaptionIndex = -1;

  if (!segments.length) {
    setTranscriptStatus("No transcript text found.");
    renderCaptionRiver(-1);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const segment of segments) {
    const line = document.createElement("p");
    line.className = "yt-translator-transcript__line";
    line.textContent = segment.text;
    fragment.appendChild(line);
  }

  transcriptNode.appendChild(fragment);
  setPlayerCaptureButtonVisible(false);
  startCaptionRiverUpdates();
  setTranscriptStatus(`${segments.length} transcript lines loaded.`);
}

function extractJsonObject(source, startIndex) {
  const firstBrace = source.indexOf("{", startIndex);

  if (firstBrace === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(firstBrace, index + 1);
      }
    }
  }

  return null;
}

function getPlayerResponseFromScripts() {
  for (const script of document.scripts) {
    const text = script.textContent || "";
    const markerIndex = text.indexOf("ytInitialPlayerResponse");

    if (markerIndex === -1) {
      continue;
    }

    const json = extractJsonObject(text, markerIndex);

    if (!json) {
      continue;
    }

    try {
      return JSON.parse(json);
    } catch (error) {
      console.warn("Unable to parse YouTube player response", error);
    }
  }

  return null;
}

function getPlayerResponseFromDom() {
  const watchFlexy = document.querySelector("ytd-watch-flexy");

  return watchFlexy?.playerResponse
    || watchFlexy?.playerData?.playerResponse
    || document.querySelector("ytd-app")?.data?.playerResponse
    || null;
}

function getCaptionTracksFromPage() {
  const playerResponse = getPlayerResponseFromDom() || getPlayerResponseFromScripts();

  return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
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

function parseTranscriptEvents(events = []) {
  return events
    .map((event) => ({
      startMs: event.tStartMs || 0,
      durationMs: event.dDurationMs || 0,
      text: (event.segs || [])
        .map((segment) => segment.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((segment) => segment.text);
}

function parseJsonTranscript(body) {
  return parseTranscriptEvents(JSON.parse(body).events);
}

function parseXmlTranscript(body) {
  const document = new DOMParser().parseFromString(body, "text/xml");
  const parserError = document.querySelector("parsererror");

  if (parserError) {
    throw new Error("Invalid XML transcript response");
  }

  return Array.from(document.querySelectorAll("text"))
    .map((node) => ({
      startMs: Math.round(Number(node.getAttribute("start") || 0) * 1000),
      durationMs: Math.round(Number(node.getAttribute("dur") || 0) * 1000),
      text: (node.textContent || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((segment) => segment.text);
}

function parseVttTimestamp(timestamp) {
  const parts = timestamp.trim().split(":");
  const seconds = Number(parts.pop() || 0);
  const minutes = Number(parts.pop() || 0);
  const hours = Number(parts.pop() || 0);

  return Math.round(((hours * 60 * 60) + (minutes * 60) + seconds) * 1000);
}

function parseVttTranscript(body) {
  const blocks = body.replace(/\r/g, "").split("\n\n");

  return blocks
    .map((block) => {
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));

      if (timingIndex === -1) {
        return null;
      }

      const [start, end] = lines[timingIndex].split("-->").map((value) => value.trim().split(" ")[0]);
      const startMs = parseVttTimestamp(start);
      const endMs = parseVttTimestamp(end);
      const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

      return {
        startMs,
        durationMs: Math.max(0, endMs - startMs),
        text,
      };
    })
    .filter((segment) => segment?.text);
}

function parseTranscriptBody(body, format) {
  if (format === "json3") {
    return parseJsonTranscript(body);
  }

  if (format === "srv3" || !format) {
    return parseXmlTranscript(body);
  }

  return parseVttTranscript(body);
}

function parseTranscriptBodyAuto(body) {
  const trimmedBody = body.trim();
  const parsers = [];

  if (trimmedBody.startsWith("{")) {
    parsers.push(() => parseJsonTranscript(trimmedBody));
  }

  if (trimmedBody.startsWith("<")) {
    parsers.push(() => parseXmlTranscript(trimmedBody));
  }

  parsers.push(() => parseVttTranscript(trimmedBody));
  parsers.push(() => parseJsonTranscript(trimmedBody));
  parsers.push(() => parseXmlTranscript(trimmedBody));

  for (const parser of parsers) {
    try {
      const segments = parser();

      if (segments.length) {
        return segments;
      }
    } catch (_error) {
      // Try the next format.
    }
  }

  return [];
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

async function captureNextPlayerCaptionRequest() {
  await ensurePageCaptionCapturerInjected();

  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${playerCaptionCaptureRequestId += 1}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("Timed out waiting for YouTube caption request"));
    }, 14000);

    function handleMessage(event) {
      if (event.source !== window
        || event.data?.source !== "yt-translator-caption-capturer"
        || event.data.type !== "PLAYER_CAPTION_CAPTURE_RESULT"
        || event.data.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);

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
    const capturePromise = captureNextPlayerCaptionRequest();
    await triggerPlayerCaptionLoad(wasEnabled);
    const captured = await capturePromise;
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
  const formats = [null, "json3", "srv3", "vtt"];
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

  if (!button || button.dataset.initialized === "true") {
    return;
  }

  button.dataset.initialized = "true";
  button.addEventListener("click", () => loadTranscriptFromPlayerCaptions(false));
}

function isWatchPage() {
  return window.location.pathname === "/watch";
}

function removeSidebar() {
  document.getElementById(SIDEBAR_ID)?.remove();
  window.clearInterval(captionRiverTimer);
}

function getRecommendationsColumn() {
  return document.querySelector("ytd-watch-flexy #secondary-inner")
    || document.querySelector("#secondary-inner")
    || document.querySelector("#secondary");
}

function createSidebar() {
  if (!isWatchPage()) {
    removeSidebar();
    return;
  }

  if (document.getElementById(SIDEBAR_ID)) {
    updateSidebarTitle();
    setupSidebarActions();
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
    <h2 class="yt-translator-sidebar__heading">Current Video</h2>
    <p id="${TITLE_ID}" class="yt-translator-sidebar__title"></p>
    <div class="yt-translator-sidebar__section">
      <h3 class="yt-translator-sidebar__subheading">Transcript</h3>
      <p id="${TRANSCRIPT_STATUS_ID}" class="yt-translator-sidebar__status">Loading transcript...</p>
      <button id="${PLAYER_CAPTURE_BUTTON_ID}" class="yt-translator-sidebar__button" type="button" hidden>
        Load transcript by enabling captions briefly
      </button>
      <div class="yt-translator-caption-river-wrap">
        <div class="yt-translator-sidebar__label">Caption River</div>
        <div id="${CAPTION_RIVER_ID}" class="yt-translator-caption-river">Caption river will appear after transcript loads.</div>
      </div>
      <div id="${TRANSCRIPT_ID}" class="yt-translator-transcript"></div>
    </div>
  `;

  recommendationsColumn.prepend(sidebar);
  setupSidebarActions();
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
  isCaptionRiverPausedForAd = false;
  window.clearInterval(captionRiverTimer);
  scheduleSidebarUpdate();
}

createSidebar();

window.addEventListener("yt-navigate-finish", handleNavigation);
window.addEventListener("yt-page-data-updated", handleNavigation);
window.addEventListener("popstate", handleNavigation);
