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

async function captureNextPlayerCaptionRequest(onCaptureStarted = () => { }) {
  await ensurePageCaptionCapturerInjected();

  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${playerCaptionCaptureRequestId += 1}`;
    let settled = false;
    let captureStarted = false;

    function cancelPageCapture() {
      window.postMessage({
        source: "yt-translator-content",
        type: "CANCEL_PLAYER_CAPTION_CAPTURE",
        requestId,
      }, "*");
    }

    function cleanup() {
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
    }

    function rejectCapture(error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      cancelPageCapture();
      reject(error instanceof Error ? error : new Error(error));
    }

    const timeout = window.setTimeout(() => {
      rejectCapture(new Error("Timed out waiting for YouTube caption request"));
    }, 14000);

    function handleMessage(event) {
      if (event.source !== window
        || event.data?.source !== "yt-translator-caption-capturer"
        || event.data.requestId !== requestId) {
        return;
      }

      if (event.data.type === "PLAYER_CAPTION_CAPTURE_STARTED") {
        if (captureStarted) {
          return;
        }

        captureStarted = true;
        Promise.resolve(onCaptureStarted()).catch(rejectCapture);
        return;
      }

      if (event.data.type !== "PLAYER_CAPTION_CAPTURE_RESULT") {
        return;
      }

      if (settled) {
        return;
      }

      settled = true;
      cleanup();

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
    const captured = await captureNextPlayerCaptionRequest(() => triggerPlayerCaptionLoad(wasEnabled));
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
