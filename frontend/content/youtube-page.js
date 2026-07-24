// Reads the current YouTube video title from the page, falling back to document.title.
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

// Reads the current YouTube watch video ID from the URL query string.
function getVideoId() {
  return new URLSearchParams(window.location.search).get("v");
}

// Internal helper for getPlaybackTimeMs.
// Finds the main YouTube video element.
function getVideoElement() {
  return document.querySelector("video.html5-main-video") || document.querySelector("video");
}

// Reads the current playback position in milliseconds.
function getPlaybackTimeMs() {
  const player = document.getElementById("movie_player");
  const playerTime = player?.getCurrentTime?.();

  if (Number.isFinite(playerTime)) {
    return playerTime * 1000;
  }

  const video = getVideoElement();

  if (!video) {
    return null;
  }

  return video.currentTime * 1000;
}

// Detects whether YouTube is currently showing an ad instead of the main video.
function isAdShowing() {
  const player = document.getElementById("movie_player");
  const adState = player?.getAdState?.();
  const adElements = [
    ".ytp-ad-player-overlay",
    ".ytp-ad-text",
    ".ytp-ad-preview-container",
    ".ytp-ad-message-container",
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-overlay-container",
    ".video-ads .ytp-ad-module",
  ];

  return Boolean(player?.classList.contains("ad-showing")
    || player?.classList.contains("ad-interrupting")
    || (typeof adState === "number" && adState !== 0)
    || adElements.some((selector) => {
      const element = document.querySelector(selector);
      return Boolean(element
        && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
    }));
}

// Internal helper for getPlayerResponseFromScripts.
// Extracts a balanced JSON object string.
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

// Internal helper for getCaptionTracksFromPage.
// Parses ytInitialPlayerResponse from scripts.
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

// Internal helper for getCaptionTracksFromPage.
// Reads YouTube's player response from DOM properties.
function getPlayerResponseFromDom() {
  const watchFlexy = document.querySelector("ytd-watch-flexy");

  return watchFlexy?.playerResponse
    || watchFlexy?.playerData?.playerResponse
    || document.querySelector("ytd-app")?.data?.playerResponse
    || null;
}

// Reads caption track metadata from the current YouTube page.
function getCaptionTracksFromPage() {
  const playerResponse = getPlayerResponseFromDom() || getPlayerResponseFromScripts();

  return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

// Checks whether the current YouTube route is a video watch page.
function isWatchPage() {
  return window.location.pathname === "/watch";
}

// Finds the right-side recommendations column where the extension sidebar is inserted.
function getRecommendationsColumn() {
  return document.querySelector("ytd-watch-flexy #secondary-inner")
    || document.querySelector("#secondary-inner")
    || document.querySelector("#secondary");
}
