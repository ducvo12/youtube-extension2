// Internal helper for updateCaptionRiver.
// Finds which transcript segment matches the current playback time.
function getActiveCaptionIndex(currentTimeMs) {
  if (!currentTranscriptSegments.length) {
    return -1;
  }

  const lookupMs = currentTimeMs + CAPTION_START_LEAD_MS;
  let activeIndex = -1;

  for (let index = 0; index < currentTranscriptSegments.length; index += 1) {
    const segment = currentTranscriptSegments[index];
    const startMs = segment.startMs || 0;

    if (startMs > lookupMs) {
      break;
    }

    activeIndex = index;
  }

  if (activeIndex < 0) {
    return -1;
  }

  const segment = currentTranscriptSegments[activeIndex];
  const nextSegment = currentTranscriptSegments[activeIndex + 1];
  const startMs = segment.startMs || 0;
  const durationMs = segment.durationMs || 0;
  const durationEndMs = durationMs > 0 ? startMs + durationMs : startMs + 4000;
  const nextStartMs = nextSegment?.startMs;
  const endMs = Number.isFinite(nextStartMs)
    ? Math.max(durationEndMs, nextStartMs)
    : durationEndMs;

  if (currentTimeMs - CAPTION_END_GRACE_MS > endMs && nextSegment) {
    return -1;
  }

  return activeIndex;
}

// Internal helper for getDisplayCaptionIndex.
// Keeps a caption index inside the available transcript segment range.
function clampCaptionIndex(index) {
  if (!currentTranscriptSegments.length) {
    return -1;
  }

  return Math.max(0, Math.min(index, currentTranscriptSegments.length - 1));
}

// Internal helper for updateCaptionRiver.
// Applies the display offset to the active caption index.
function getDisplayCaptionIndex(activeIndex) {
  if (activeIndex < 0) {
    return activeIndex;
  }

  return clampCaptionIndex(activeIndex + CAPTION_DISPLAY_SEGMENT_OFFSET);
}

// Internal helper for appendCaptionText.
// Splits caption text into word and non-word segments for selectable word spans.
function getCaptionWordSegments(text) {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

    return Array.from(segmenter.segment(text)).map((segment) => ({
      text: segment.segment,
      isWordLike: segment.isWordLike,
    }));
  }

  return text.match(/\s+|\S+/g)?.map((segment) => ({
    text: segment,
    isWordLike: !/^\s+$/.test(segment),
  })) || [];
}

// Internal helper for renderCaptionRiver.
// Appends caption text to a line while wrapping words in selectable span elements.
function appendCaptionText(line, text, segmentIndex) {
  const segments = getCaptionWordSegments(text);
  let wordIndex = 0;

  for (const segment of segments) {
    if (!segment.isWordLike) {
      line.appendChild(document.createTextNode(segment.text));
      continue;
    }

    const word = document.createElement("span");
    word.className = "yt-translator-caption-word";
    word.dataset.captionSegmentIndex = String(segmentIndex);
    word.dataset.captionWordIndex = String(wordIndex);
    word.textContent = segment.text;
    line.appendChild(word);
    wordIndex += 1;
  }
}

