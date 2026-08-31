(() => {
  // frontend/src/content/shared/storage-keys.js
  var LATENCY_DIAGNOSTICS_STORAGE_KEY = "ytTranslatorLatencyDiagnostics";

  // frontend/src/background.js
  var BACKEND_CHAT_URL = "http://127.0.0.1:8000/api/chat";
  var BACKEND_TRANSLATE_URL = "http://127.0.0.1:8000/api/translate";
  var BACKEND_TRANSLATE_LEARNING_URL = "http://127.0.0.1:8000/api/translate/learning";
  var CHAT_REQUEST_TIMEOUT_MS = 15e3;
  var TRANSLATE_REQUEST_TIMEOUT_MS = 1e4;
  var TRANSLATE_LEARNING_REQUEST_TIMEOUT_MS = 15e3;
  var MAX_LATENCY_DIAGNOSTICS_RECORDS = 100;
  function createLatencyRequestId() {
    if (globalThis.crypto?.randomUUID) {
      return `yttr_${globalThis.crypto.randomUUID()}`;
    }
    return `yttr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
  function getNowMs() {
    return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  }
  function getBackendEndpoint(backendUrl) {
    try {
      return new URL(backendUrl).pathname;
    } catch (_error) {
      return backendUrl;
    }
  }
  function getTextLength(value) {
    return typeof value === "string" ? value.trim().length : 0;
  }
  function getPayloadMetrics(payload, payloadJson) {
    const videoContext = payload?.videoContext || payload?.video_context || {};
    const history = Array.isArray(payload?.history) ? payload.history : [];
    return {
      payloadBytes: payloadJson.length,
      textLength: getTextLength(payload?.text),
      messageLength: getTextLength(payload?.message),
      historyCount: history.length,
      transcriptContextLength: getTextLength(
        videoContext.transcriptContext || videoContext.transcript_context
      ),
      selectedCaptionTextLength: getTextLength(
        videoContext.selectedCaptionText || videoContext.selected_caption_text
      ),
      titleLength: getTextLength(videoContext.title),
      videoId: videoContext.videoId || videoContext.video_id || null,
      sourceLanguage: payload?.sourceLanguage || payload?.source_language || null,
      targetLanguage: payload?.targetLanguage || payload?.target_language || null
    };
  }
  function getStoredLatencyRecords(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (Array.isArray(value?.records)) {
      return value.records;
    }
    if (Array.isArray(value?.requests)) {
      return value.requests;
    }
    return [];
  }
  function saveLatencyDiagnosticsRecord(record) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return;
    }
    chrome.storage.local.get([LATENCY_DIAGNOSTICS_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        return;
      }
      const currentRecords = getStoredLatencyRecords(result?.[LATENCY_DIAGNOSTICS_STORAGE_KEY]);
      const records = [...currentRecords, record].slice(-MAX_LATENCY_DIAGNOSTICS_RECORDS);
      chrome.storage.local.set({
        [LATENCY_DIAGNOSTICS_STORAGE_KEY]: {
          records,
          maxRecords: MAX_LATENCY_DIAGNOSTICS_RECORDS,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    });
  }
  function getResponseMetrics(body) {
    return {
      responseTextLength: getTextLength(body?.translatedText || body?.message),
      chunkCount: Array.isArray(body?.chunks) ? body.chunks.length : null,
      detectedSourceLanguage: body?.detectedSourceLanguage || null,
      sourceLanguage: body?.sourceLanguage || null,
      targetLanguage: body?.targetLanguage || null,
      provider: body?.provider || body?.diagnostics?.provider || null,
      model: body?.model || body?.diagnostics?.model || null,
      thinkingLevel: body?.thinkingLevel || body?.diagnostics?.thinkingLevel || null,
      backendTotalMs: body?.diagnostics?.backendTotalMs ?? null,
      providerMs: body?.diagnostics?.providerMs ?? null,
      parseMs: body?.diagnostics?.parseMs ?? null,
      backendRequestId: body?.diagnostics?.requestId || null,
      promptLength: body?.diagnostics?.promptLength ?? null,
      maxOutputTokens: body?.diagnostics?.maxOutputTokens ?? null,
      structuredOutput: body?.diagnostics?.structuredOutput ?? null
    };
  }
  function getBackendError(response, body, rawBody, backendUrl, requestLabel) {
    const detail = body?.detail;
    const baseDetails = {
      source: "fastapi",
      status: response.status,
      statusText: response.statusText,
      backendUrl
    };
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      return {
        message: detail.message || `Backend ${requestLabel} request failed with ${response.status}`,
        details: {
          ...baseDetails,
          code: detail.code,
          hint: detail.hint,
          backendDetails: detail.details
        }
      };
    }
    if (typeof detail === "string") {
      return {
        message: detail,
        details: baseDetails
      };
    }
    return {
      message: rawBody || `Backend ${requestLabel} request failed with ${response.status}`,
      details: baseDetails
    };
  }
  function sendBackendRequest({
    backendUrl,
    payload,
    requestLabel,
    sendResponse,
    timeoutMs,
    buildSuccessResponse
  }) {
    const requestId = createLatencyRequestId();
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const startMs = getNowMs();
    const payloadJson = JSON.stringify(payload);
    const baseRecord = {
      requestId,
      timestamp: startedAt,
      type: requestLabel,
      endpoint: getBackendEndpoint(backendUrl),
      backendUrl,
      timeoutMs,
      ...getPayloadMetrics(payload, payloadJson)
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-YT-Translator-Request-Id": requestId
      },
      body: payloadJson,
      signal: controller.signal
    }).then(async (response) => {
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
      const successResponse = buildSuccessResponse(body);
      saveLatencyDiagnosticsRecord({
        ...baseRecord,
        status: "ok",
        ok: true,
        totalMs: Math.round(getNowMs() - startMs),
        httpStatus: response.status,
        rawResponseBytes: rawBody.length,
        ...getResponseMetrics(body)
      });
      sendResponse(successResponse);
    }).catch((error) => {
      const message = error.name === "AbortError" ? `Backend ${requestLabel} request timed out` : error.message;
      const details = error.details || {
        source: "background",
        code: error.name === "AbortError" ? "BACKEND_TIMEOUT" : "BACKEND_REQUEST_FAILED",
        backendUrl
      };
      saveLatencyDiagnosticsRecord({
        ...baseRecord,
        status: "error",
        ok: false,
        totalMs: Math.round(getNowMs() - startMs),
        errorName: error.name || null,
        errorMessage: message,
        errorCode: details.code || details.backendDetails?.code || null,
        httpStatus: details.status || null,
        backendErrorDetails: details.backendDetails || null
      });
      sendResponse({ ok: false, error: message, errorDetails: details });
    }).finally(() => {
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
        model: body.model
      })
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
        targetLanguage: payload?.targetLanguage || "en"
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
        provider: body.provider
      })
    });
  }
  function sendBackendTranslateLearningReply(payload, sendResponse) {
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) {
      sendResponse({ ok: false, error: "Missing text to translate" });
      return;
    }
    sendBackendRequest({
      backendUrl: BACKEND_TRANSLATE_LEARNING_URL,
      payload: {
        ...payload,
        text,
        targetLanguage: payload?.targetLanguage || "en"
      },
      requestLabel: "learning translation",
      sendResponse,
      timeoutMs: TRANSLATE_LEARNING_REQUEST_TIMEOUT_MS,
      buildSuccessResponse: (body) => ({
        ok: true,
        translatedText: body.translatedText || "",
        chunks: Array.isArray(body.chunks) ? body.chunks : [],
        detectedSourceLanguage: body.detectedSourceLanguage,
        sourceLanguage: body.sourceLanguage,
        targetLanguage: body.targetLanguage,
        provider: body.provider,
        model: body.model
      })
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
    if (message?.type === "TRANSLATE_WITH_BREAKDOWN") {
      sendBackendTranslateLearningReply(message.payload, sendResponse);
      return true;
    }
    return false;
  });
})();
//# sourceMappingURL=background.js.map
