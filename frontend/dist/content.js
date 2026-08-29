(() => {
  // frontend/src/content/state.js
  var ytTranslatorState = {
    sidebar: {
      updateTimer: null,
      isOpen: true,
      hasLoadedOpenState: false
    },
    transcript: {
      retryCount: 0,
      activeRequest: 0,
      loadedVideoId: null,
      loadedTrackKey: "",
      segments: [],
      currentCaptionIndex: -1
    },
    captionTracks: {
      available: [],
      selectedKey: "",
      preferredLanguageCode: "",
      preferredKind: "",
      hasUserSelectedForVideo: false
    },
    captionRiver: {
      timer: null,
      isPausedForAd: false
    },
    selection: {
      captionText: "",
      isSnapping: false
    },
    chat: {
      activeRequest: 0,
      messages: [],
      messageCounter: 0,
      isWaitingForReply: false
    },
    translate: {
      activeRequest: 0,
      isWaiting: false,
      result: "",
      chunks: [],
      error: "",
      errorDetails: null
    },
    diagnostics: {
      isViewOpen: false,
      snapshot: null,
      error: "",
      isLoading: false,
      copyMessage: ""
    },
    playerCapture: {
      userAllowedCaptionCapture: false,
      activeVideoId: null,
      pendingVideoId: null,
      pendingTimer: null,
      pageCapturerInjected: false,
      pageCapturerReady: null,
      requestId: 0,
      lastCapturedCaptionUrl: ""
    }
  };

  // frontend/src/content/dom-ids.js
  var SIDEBAR_ID = "yt-translator-sidebar";
  var SIDEBAR_BODY_ID = "yt-translator-sidebar-body";
  var SIDEBAR_TOGGLE_BUTTON_ID = "yt-translator-sidebar-toggle";
  var DIAGNOSTICS_BUTTON_ID = "yt-translator-diagnostics-button";
  var DIAGNOSTICS_CONTENT_ID = "yt-translator-diagnostics-content";
  var DIAGNOSTICS_PANEL_ID = "yt-translator-diagnostics-panel";
  var DIAGNOSTICS_TABLE_ID = "yt-translator-diagnostics-table";
  var DIAGNOSTICS_REFRESH_BUTTON_ID = "yt-translator-diagnostics-refresh";
  var DIAGNOSTICS_COPY_BUTTON_ID = "yt-translator-diagnostics-copy";
  var TITLE_ID = "yt-translator-video-title";
  var TRANSCRIPT_STATUS_ID = "yt-translator-transcript-status";
  var CAPTION_TRACK_SELECT_ID = "yt-translator-caption-track-select";
  var CAPTION_TRACK_GROUP_ID = "yt-translator-caption-track-group";
  var CAPTION_RIVER_ID = "yt-translator-caption-river";
  var PLAYER_CAPTURE_BUTTON_ID = "yt-translator-player-capture-button";
  var CHAT_RIVER_ID = "yt-translator-chat-river";
  var CHAT_FORM_ID = "yt-translator-chat-form";
  var CHAT_INPUT_ID = "yt-translator-chat-input";
  var CHAT_SEND_BUTTON_ID = "yt-translator-chat-send";
  var SELECTED_CAPTION_ID = "yt-translator-selected-caption";
  var TRANSLATE_BUTTON_ID = "yt-translator-translate-button";

  // frontend/src/content/chat/markdown.js
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

  // frontend/src/content/chat/selected-caption.js
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
  function renderSelectedCaptionPill(renderOptions = {}) {
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
        ytTranslatorState.translate.isWaiting || ytTranslatorState.translate.result || ytTranslatorState.translate.error
      )
    );
    if (!ytTranslatorState.selection.captionText) {
      const label2 = document.createElement("span");
      label2.className = "yt-translator-selected-caption__label";
      label2.textContent = "Tip";
      const text = document.createElement("span");
      text.className = "yt-translator-selected-caption__text yt-translator-selected-caption__text--empty";
      text.textContent = "Highlight captions to select";
      contextNode.append(label2, text);
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
    if (ytTranslatorState.translate.isWaiting || ytTranslatorState.translate.result || ytTranslatorState.translate.error) {
      const translationBlock = document.createElement("div");
      translationBlock.className = "yt-translator-selected-caption__translation";
      translationBlock.classList.toggle(
        "yt-translator-selected-caption__translation--error",
        Boolean(ytTranslatorState.translate.error)
      );
      const translationLabel = document.createElement("div");
      translationLabel.className = "yt-translator-selected-caption__label";
      translationLabel.textContent = "English";
      const translationText = document.createElement("p");
      translationText.className = "yt-translator-selected-caption__translation-text";
      translationText.textContent = ytTranslatorState.translate.isWaiting ? "Translating..." : ytTranslatorState.translate.error || ytTranslatorState.translate.result;
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

  // frontend/src/content/translate.js
  function resetTranslateState() {
    ytTranslatorState.translate.activeRequest += 1;
    ytTranslatorState.translate.isWaiting = false;
    ytTranslatorState.translate.result = "";
    ytTranslatorState.translate.chunks = [];
    ytTranslatorState.translate.error = "";
    ytTranslatorState.translate.errorDetails = null;
  }
  function sendTranslatePromptToBackground(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "TRANSLATE_WITH_BREAKDOWN", payload }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response?.ok) {
          const error = new Error(response?.error || "Translate request failed");
          error.details = response?.errorDetails;
          reject(error);
          return;
        }
        resolve(response);
      });
    });
  }
  async function submitTranslatePrompt() {
    if (ytTranslatorState.translate.isWaiting) {
      return;
    }
    const text = ytTranslatorState.selection.captionText.trim();
    if (!text) {
      resetTranslateState();
      renderSelectedCaptionPill2();
      return;
    }
    ytTranslatorState.translate.isWaiting = true;
    ytTranslatorState.translate.result = "";
    ytTranslatorState.translate.chunks = [];
    ytTranslatorState.translate.error = "";
    ytTranslatorState.translate.errorDetails = null;
    const requestId = ytTranslatorState.translate.activeRequest + 1;
    ytTranslatorState.translate.activeRequest = requestId;
    renderSelectedCaptionPill2();
    try {
      const response = await sendTranslatePromptToBackground({
        text,
        targetLanguage: "en"
      });
      if (requestId !== ytTranslatorState.translate.activeRequest) {
        return;
      }
      ytTranslatorState.translate.result = response.translatedText || "The backend returned an empty translation.";
      ytTranslatorState.translate.chunks = Array.isArray(response.chunks) ? response.chunks : [];
    } catch (error) {
      if (requestId !== ytTranslatorState.translate.activeRequest) {
        return;
      }
      ytTranslatorState.translate.error = `Unable to translate: ${error.message}`;
      ytTranslatorState.translate.errorDetails = error.details || {
        source: "content-script",
        message: error.message
      };
    } finally {
      if (requestId === ytTranslatorState.translate.activeRequest) {
        ytTranslatorState.translate.isWaiting = false;
        renderSelectedCaptionPill2();
      }
    }
  }

  // frontend/src/content/youtube/youtube-page.js
  function getVideoTitle() {
    const titleElement = document.querySelector("h1.ytd-watch-metadata yt-formatted-string") || document.querySelector("h1.ytd-watch-metadata") || document.querySelector("h1.title");
    const title = titleElement?.textContent?.trim();
    if (title) {
      return title;
    }
    return document.title.replace(/ - YouTube$/, "").trim() || "Untitled video";
  }
  function getVideoId() {
    return new URLSearchParams(window.location.search).get("v");
  }
  function getVideoElement() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }
  function getPlaybackTimeMs() {
    const player = document.getElementById("movie_player");
    const playerTime = player?.getCurrentTime?.();
    if (Number.isFinite(playerTime)) {
      return playerTime * 1e3;
    }
    const video = getVideoElement();
    if (!video) {
      return null;
    }
    return video.currentTime * 1e3;
  }
  function isAdShowing() {
    const player = document.getElementById("movie_player");
    const adState = player?.getAdState?.();
    const adElements = [
      ".ytp-ad-player-overlay",
      ".ytp-ad-text",
      ".ytp-ad-preview-container",
      ".ytp-ad-message-container",
      ".ytp-ad-skip-button",
      ".ytp-ad-skip-button-modern",
      ".ytp-ad-overlay-container",
      ".video-ads .ytp-ad-module"
    ];
    return Boolean(player?.classList.contains("ad-showing") || player?.classList.contains("ad-interrupting") || typeof adState === "number" && adState !== 0 || adElements.some((selector) => {
      const element = document.querySelector(selector);
      return Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
    }));
  }
  function extractJsonObject(source, startIndex) {
    const firstBrace = source.indexOf("{", startIndex);
    if (firstBrace === -1) {
      return null;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = firstBrace; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(firstBrace, index + 1);
        }
      }
    }
    return null;
  }
  function getPlayerResponseFromScripts() {
    for (const script of document.scripts) {
      const text = script.textContent || "";
      const markerIndex = text.indexOf("ytInitialPlayerResponse");
      if (markerIndex === -1) {
        continue;
      }
      const json = extractJsonObject(text, markerIndex);
      if (!json) {
        continue;
      }
      try {
        return JSON.parse(json);
      } catch (error) {
        console.warn("Unable to parse YouTube player response", error);
      }
    }
    return null;
  }
  function getPlayerResponseFromDom() {
    const watchFlexy = document.querySelector("ytd-watch-flexy");
    return watchFlexy?.playerResponse || watchFlexy?.playerData?.playerResponse || document.querySelector("ytd-app")?.data?.playerResponse || null;
  }
  function getCaptionTracksFromPage() {
    const playerResponse = getPlayerResponseFromDom() || getPlayerResponseFromScripts();
    return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  }
  function getYouTubeText(textLike) {
    if (!textLike) {
      return "";
    }
    if (typeof textLike.simpleText === "string") {
      return textLike.simpleText.trim();
    }
    if (Array.isArray(textLike.runs)) {
      return textLike.runs.map((run) => run.text || "").join("").trim();
    }
    return "";
  }
  function getCaptionTrackUrlString(urlString) {
    if (!urlString) {
      return "";
    }
    try {
      const url = new URL(urlString, window.location.href);
      url.searchParams.delete("fmt");
      return url.toString();
    } catch (_error) {
      return urlString;
    }
  }
  function getCaptionSourceUrlString(urlString) {
    const urlStringWithoutFormat = getCaptionTrackUrlString(urlString);
    if (!urlStringWithoutFormat) {
      return "";
    }
    try {
      const url = new URL(urlStringWithoutFormat, window.location.href);
      url.searchParams.delete("tlang");
      return url.toString();
    } catch (_error) {
      return urlStringWithoutFormat;
    }
  }
  function getCaptionTranslationLanguageCode(urlString) {
    try {
      return new URL(urlString, window.location.href).searchParams.get("tlang") || "";
    } catch (_error) {
      return "";
    }
  }
  function getLanguageDisplayName(languageCode) {
    if (!languageCode) {
      return "";
    }
    try {
      if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
        const displayNames = new Intl.DisplayNames([navigator.language || "en"], { type: "language" });
        return displayNames.of(languageCode) || languageCode;
      }
    } catch (_error) {
    }
    return languageCode;
  }
  function getCaptionUrlParam(urlString, param) {
    try {
      return new URL(urlString, window.location.href).searchParams.get(param) || "";
    } catch (_error) {
      return "";
    }
  }
  function getCaptionTrackIdentity(urlString) {
    return [
      getCaptionUrlParam(urlString, "v"),
      getCaptionUrlParam(urlString, "lang"),
      getCaptionUrlParam(urlString, "kind"),
      getCaptionUrlParam(urlString, "name"),
      getCaptionUrlParam(urlString, "tlang")
    ].join("|");
  }
  function getCaptionSourceIdentity(urlString) {
    return [
      getCaptionUrlParam(urlString, "v"),
      getCaptionUrlParam(urlString, "lang"),
      getCaptionUrlParam(urlString, "kind"),
      getCaptionUrlParam(urlString, "name"),
      ""
    ].join("|");
  }
  function isAutoGeneratedCaptionTrack(track) {
    return track?.kind === "asr" || new URLSearchParams(track?.trackUrl?.split("?")[1] || "").get("kind") === "asr" || /\bauto-generated\b/i.test(track?.label || "");
  }
  function isTranslatedCaptionTrack(track) {
    return Boolean(track?.translationLanguageCode);
  }
  function getCaptionSourceLabel(label) {
    const sourceLabel = (label || "").split(/\s*(?:>{2,}|→|›|->)\s*/)[0].replace(/\s*\(translated to [^)]+\)\s*$/i, "").trim();
    return sourceLabel || "Auto-generated captions";
  }
  function getCaptionTrackLabelFromUrl(urlString) {
    const languageName = getLanguageDisplayName(getCaptionUrlParam(urlString, "lang"));
    const translationLanguageName = getLanguageDisplayName(getCaptionUrlParam(urlString, "tlang"));
    const isAutoGenerated = getCaptionUrlParam(urlString, "kind") === "asr";
    const sourceLabel = `${languageName || "Captions"}${isAutoGenerated ? " (auto-generated)" : ""}`;
    if (translationLanguageName) {
      return `${sourceLabel} >>> ${translationLanguageName}`;
    }
    return sourceLabel;
  }
  function getCaptionTrackKey(track) {
    return [
      track.vssId || "",
      track.languageCode || "",
      track.kind || "",
      getYouTubeText(track.name),
      getCaptionTrackIdentity(track.baseUrl || "")
    ].join("|");
  }
  function getCaptionTrackLabel(track) {
    const name = getYouTubeText(track.name);
    const languageCode = track.languageCode || "";
    const translationLanguageCode = getCaptionTranslationLanguageCode(track.baseUrl || "");
    const details = [];
    if (languageCode && !name.toLowerCase().includes(languageCode.toLowerCase())) {
      details.push(languageCode);
    }
    if (track.kind === "asr" && !/auto|generated/i.test(name)) {
      details.push("auto-generated");
    }
    if (translationLanguageCode && !name.includes(">>>")) {
      details.push(`translated to ${translationLanguageCode}`);
    }
    if (!name && !details.length) {
      return "Caption track";
    }
    if (!details.length) {
      return name;
    }
    return `${name || "Caption track"} (${details.join(", ")})`;
  }
  function getNormalizedCaptionTracksFromPage() {
    return getCaptionTracksFromPage().map((track) => ({
      key: getCaptionTrackKey(track),
      label: getCaptionTrackLabel(track),
      baseUrl: track.baseUrl || "",
      languageCode: track.languageCode || "",
      kind: track.kind || "",
      trackUrl: getCaptionTrackUrlString(track.baseUrl || ""),
      sourceUrl: getCaptionSourceUrlString(track.baseUrl || ""),
      identity: getCaptionTrackIdentity(track.baseUrl || ""),
      sourceIdentity: getCaptionSourceIdentity(track.baseUrl || ""),
      translationLanguageCode: getCaptionTranslationLanguageCode(track.baseUrl || "")
    })).filter((track) => track.baseUrl);
  }
  function createCaptionTrackFromUrl(captionUrl, label) {
    const trackUrl = getCaptionTrackUrlString(captionUrl);
    const sourceUrl = getCaptionSourceUrlString(captionUrl);
    const translationLanguageCode = getCaptionTranslationLanguageCode(captionUrl);
    if (!trackUrl) {
      return null;
    }
    return {
      key: `captured|${getCaptionTrackIdentity(captionUrl) || trackUrl}`,
      label: label || getCaptionTrackLabelFromUrl(captionUrl),
      baseUrl: trackUrl,
      languageCode: "",
      kind: "",
      trackUrl,
      sourceUrl,
      identity: getCaptionTrackIdentity(captionUrl),
      sourceIdentity: getCaptionSourceIdentity(captionUrl),
      translationLanguageCode
    };
  }
  function createSourceCaptionTrackFromUrl(captionUrl, sourceLabel) {
    const sourceUrl = getCaptionSourceUrlString(captionUrl);
    if (!sourceUrl || sourceUrl === getCaptionTrackUrlString(captionUrl)) {
      return null;
    }
    return {
      key: `source|${getCaptionSourceIdentity(captionUrl) || sourceUrl}`,
      label: getCaptionSourceLabel(sourceLabel),
      baseUrl: sourceUrl,
      languageCode: "",
      kind: "asr",
      trackUrl: sourceUrl,
      sourceUrl,
      identity: getCaptionSourceIdentity(captionUrl),
      sourceIdentity: getCaptionSourceIdentity(captionUrl),
      translationLanguageCode: ""
    };
  }
  function isWatchPage() {
    return window.location.pathname === "/watch";
  }
  function getRecommendationsColumn() {
    return document.querySelector("ytd-watch-flexy #secondary-inner") || document.querySelector("#secondary-inner") || document.querySelector("#secondary");
  }

  // frontend/src/content/chat/chat.js
  function createChatMessage(role, content, status = "done") {
    ytTranslatorState.chat.messageCounter += 1;
    return {
      id: `${Date.now()}-${ytTranslatorState.chat.messageCounter}`,
      role,
      content,
      status,
      createdAt: Date.now()
    };
  }
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
  function getTranscriptContextPreview() {
    if (!ytTranslatorState.transcript.segments.length) {
      return "";
    }
    const currentIndex = ytTranslatorState.transcript.currentCaptionIndex;
    const activeIndex = currentIndex >= 0 ? currentIndex : 0;
    const startIndex = Math.max(0, activeIndex - 4);
    const endIndex = Math.min(ytTranslatorState.transcript.segments.length, activeIndex + 2);
    return ytTranslatorState.transcript.segments.slice(startIndex, endIndex).map((segment) => segment.text).join(" ");
  }
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
  function scrollChatRiverToBottom() {
    const river = document.getElementById(CHAT_RIVER_ID);
    if (river) {
      river.scrollTop = river.scrollHeight;
    }
  }
  function renderSelectedCaptionPill2() {
    renderSelectedCaptionPill({
      onClearCaption: resetTranslateState,
      onTranslateCaption: submitTranslatePrompt
    });
  }
  function renderChatRiver() {
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
  function buildChatPayload(prompt) {
    return {
      message: prompt,
      history: ytTranslatorState.chat.messages.filter((message) => message.status === "done").slice(-8).map((message) => ({
        role: message.role,
        content: message.content
      })),
      videoContext: {
        videoId: getVideoId(),
        title: getVideoTitle(),
        transcriptContext: getTranscriptContextPreview(),
        selectedCaptionText: ytTranslatorState.selection.captionText || null
      }
    };
  }
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
  async function submitChatPrompt() {
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
        message: error.message
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

  // frontend/src/content/caption-timing.js
  var CAPTION_START_LEAD_MS = 0;
  var CAPTION_END_GRACE_MS = 500;
  var CAPTION_DISPLAY_SEGMENT_OFFSET = 0;

  // frontend/src/content/captions/caption-river.js
  function getActiveCaptionIndex(currentTimeMs) {
    if (!ytTranslatorState.transcript.segments.length) {
      return -1;
    }
    const lookupMs = currentTimeMs + CAPTION_START_LEAD_MS;
    let activeIndex = -1;
    for (let index = 0; index < ytTranslatorState.transcript.segments.length; index += 1) {
      const segment2 = ytTranslatorState.transcript.segments[index];
      const startMs2 = segment2.startMs || 0;
      if (startMs2 > lookupMs) {
        break;
      }
      activeIndex = index;
    }
    if (activeIndex < 0) {
      return -1;
    }
    const segment = ytTranslatorState.transcript.segments[activeIndex];
    const nextSegment = ytTranslatorState.transcript.segments[activeIndex + 1];
    const startMs = segment.startMs || 0;
    const durationMs = segment.durationMs || 0;
    const durationEndMs = durationMs > 0 ? startMs + durationMs : startMs + 4e3;
    const nextStartMs = nextSegment?.startMs;
    const endMs = Number.isFinite(nextStartMs) ? Math.max(durationEndMs, nextStartMs) : durationEndMs;
    if (currentTimeMs - CAPTION_END_GRACE_MS > endMs && nextSegment) {
      return -1;
    }
    return activeIndex;
  }
  function clampCaptionIndex(index) {
    if (!ytTranslatorState.transcript.segments.length) {
      return -1;
    }
    return Math.max(0, Math.min(index, ytTranslatorState.transcript.segments.length - 1));
  }
  function getDisplayCaptionIndex(activeIndex) {
    if (activeIndex < 0) {
      return activeIndex;
    }
    return clampCaptionIndex(activeIndex + CAPTION_DISPLAY_SEGMENT_OFFSET);
  }
  function getCaptionWordSegments(text) {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const segmenter = new Intl.Segmenter(void 0, { granularity: "word" });
      return Array.from(segmenter.segment(text)).map((segment) => ({
        text: segment.segment,
        isWordLike: segment.isWordLike
      }));
    }
    return text.match(/\s+|\S+/g)?.map((segment) => ({
      text: segment,
      isWordLike: !/^\s+$/.test(segment)
    })) || [];
  }
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
  function snapCaptionSelectionToWords() {
    if (ytTranslatorState.selection.isSnapping) {
      return;
    }
    const riverNode = document.getElementById(CAPTION_RIVER_ID);
    const selection = window.getSelection();
    if (!riverNode || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }
    const selectionRange = selection.getRangeAt(0);
    const selectionTouchesCaptionRiver = riverNode.contains(selectionRange.commonAncestorContainer) || riverNode.contains(selection.anchorNode) || riverNode.contains(selection.focusNode);
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
    ytTranslatorState.selection.isSnapping = true;
    selection.removeAllRanges();
    selection.addRange(snappedRange);
    ytTranslatorState.selection.isSnapping = false;
    const nextSelectedCaptionText = snappedRange.toString().replace(/\s+/g, " ").trim();
    if (nextSelectedCaptionText !== ytTranslatorState.selection.captionText) {
      resetTranslateState();
    }
    ytTranslatorState.selection.captionText = nextSelectedCaptionText;
    renderSelectedCaptionPill2();
  }
  function scheduleCaptionSelectionSnap() {
    window.setTimeout(snapCaptionSelectionToWords, 0);
  }
  function renderCaptionRiver(activeIndex) {
    const riverNode = document.getElementById(CAPTION_RIVER_ID);
    if (!riverNode) {
      return;
    }
    riverNode.textContent = "";
    if (!ytTranslatorState.transcript.segments.length) {
      riverNode.textContent = "Current caption will appear after captions load.";
      ytTranslatorState.transcript.currentCaptionIndex = -1;
      return;
    }
    if (activeIndex < 0) {
      riverNode.textContent = "Waiting for playback...";
      ytTranslatorState.transcript.currentCaptionIndex = -1;
      return;
    }
    const fragment = document.createDocumentFragment();
    const startIndex = Math.max(0, activeIndex - 3);
    for (let index = startIndex; index <= activeIndex; index += 1) {
      const line = document.createElement("p");
      line.className = index === activeIndex ? "yt-translator-caption-river__line yt-translator-caption-river__line--active" : "yt-translator-caption-river__line";
      appendCaptionText(line, ytTranslatorState.transcript.segments[index].text, index);
      fragment.appendChild(line);
    }
    riverNode.appendChild(fragment);
    ytTranslatorState.transcript.currentCaptionIndex = activeIndex;
  }
  function updateCaptionRiver() {
    const riverNode = document.getElementById(CAPTION_RIVER_ID);
    if (isAdShowing()) {
      if (!ytTranslatorState.captionRiver.isPausedForAd) {
        ytTranslatorState.captionRiver.isPausedForAd = true;
        ytTranslatorState.transcript.currentCaptionIndex = -1;
        setTranscriptStatus("Ad playing. Caption river paused until the video resumes.");
        if (riverNode) {
          riverNode.textContent = "Ad playing. Caption river paused.";
        }
      }
      return;
    }
    if (ytTranslatorState.captionRiver.isPausedForAd) {
      ytTranslatorState.captionRiver.isPausedForAd = false;
      ytTranslatorState.transcript.currentCaptionIndex = -1;
      if (ytTranslatorState.transcript.segments.length) {
        setTranscriptStatus("Captions loaded.");
      }
    }
    const currentTimeMs = getPlaybackTimeMs();
    if (currentTimeMs === null) {
      renderCaptionRiver(-1);
      return;
    }
    const activeIndex = getDisplayCaptionIndex(getActiveCaptionIndex(currentTimeMs));
    if (activeIndex !== ytTranslatorState.transcript.currentCaptionIndex) {
      renderCaptionRiver(activeIndex);
    }
  }
  function startCaptionRiverUpdates() {
    window.clearInterval(ytTranslatorState.captionRiver.timer);
    updateCaptionRiver();
    ytTranslatorState.captionRiver.timer = window.setInterval(updateCaptionRiver, 250);
  }
  function renderTranscript(segments, trackLabel = "") {
    ytTranslatorState.transcript.segments = segments;
    ytTranslatorState.transcript.currentCaptionIndex = -1;
    if (!segments.length) {
      setTranscriptStatus("No transcript text found.");
      renderCaptionRiver(-1);
      return;
    }
    setPlayerCaptureButtonVisible(false);
    startCaptionRiverUpdates();
    setTranscriptStatus(trackLabel ? `Captions loaded: ${trackLabel}.` : "Captions loaded.");
  }

  // frontend/src/content/sidebar/caption-track-selector.js
  function appendCaptionTrackIfMissing(tracks, track) {
    if (!track) {
      return tracks;
    }
    const alreadyExists = tracks.some((existingTrack) => existingTrack.identity === track.identity || existingTrack.trackUrl === track.trackUrl);
    if (alreadyExists) {
      return tracks;
    }
    return [...tracks, track];
  }
  function addCapturedCaptionTrackOptions(tracks) {
    if (!ytTranslatorState.playerCapture.lastCapturedCaptionUrl) {
      return tracks;
    }
    const capturedTrack = createCaptionTrackFromUrl(ytTranslatorState.playerCapture.lastCapturedCaptionUrl);
    let nextTracks = appendCaptionTrackIfMissing(tracks, capturedTrack);
    if (isAutoGeneratedCaptionTrack(capturedTrack) && isTranslatedCaptionTrack(capturedTrack)) {
      const hasSourceTrack = nextTracks.some((track) => track.sourceIdentity === capturedTrack.sourceIdentity && !isTranslatedCaptionTrack(track));
      const sourceTrack = createSourceCaptionTrackFromUrl(
        ytTranslatorState.playerCapture.lastCapturedCaptionUrl,
        capturedTrack.label
      );
      if (!hasSourceTrack) {
        nextTracks = appendCaptionTrackIfMissing(nextTracks, sourceTrack);
      }
    }
    return nextTracks;
  }
  function refreshAvailableCaptionTracks() {
    const nextTracks = addCapturedCaptionTrackOptions(getNormalizedCaptionTracksFromPage());
    const currentSelection = nextTracks.find((track) => track.key === ytTranslatorState.captionTracks.selectedKey);
    const preferredSelection = nextTracks.find((track) => track.languageCode && track.languageCode === ytTranslatorState.captionTracks.preferredLanguageCode && track.kind === ytTranslatorState.captionTracks.preferredKind) || nextTracks.find((track) => track.languageCode && track.languageCode === ytTranslatorState.captionTracks.preferredLanguageCode);
    ytTranslatorState.captionTracks.available = nextTracks;
    if (currentSelection) {
      ytTranslatorState.captionTracks.selectedKey = currentSelection.key;
    } else {
      ytTranslatorState.captionTracks.selectedKey = (preferredSelection || ytTranslatorState.captionTracks.available[0])?.key || "";
    }
  }
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

  // frontend/src/shared/storage-keys.js
  var LATENCY_DIAGNOSTICS_STORAGE_KEY = "ytTranslatorLatencyDiagnostics";
  var SIDEBAR_OPEN_STORAGE_KEY = "ytTranslatorSidebarOpen";

  // frontend/src/content/sidebar/diagnostics.js
  function formatDiagnosticsDuration(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "-";
    }
    if (value >= 1e3) {
      return `${(value / 1e3).toFixed(1)}s`;
    }
    return `${Math.round(value)}ms`;
  }
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
  function buildDiagnosticsReport() {
    const records = getLatencyDiagnosticsRecords();
    const latestRecords = records.slice(-20);
    const lines = [
      "## YouTube Translator Latency Diagnostics",
      "",
      `Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`,
      `Record count: ${records.length}`,
      "",
      "Recent requests:"
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
        `requestId=${record.requestId || "-"}`
      ].join(" "));
    }
    lines.push("", "Raw storage:", JSON.stringify(ytTranslatorState.diagnostics.snapshot || {}, null, 2));
    return lines.join("\n");
  }
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
        const timeText = date && !Number.isNaN(date.valueOf()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
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
          status
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
    keys.textContent = storageKeys.length ? `Storage keys: ${storageKeys.join(", ")}` : "Storage keys: none";
    panel.appendChild(keys);
    const raw = document.createElement("pre");
    raw.className = "yt-translator-diagnostics__raw";
    raw.textContent = JSON.stringify(ytTranslatorState.diagnostics.snapshot || {}, null, 2);
    panel.appendChild(raw);
  }
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

  // frontend/src/content/captions/transcript-parser.js
  function parseTranscriptEvents(events = []) {
    return events.map((event) => ({
      startMs: event.tStartMs || 0,
      durationMs: event.dDurationMs || 0,
      text: (event.segs || []).map((segment) => segment.utf8 || "").join("").replace(/\s+/g, " ").trim()
    })).filter((segment) => segment.text);
  }
  function parseJsonTranscript(body) {
    return parseTranscriptEvents(JSON.parse(body).events);
  }
  function parseXmlTranscript(body) {
    const document2 = new DOMParser().parseFromString(body, "text/xml");
    const parserError = document2.querySelector("parsererror");
    if (parserError) {
      throw new Error("Invalid XML transcript response");
    }
    const textSegments = Array.from(document2.querySelectorAll("text")).map((node) => ({
      startMs: Math.round(Number(node.getAttribute("start") || 0) * 1e3),
      durationMs: Math.round(Number(node.getAttribute("dur") || 0) * 1e3),
      text: (node.textContent || "").replace(/\s+/g, " ").trim()
    })).filter((segment) => segment.text);
    if (textSegments.length) {
      return textSegments;
    }
    return Array.from(document2.querySelectorAll("p")).map((node) => ({
      startMs: Math.round(Number(node.getAttribute("t") || 0)),
      durationMs: Math.round(Number(node.getAttribute("d") || 0)),
      text: (node.textContent || "").replace(/\s+/g, " ").trim()
    })).filter((segment) => segment.text);
  }
  function parseVttTimestamp(timestamp) {
    const parts = timestamp.trim().split(":");
    const seconds = Number(parts.pop() || 0);
    const minutes = Number(parts.pop() || 0);
    const hours = Number(parts.pop() || 0);
    return Math.round((hours * 60 * 60 + minutes * 60 + seconds) * 1e3);
  }
  function parseVttTranscript(body) {
    const blocks = body.replace(/\r/g, "").split("\n\n");
    return blocks.map((block) => {
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex === -1) {
        return null;
      }
      const [start, end] = lines[timingIndex].split("-->").map((value) => value.trim().split(" ")[0]);
      const startMs = parseVttTimestamp(start);
      const endMs = parseVttTimestamp(end);
      const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      return {
        startMs,
        durationMs: Math.max(0, endMs - startMs),
        text
      };
    }).filter((segment) => segment?.text);
  }
  function parseTranscriptBodyAuto(body) {
    const trimmedBody = body.trim();
    const parsers = [];
    if (trimmedBody.startsWith("{")) {
      parsers.push(() => parseJsonTranscript(trimmedBody));
    }
    if (trimmedBody.startsWith("<")) {
      parsers.push(() => parseXmlTranscript(trimmedBody));
    }
    parsers.push(() => parseVttTranscript(trimmedBody));
    parsers.push(() => parseJsonTranscript(trimmedBody));
    parsers.push(() => parseXmlTranscript(trimmedBody));
    for (const parser of parsers) {
      try {
        const segments = parser();
        if (segments.length) {
          return segments;
        }
      } catch (_error) {
      }
    }
    return [];
  }

  // frontend/src/content/captions/player-caption-capture.js
  function ensurePageCaptionCapturerInjected() {
    if (ytTranslatorState.playerCapture.pageCapturerReady) {
      return ytTranslatorState.playerCapture.pageCapturerReady;
    }
    if (ytTranslatorState.playerCapture.pageCapturerInjected || window.__ytTranslatorCaptionCapturerRequested) {
      ytTranslatorState.playerCapture.pageCapturerInjected = true;
      ytTranslatorState.playerCapture.pageCapturerReady = Promise.resolve();
      return ytTranslatorState.playerCapture.pageCapturerReady;
    }
    window.__ytTranslatorCaptionCapturerRequested = true;
    ytTranslatorState.playerCapture.pageCapturerReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = "yt-translator-page-caption-capturer";
      script.src = chrome.runtime.getURL("dist/page-caption-capturer.js");
      script.onload = () => {
        script.remove();
        ytTranslatorState.playerCapture.pageCapturerInjected = true;
        resolve();
      };
      script.onerror = () => {
        ytTranslatorState.playerCapture.pageCapturerReady = null;
        window.__ytTranslatorCaptionCapturerRequested = false;
        reject(new Error("Unable to inject page caption capturer"));
      };
      (document.head || document.documentElement).appendChild(script);
    });
    return ytTranslatorState.playerCapture.pageCapturerReady;
  }
  async function captureNextPlayerCaptionRequest(expectedVideoId, onCaptureStarted = () => {
  }) {
    await ensurePageCaptionCapturerInjected();
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${ytTranslatorState.playerCapture.requestId += 1}`;
      let settled = false;
      let captureStarted = false;
      function cancelPageCapture() {
        window.postMessage({
          source: "yt-translator-content",
          type: "CANCEL_PLAYER_CAPTION_CAPTURE",
          requestId
        }, "*");
      }
      function cleanup() {
        window.clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
      }
      function rejectCapture(error) {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        cancelPageCapture();
        reject(error instanceof Error ? error : new Error(error));
      }
      const timeout = window.setTimeout(() => {
        rejectCapture(new Error("Timed out waiting for YouTube caption request"));
      }, 14e3);
      function handleMessage(event) {
        if (event.source !== window || event.data?.source !== "yt-translator-caption-capturer" || event.data.requestId !== requestId) {
          return;
        }
        if (event.data.type === "PLAYER_CAPTION_CAPTURE_STARTED") {
          if (captureStarted) {
            return;
          }
          captureStarted = true;
          Promise.resolve(onCaptureStarted()).catch(rejectCapture);
          return;
        }
        if (event.data.type !== "PLAYER_CAPTION_CAPTURE_RESULT") {
          return;
        }
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (!event.data.ok) {
          reject(new Error(event.data.error || "Player caption capture failed"));
          return;
        }
        resolve({ body: event.data.body || "", url: event.data.url || "" });
      }
      window.addEventListener("message", handleMessage);
      window.postMessage({
        source: "yt-translator-content",
        type: "START_PLAYER_CAPTION_CAPTURE",
        requestId,
        expectedVideoId,
        timeoutMs: 12e3
      }, "*");
    });
  }
  function getCaptionButton() {
    return document.querySelector(".ytp-subtitles-button") || document.querySelector("button[aria-keyshortcuts='c']");
  }
  function isCaptionButtonEnabled(button) {
    return button?.getAttribute("aria-pressed") === "true" || button?.classList.contains("ytp-button-active");
  }
  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  function waitForAdToFinishBeforeCaptionCapture(videoId, requestId, attempt) {
    const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);
    ytTranslatorState.playerCapture.pendingVideoId = videoId;
    setPlayerCaptureButtonVisible(false);
    setTranscriptStatus("Ad playing. Transcript will load after the video resumes.");
    if (button) {
      button.disabled = true;
    }
    window.clearTimeout(ytTranslatorState.playerCapture.pendingTimer);
    ytTranslatorState.playerCapture.pendingTimer = window.setTimeout(() => {
      ytTranslatorState.playerCapture.pendingTimer = null;
      if (requestId !== ytTranslatorState.transcript.activeRequest || videoId !== getVideoId()) {
        ytTranslatorState.playerCapture.pendingVideoId = null;
        if (button) {
          button.disabled = false;
        }
        return;
      }
      if (isAdShowing()) {
        waitForAdToFinishBeforeCaptionCapture(videoId, requestId, attempt);
        return;
      }
      ytTranslatorState.playerCapture.pendingVideoId = null;
      loadTranscriptFromPlayerCaptions(true, attempt, requestId);
    }, 500);
  }
  async function triggerPlayerCaptionLoad(wasEnabled) {
    const button = getCaptionButton();
    if (!button) {
      throw new Error("YouTube CC button was not found. Try enabling captions manually, then click this button again.");
    }
    if (wasEnabled) {
      button.click();
      await wait(250);
    }
    button.click();
  }
  async function restorePlayerCaptionState(wasEnabled) {
    const button = getCaptionButton();
    if (!button) {
      return;
    }
    await wait(500);
    if (isCaptionButtonEnabled(button) !== wasEnabled) {
      button.click();
    }
  }
  function getSelectedCaptionTrack() {
    return ytTranslatorState.captionTracks.available.find(
      (track) => track.key === ytTranslatorState.captionTracks.selectedKey
    ) || null;
  }
  function getCaptionTrackForCaptionUrl(captionUrl) {
    if (!ytTranslatorState.captionTracks.available.length && typeof refreshAvailableCaptionTracks === "function") {
      refreshAvailableCaptionTracks();
    }
    const identity = getCaptionTrackIdentity(captionUrl);
    const trackUrl = getCaptionTrackUrlString(captionUrl);
    if (!trackUrl) {
      return null;
    }
    return ytTranslatorState.captionTracks.available.find((track) => track.identity === identity) || ytTranslatorState.captionTracks.available.find((track) => track.trackUrl === trackUrl) || ytTranslatorState.captionTracks.available.find(
      (track) => track.sourceIdentity === getCaptionSourceIdentity(captionUrl) && !isTranslatedCaptionTrack(track)
    ) || null;
  }
  function getUntranslatedAutoGeneratedTrack(captionUrl, matchedTrack) {
    const capturedTrack = createCaptionTrackFromUrl(captionUrl);
    if (!capturedTrack || !isTranslatedCaptionTrack(capturedTrack)) {
      return null;
    }
    const isAutoGenerated = isAutoGeneratedCaptionTrack(capturedTrack) || isAutoGeneratedCaptionTrack(matchedTrack);
    if (!isAutoGenerated) {
      return null;
    }
    return ytTranslatorState.captionTracks.available.find((track) => track.sourceIdentity === capturedTrack.sourceIdentity && !isTranslatedCaptionTrack(track)) || createSourceCaptionTrackFromUrl(captionUrl, matchedTrack?.label || capturedTrack.label);
  }
  function applyCapturedCaptionRequestParams(url) {
    if (!ytTranslatorState.playerCapture.lastCapturedCaptionUrl) {
      return;
    }
    let capturedUrl = null;
    try {
      capturedUrl = new URL(ytTranslatorState.playerCapture.lastCapturedCaptionUrl, window.location.href);
    } catch (_error) {
      return;
    }
    for (const param of [
      "pot",
      "potc",
      "po_token",
      "xorb",
      "xobt",
      "xovt",
      "c",
      "cver",
      "cplayer",
      "cbr",
      "cbrver",
      "cos",
      "cosver",
      "cplatform"
    ]) {
      const value = capturedUrl.searchParams.get(param);
      if (value && !url.searchParams.has(param)) {
        url.searchParams.set(param, value);
      }
    }
  }
  function getCaptionTrackFetchBaseUrl(track) {
    const url = new URL(track.trackUrl || track.baseUrl, window.location.href);
    url.searchParams.delete("fmt");
    applyCapturedCaptionRequestParams(url);
    return url;
  }
  function getCaptionTrackRequestUrls(track) {
    const baseUrl = getCaptionTrackFetchBaseUrl(track);
    const urls = [baseUrl.toString()];
    for (const format of ["json3", "srv3", "vtt"]) {
      const url = new URL(baseUrl.toString());
      url.searchParams.set("fmt", format);
      urls.push(url.toString());
    }
    return Array.from(new Set(urls));
  }
  async function fetchCaptionTrackTranscript(track) {
    let lastError = null;
    for (const url of getCaptionTrackRequestUrls(track)) {
      try {
        const response = await fetch(url, {
          credentials: "include"
        });
        if (!response.ok) {
          throw new Error(`YouTube returned ${response.status}`);
        }
        const body = await response.text();
        const segments = parseTranscriptBodyAuto(body);
        if (segments.length) {
          return segments;
        }
        lastError = new Error("response did not contain transcript text");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw new Error(lastError ? `Selected YouTube caption track could not be parsed (${lastError.message}).` : "Selected YouTube caption track could not be parsed.");
  }
  async function parseOrRefetchCapturedTranscript(captured) {
    const segments = parseTranscriptBodyAuto(captured.body || "");
    if (segments.length) {
      return segments;
    }
    const capturedTrack = createCaptionTrackFromUrl(captured.url);
    if (!capturedTrack) {
      return [];
    }
    return fetchCaptionTrackTranscript(capturedTrack);
  }
  async function primeCaptionTrackRequestParams(videoId, captionRequestId, trackLabel) {
    if (ytTranslatorState.playerCapture.lastCapturedCaptionUrl) {
      return;
    }
    if (isAdShowing()) {
      return;
    }
    const captionButton = getCaptionButton();
    if (!captionButton) {
      return;
    }
    const wasEnabled = isCaptionButtonEnabled(captionButton);
    ytTranslatorState.playerCapture.activeVideoId = videoId;
    setTranscriptStatus(`Preparing ${trackLabel} captions...`);
    try {
      const captured = await captureNextPlayerCaptionRequest(videoId, () => triggerPlayerCaptionLoad(wasEnabled));
      if (captionRequestId !== ytTranslatorState.transcript.activeRequest || videoId !== getVideoId()) {
        return;
      }
      ytTranslatorState.playerCapture.lastCapturedCaptionUrl = captured.url;
      if (typeof refreshAvailableCaptionTracks === "function") {
        refreshAvailableCaptionTracks();
        renderCaptionTrackSelector();
      }
    } finally {
      await restorePlayerCaptionState(wasEnabled);
      ytTranslatorState.playerCapture.activeVideoId = null;
    }
  }
  async function loadTranscriptFromSelectedCaptionTrack(isAutomatic = false, options = {}) {
    const videoId = getVideoId();
    const track = getSelectedCaptionTrack();
    const shouldPrimeWithPlayerCapture = options.primeWithPlayerCapture && !ytTranslatorState.playerCapture.lastCapturedCaptionUrl;
    if (!track) {
      await loadTranscriptFromPlayerCaptions(isAutomatic);
      return;
    }
    if (!videoId) {
      setTranscriptStatus("Open a video page before loading captions.");
      return;
    }
    if (ytTranslatorState.transcript.loadedVideoId === videoId && ytTranslatorState.transcript.loadedTrackKey === track.key) {
      return;
    }
    if (!isAutomatic) {
      ytTranslatorState.playerCapture.userAllowedCaptionCapture = true;
    }
    const captionRequestId = ytTranslatorState.transcript.activeRequest += 1;
    const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);
    const select = document.getElementById(CAPTION_TRACK_SELECT_ID);
    setPlayerCaptureButtonVisible(false);
    setTranscriptStatus(`Loading ${track.label} captions...`);
    if (button) {
      button.disabled = true;
    }
    if (select) {
      select.disabled = true;
    }
    try {
      if (shouldPrimeWithPlayerCapture) {
        try {
          await primeCaptionTrackRequestParams(videoId, captionRequestId, track.label);
        } catch (error) {
          console.warn("Unable to prepare caption request params before selected-track fetch", error);
        }
        if (select) {
          select.disabled = true;
        }
      }
      if (captionRequestId !== ytTranslatorState.transcript.activeRequest || videoId !== getVideoId()) {
        return;
      }
      const refreshedTrack = getSelectedCaptionTrack() || track;
      const segments = await fetchCaptionTrackTranscript(refreshedTrack);
      if (captionRequestId !== ytTranslatorState.transcript.activeRequest || videoId !== getVideoId()) {
        return;
      }
      ytTranslatorState.transcript.loadedVideoId = videoId;
      ytTranslatorState.transcript.loadedTrackKey = refreshedTrack.key;
      renderTranscript(segments, refreshedTrack.label);
    } catch (error) {
      console.error("Unable to load selected caption track", error);
      setTranscriptStatus(`Unable to load selected captions: ${error.message}`);
      setPlayerCaptureButtonVisible(true);
    } finally {
      if (button) {
        button.disabled = false;
      }
      if (select) {
        select.disabled = ytTranslatorState.captionTracks.available.length <= 1;
      }
    }
  }
  async function loadTranscriptFromPlayerCaptions(isAutomatic = false, attempt = 0, requestId = null) {
    const videoId = getVideoId();
    if (!videoId) {
      setTranscriptStatus("Open a video page before loading captions.");
      return;
    }
    if (ytTranslatorState.transcript.loadedVideoId === videoId || ytTranslatorState.playerCapture.activeVideoId === videoId || ytTranslatorState.playerCapture.pendingVideoId === videoId && requestId === null) {
      return;
    }
    const captionRequestId = requestId || (ytTranslatorState.transcript.activeRequest += 1);
    if (captionRequestId !== ytTranslatorState.transcript.activeRequest) {
      return;
    }
    if (!isAutomatic) {
      ytTranslatorState.playerCapture.userAllowedCaptionCapture = true;
    }
    const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);
    if (isAdShowing()) {
      waitForAdToFinishBeforeCaptionCapture(videoId, captionRequestId, attempt);
      return;
    }
    ytTranslatorState.playerCapture.activeVideoId = videoId;
    const captionButton = getCaptionButton();
    if (!captionButton) {
      ytTranslatorState.playerCapture.activeVideoId = null;
      if (isAutomatic && attempt < 20 && videoId === getVideoId()) {
        setTranscriptStatus("Waiting for YouTube captions control...");
        window.setTimeout(() => loadTranscriptFromPlayerCaptions(true, attempt + 1), 500);
        return;
      }
      setTranscriptStatus("YouTube CC button was not found. Try enabling captions manually, then click this button again.");
      setPlayerCaptureButtonVisible(true);
      return;
    }
    const wasEnabled = isCaptionButtonEnabled(captionButton);
    setPlayerCaptureButtonVisible(false);
    setTranscriptStatus("Enabling captions briefly to capture YouTube's transcript request...");
    if (button) {
      button.disabled = true;
    }
    try {
      const captured = await captureNextPlayerCaptionRequest(videoId, () => triggerPlayerCaptionLoad(wasEnabled));
      if (captionRequestId !== ytTranslatorState.transcript.activeRequest || videoId !== getVideoId()) {
        return;
      }
      if (isAdShowing()) {
        waitForAdToFinishBeforeCaptionCapture(videoId, captionRequestId, attempt);
        return;
      }
      ytTranslatorState.playerCapture.lastCapturedCaptionUrl = captured.url;
      if (typeof refreshAvailableCaptionTracks === "function") {
        refreshAvailableCaptionTracks();
      }
      const capturedTrack = getCaptionTrackForCaptionUrl(captured.url);
      const untranslatedTrack = getUntranslatedAutoGeneratedTrack(captured.url, capturedTrack);
      const segments = untranslatedTrack ? await fetchCaptionTrackTranscript(untranslatedTrack) : await parseOrRefetchCapturedTranscript(captured);
      if (!segments.length) {
        throw new Error("Captured YouTube caption response, but no transcript text was found.");
      }
      ytTranslatorState.transcript.loadedVideoId = videoId;
      const loadedTrack = untranslatedTrack || capturedTrack;
      if (loadedTrack) {
        ytTranslatorState.captionTracks.selectedKey = loadedTrack.key;
        ytTranslatorState.transcript.loadedTrackKey = loadedTrack.key;
        renderCaptionTrackSelector();
        renderTranscript(segments, loadedTrack.label);
      } else {
        ytTranslatorState.transcript.loadedTrackKey = "";
        renderTranscript(segments);
      }
    } catch (error) {
      console.error("Unable to capture player captions", error);
      setTranscriptStatus(`Unable to capture player captions: ${error.message}`);
      setPlayerCaptureButtonVisible(true);
    } finally {
      await restorePlayerCaptionState(wasEnabled);
      ytTranslatorState.playerCapture.activeVideoId = null;
      if (button) {
        button.disabled = false;
      }
    }
  }

  // frontend/src/content/sidebar/sidebar.js
  function updateSidebarTitle() {
    const titleNode = document.getElementById(TITLE_ID);
    if (!titleNode) {
      return;
    }
    titleNode.textContent = getVideoTitle();
  }
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
      ytTranslatorState.sidebar.isOpen ? "Hide language assistant sidebar" : "Open language assistant sidebar"
    );
    toggleButton.title = ytTranslatorState.sidebar.isOpen ? "Hide sidebar" : "Open sidebar";
  }
  function setSidebarOpen(nextIsOpen) {
    ytTranslatorState.sidebar.isOpen = nextIsOpen;
    renderSidebarOpenState();
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [SIDEBAR_OPEN_STORAGE_KEY]: ytTranslatorState.sidebar.isOpen });
    }
  }
  function setTranscriptStatus(message) {
    const statusNode = document.getElementById(TRANSCRIPT_STATUS_ID);
    if (statusNode) {
      statusNode.textContent = message;
    }
  }
  function setPlayerCaptureButtonVisible(visible) {
    const button = document.getElementById(PLAYER_CAPTURE_BUTTON_ID);
    if (button) {
      button.hidden = !visible;
    }
  }
  function loadTranscriptForCurrentCaptionChoice(isAutomatic = false) {
    if (ytTranslatorState.captionTracks.hasUserSelectedForVideo) {
      loadTranscriptFromSelectedCaptionTrack(isAutomatic, { primeWithPlayerCapture: true });
      return;
    }
    loadTranscriptFromPlayerCaptions(isAutomatic);
  }
  function setInitialTranscriptPrompt() {
    const videoId = getVideoId();
    refreshAvailableCaptionTracks();
    renderCaptionTrackSelector();
    const selectedTrack = getSelectedCaptionTrack();
    const isCurrentTranscriptLoaded = ytTranslatorState.transcript.loadedVideoId === videoId && (!ytTranslatorState.captionTracks.hasUserSelectedForVideo || !selectedTrack || ytTranslatorState.transcript.loadedTrackKey === selectedTrack.key);
    if (!videoId || ytTranslatorState.playerCapture.activeVideoId === videoId || isCurrentTranscriptLoaded) {
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
    setTranscriptStatus(ytTranslatorState.captionTracks.available.length ? "Choose a caption track, then load the transcript." : "Click below to load transcript. Captions will be enabled briefly.");
    setPlayerCaptureButtonVisible(true);
  }
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
        renderSelectedCaptionPill2();
        if (ytTranslatorState.playerCapture.userAllowedCaptionCapture || ytTranslatorState.transcript.loadedVideoId === getVideoId()) {
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
  function removeSidebar() {
    document.getElementById(SIDEBAR_ID)?.remove();
    window.clearInterval(ytTranslatorState.captionRiver.timer);
  }
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
      renderSelectedCaptionPill2();
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
    renderSelectedCaptionPill2();
    updateSidebarTitle();
    setInitialTranscriptPrompt();
  }
  function scheduleSidebarUpdate() {
    window.clearTimeout(ytTranslatorState.sidebar.updateTimer);
    ytTranslatorState.sidebar.updateTimer = window.setTimeout(createSidebar, 500);
  }

  // frontend/src/content/lifecycle.js
  function handleNavigation() {
    ytTranslatorState.transcript.activeRequest += 1;
    ytTranslatorState.transcript.loadedVideoId = null;
    ytTranslatorState.transcript.loadedTrackKey = "";
    ytTranslatorState.captionTracks.available = [];
    ytTranslatorState.captionTracks.selectedKey = "";
    ytTranslatorState.captionTracks.hasUserSelectedForVideo = false;
    ytTranslatorState.playerCapture.lastCapturedCaptionUrl = "";
    ytTranslatorState.playerCapture.activeVideoId = null;
    ytTranslatorState.playerCapture.pendingVideoId = null;
    ytTranslatorState.transcript.segments = [];
    ytTranslatorState.transcript.currentCaptionIndex = -1;
    ytTranslatorState.chat.messages = [];
    ytTranslatorState.selection.captionText = "";
    resetTranslateState();
    ytTranslatorState.chat.isWaitingForReply = false;
    ytTranslatorState.chat.activeRequest += 1;
    ytTranslatorState.captionRiver.isPausedForAd = false;
    window.clearTimeout(ytTranslatorState.playerCapture.pendingTimer);
    ytTranslatorState.playerCapture.pendingTimer = null;
    window.clearInterval(ytTranslatorState.captionRiver.timer);
    scheduleSidebarUpdate();
  }

  // frontend/src/content.js
  function startYouTubeTranslatorContentScript() {
    initializeSidebarOpenState(createSidebar);
    window.addEventListener("yt-navigate-finish", handleNavigation);
    window.addEventListener("yt-page-data-updated", handleNavigation);
    window.addEventListener("popstate", handleNavigation);
  }
  startYouTubeTranslatorContentScript();
})();
//# sourceMappingURL=content.js.map
