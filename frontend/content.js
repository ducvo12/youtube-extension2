const SIDEBAR_ID = "yt-translator-sidebar";
const TITLE_ID = "yt-translator-video-title";
let updateTimer = null;
let retryCount = 0;

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

function updateSidebarTitle() {
  const titleNode = document.getElementById(TITLE_ID);

  if (!titleNode) {
    return;
  }

  titleNode.textContent = getVideoTitle();
}

function isWatchPage() {
  return window.location.pathname === "/watch";
}

function removeSidebar() {
  document.getElementById(SIDEBAR_ID)?.remove();
}

function getRecommendationsColumn() {
  return document.querySelector("ytd-watch-flexy #secondary-inner")
    || document.querySelector("#secondary-inner")
    || document.querySelector("#secondary");
}

function createSidebar() {
  if (!isWatchPage()) {
    removeSidebar();
    return;
  }

  if (document.getElementById(SIDEBAR_ID)) {
    updateSidebarTitle();
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
    <h2 class="yt-translator-sidebar__heading">Current Video</h2>
    <p id="${TITLE_ID}" class="yt-translator-sidebar__title"></p>
  `;

  recommendationsColumn.prepend(sidebar);
  updateSidebarTitle();
}

function scheduleSidebarUpdate() {
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(createSidebar, 500);
}

createSidebar();

window.addEventListener("yt-navigate-finish", scheduleSidebarUpdate);
window.addEventListener("yt-page-data-updated", scheduleSidebarUpdate);
window.addEventListener("popstate", scheduleSidebarUpdate);
