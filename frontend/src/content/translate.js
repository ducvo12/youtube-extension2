import { renderSelectedCaptionPill } from "./chat.js";
import { ytTranslatorState } from "./state.js";

// Exported for caption selection handlers and translation request flow.
// Clears the selected-caption translation result and cancels older in-flight output.
export function resetTranslateState() {
  ytTranslatorState.translate.activeRequest += 1;
  ytTranslatorState.translate.isWaiting = false;
  ytTranslatorState.translate.result = "";
  ytTranslatorState.translate.chunks = [];
  ytTranslatorState.translate.error = "";
  ytTranslatorState.translate.errorDetails = null;
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

// Exported for the selected-caption translate button.
// Translates the currently highlighted caption text and renders the English response.
export async function submitTranslatePrompt() {
  if (ytTranslatorState.translate.isWaiting) {
    return;
  }

  const text = ytTranslatorState.selection.captionText.trim();

  if (!text) {
    resetTranslateState();
    renderSelectedCaptionPill();
    return;
  }

  ytTranslatorState.translate.isWaiting = true;
  ytTranslatorState.translate.result = "";
  ytTranslatorState.translate.chunks = [];
  ytTranslatorState.translate.error = "";
  ytTranslatorState.translate.errorDetails = null;
  const requestId = ytTranslatorState.translate.activeRequest + 1;
  ytTranslatorState.translate.activeRequest = requestId;
  renderSelectedCaptionPill();

  try {
    const response = await sendTranslatePromptToBackground({
      text,
      targetLanguage: "en",
    });

    if (requestId !== ytTranslatorState.translate.activeRequest) {
      return;
    }

    ytTranslatorState.translate.result = response.translatedText || "The backend returned an empty translation.";
    ytTranslatorState.translate.chunks = Array.isArray(response.chunks) ? response.chunks : [];
  } catch (error) {
    if (requestId !== ytTranslatorState.translate.activeRequest) {
      return;
    }

    ytTranslatorState.translate.error = `Unable to translate: ${error.message}`;
    ytTranslatorState.translate.errorDetails = error.details || {
      source: "content-script",
      message: error.message,
    };
  } finally {
    if (requestId === ytTranslatorState.translate.activeRequest) {
      ytTranslatorState.translate.isWaiting = false;
      renderSelectedCaptionPill();
    }
  }
}
