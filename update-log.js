function openDashboard() {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html"), active: true });
}

function hydrateVersion() {
    const params = new URLSearchParams(window.location.search);
    const version = String(params.get("version") || chrome.runtime.getManifest?.().version || "unknown");
    const versionPill = document.getElementById("versionPill");
    if (versionPill) versionPill.textContent = `v${version}`;
}

function bindActions() {
    document.getElementById("openDashboardBtn")?.addEventListener("click", openDashboard);
    document.getElementById("backToWelcomeBtn")?.addEventListener("click", () => {
        if (history.length > 1) {
            history.back();
            return;
        }

        chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html"), active: true });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    hydrateVersion();
    bindActions();
});
