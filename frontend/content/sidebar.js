// Internal helper for createSidebar.
// Updates the sidebar title text from the current YouTube video title.
function updateSidebarTitle() {
  const titleNode = document.getElementById(TITLE_ID);

  if (!titleNode) {
    return;
  }

  titleNode.textContent = getVideoTitle();
}

// Called externally by caption-river.js and player-caption-capture.js.
// Updates the transcript status message shown in the sidebar.
function setTranscriptStatus(message) {
  const statusNode = document.getElementById(TRANSCRIPT_STATUS_ID);

  if (statusNode) {
    statusNode.textContent = message;
  }
}

// Called externally by caption-river.js and player-caption-capture.js.
// Shows or hides the button that starts player-caption transcript capture.
function setPlayerCaptureButtonVisible(visible) {
  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);

  if (button) {
    button.hidden = !visible;
  }
}

// Internal helper for createSidebar.
// Resets transcript state for the current video and prompts or starts caption capture.
function setInitialTranscriptPrompt() {
  const videoId = getVideoId();

  if (!videoId || loadedTranscriptVideoId === videoId || activePlayerCaptionCaptureVideoId === videoId) {
    return;
  }

  currentTranscriptSegments = [];
  currentCaptionIndex = -1;
  renderCaptionRiver(-1);

  if (userAllowedCaptionCapture) {
    setPlayerCaptureButtonVisible(false);
    loadTranscriptFromPlayerCaptions(true);
    return;
  }

  setTranscriptStatus("Click below to load transcript. Captions will be enabled briefly.");
  setPlayerCaptureButtonVisible(true);
}

// Internal helper for createSidebar.
// Attaches sidebar button, caption selection, and chat form event handlers.
function setupSidebarActions() {
  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);

  if (button && button.dataset.initialized !== "true") {
    button.dataset.initialized = "true";
    button.addEventListener("click", () => loadTranscriptFromPlayerCaptions(false));
  }

  if (document.documentElement.dataset.ytTranslatorCaptionSelectionInitialized !== "true") {
    document.documentElement.dataset.ytTranslatorCaptionSelectionInitialized = "true";
    document.addEventListener("mouseup", scheduleCaptionSelectionSnap);
    document.addEventListener("touchend", scheduleCaptionSelectionSnap);
    document.addEventListener("keyup", scheduleCaptionSelectionSnap);
  }

  const form = document.getElementById(CHAT_FORM_ID);
  const input = document.getElementById(CHAT_INPUT_ID);

  if (!form || form.dataset.initialized === "true") {
    return;
  }

  form.dataset.initialized = "true";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitChatPrompt();
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitChatPrompt();
    }
  });
}

// Internal helper for createSidebar.
// Removes the sidebar and stops caption river updates.
function removeSidebar() {
  document.getElementById(SIDEBAR_ID)?.remove();
  window.clearInterval(captionRiverTimer);
}

// Called externally by content.js.
// Creates, refreshes, or removes the sidebar based on the current YouTube page.
function createSidebar() {
  if (!isWatchPage()) {
    removeSidebar();
    return;
  }

  if (document.getElementById(SIDEBAR_ID)) {
    updateSidebarTitle();
    setupSidebarActions();
    renderChatRiver();
    renderSelectedCaptionPill();
    setInitialTranscriptPrompt();
    return;
  }

  const recommendationsColumn = getRecommendationsColumn();

  if (!recommendationsColumn) {
    if (retryCount < 10) {
      retryCount += 1;
      scheduleSidebarUpdate();
    }

    return;
  }

  retryCount = 0;

  const sidebar = document.createElement("aside");
  sidebar.id = SIDEBAR_ID;
  sidebar.innerHTML = `
    <div class="yt-translator-sidebar__eyebrow">Language Assistant</div>
    <div class="yt-translator-sidebar__section">
      <h3 class="yt-translator-sidebar__subheading">Current Caption</h3>
      <p id="${TRANSCRIPT_STATUS_ID}" class="yt-translator-sidebar__status">Loading transcript...</p>
      <button id="${PLAYER_CAPTURE_BUTTON_ID}" class="yt-translator-sidebar__button" type="button" hidden>
        Load transcript by enabling captions briefly
      </button>
      <div class="yt-translator-caption-river-wrap">
        <div class="yt-translator-sidebar__label">Now Playing</div>
        <div id="${CAPTION_RIVER_ID}" class="yt-translator-caption-river">Current caption will appear after captions load.</div>
      </div>
      <div id="${SELECTED_CAPTION_ID}" class="yt-translator-selected-caption" hidden></div>
    </div>
    <div class="yt-translator-sidebar__section">
      <h3 class="yt-translator-sidebar__subheading">Ask</h3>
      <div id="${CHAT_RIVER_ID}" class="yt-translator-chat-river"></div>
      <form id="${CHAT_FORM_ID}" class="yt-translator-chat-form">
        <textarea
          id="${CHAT_INPUT_ID}"
          class="yt-translator-chat-form__input"
          rows="3"
          maxlength="1200"
          placeholder="Ask about the current phrase, tone, grammar, or slang..."
        ></textarea>
        <button id="${CHAT_SEND_BUTTON_ID}" class="yt-translator-chat-form__send" type="submit">Send</button>
      </form>
    </div>
  `;

  recommendationsColumn.prepend(sidebar);
  setupSidebarActions();
  renderChatRiver();
  renderSelectedCaptionPill();
  updateSidebarTitle();
  setInitialTranscriptPrompt();
}

// Called externally by lifecycle.js and internally by createSidebar.
// Schedules a delayed sidebar creation attempt.
function scheduleSidebarUpdate() {
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(createSidebar, 500);
}
