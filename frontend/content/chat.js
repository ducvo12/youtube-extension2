// Internal helper for submitChatPrompt.
// Creates a chat message record with a unique ID and timestamp.
function createChatMessage(role, content, status = "done") {
  chatMessageCounter += 1;

  return {
    id: `${Date.now()}-${chatMessageCounter}`,
    role,
    content,
    status,
    createdAt: Date.now(),
  };
}

// Internal helper for renderChatRiver.
// Creates the expandable error details node for failed assistant responses.
function createChatErrorDetailsNode(errorDetails) {
  if (!errorDetails) {
    return null;
  }

  const detailsNode = document.createElement("details");
  detailsNode.className = "yt-translator-chat-message__details";

  const summary = document.createElement("summary");
  summary.textContent = "Error details";

  const detailsText = document.createElement("pre");
  detailsText.textContent = JSON.stringify(errorDetails, null, 2);

  detailsNode.append(summary, detailsText);

  return detailsNode;
}

// Internal helper for buildChatPayload.
// Collects nearby transcript text to send as video context with the chat prompt.
function getTranscriptContextPreview() {
  if (!currentTranscriptSegments.length) {
    return "";
  }

  const activeIndex = currentCaptionIndex >= 0 ? currentCaptionIndex : 0;
  const startIndex = Math.max(0, activeIndex - 1);

  return currentTranscriptSegments
    .slice(startIndex, startIndex + 3)
    .map((segment) => segment.text)
    .join(" ");
}

// Internal helper for renderChatRiver.
// Disables or restores the chat input and send button while the assistant is responding.
function setChatControlsWaiting(isWaiting) {
  const input = document.getElementById(CHAT_INPUT_ID);
  const button = document.getElementById(CHAT_SEND_BUTTON_ID);

  if (input) {
    input.disabled = isWaiting;
  }

  if (button) {
    button.disabled = isWaiting;
    button.textContent = isWaiting ? "Thinking..." : "Send";
  }
}

// Internal helper for renderChatRiver.
// Keeps the chat message list scrolled to the newest message.
function scrollChatRiverToBottom() {
  const river = document.getElementById(CHAT_RIVER_ID);

  if (river) {
    river.scrollTop = river.scrollHeight;
  }
}

// Called externally by content.js.
// Renders the selected caption pill shown above the chat input.
// Gets called when user highlights captions in caption river (highlight state changes)
function renderSelectedCaptionPill() {
  const contextNode = document.getElementById(SELECTED_CAPTION_ID);

  if (!contextNode) {
    return;
  }

  contextNode.textContent = "";
  contextNode.hidden = !selectedCaptionText;

  if (!selectedCaptionText) {
    return;
  }

  const label = document.createElement("span");
  label.className = "yt-translator-selected-caption__label";
  label.textContent = "Selected";

  const text = document.createElement("span");
  text.className = "yt-translator-selected-caption__text";
  text.textContent = selectedCaptionText;

  const translateButton = document.createElement("button");
  translateButton.id = TRANSLATE_BUTTON_ID;
  translateButton.className = "yt-translator-selected-caption__translate";
  translateButton.type = "button";
  translateButton.textContent = isTranslateWaiting ? "Translating..." : "Translate";
  translateButton.disabled = isTranslateWaiting;
  translateButton.setAttribute("aria-label", "Translate selected caption text");
  translateButton.addEventListener("click", submitTranslatePrompt);

  // Button to remove the selected caption pill
  const clearButton = document.createElement("button");
  clearButton.className = "yt-translator-selected-caption__clear";
  clearButton.type = "button";
  clearButton.textContent = "x";
  clearButton.setAttribute("aria-label", "Clear selected caption text");

  // Attaches itself for future clicks
  clearButton.addEventListener("click", () => {
    selectedCaptionText = "";
    resetTranslateState();
    window.getSelection()?.removeAllRanges();
    renderSelectedCaptionPill();
    renderTranslateBox();
    document.getElementById(CHAT_INPUT_ID)?.focus();
  });

  contextNode.append(label, text, translateButton, clearButton);
  renderTranslateBox();
}

