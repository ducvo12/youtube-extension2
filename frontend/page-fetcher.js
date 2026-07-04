window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "yt-translator-content") {
    return;
  }

  if (event.data.type !== "FETCH_TRANSCRIPT_IN_PAGE") {
    return;
  }

  fetch(event.data.url, { credentials: "include" })
    .then(async (response) => {
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`Page caption request failed with ${response.status}: ${body.slice(0, 120)}`);
      }

      window.postMessage({
        source: "yt-translator-page",
        type: "FETCH_TRANSCRIPT_IN_PAGE_RESULT",
        requestId: event.data.requestId,
        ok: true,
        body,
      }, "*");
    })
    .catch((error) => {
      window.postMessage({
        source: "yt-translator-page",
        type: "FETCH_TRANSCRIPT_IN_PAGE_RESULT",
        requestId: event.data.requestId,
        ok: false,
        error: error.message,
      }, "*");
    });
});
