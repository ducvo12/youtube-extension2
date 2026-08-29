import { renderCaptionRiver, scheduleCaptionSelectionSnap } from "../captions/caption-river.js";
import {
  refreshAvailableCaptionTracks,
  renderCaptionTrackSelector,
} from "./caption-track-selector.js";
import { renderChatRiver, renderSelectedCaptionPill, submitChatPrompt } from "../chat/chat.js";
import {
  CAPTION_RIVER_ID,
  CAPTION_TRACK_GROUP_ID,
  CAPTION_TRACK_SELECT_ID,
  CHAT_FORM_ID,
  CHAT_INPUT_ID,
  CHAT_RIVER_ID,
  CHAT_SEND_BUTTON_ID,
  DIAGNOSTICS_BUTTON_ID,
  DIAGNOSTICS_CONTENT_ID,
  DIAGNOSTICS_PANEL_ID,
  PLAYER_CAPTURE_BUTTON_ID,
  SELECTED_CAPTION_ID,
  SIDEBAR_BODY_ID,
  SIDEBAR_ID,
  SIDEBAR_TOGGLE_BUTTON_ID,
  TITLE_ID,
  TRANSCRIPT_STATUS_ID,
} from "../dom-ids.js";
import { SIDEBAR_OPEN_STORAGE_KEY } from "../../shared/storage-keys.js";
import { setDiagnosticsViewOpen } from "./diagnostics.js";
import {
  getSelectedCaptionTrack,
  loadTranscriptFromPlayerCaptions,
  loadTranscriptFromSelectedCaptionTrack,
} from "../captions/player-caption-capture.js";
import { ytTranslatorState } from "../state.js";
import { resetTranslateState } from "../translate.js";
import {
  getRecommendationsColumn,
  getVideoId,
  getVideoTitle,
  isWatchPage,
} from "../youtube/youtube-page.js";

// Internal helper for createSidebar.
// Updates the sidebar title text from the current YouTube video title.
function updateSidebarTitle() {
  const titleNode = document.getElementById(TITLE_ID);

  if (!titleNode) {
    return;
  }

  titleNode.textContent = getVideoTitle();
}

// Exported for the content entry point before the first sidebar render.
// Loads the persisted sidebar open state before the first render.
export function initializeSidebarOpenState(callback) {
  if (ytTranslatorState.sidebar.hasLoadedOpenState) {
    callback();
    return;
  }

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    ytTranslatorState.sidebar.hasLoadedOpenState = true;
    callback();
    return;
  }

  chrome.storage.local.get([SIDEBAR_OPEN_STORAGE_KEY], (result) => {
    ytTranslatorState.sidebar.hasLoadedOpenState = true;

    if (!chrome.runtime.lastError && typeof result[SIDEBAR_OPEN_STORAGE_KEY] === "boolean") {
      ytTranslatorState.sidebar.isOpen = result[SIDEBAR_OPEN_STORAGE_KEY];
    }

    callback();
  });
}

// Internal helper for createSidebar and setupSidebarActions.
// Applies the current open/collapsed state to the sidebar shell.
function renderSidebarOpenState() {
  const sidebar = document.getElementById(SIDEBAR_ID);
  const body = document.getElementById(SIDEBAR_BODY_ID);
  const toggleButton = document.getElementById(SIDEBAR_TOGGLE_BUTTON_ID);

  if (!sidebar || !body || !toggleButton) {
    return;
  }

  sidebar.classList.toggle("yt-translator-sidebar--collapsed", !ytTranslatorState.sidebar.isOpen);
  body.hidden = !ytTranslatorState.sidebar.isOpen;
  toggleButton.textContent = "";
  toggleButton.classList.toggle("yt-translator-sidebar__toggle--open", ytTranslatorState.sidebar.isOpen);
  toggleButton.setAttribute("aria-expanded", String(ytTranslatorState.sidebar.isOpen));
  toggleButton.setAttribute(
    "aria-label",
    ytTranslatorState.sidebar.isOpen ? "Hide language assistant sidebar" : "Open language assistant sidebar",
  );
  toggleButton.title = ytTranslatorState.sidebar.isOpen ? "Hide sidebar" : "Open sidebar";
}

// Internal helper for setupSidebarActions.
// Updates and persists the sidebar open state.
function setSidebarOpen(nextIsOpen) {
  ytTranslatorState.sidebar.isOpen = nextIsOpen;
  renderSidebarOpenState();

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ [SIDEBAR_OPEN_STORAGE_KEY]: ytTranslatorState.sidebar.isOpen });
  }
}

// Exported for caption river and transcript loading status updates.
// Updates the transcript status message shown in the sidebar.
export function setTranscriptStatus(message) {
  const statusNode = document.getElementById(TRANSCRIPT_STATUS_ID);

  if (statusNode) {
    statusNode.textContent = message;
  }
}

