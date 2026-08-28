import { ytTranslatorState } from "./state.js";
import { scheduleSidebarUpdate } from "./sidebar.js";
import { resetTranslateState } from "./translate.js";

/*
 * YouTube navigation lifecycle.
 *
 * YouTube behaves like a single-page app, so moving between videos does not
 * always reload this content script. content.js wires YouTube navigation
 * events to handleNavigation(), and this file resets video-specific extension
 * state before asking the sidebar to refresh for the new page/video.
 */

export function handleNavigation() {
  // Resets states
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

  // Stop the old video's caption sync timer before refreshing for the new page.
  window.clearTimeout(ytTranslatorState.playerCapture.pendingTimer);
  ytTranslatorState.playerCapture.pendingTimer = null;
  window.clearInterval(ytTranslatorState.captionRiver.timer);

  // Located in sidebar.js
  scheduleSidebarUpdate();
}
