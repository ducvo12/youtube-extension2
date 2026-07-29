// Reads the current YouTube video title from the page, falling back to document.title.
function getVideoTitle() {
  const titleElement = document.querySelector("h1.ytd-watch-metadata yt-formatted-string")
    || document.querySelector("h1.ytd-watch-metadata")
    || document.querySelector("h1.title");

  const title = titleElement?.textContent?.trim();

  if (title) {
    return title;
  }

  return document.title.replace(/ - YouTube$/, "").trim() || "Untitled video";
}

// Reads the current YouTube watch video ID from the URL query string.
function getVideoId() {
  return new URLSearchParams(window.location.search).get("v");
}

// Internal helper for getPlaybackTimeMs.
// Finds the main YouTube video element.
function getVideoElement() {
  return document.querySelector("video.html5-main-video") || document.querySelector("video");
}

// Reads the current playback position in milliseconds.
function getPlaybackTimeMs() {
  const player = document.getElementById("movie_player");
  const playerTime = player?.getCurrentTime?.();

  if (Number.isFinite(playerTime)) {
    return playerTime * 1000;
  }

  const video = getVideoElement();

  if (!video) {
    return null;
  }

  return video.currentTime * 1000;
}

// Detects whether YouTube is currently showing an ad instead of the main video.
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
    ".video-ads .ytp-ad-module",
  ];

  return Boolean(player?.classList.contains("ad-showing")
    || player?.classList.contains("ad-interrupting")
    || (typeof adState === "number" && adState !== 0)
    || adElements.some((selector) => {
      const element = document.querySelector(selector);
      return Boolean(element
        && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
    }));
}

// Internal helper for getPlayerResponseFromScripts.
// Extracts a balanced JSON object string.
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

// Internal helper for getCaptionTracksFromPage.
// Parses ytInitialPlayerResponse from scripts.
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

// Internal helper for getCaptionTracksFromPage.
// Reads YouTube's player response from DOM properties.
function getPlayerResponseFromDom() {
  const watchFlexy = document.querySelector("ytd-watch-flexy");

  return watchFlexy?.playerResponse
    || watchFlexy?.playerData?.playerResponse
    || document.querySelector("ytd-app")?.data?.playerResponse
    || null;
}

// Reads caption track metadata from the current YouTube page.
function getCaptionTracksFromPage() {
  const playerResponse = getPlayerResponseFromDom() || getPlayerResponseFromScripts();

  return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

// Internal helper for getNormalizedCaptionTracksFromPage.
// Reads a localized YouTube text shape into a plain string.
function getYouTubeText(textLike) {
  if (!textLike) {
    return "";
  }

  if (typeof textLike.simpleText === "string") {
    return textLike.simpleText.trim();
  }

  if (Array.isArray(textLike.runs)) {
    return textLike.runs
      .map((run) => run.text || "")
      .join("")
      .trim();
  }

  return "";
}

// Internal helper for getNormalizedCaptionTracksFromPage.
// Normalizes a caption URL while preserving the selected translation target.
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

// Internal helper for getNormalizedCaptionTracksFromPage.
// Removes YouTube's target-language translation from a caption URL.
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

// Internal helper for getNormalizedCaptionTracksFromPage.
// Reads YouTube's target-language translation from a caption URL.
function getCaptionTranslationLanguageCode(urlString) {
  try {
    return new URL(urlString, window.location.href).searchParams.get("tlang") || "";
  } catch (_error) {
    return "";
  }
}

// Converts a caption language code into a user-facing language name.
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
    // Fall through to the language code.
  }

  return languageCode;
}

// Internal helper for getCaptionTrackIdentity.
// Reads a URL query param without leaking token/client params into selector identity.
function getCaptionUrlParam(urlString, param) {
  try {
    return new URL(urlString, window.location.href).searchParams.get(param) || "";
  } catch (_error) {
    return "";
  }
}

// Builds a stable caption identity from only the meaningful track params.
function getCaptionTrackIdentity(urlString) {
  return [
    getCaptionUrlParam(urlString, "v"),
    getCaptionUrlParam(urlString, "lang"),
    getCaptionUrlParam(urlString, "kind"),
    getCaptionUrlParam(urlString, "name"),
    getCaptionUrlParam(urlString, "tlang"),
  ].join("|");
}

// Builds a stable source-caption identity from only the meaningful track params.
function getCaptionSourceIdentity(urlString) {
  return [
    getCaptionUrlParam(urlString, "v"),
    getCaptionUrlParam(urlString, "lang"),
    getCaptionUrlParam(urlString, "kind"),
    getCaptionUrlParam(urlString, "name"),
    "",
  ].join("|");
}

// Checks whether a normalized caption track is auto-generated.
function isAutoGeneratedCaptionTrack(track) {
  return track?.kind === "asr"
    || new URLSearchParams(track?.trackUrl?.split("?")[1] || "").get("kind") === "asr"
    || /\bauto-generated\b/i.test(track?.label || "");
}

// Checks whether a normalized caption track is an auto-translated variant.
function isTranslatedCaptionTrack(track) {
  return Boolean(track?.translationLanguageCode);
}

// Builds a source-caption label from YouTube's translated caption label.
function getCaptionSourceLabel(label) {
  const sourceLabel = (label || "")
    .split(/\s*(?:>{2,}|→|›|->)\s*/)[0]
    .replace(/\s*\(translated to [^)]+\)\s*$/i, "")
    .trim();

  return sourceLabel || "Auto-generated captions";
}

// Builds a fallback label from caption URL params when YouTube metadata is unavailable.
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

// Internal helper for getNormalizedCaptionTracksFromPage.
// Creates a stable track key for the current page's caption selector.
function getCaptionTrackKey(track) {
  return [
    track.vssId || "",
    track.languageCode || "",
    track.kind || "",
    getYouTubeText(track.name),
    getCaptionTrackIdentity(track.baseUrl || ""),
  ].join("|");
}

// Internal helper for getNormalizedCaptionTracksFromPage.
// Builds the user-facing label shown in the caption track selector.
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

// Reads and normalizes usable caption tracks from the current YouTube page.
function getNormalizedCaptionTracksFromPage() {
  return getCaptionTracksFromPage()
    .map((track) => ({
      key: getCaptionTrackKey(track),
      label: getCaptionTrackLabel(track),
      baseUrl: track.baseUrl || "",
      languageCode: track.languageCode || "",
      kind: track.kind || "",
      trackUrl: getCaptionTrackUrlString(track.baseUrl || ""),
      sourceUrl: getCaptionSourceUrlString(track.baseUrl || ""),
      identity: getCaptionTrackIdentity(track.baseUrl || ""),
      sourceIdentity: getCaptionSourceIdentity(track.baseUrl || ""),
      translationLanguageCode: getCaptionTranslationLanguageCode(track.baseUrl || ""),
    }))
    .filter((track) => track.baseUrl);
}

// Creates a selector option from a captured player caption URL that is not in page metadata.
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
    translationLanguageCode,
  };
}

// Creates a selector option for the un-translated source behind an auto-translated URL.
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
    translationLanguageCode: "",
  };
}

// Checks whether the current YouTube route is a video watch page.
function isWatchPage() {
  return window.location.pathname === "/watch";
}

// Finds the right-side recommendations column where the extension sidebar is inserted.
function getRecommendationsColumn() {
  return document.querySelector("ytd-watch-flexy #secondary-inner")
    || document.querySelector("#secondary-inner")
    || document.querySelector("#secondary");
}
