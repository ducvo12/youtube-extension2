const BACKEND_CHAT_URL = "http://127.0.0.1:8000/api/chat";
const CHAT_REQUEST_TIMEOUT_MS = 15000;

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

  return false;
});
