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

function getPlayerResponseFromHtml(html) {
  const markerIndex = html.indexOf("ytInitialPlayerResponse");

  if (markerIndex === -1) {
    return null;
  }

  const json = extractJsonObject(html, markerIndex);

  if (!json) {
    return null;
  }

  return JSON.parse(json);
}

function sendCaptionTracks(videoId, sendResponse) {
  const watchUrl = new URL("https://www.youtube.com/watch");
  watchUrl.searchParams.set("v", videoId);
  watchUrl.searchParams.set("hl", "en");

  fetch(watchUrl.toString(), { credentials: "include" })
    .then(async (response) => {
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`Watch page request failed with ${response.status}: ${body.slice(0, 120)}`);
      }

      const playerResponse = getPlayerResponseFromHtml(body);
      const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

      sendResponse({ ok: true, tracks });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
}

function sendTranscript(url, sendResponse) {
  fetch(url.toString(), { credentials: "include" })
    .then(async (response) => {
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`Caption request failed with ${response.status}: ${body.slice(0, 120)}`);
      }

      sendResponse({ ok: true, body });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_CAPTION_TRACKS") {
    if (!message.videoId) {
      sendResponse({ ok: false, error: "Missing video ID" });
      return false;
    }

    sendCaptionTracks(message.videoId, sendResponse);
    return true;
  }

  if (message?.type !== "FETCH_TRANSCRIPT") {
    return false;
  }

  let url;

  try {
    url = new URL(message.url);
  } catch (_error) {
    sendResponse({ ok: false, error: "Invalid transcript URL" });
    return false;
  }

  const isSupportedHost = url.hostname === "youtube.com"
    || url.hostname.endsWith(".youtube.com")
    || url.hostname.endsWith(".googlevideo.com");

  if (url.protocol !== "https:" || !isSupportedHost) {
    sendResponse({ ok: false, error: "Unsupported transcript URL" });
    return false;
  }

  sendTranscript(url, sendResponse);

  return true;
});
