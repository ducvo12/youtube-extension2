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

// Internal helper for renderChatRiver.
// Converts a small Markdown subset into DOM nodes without interpreting model output as HTML.
function renderAssistantMarkdown(markdown) {
  const fragment = document.createDocumentFragment();
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let paragraphLines = [];
  let currentList = null;

  function flushParagraph() {
    if (!paragraphLines.length) {
      return;
    }

    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join(" "));
    fragment.appendChild(paragraph);
    paragraphLines = [];
  }

  function closeList() {
    currentList = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);

    if (bulletMatch) {
      flushParagraph();

      if (!currentList) {
        currentList = document.createElement("ul");
        fragment.appendChild(currentList);
      }

      const item = document.createElement("li");
      appendInlineMarkdown(item, bulletMatch[1]);
      currentList.appendChild(item);
      continue;
    }

    closeList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();

  return fragment;
}

// Internal helper for renderAssistantMarkdown.
// Supports the formatting the assistant usually returns: bold, italics, and inline code.
function appendInlineMarkdown(parent, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const token = match[0];

    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else if (token.startsWith("*")) {
      const emphasis = document.createElement("em");
      emphasis.textContent = token.slice(1, -1);
      parent.appendChild(emphasis);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

// Internal helper for buildChatPayload.
// Collects nearby transcript text to send as video context with the chat prompt.
function getTranscriptContextPreview() {
  if (!currentTranscriptSegments.length) {
    return "";
  }

  const activeIndex = currentCaptionIndex >= 0 ? currentCaptionIndex : 0;
  const startIndex = Math.max(0, activeIndex - 4);
  const endIndex = Math.min(currentTranscriptSegments.length, activeIndex + 2);

  return currentTranscriptSegments
    .slice(startIndex, endIndex)
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

function createSelectedCaptionClearButton() {
  const clearButton = document.createElement("button");
  clearButton.className = "yt-translator-selected-caption__clear";
  clearButton.type = "button";
  clearButton.textContent = "x";
  clearButton.setAttribute("aria-label", "Clear selected caption text");

  clearButton.addEventListener("click", () => {
    selectedCaptionText = "";
    resetTranslateState();
    window.getSelection()?.removeAllRanges();
    renderSelectedCaptionPill();
    document.getElementById(CHAT_INPUT_ID)?.focus();
  });

  return clearButton;
}

function createSelectedCaptionChunkNode(chunk) {
  const chunkNode = document.createElement("span");
  chunkNode.className = "yt-translator-selected-caption__chunk";
  chunkNode.tabIndex = 0;
  chunkNode.textContent = chunk.source;

  const tooltip = document.createElement("span");
  tooltip.className = "yt-translator-selected-caption__tooltip";
  tooltip.setAttribute("role", "tooltip");

  const definition = document.createElement("span");
  definition.className = "yt-translator-selected-caption__tooltip-definition";
  definition.textContent = chunk.definition || "No definition returned.";
  tooltip.appendChild(definition);

  if (chunk.natural) {
    const natural = document.createElement("span");
    natural.className = "yt-translator-selected-caption__tooltip-meta";
    natural.textContent = `Maps to: ${chunk.natural}`;
    tooltip.appendChild(natural);
  }

  if (chunk.role) {
    const role = document.createElement("span");
    role.className = "yt-translator-selected-caption__tooltip-meta";
    role.textContent = chunk.role;
    tooltip.appendChild(role);
  }

  if (chunk.note) {
    const note = document.createElement("span");
    note.className = "yt-translator-selected-caption__tooltip-note";
    note.textContent = chunk.note;
    tooltip.appendChild(note);
  }

  chunkNode.appendChild(tooltip);
  return chunkNode;
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
  contextNode.hidden = false;
  contextNode.classList.toggle("yt-translator-selected-caption--empty", !selectedCaptionText);
  contextNode.classList.toggle(
    "yt-translator-selected-caption--translated",
    Boolean(isTranslateWaiting || translateResult || translateError)
  );

  if (!selectedCaptionText) {
    const label = document.createElement("span");
    label.className = "yt-translator-selected-caption__label";
    label.textContent = "Tip";

    const text = document.createElement("span");
    text.className = "yt-translator-selected-caption__text yt-translator-selected-caption__text--empty";
    text.textContent = "Highlight captions to select";

    contextNode.append(label, text);
    return;
  }

  const header = document.createElement("div");
  header.className = "yt-translator-selected-caption__header";

  const label = document.createElement("span");
  label.className = "yt-translator-selected-caption__label";
  label.textContent = "Selected";

  const actions = document.createElement("div");
  actions.className = "yt-translator-selected-caption__actions";

  const translateButton = document.createElement("button");
  translateButton.id = TRANSLATE_BUTTON_ID;
  translateButton.className = "yt-translator-selected-caption__translate";
  translateButton.type = "button";
  translateButton.textContent = isTranslateWaiting ? "Translating..." : "Translate";
  translateButton.disabled = isTranslateWaiting;
  translateButton.setAttribute("aria-label", "Translate selected caption text");
  translateButton.addEventListener("click", submitTranslatePrompt);

  actions.append(translateButton, createSelectedCaptionClearButton());
  header.append(label, actions);

  const sourceBlock = document.createElement("div");
  sourceBlock.className = "yt-translator-selected-caption__source";

  const sourceText = document.createElement("div");
  sourceText.className = "yt-translator-selected-caption__source-text";

  const chunks = translateChunks.filter((chunk) => chunk?.source);

  if (chunks.length) {
    sourceText.classList.add("yt-translator-selected-caption__source-text--chunked");

    for (const chunk of chunks) {
      sourceText.appendChild(createSelectedCaptionChunkNode(chunk));
    }
  } else {
    sourceText.textContent = selectedCaptionText;
  }

  sourceBlock.appendChild(sourceText);
  contextNode.append(header, sourceBlock);

  if (isTranslateWaiting || translateResult || translateError) {
    const translationBlock = document.createElement("div");
    translationBlock.className = "yt-translator-selected-caption__translation";
    translationBlock.classList.toggle("yt-translator-selected-caption__translation--error", Boolean(translateError));

    const translationLabel = document.createElement("div");
    translationLabel.className = "yt-translator-selected-caption__label";
    translationLabel.textContent = "English";

    const translationText = document.createElement("p");
    translationText.className = "yt-translator-selected-caption__translation-text";
    translationText.textContent = isTranslateWaiting
      ? "Translating..."
      : translateError || translateResult;

    translationBlock.append(translationLabel, translationText);

    if (translateErrorDetails) {
      const details = document.createElement("details");
      details.className = "yt-translator-selected-caption__details";

      const summary = document.createElement("summary");
      summary.textContent = "Error details";

      const detailsText = document.createElement("pre");
      detailsText.textContent = JSON.stringify(translateErrorDetails, null, 2);

      details.append(summary, detailsText);
      translationBlock.appendChild(details);
    }

    contextNode.appendChild(translationBlock);
  }
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

    const content = document.createElement("div");
    content.className = "yt-translator-chat-message__content";

    if (message.status === "sending") {
      content.classList.add("yt-translator-chat-message__content--plain");
      content.textContent = "Thinking...";
    } else if (message.role === "assistant") {
      content.appendChild(renderAssistantMarkdown(message.content));
    } else {
      content.classList.add("yt-translator-chat-message__content--plain");
      content.textContent = message.content;
    }

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
