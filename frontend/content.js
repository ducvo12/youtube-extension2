createSidebar();

// Call handleNavigation when specific Youtube/browser events happen
window.addEventListener("yt-navigate-finish", handleNavigation);
window.addEventListener("yt-page-data-updated", handleNavigation);
window.addEventListener("popstate", handleNavigation);
