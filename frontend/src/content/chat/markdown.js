// Converts a small Markdown subset into DOM nodes without interpreting model output as HTML.
export function renderAssistantMarkdown(markdown) {
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