// Called externally by content.js and internally by submitChatPrompt.
// Renders all chat messages and updates the chat controls.
// Is called when chat state changes.
function renderChatRiver() {
  const river = document.getElementById(CHAT_RIVER_ID);

  if (!river) {
    return;
  }

  river.textContent = "";
  river.hidden = !chatMessages.length;

  if (!chatMessages.length) {
    setChatControlsWaiting(isChatWaitingForReply);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const message of chatMessages) {
    const messageNode = document.createElement("article");
    messageNode.className = `yt-translator-chat-message yt-translator-chat-message--${message.role}`;

    if (message.status === "error") {
      messageNode.classList.add("yt-translator-chat-message--error");
    }

    const role = document.createElement("div");
    role.className = "yt-translator-chat-message__role";
    role.textContent = message.role === "user" ? "You" : "Assistant";

    const content = document.createElement("p");
    content.className = "yt-translator-chat-message__content";
    content.textContent = message.status === "sending" ? "Thinking..." : message.content;

    messageNode.append(role, content);

    if (message.status === "error") {
      const detailsNode = createChatErrorDetailsNode(message.errorDetails);

      if (detailsNode) {
        messageNode.appendChild(detailsNode);
      }
    }

    fragment.appendChild(messageNode);
  }

  river.appendChild(fragment);
  setChatControlsWaiting(isChatWaitingForReply);
  scrollChatRiverToBottom();
}

// Internal helper for submitChatPrompt.
// Builds the background chat request payload from the prompt, history, and video context.
function buildChatPayload(prompt) {
  return {
    message: prompt,
    history: chatMessages
      .filter((message) => message.status === "done")
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
    videoContext: {
      videoId: getVideoId(),
      title: getVideoTitle(),
      transcriptContext: getTranscriptContextPreview(),
      selectedCaptionText: selectedCaptionText || null,
    },
  };
}

// Internal helper for submitChatPrompt.
// Sends a chat request to the extension background script.
function sendChatPromptToBackground(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "CHAT_PROMPT", payload }, (response) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }

      if (!response?.ok) {
        const error = new Error(response?.error || "Chat request failed");
        error.details = response?.errorDetails;
        reject(error);
        return;
      }

      resolve(response);
    });
  });
}

// Called externally by content.js.
// Submits the current chat prompt, renders pending state, and applies the assistant response.
async function submitChatPrompt() {
  const input = document.getElementById(CHAT_INPUT_ID);

  if (!input || isChatWaitingForReply) {
    return;
  }

  const prompt = input.value.trim();

  if (!prompt) {
    input.value = "";
    return;
  }

  input.value = "";
  isChatWaitingForReply = true;
  chatMessages.push(createChatMessage("user", prompt));
  const pendingReply = createChatMessage("assistant", "", "sending");
  chatMessages.push(pendingReply);
  const requestId = activeChatRequest + 1;
  activeChatRequest = requestId;
  renderChatRiver();

  try {
    const response = await sendChatPromptToBackground(buildChatPayload(prompt));

    if (requestId !== activeChatRequest) {
      return;
    }

    pendingReply.content = response.message || "The assistant returned an empty response.";
    pendingReply.status = "done";
  } catch (error) {
    if (requestId !== activeChatRequest) {
      return;
    }

    pendingReply.content = `Unable to get a response: ${error.message}`;
    pendingReply.errorDetails = error.details || {
      source: "content-script",
      message: error.message,
    };
    pendingReply.status = "error";
  } finally {
    if (requestId === activeChatRequest) {
      isChatWaitingForReply = false;
      renderChatRiver();
      document.getElementById(CHAT_INPUT_ID)?.focus();
    }
  }
}
