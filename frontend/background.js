const BACKEND_CHAT_URL = "http://127.0.0.1:8000/api/chat";
const CHAT_REQUEST_TIMEOUT_MS = 15000;

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

function getBackendError(response, body, rawBody) {
  const detail = body?.detail;
  const baseDetails = {
    source: "fastapi",
    status: response.status,
    statusText: response.statusText,
    backendUrl: BACKEND_CHAT_URL,
  };

  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return {
      message: detail.message || `Backend chat request failed with ${response.status}`,
      details: {
        ...baseDetails,
        code: detail.code,
        hint: detail.hint,
        backendDetails: detail.details,
      },
    };
  }

  if (typeof detail === "string") {
    return {
      message: detail,
      details: baseDetails,
    };
  }

  return {
    message: rawBody || `Backend chat request failed with ${response.status}`,
    details: baseDetails,
  };
}

function sendBackendChatReply(payload, sendResponse) {
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";

  if (!message) {
    sendResponse({ ok: false, error: "Missing chat message" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);

  fetch(BACKEND_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (response) => {
      const rawBody = await response.text();
      let body = {};

      try {
        body = rawBody ? JSON.parse(rawBody) : {};
      } catch (_error) {
        body = {};
      }

      if (!response.ok) {
        const backendError = getBackendError(response, body, rawBody);
        const error = new Error(backendError.message);
        error.details = backendError.details;
        throw error;
      }

      sendResponse({
        ok: true,
        message: body.message || "The backend returned an empty response.",
        model: body.model,
      });
    })
    .catch((error) => {
      const message = error.name === "AbortError"
        ? "Backend chat request timed out"
        : error.message;
      const details = error.details || {
        source: "background",
        code: error.name === "AbortError" ? "BACKEND_TIMEOUT" : "BACKEND_REQUEST_FAILED",
        backendUrl: BACKEND_CHAT_URL,
      };

      sendResponse({ ok: false, error: message, errorDetails: details });
    })
    .finally(() => {
      clearTimeout(timeout);
    });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHAT_PROMPT") {
    sendBackendChatReply(message.payload, sendResponse);
    return true;
  }

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
