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

// Finds the main YouTube video element used for playback time fallback.
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

  return Boolean(player?.classList.contains("ad-showing")
    || player?.classList.contains("ad-interrupting")
    || document.querySelector(".ytp-ad-player-overlay")
    || document.querySelector(".ytp-ad-text"));
}

// Extracts a balanced JSON object string from embedded YouTube page JavaScript.
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

// Finds and parses ytInitialPlayerResponse from inline YouTube script tags.
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

// Reads YouTube's player response from Polymer-backed DOM properties when available.
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
