/*
 * YouTube navigation lifecycle.
 *
 * YouTube behaves like a single-page app, so moving between videos does not
 * always reload this content script. content.js wires YouTube navigation
 * events to handleNavigation(), and this file resets video-specific extension
 * state before asking the sidebar to refresh for the new page/video.
 */

function handleNavigation() {
  // Resets states
  activeTranscriptRequest += 1;
  loadedTranscriptVideoId = null;
  activePlayerCaptionCaptureVideoId = null;
  pendingPlayerCaptionCaptureVideoId = null;
  currentTranscriptSegments = [];
  currentCaptionIndex = -1;
  chatMessages = [];
  selectedCaptionText = "";
  resetTranslateState();
  isChatWaitingForReply = false;
  activeChatRequest += 1;
  isCaptionRiverPausedForAd = false;

  // Stop the old video's caption sync timer before refreshing for the new page.
  window.clearTimeout(pendingPlayerCaptionCaptureTimer);
  pendingPlayerCaptionCaptureTimer = null;
  window.clearInterval(captionRiverTimer);

  // Located in sidebar.js
  scheduleSidebarUpdate();
}
