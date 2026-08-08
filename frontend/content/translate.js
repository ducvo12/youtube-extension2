// Called externally by caption selection handlers and internally by submitTranslatePrompt.
// Clears the selected-caption translation result and cancels older in-flight output.
function resetTranslateState() {
  activeTranslateRequest += 1;
  isTranslateWaiting = false;
  translateResult = "";
  translateChunks = [];
  translateError = "";
  translateErrorDetails = null;
}

// Internal helper for submitTranslatePrompt.
// Sends a translate request to the extension background script.
function sendTranslatePromptToBackground(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "TRANSLATE_WITH_BREAKDOWN", payload }, (response) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response?.ok) {
        const error = new Error(response?.error || "Translate request failed");
        error.details = response?.errorDetails;
        reject(error);
        return;
      }

      resolve(response);
    });
  });
}

// Called externally by selected caption controls.
// Translates the currently highlighted caption text and renders the English response.
async function submitTranslatePrompt() {
  if (isTranslateWaiting) {
    return;
  }

  const text = selectedCaptionText.trim();

  if (!text) {
    resetTranslateState();
    renderSelectedCaptionPill();
    return;
  }

  isTranslateWaiting = true;
  translateResult = "";
  translateChunks = [];
  translateError = "";
  translateErrorDetails = null;
  const requestId = activeTranslateRequest + 1;
  activeTranslateRequest = requestId;
  renderSelectedCaptionPill();

  try {
    const response = await sendTranslatePromptToBackground({
      text,
      targetLanguage: "en",
    });

    if (requestId !== activeTranslateRequest) {
      return;
    }

    translateResult = response.translatedText || "The backend returned an empty translation.";
    translateChunks = Array.isArray(response.chunks) ? response.chunks : [];
  } catch (error) {
    if (requestId !== activeTranslateRequest) {
      return;
    }

    translateError = `Unable to translate: ${error.message}`;
    translateErrorDetails = error.details || {
      source: "content-script",
      message: error.message,
    };
  } finally {
    if (requestId === activeTranslateRequest) {
      isTranslateWaiting = false;
      renderSelectedCaptionPill();
    }
  }
}
