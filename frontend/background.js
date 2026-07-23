const BACKEND_CHAT_URL = "http://127.0.0.1:8000/api/chat";
const BACKEND_TRANSLATE_URL = "http://127.0.0.1:8000/api/translate";
const CHAT_REQUEST_TIMEOUT_MS = 15000;
const TRANSLATE_REQUEST_TIMEOUT_MS = 10000;

function getBackendError(response, body, rawBody, backendUrl, requestLabel) {
  const detail = body?.detail;
  const baseDetails = {
    source: "fastapi",
    status: response.status,
    statusText: response.statusText,
    backendUrl,
  };

  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    return {
      message: detail.message || `Backend ${requestLabel} request failed with ${response.status}`,
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
    message: rawBody || `Backend ${requestLabel} request failed with ${response.status}`,
    details: baseDetails,
  };
}

function sendBackendRequest({
  backendUrl,
  payload,
  requestLabel,
  sendResponse,
  timeoutMs,
  buildSuccessResponse,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  fetch(backendUrl, {
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
        const backendError = getBackendError(response, body, rawBody, backendUrl, requestLabel);
        const error = new Error(backendError.message);
        error.details = backendError.details;
        throw error;
      }

      sendResponse(buildSuccessResponse(body));
    })
    .catch((error) => {
      const message = error.name === "AbortError"
        ? `Backend ${requestLabel} request timed out`
        : error.message;
      const details = error.details || {
        source: "background",
        code: error.name === "AbortError" ? "BACKEND_TIMEOUT" : "BACKEND_REQUEST_FAILED",
        backendUrl,
      };

      sendResponse({ ok: false, error: message, errorDetails: details });
    })
    .finally(() => {
      clearTimeout(timeout);
    });
}

function sendBackendChatReply(payload, sendResponse) {
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";

  if (!message) {
    sendResponse({ ok: false, error: "Missing chat message" });
    return;
  }

  sendBackendRequest({
    backendUrl: BACKEND_CHAT_URL,
    payload,
    requestLabel: "chat",
    sendResponse,
    timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
    buildSuccessResponse: (body) => ({
      ok: true,
      message: body.message || "The backend returned an empty response.",
      model: body.model,
    }),
  });
}

function sendBackendTranslateReply(payload, sendResponse) {
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";

  if (!text) {
    sendResponse({ ok: false, error: "Missing text to translate" });
    return;
  }

  sendBackendRequest({
    backendUrl: BACKEND_TRANSLATE_URL,
    payload: {
      ...payload,
      text,
      targetLanguage: payload?.targetLanguage || "en",
    },
    requestLabel: "translate",
    sendResponse,
    timeoutMs: TRANSLATE_REQUEST_TIMEOUT_MS,
    buildSuccessResponse: (body) => ({
      ok: true,
      translatedText: body.translatedText || "",
      detectedSourceLanguage: body.detectedSourceLanguage,
      sourceLanguage: body.sourceLanguage,
      targetLanguage: body.targetLanguage,
      provider: body.provider,
    }),
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHAT_PROMPT") {
    sendBackendChatReply(message.payload, sendResponse);
    return true;
  }

  if (message?.type === "TRANSLATE_TEXT") {
    sendBackendTranslateReply(message.payload, sendResponse);
    return true;
  }

  return false;
});
