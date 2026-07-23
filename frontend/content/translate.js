// Internal helper for submitTranslatePrompt.
// Disables or restores the temporary translate controls while the backend responds.
function setTranslateControlsWaiting(isWaiting) {
  const input = document.getElementById(TRANSLATE_INPUT_ID);
  const button = document.getElementById(TRANSLATE_BUTTON_ID);

  if (input) {
    input.disabled = isWaiting;
  }

  if (button) {
    button.disabled = isWaiting;
    button.textContent = isWaiting ? "Translating..." : "Translate";
  }
}

// Called externally by sidebar.js and internally by submitTranslatePrompt.
// Renders the temporary translation box result area.
function renderTranslateBox() {
  const resultNode = document.getElementById(TRANSLATE_RESULT_ID);

  setTranslateControlsWaiting(isTranslateWaiting);

  if (!resultNode) {
    return;
  }

  resultNode.textContent = "";
  resultNode.hidden = !isTranslateWaiting && !translateResult && !translateError;
  resultNode.classList.toggle("yt-translator-translate-result--error", Boolean(translateError));

  if (isTranslateWaiting) {
    resultNode.textContent = "Translating...";
    return;
  }

  if (translateError) {
    const message = document.createElement("p");
    message.className = "yt-translator-translate-result__text";
    message.textContent = translateError;
    resultNode.appendChild(message);

    if (translateErrorDetails) {
      const details = document.createElement("details");
      details.className = "yt-translator-translate-result__details";

      const summary = document.createElement("summary");
      summary.textContent = "Error details";

      const detailsText = document.createElement("pre");
      detailsText.textContent = JSON.stringify(translateErrorDetails, null, 2);

      details.append(summary, detailsText);
      resultNode.appendChild(details);
    }

    return;
  }

  if (translateResult) {
    const label = document.createElement("div");
    label.className = "yt-translator-translate-result__label";
    label.textContent = "English";

    const text = document.createElement("p");
    text.className = "yt-translator-translate-result__text";
    text.textContent = translateResult;

    resultNode.append(label, text);
  }
}

// Internal helper for submitTranslatePrompt.
// Sends a translate request to the extension background script.
function sendTranslatePromptToBackground(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "TRANSLATE_TEXT", payload }, (response) => {
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

// Called externally by sidebar.js.
// Submits text from the temporary translation box and renders the English response.
async function submitTranslatePrompt() {
  const input = document.getElementById(TRANSLATE_INPUT_ID);

  if (!input || isTranslateWaiting) {
    return;
  }

  const text = input.value.trim();

  if (!text) {
    input.value = "";
    translateResult = "";
    translateError = "";
    translateErrorDetails = null;
    renderTranslateBox();
    return;
  }

  isTranslateWaiting = true;
  translateResult = "";
  translateError = "";
  translateErrorDetails = null;
  const requestId = activeTranslateRequest + 1;
  activeTranslateRequest = requestId;
  renderTranslateBox();

  try {
    const response = await sendTranslatePromptToBackground({
      text,
      targetLanguage: "en",
    });

    if (requestId !== activeTranslateRequest) {
      return;
    }

    translateResult = response.translatedText || "The backend returned an empty translation.";
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
      renderTranslateBox();
      document.getElementById(TRANSLATE_INPUT_ID)?.focus();
    }
  }
}
