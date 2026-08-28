import { handleNavigation } from "./content/lifecycle.js";
import { createSidebar, initializeSidebarOpenState } from "./content/sidebar.js";

function startYouTubeTranslatorContentScript() {
  initializeSidebarOpenState(createSidebar);

  window.addEventListener("yt-navigate-finish", handleNavigation);
  window.addEventListener("yt-page-data-updated", handleNavigation);
  window.addEventListener("popstate", handleNavigation);
}

startYouTubeTranslatorContentScript();
