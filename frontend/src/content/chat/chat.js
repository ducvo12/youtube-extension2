import {
  CHAT_INPUT_ID,
  CHAT_RIVER_ID,
  CHAT_SEND_BUTTON_ID,
} from "../dom-ids.js";
import { renderAssistantMarkdown } from "./markdown.js";
import { renderSelectedCaptionPill as renderSelectedCaptionPillView } from "./selected-caption.js";
import { ytTranslatorState } from "../state.js";
import { resetTranslateState, submitTranslatePrompt } from "../translate.js";
import { getVideoId, getVideoTitle } from "../youtube/youtube-page.js";

// Internal helper for submitChatPrompt.
// Creates a chat message record with a unique ID and timestamp.
function createChatMessage(role, content, status = "done") {
  ytTranslatorState.chat.messageCounter += 1;

  return {
    id: `${Date.now()}-${ytTranslatorState.chat.messageCounter}`,
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
  if (!ytTranslatorState.transcript.segments.length) {
    return "";
  }

  const currentIndex = ytTranslatorState.transcript.currentCaptionIndex;
  const activeIndex = currentIndex >= 0 ? currentIndex : 0;
  const startIndex = Math.max(0, activeIndex - 4);
  const endIndex = Math.min(ytTranslatorState.transcript.segments.length, activeIndex + 2);

  return ytTranslatorState.transcript.segments
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

// Exported for caption selection, translation, and sidebar rendering.
// Renders the selected caption pill shown above the chat input.
export function renderSelectedCaptionPill() {
  renderSelectedCaptionPillView({
    onClearCaption: resetTranslateState,
    onTranslateCaption: submitTranslatePrompt,
  });
}

// Exported for sidebar rendering and reused after chat state changes.
// Renders all chat messages and updates the chat controls.
export function renderChatRiver() {
  const river = document.getElementById(CHAT_RIVER_ID);

  if (!river) {
    return;
  }

  river.textContent = "";
  river.hidden = !ytTranslatorState.chat.messages.length;

  if (!ytTranslatorState.chat.messages.length) {
    setChatControlsWaiting(ytTranslatorState.chat.isWaitingForReply);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const message of ytTranslatorState.chat.messages) {
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
  setChatControlsWaiting(ytTranslatorState.chat.isWaitingForReply);
  scrollChatRiverToBottom();
}

// Internal helper for submitChatPrompt.
// Builds the background chat request payload from the prompt, history, and video context.
function buildChatPayload(prompt) {
  return {
    message: prompt,
    history: ytTranslatorState.chat.messages
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
      selectedCaptionText: ytTranslatorState.selection.captionText || null,
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

// Exported for sidebar form event handlers.
// Submits the current chat prompt, renders pending state, and applies the assistant response.
export async function submitChatPrompt() {
  const input = document.getElementById(CHAT_INPUT_ID);

  if (!input || ytTranslatorState.chat.isWaitingForReply) {
    return;
  }

  const prompt = input.value.trim();

  if (!prompt) {
    input.value = "";
    return;
  }

  input.value = "";
  ytTranslatorState.chat.isWaitingForReply = true;
  ytTranslatorState.chat.messages.push(createChatMessage("user", prompt));
  const pendingReply = createChatMessage("assistant", "", "sending");
  ytTranslatorState.chat.messages.push(pendingReply);
  const requestId = ytTranslatorState.chat.activeRequest + 1;
  ytTranslatorState.chat.activeRequest = requestId;
  renderChatRiver();

  try {
    const response = await sendChatPromptToBackground(buildChatPayload(prompt));

    if (requestId !== ytTranslatorState.chat.activeRequest) {
      return;
    }

    pendingReply.content = response.message || "The assistant returned an empty response.";
    pendingReply.status = "done";
  } catch (error) {
    if (requestId !== ytTranslatorState.chat.activeRequest) {
      return;
    }

    pendingReply.content = `Unable to get a response: ${error.message}`;
    pendingReply.errorDetails = error.details || {
      source: "content-script",
      message: error.message,
    };
    pendingReply.status = "error";
  } finally {
    if (requestId === ytTranslatorState.chat.activeRequest) {
      ytTranslatorState.chat.isWaitingForReply = false;
      renderChatRiver();
      document.getElementById(CHAT_INPUT_ID)?.focus();
    }
  }
}
