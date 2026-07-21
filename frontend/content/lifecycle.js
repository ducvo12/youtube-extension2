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
  loadedTranscriptVideoId = null;
  activePlayerCaptionCaptureVideoId = null;
  currentTranscriptSegments = [];
  currentCaptionIndex = -1;
  chatMessages = [];
  selectedCaptionText = "";
  isChatWaitingForReply = false;
  activeChatRequest += 1;
  isCaptionRiverPausedForAd = false;

  // Stop the old video's caption sync timer before refreshing for the new page.
  window.clearInterval(captionRiverTimer);

  // Located in sidebar.js
  scheduleSidebarUpdate();
}
