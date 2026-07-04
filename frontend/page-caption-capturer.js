(() => {
  if (window.__ytTranslatorCaptionCapturerInstalled) {
    return;
  }

  window.__ytTranslatorCaptionCapturerInstalled = true;
  const captures = new Map();

  function isCaptionUrl(url) {
    return typeof url === "string" && url.includes("timedtext");
  }

  function finishCapture(body, url) {
    if (!body.trim()) {
      return;
    }

    for (const [requestId, capture] of captures) {
      window.clearTimeout(capture.timeout);
      captures.delete(requestId);
      window.postMessage({
        source: "yt-translator-caption-capturer",
        type: "PLAYER_CAPTION_CAPTURE_RESULT",
        requestId,
        ok: true,
        body,
        url,
      }, "*");
    }
  }

  function failCapture(requestId, error) {
    const capture = captures.get(requestId);

    if (!capture) {
      return;
    }

    window.clearTimeout(capture.timeout);
    captures.delete(requestId);
    window.postMessage({
      source: "yt-translator-caption-capturer",
      type: "PLAYER_CAPTION_CAPTURE_RESULT",
      requestId,
      ok: false,
      error,
    }, "*");
  }

  const originalFetch = window.fetch;

  window.fetch = async function patchedFetch(...args) {
    const response = await originalFetch.apply(this, args);
    const url = response.url || String(args[0]?.url || args[0] || "");

    if (isCaptionUrl(url) && captures.size) {
      response.clone().text()
        .then((body) => finishCapture(body, url))
        .catch(() => {});
    }

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...args) {
    this.__ytTranslatorUrl = String(url || "");
    return originalOpen.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    if (isCaptionUrl(this.__ytTranslatorUrl)) {
      this.addEventListener("loadend", () => {
        if (!captures.size) {
          return;
        }

        try {
          finishCapture(this.responseText || "", this.__ytTranslatorUrl);
        } catch (_error) {
          // Ignore binary/non-text responses.
        }
      });
    }

    return originalSend.apply(this, args);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "yt-translator-content") {
      return;
    }

    if (event.data.type !== "START_PLAYER_CAPTION_CAPTURE") {
      return;
    }

    const requestId = event.data.requestId;
    const timeout = window.setTimeout(() => {
      failCapture(requestId, "Timed out waiting for YouTube caption request");
    }, event.data.timeoutMs || 12000);

    captures.set(requestId, { timeout });
  });
})();