// Exported for caption river and transcript loading controls.
// Shows or hides the button that starts player-caption transcript capture.
export function setPlayerCaptureButtonVisible(visible) {
  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);

  if (button) {
    button.hidden = !visible;
  }
}

// Internal helper for setInitialTranscriptPrompt and setupSidebarActions.
// Preserves the original player-capture path until the user chooses a track here.
function loadTranscriptForCurrentCaptionChoice(isAutomatic = false) {
  if (ytTranslatorState.captionTracks.hasUserSelectedForVideo) {
    loadTranscriptFromSelectedCaptionTrack(isAutomatic, { primeWithPlayerCapture: true });
    return;
  }

  loadTranscriptFromPlayerCaptions(isAutomatic);
}

// Internal helper for createSidebar.
// Resets transcript state for the current video and prompts or starts caption capture.
function setInitialTranscriptPrompt() {
  const videoId = getVideoId();
  refreshAvailableCaptionTracks();
  renderCaptionTrackSelector();
  const selectedTrack = getSelectedCaptionTrack();
  const isCurrentTranscriptLoaded = ytTranslatorState.transcript.loadedVideoId === videoId
    && (!ytTranslatorState.captionTracks.hasUserSelectedForVideo
      || !selectedTrack
      || ytTranslatorState.transcript.loadedTrackKey === selectedTrack.key);

  if (!videoId
    || ytTranslatorState.playerCapture.activeVideoId === videoId
    || isCurrentTranscriptLoaded) {
    return;
  }

  ytTranslatorState.transcript.segments = [];
  ytTranslatorState.transcript.currentCaptionIndex = -1;
  renderCaptionRiver(-1);

  if (ytTranslatorState.playerCapture.userAllowedCaptionCapture) {
    setPlayerCaptureButtonVisible(false);
    loadTranscriptForCurrentCaptionChoice(true);
    return;
  }

  setTranscriptStatus(ytTranslatorState.captionTracks.available.length
    ? "Choose a caption track, then load the transcript."
    : "Click below to load transcript. Captions will be enabled briefly.");
  setPlayerCaptureButtonVisible(true);
}

// Internal helper for createSidebar.
// Attaches sidebar button, caption selection, and chat form event handlers.
function setupSidebarActions() {
  const toggleButton = document.getElementById(SIDEBAR_TOGGLE_BUTTON_ID);

  if (toggleButton && toggleButton.dataset.initialized !== "true") {
    toggleButton.dataset.initialized = "true";
    toggleButton.addEventListener("click", () => {
      setSidebarOpen(!ytTranslatorState.sidebar.isOpen);

      if (ytTranslatorState.sidebar.isOpen) {
        createSidebar();
      }
    });
  }

  const diagnosticsButton = document.getElementById(DIAGNOSTICS_BUTTON_ID);

  if (diagnosticsButton && diagnosticsButton.dataset.initialized !== "true") {
    diagnosticsButton.dataset.initialized = "true";
    diagnosticsButton.addEventListener("click", () => {
      setDiagnosticsViewOpen(!ytTranslatorState.diagnostics.isViewOpen);
    });
  }

  const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);

  if (button && button.dataset.initialized !== "true") {
    button.dataset.initialized = "true";
    button.addEventListener("click", () => loadTranscriptForCurrentCaptionChoice(false));
  }

  const captionTrackSelect = document.getElementById(CAPTION_TRACK_SELECT_ID);

  if (captionTrackSelect && captionTrackSelect.dataset.initialized !== "true") {
    captionTrackSelect.dataset.initialized = "true";
    captionTrackSelect.addEventListener("change", () => {
      ytTranslatorState.captionTracks.hasUserSelectedForVideo = true;
      ytTranslatorState.captionTracks.selectedKey = captionTrackSelect.value;
      const track = getSelectedCaptionTrack();

      if (track) {
        ytTranslatorState.captionTracks.preferredLanguageCode = track.languageCode;
        ytTranslatorState.captionTracks.preferredKind = track.kind;
      }

      ytTranslatorState.selection.captionText = "";
      resetTranslateState();
      window.getSelection()?.removeAllRanges();
      renderSelectedCaptionPill();

      if (
        ytTranslatorState.playerCapture.userAllowedCaptionCapture
          || ytTranslatorState.transcript.loadedVideoId === getVideoId()
      ) {
        loadTranscriptFromSelectedCaptionTrack(false);
        return;
      }

      setTranscriptStatus("Click below to load the selected transcript.");
      setPlayerCaptureButtonVisible(true);
    });
  }

  if (document.documentElement.dataset.ytTranslatorCaptionSelectionInitialized !== "true") {
    document.documentElement.dataset.ytTranslatorCaptionSelectionInitialized = "true";
    document.addEventListener("mouseup", scheduleCaptionSelectionSnap);
    document.addEventListener("touchend", scheduleCaptionSelectionSnap);
    document.addEventListener("keyup", scheduleCaptionSelectionSnap);
  }

  const form = document.getElementById(CHAT_FORM_ID);
  const input = document.getElementById(CHAT_INPUT_ID);

  if (form && form.dataset.initialized !== "true") {
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

}