// Internal helper for scheduleCaptionSelectionSnap.
// Expands a caption text selection to whole words and stores it for chat context.
function snapCaptionSelectionToWords() {
  if (isSnappingCaptionSelection) {
    return;
  }

  const riverNode = document.getElementById(CAPTION_RIVER_ID);
  const selection = window.getSelection();

  if (!riverNode || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const selectionRange = selection.getRangeAt(0);
  const selectionTouchesCaptionRiver = riverNode.contains(selectionRange.commonAncestorContainer)
    || riverNode.contains(selection.anchorNode)
    || riverNode.contains(selection.focusNode);

  if (!selectionTouchesCaptionRiver) {
    return;
  }

  const words = Array.from(riverNode.querySelectorAll(".yt-translator-caption-word"));
  const selectedWords = words.filter((word) => selection.containsNode(word, true));

  if (!selectedWords.length) {
    return;
  }

  const snappedRange = document.createRange();
  snappedRange.setStartBefore(selectedWords[0]);
  snappedRange.setEndAfter(selectedWords[selectedWords.length - 1]);

  isSnappingCaptionSelection = true;
  selection.removeAllRanges();
  selection.addRange(snappedRange);
  isSnappingCaptionSelection = false;

  const nextSelectedCaptionText = snappedRange.toString().replace(/\s+/g, " ").trim();

  if (nextSelectedCaptionText !== selectedCaptionText) {
    resetTranslateState();
  }

  selectedCaptionText = nextSelectedCaptionText;
  renderSelectedCaptionPill();
}

// Called externally by content.js.
// Defers caption selection snapping until the browser selection has settled.
function scheduleCaptionSelectionSnap() {
  window.setTimeout(snapCaptionSelectionToWords, 0);
}

// Called externally by content.js and internally by updateCaptionRiver and renderTranscript.
// Renders the visible caption river for the current active caption index.
// Called when caption river state changes
function renderCaptionRiver(activeIndex) {
  const riverNode = document.getElementById(CAPTION_RIVER_ID);

  if (!riverNode) {
    return;
  }

  riverNode.textContent = "";

  if (!currentTranscriptSegments.length) {
    riverNode.textContent = "Current caption will appear after captions load.";
    currentCaptionIndex = -1;
    return;
  }

  if (activeIndex < 0) {
    riverNode.textContent = "Waiting for playback...";
    currentCaptionIndex = -1;
    return;
  }

  const fragment = document.createDocumentFragment();
  const startIndex = Math.max(0, activeIndex - 3);

  for (let index = startIndex; index <= activeIndex; index += 1) {
    const line = document.createElement("p");
    line.className = index === activeIndex
      ? "yt-translator-caption-river__line yt-translator-caption-river__line--active"
      : "yt-translator-caption-river__line";
    appendCaptionText(line, currentTranscriptSegments[index].text, index);
    fragment.appendChild(line);
  }

  riverNode.appendChild(fragment);
  currentCaptionIndex = activeIndex;
}

// Internal helper for startCaptionRiverUpdates.
// Syncs the caption river with playback time and pauses it during ads.
function updateCaptionRiver() {
  const riverNode = document.getElementById(CAPTION_RIVER_ID);

  if (isAdShowing()) {
    if (!isCaptionRiverPausedForAd) {
      isCaptionRiverPausedForAd = true;
      currentCaptionIndex = -1;
      setTranscriptStatus("Ad playing. Caption river paused until the video resumes.");

      if (riverNode) {
        riverNode.textContent = "Ad playing. Caption river paused.";
      }
    }

    return;
  }

  if (isCaptionRiverPausedForAd) {
    isCaptionRiverPausedForAd = false;
    currentCaptionIndex = -1;

    if (currentTranscriptSegments.length) {
      setTranscriptStatus("Captions loaded.");
    }
  }

  const currentTimeMs = getPlaybackTimeMs();

  if (currentTimeMs === null) {
    renderCaptionRiver(-1);
    return;
  }

  const activeIndex = getDisplayCaptionIndex(getActiveCaptionIndex(currentTimeMs));

  if (activeIndex !== currentCaptionIndex) {
    renderCaptionRiver(activeIndex);
  }
}

// Internal helper for renderTranscript.
// Starts the recurring timer that keeps the caption river synced with playback.
function startCaptionRiverUpdates() {
  window.clearInterval(captionRiverTimer);
  updateCaptionRiver();
  captionRiverTimer = window.setInterval(updateCaptionRiver, 250);
}

// Called externally by content.js after transcript segments are loaded.
// Stores transcript segments and starts rendering the caption river.
// Called when new video (and new transcript) are loaded
function renderTranscript(segments) {
  currentTranscriptSegments = segments;
  currentCaptionIndex = -1;

  if (!segments.length) {
    setTranscriptStatus("No transcript text found.");
    renderCaptionRiver(-1);
    return;
  }

  setPlayerCaptureButtonVisible(false);
  startCaptionRiverUpdates();
  setTranscriptStatus("Captions loaded.");
}
