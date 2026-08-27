// Internal helper for createSidebar.
// Updates the sidebar title text from the current YouTube video title.
function updateSidebarTitle() {
  const titleNode = document.getElementById(TITLE_ID);

  if (!titleNode) {
    return;
  }

  titleNode.textContent = getVideoTitle();
}

// Called externally by content.js.
// Loads the persisted sidebar open state before the first render.
function initializeSidebarOpenState(callback) {
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

// Internal helper for the temporary diagnostics view.
// Shows milliseconds compactly while keeping missing values obvious.
function formatDiagnosticsDuration(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }

  return `${Math.round(value)}ms`;
}

// Internal helper for the temporary diagnostics view.
// Accepts the final planned records shape and a couple of flexible early variants.
function getLatencyDiagnosticsRecords() {
  const rawDiagnostics = ytTranslatorState.diagnostics.snapshot?.[LATENCY_DIAGNOSTICS_STORAGE_KEY];

  if (Array.isArray(rawDiagnostics)) {
    return rawDiagnostics;
  }

  if (Array.isArray(rawDiagnostics?.records)) {
    return rawDiagnostics.records;
  }

  if (Array.isArray(rawDiagnostics?.requests)) {
    return rawDiagnostics.requests;
  }

  return [];
}

// Internal helper for the temporary diagnostics view.
// Builds a compact report that can be pasted into chat without the full storage dump first.
function buildDiagnosticsReport() {
  const records = getLatencyDiagnosticsRecords();
  const latestRecords = records.slice(-20);
  const lines = [
    "## YouTube Translator Latency Diagnostics",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Record count: ${records.length}`,
    "",
    "Recent requests:",
  ];

  if (!latestRecords.length) {
    lines.push("- No latency records captured yet.");
  }

  for (const record of latestRecords) {
    lines.push([
      `- ${record.type || record.endpoint || "request"}`,
      `total=${formatDiagnosticsDuration(record.totalMs ?? record.frontendTotalMs ?? record.durationMs)}`,
      `backend=${formatDiagnosticsDuration(record.backendTotalMs ?? record.backend?.totalMs)}`,
      `provider=${formatDiagnosticsDuration(record.providerMs ?? record.backend?.providerMs)}`,
      `status=${record.status || (record.error || record.errorCode ? "error" : "ok")}`,
      `model=${record.model || "-"}`,
      `thinking=${record.thinkingLevel || "-"}`,
      `textLength=${record.textLength ?? record.messageLength ?? "-"}`,
      `promptLength=${record.promptLength ?? "-"}`,
      `maxOutput=${record.maxOutputTokens ?? "-"}`,
      `structured=${record.structuredOutput ?? "-"}`,
      `requestId=${record.requestId || "-"}`,
    ].join(" "));
  }

  lines.push("", "Raw storage:", JSON.stringify(ytTranslatorState.diagnostics.snapshot || {}, null, 2));

  return lines.join("\n");
}

// Internal helper for the temporary diagnostics view.
// Copies the compact diagnostics report, with a textarea fallback for older contexts.
async function copyDiagnosticsReport() {
  const report = buildDiagnosticsReport();

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(report);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = report;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    ytTranslatorState.diagnostics.copyMessage = "Copied diagnostics report.";
  } catch (error) {
    ytTranslatorState.diagnostics.copyMessage = `Unable to copy: ${error.message}`;
  }

  renderDiagnosticsPanel();
}

// Internal helper for the temporary diagnostics view.
// Reads all local extension storage so the panel can show both latency records and raw keys.
function loadDiagnosticsSnapshot() {
  const panel = document.getElementById(DIAGNOSTICS_PANEL_ID);

  if (!panel || typeof chrome === "undefined" || !chrome.storage?.local) {
    ytTranslatorState.diagnostics.error = "chrome.storage.local is not available on this page.";
    ytTranslatorState.diagnostics.snapshot = null;
    ytTranslatorState.diagnostics.isLoading = false;
    renderDiagnosticsPanel();
    return;
  }

  ytTranslatorState.diagnostics.isLoading = true;
  ytTranslatorState.diagnostics.error = "";
  ytTranslatorState.diagnostics.copyMessage = "";
  renderDiagnosticsPanel();

  chrome.storage.local.get(null, (result) => {
    ytTranslatorState.diagnostics.isLoading = false;

    if (chrome.runtime.lastError) {
      ytTranslatorState.diagnostics.error = chrome.runtime.lastError.message;
      ytTranslatorState.diagnostics.snapshot = null;
    } else {
      ytTranslatorState.diagnostics.snapshot = result || {};
      ytTranslatorState.diagnostics.error = "";
    }

    renderDiagnosticsPanel();
  });
}

// Internal helper for the temporary diagnostics view.
// Renders the best available latency table plus a compact raw storage dump.
function renderDiagnosticsPanel() {
  const panel = document.getElementById(DIAGNOSTICS_PANEL_ID);

  if (!panel) {
    return;
  }

  panel.textContent = "";

  const header = document.createElement("div");
  header.className = "yt-translator-diagnostics__header";

  const title = document.createElement("h3");
  title.className = "yt-translator-sidebar__subheading";
  title.textContent = "Diagnostics";

  const refreshButton = document.createElement("button");
  refreshButton.id = DIAGNOSTICS_REFRESH_BUTTON_ID;
  refreshButton.className = "yt-translator-diagnostics__refresh";
  refreshButton.type = "button";
  refreshButton.textContent = ytTranslatorState.diagnostics.isLoading ? "Loading" : "Refresh";
  refreshButton.disabled = ytTranslatorState.diagnostics.isLoading;
  refreshButton.addEventListener("click", loadDiagnosticsSnapshot);

  const copyButton = document.createElement("button");
  copyButton.id = DIAGNOSTICS_COPY_BUTTON_ID;
  copyButton.className = "yt-translator-diagnostics__refresh";
  copyButton.type = "button";
  copyButton.textContent = "Copy";
  copyButton.disabled = ytTranslatorState.diagnostics.isLoading;
  copyButton.addEventListener("click", copyDiagnosticsReport);

  const actions = document.createElement("div");
  actions.className = "yt-translator-diagnostics__actions";
  actions.append(copyButton, refreshButton);

  header.append(title, actions);
  panel.appendChild(header);

  if (ytTranslatorState.diagnostics.isLoading) {
    const status = document.createElement("p");
    status.className = "yt-translator-sidebar__status";
    status.textContent = "Reading chrome.storage.local...";
    panel.appendChild(status);
    return;
  }

  if (ytTranslatorState.diagnostics.error) {
    const error = document.createElement("p");
    error.className = "yt-translator-diagnostics__error";
    error.textContent = ytTranslatorState.diagnostics.error;
    panel.appendChild(error);
    return;
  }

  const records = getLatencyDiagnosticsRecords();
  const summary = document.createElement("div");
  summary.className = "yt-translator-diagnostics__summary";
  summary.textContent = `${records.length} latency record${records.length === 1 ? "" : "s"} in ${LATENCY_DIAGNOSTICS_STORAGE_KEY}`;
  panel.appendChild(summary);

  if (ytTranslatorState.diagnostics.copyMessage) {
    const copyStatus = document.createElement("p");
    copyStatus.className = "yt-translator-diagnostics__copy-status";
    copyStatus.textContent = ytTranslatorState.diagnostics.copyMessage;
    panel.appendChild(copyStatus);
  }

  if (records.length) {
    const tableWrap = document.createElement("div");
    tableWrap.className = "yt-translator-diagnostics__table-wrap";

    const table = document.createElement("table");
    table.id = DIAGNOSTICS_TABLE_ID;
    table.className = "yt-translator-diagnostics__table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    for (const label of ["Time", "Type", "Total", "Backend", "Provider", "Model", "Thinking", "Status"]) {
      const cell = document.createElement("th");
      cell.textContent = label;
      headerRow.appendChild(cell);
    }

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    for (const record of records.slice().reverse().slice(0, 20)) {
      const row = document.createElement("tr");
      const timestamp = record.timestamp || record.startedAt || record.createdAt;
      const date = timestamp ? new Date(timestamp) : null;
      const timeText = date && !Number.isNaN(date.valueOf())
        ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : "-";
      const type = record.type || record.requestType || record.endpoint || "-";
      const totalMs = record.totalMs ?? record.frontendTotalMs ?? record.durationMs;
      const backendMs = record.backendTotalMs ?? record.backend?.totalMs;
      const providerMs = record.providerMs ?? record.backend?.providerMs;
      const model = record.model || "-";
      const thinkingLevel = record.thinkingLevel || "-";
      const status = record.status || (record.error || record.errorCode ? "error" : "ok");

      for (const value of [
        timeText,
        type,
        formatDiagnosticsDuration(totalMs),
        formatDiagnosticsDuration(backendMs),
        formatDiagnosticsDuration(providerMs),
        model,
        thinkingLevel,
        status,
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      }

      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    panel.appendChild(tableWrap);
  } else {
    const empty = document.createElement("p");
    empty.className = "yt-translator-sidebar__status";
    empty.textContent = "No latency records have been written yet.";
    panel.appendChild(empty);
  }

  const storageKeys = Object.keys(ytTranslatorState.diagnostics.snapshot || {}).sort();
  const keys = document.createElement("p");
  keys.className = "yt-translator-diagnostics__keys";
  keys.textContent = storageKeys.length
    ? `Storage keys: ${storageKeys.join(", ")}`
    : "Storage keys: none";
  panel.appendChild(keys);

  const raw = document.createElement("pre");
  raw.className = "yt-translator-diagnostics__raw";
  raw.textContent = JSON.stringify(ytTranslatorState.diagnostics.snapshot || {}, null, 2);
  panel.appendChild(raw);
}

// Internal helper for the temporary diagnostics view.
// Switches between the product sidebar and the storage-backed diagnostics display.
function setDiagnosticsViewOpen(nextIsOpen) {
  ytTranslatorState.diagnostics.isViewOpen = nextIsOpen;

  const content = document.getElementById(DIAGNOSTICS_CONTENT_ID);
  const panel = document.getElementById(DIAGNOSTICS_PANEL_ID);
  const button = document.getElementById(DIAGNOSTICS_BUTTON_ID);

  if (content) {
    content.hidden = ytTranslatorState.diagnostics.isViewOpen;
  }

  if (panel) {
    panel.hidden = !ytTranslatorState.diagnostics.isViewOpen;
  }

  if (button) {
    button.textContent = ytTranslatorState.diagnostics.isViewOpen ? "Back" : "Diagnostics";
    button.setAttribute("aria-pressed", String(ytTranslatorState.diagnostics.isViewOpen));
  }

  if (ytTranslatorState.diagnostics.isViewOpen) {
    loadDiagnosticsSnapshot();
  }
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

// Internal helper for refreshAvailableCaptionTracks.
// Keeps player-captured caption URLs selectable even when page metadata omits them.
function appendCaptionTrackIfMissing(tracks, track) {
  if (!track) {
    return tracks;
  }

  const alreadyExists = tracks.some((existingTrack) => existingTrack.identity === track.identity
    || existingTrack.trackUrl === track.trackUrl);

  if (alreadyExists) {
    return tracks;
  }

  return [...tracks, track];
}

// Internal helper for refreshAvailableCaptionTracks.
// Adds player-captured caption URLs when page metadata omits them.
function addCapturedCaptionTrackOptions(tracks) {
  if (!ytTranslatorState.playerCapture.lastCapturedCaptionUrl) {
    return tracks;
  }

  const capturedTrack = createCaptionTrackFromUrl(ytTranslatorState.playerCapture.lastCapturedCaptionUrl);
  let nextTracks = appendCaptionTrackIfMissing(tracks, capturedTrack);

  if (isAutoGeneratedCaptionTrack(capturedTrack) && isTranslatedCaptionTrack(capturedTrack)) {
    const hasSourceTrack = nextTracks.some((track) => track.sourceIdentity === capturedTrack.sourceIdentity
      && !isTranslatedCaptionTrack(track));
    const sourceTrack = createSourceCaptionTrackFromUrl(
      ytTranslatorState.playerCapture.lastCapturedCaptionUrl,
      capturedTrack.label,
    );

    if (!hasSourceTrack) {
      nextTracks = appendCaptionTrackIfMissing(nextTracks, sourceTrack);
    }
  }

  return nextTracks;
}

// Internal helper for createSidebar and setInitialTranscriptPrompt.
// Refreshes the sidebar's caption track choices from the current YouTube page.
function refreshAvailableCaptionTracks() {
  const nextTracks = addCapturedCaptionTrackOptions(getNormalizedCaptionTracksFromPage());
  const currentSelection = nextTracks.find((track) => track.key === ytTranslatorState.captionTracks.selectedKey);
  const preferredSelection = nextTracks.find((track) => track.languageCode
    && track.languageCode === ytTranslatorState.captionTracks.preferredLanguageCode
    && track.kind === ytTranslatorState.captionTracks.preferredKind)
    || nextTracks.find((track) => track.languageCode
      && track.languageCode === ytTranslatorState.captionTracks.preferredLanguageCode);

  ytTranslatorState.captionTracks.available = nextTracks;

  if (currentSelection) {
    ytTranslatorState.captionTracks.selectedKey = currentSelection.key;
  } else {
    ytTranslatorState.captionTracks.selectedKey = (
      preferredSelection || ytTranslatorState.captionTracks.available[0]
    )?.key || "";
  }
}

// Internal helper for createSidebar and setInitialTranscriptPrompt.
// Renders the caption track selector and keeps its selected value current.
function renderCaptionTrackSelector() {
  const group = document.getElementById(CAPTION_TRACK_GROUP_ID);
  const select = document.getElementById(CAPTION_TRACK_SELECT_ID);

  if (!group || !select) {
    return;
  }

  select.textContent = "";
  group.hidden = !ytTranslatorState.captionTracks.available.length;

  for (const track of ytTranslatorState.captionTracks.available) {
    const option = document.createElement("option");
    option.value = track.key;
    option.textContent = track.label;
    select.appendChild(option);
  }

  select.value = ytTranslatorState.captionTracks.selectedKey;
  select.disabled = ytTranslatorState.captionTracks.available.length <= 1;
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

// Called externally by content.js.
// Creates, refreshes, or removes the sidebar based on the current YouTube page.
function createSidebar() {
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

// Called externally by lifecycle.js and internally by createSidebar.
// Schedules a delayed sidebar creation attempt.
function scheduleSidebarUpdate() {
  window.clearTimeout(ytTranslatorState.sidebar.updateTimer);
  ytTranslatorState.sidebar.updateTimer = window.setTimeout(createSidebar, 500);
}
