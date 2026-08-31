import {
  CHAT_INPUT_ID,
  SELECTED_CAPTION_ID,
  TRANSLATE_BUTTON_ID,
} from "../shared/dom-ids.js";
import { ytTranslatorState } from "../shared/state.js";

function createSelectedCaptionClearButton(renderOptions) {
  const clearButton = document.createElement("button");
  clearButton.className = "yt-translator-selected-caption__clear";
  clearButton.type = "button";
  clearButton.textContent = "x";
  clearButton.setAttribute("aria-label", "Clear selected caption text");

  clearButton.addEventListener("click", () => {
    ytTranslatorState.selection.captionText = "";
    renderOptions.onClearCaption?.();
    window.getSelection()?.removeAllRanges();
    renderSelectedCaptionPill(renderOptions);
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

// Renders the selected caption pill shown above the chat input.
export function renderSelectedCaptionPill(renderOptions = {}) {
  const contextNode = document.getElementById(SELECTED_CAPTION_ID);

  if (!contextNode) {
    return;
  }

  contextNode.textContent = "";
  contextNode.hidden = false;
  contextNode.classList.toggle("yt-translator-selected-caption--empty", !ytTranslatorState.selection.captionText);
  contextNode.classList.toggle(
    "yt-translator-selected-caption--translated",
    Boolean(
      ytTranslatorState.translate.isWaiting
        || ytTranslatorState.translate.result
        || ytTranslatorState.translate.error
    )
  );

  if (!ytTranslatorState.selection.captionText) {
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
  translateButton.textContent = ytTranslatorState.translate.isWaiting ? "Translating..." : "Translate";
  translateButton.disabled = ytTranslatorState.translate.isWaiting;
  translateButton.setAttribute("aria-label", "Translate selected caption text");
  translateButton.addEventListener("click", () => renderOptions.onTranslateCaption?.());

  actions.append(translateButton, createSelectedCaptionClearButton(renderOptions));
  header.append(label, actions);

  const sourceBlock = document.createElement("div");
  sourceBlock.className = "yt-translator-selected-caption__source";

  const sourceText = document.createElement("div");
  sourceText.className = "yt-translator-selected-caption__source-text";

  const chunks = ytTranslatorState.translate.chunks.filter((chunk) => chunk?.source);

  if (chunks.length) {
    sourceText.classList.add("yt-translator-selected-caption__source-text--chunked");

    for (const chunk of chunks) {
      sourceText.appendChild(createSelectedCaptionChunkNode(chunk));
    }
  } else {
    sourceText.textContent = ytTranslatorState.selection.captionText;
  }

  sourceBlock.appendChild(sourceText);
  contextNode.append(header, sourceBlock);

  if (
    ytTranslatorState.translate.isWaiting
      || ytTranslatorState.translate.result
      || ytTranslatorState.translate.error
  ) {
    const translationBlock = document.createElement("div");
    translationBlock.className = "yt-translator-selected-caption__translation";
    translationBlock.classList.toggle(
      "yt-translator-selected-caption__translation--error",
      Boolean(ytTranslatorState.translate.error),
    );

    const translationLabel = document.createElement("div");
    translationLabel.className = "yt-translator-selected-caption__label";
    translationLabel.textContent = "English";

    const translationText = document.createElement("p");
    translationText.className = "yt-translator-selected-caption__translation-text";
    translationText.textContent = ytTranslatorState.translate.isWaiting
      ? "Translating..."
      : ytTranslatorState.translate.error || ytTranslatorState.translate.result;

    translationBlock.append(translationLabel, translationText);

    if (ytTranslatorState.translate.errorDetails) {
      const details = document.createElement("details");
      details.className = "yt-translator-selected-caption__details";

      const summary = document.createElement("summary");
      summary.textContent = "Error details";

      const detailsText = document.createElement("pre");
      detailsText.textContent = JSON.stringify(ytTranslatorState.translate.errorDetails, null, 2);

      details.append(summary, detailsText);
      translationBlock.appendChild(details);
    }

    contextNode.appendChild(translationBlock);
  }
}
