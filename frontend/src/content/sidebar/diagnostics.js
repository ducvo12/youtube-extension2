import {
  DIAGNOSTICS_BUTTON_ID,
  DIAGNOSTICS_CONTENT_ID,
  DIAGNOSTICS_COPY_BUTTON_ID,
  DIAGNOSTICS_PANEL_ID,
  DIAGNOSTICS_REFRESH_BUTTON_ID,
  DIAGNOSTICS_TABLE_ID,
} from "../shared/dom-ids.js";
import { LATENCY_DIAGNOSTICS_STORAGE_KEY } from "../shared/storage-keys.js";
import { ytTranslatorState } from "../shared/state.js";

// Internal helper for the diagnostics view.
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

// Internal helper for the diagnostics view.
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

// Internal helper for the diagnostics view.
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

// Internal helper for the diagnostics view.
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

// Internal helper for the diagnostics view.
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

// Internal helper for the diagnostics view.
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
  summary.textContent = `${records.length} latency record${records.length === 1 ? "" : "s"} `
    + `in ${LATENCY_DIAGNOSTICS_STORAGE_KEY}`;
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

// Exported for sidebar diagnostics button state.
// Switches between the product sidebar and the storage-backed diagnostics display.
export function setDiagnosticsViewOpen(nextIsOpen) {
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