// Internal helper for createSidebar.
// Removes the sidebar and stops caption river updates.
function removeSidebar() {
  document.getElementById(SIDEBAR_ID)?.remove();
  window.clearInterval(ytTranslatorState.captionRiver.timer);
}

// Exported for the content entry point and sidebar retry scheduling.
// Creates, refreshes, or removes the sidebar based on the current YouTube page.
export function createSidebar() {
  if (!ytTranslatorState.sidebar.hasLoadedOpenState) {
    initializeSidebarOpenState(createSidebar);
    return;
  }

  if (!isWatchPage()) {
    removeSidebar();
    return;
  }

  if (document.getElementById(SIDEBAR_ID)) {
    updateSidebarTitle();
    setupSidebarActions();
    renderSidebarOpenState();
    setDiagnosticsViewOpen(ytTranslatorState.diagnostics.isViewOpen);
    renderChatRiver();
    renderSelectedCaptionPill();
    setInitialTranscriptPrompt();
    return;
  }

  const recommendationsColumn = getRecommendationsColumn();

  if (!recommendationsColumn) {
    if (ytTranslatorState.transcript.retryCount < 10) {
      ytTranslatorState.transcript.retryCount += 1;
      scheduleSidebarUpdate();
    }

    return;
  }

  ytTranslatorState.transcript.retryCount = 0;

  const sidebar = document.createElement("aside");
  sidebar.id = SIDEBAR_ID;
  sidebar.innerHTML = `
    <div class="yt-translator-sidebar__header">
      <div class="yt-translator-sidebar__eyebrow">Language Assistant</div>
      <div class="yt-translator-sidebar__header-actions">
        <button
          id="${DIAGNOSTICS_BUTTON_ID}"
          class="yt-translator-sidebar__diagnostics-button"
          type="button"
          aria-pressed="false"
        >Diagnostics</button>
        <button
          id="${SIDEBAR_TOGGLE_BUTTON_ID}"
          class="yt-translator-sidebar__toggle"
          type="button"
          aria-expanded="true"
          aria-controls="${SIDEBAR_BODY_ID}"
        >Hide</button>
      </div>
    </div>
    <div id="${SIDEBAR_BODY_ID}" class="yt-translator-sidebar__body">
      <div id="${DIAGNOSTICS_CONTENT_ID}">
        <div class="yt-translator-sidebar__section">
          <h3 class="yt-translator-sidebar__subheading">Current Caption</h3>
          <p id="${TRANSCRIPT_STATUS_ID}" class="yt-translator-sidebar__status">Loading transcript...</p>
          <label id="${CAPTION_TRACK_GROUP_ID}" class="yt-translator-caption-track" hidden>
            <span class="yt-translator-sidebar__label">Caption Track</span>
            <select id="${CAPTION_TRACK_SELECT_ID}" class="yt-translator-caption-track__select"></select>
          </label>
          <button id="${PLAYER_CAPTURE_BUTTON_ID}" class="yt-translator-sidebar__button" type="button" hidden>
            Load transcript
          </button>
          <div class="yt-translator-caption-river-wrap">
            <div class="yt-translator-sidebar__label">Now Playing</div>
            <div id="${CAPTION_RIVER_ID}" class="yt-translator-caption-river">Current caption will appear after captions load.</div>
          </div>
          <div id="${SELECTED_CAPTION_ID}" class="yt-translator-selected-caption"></div>
        </div>
        <div class="yt-translator-sidebar__section">
          <h3 class="yt-translator-sidebar__subheading">Ask</h3>
          <div id="${CHAT_RIVER_ID}" class="yt-translator-chat-river" hidden></div>
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
      </div>
      <div id="${DIAGNOSTICS_PANEL_ID}" class="yt-translator-diagnostics" hidden></div>
    </div>
  `;

  recommendationsColumn.prepend(sidebar);
  setupSidebarActions();
  renderSidebarOpenState();
  setDiagnosticsViewOpen(ytTranslatorState.diagnostics.isViewOpen);
  renderChatRiver();
  renderSelectedCaptionPill();
  updateSidebarTitle();
  setInitialTranscriptPrompt();
}

// Exported for navigation lifecycle resets and sidebar retry scheduling.
// Schedules a delayed sidebar creation attempt.
export function scheduleSidebarUpdate() {
  window.clearTimeout(ytTranslatorState.sidebar.updateTimer);
  ytTranslatorState.sidebar.updateTimer = window.setTimeout(createSidebar, 500);
}
