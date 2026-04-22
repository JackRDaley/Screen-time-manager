function formatReason(reason) {
    if (reason === "update") {
        return "Updated";
    }

    if (reason === "install") {
        return "Installed";
    }

    return "Activated";
}

function bindActions() {
    const openDashboardBtn = document.getElementById("openDashboardBtn");
    const openGuideBtn = document.getElementById("openGuideBtn");

    openDashboardBtn?.addEventListener("click", async () => {
        try {
            if (typeof chrome.action?.openPopup === "function") {
                await chrome.action.openPopup();
                return;
            }
        } catch {
            // Fall through to tab fallback.
        }

        chrome.tabs.create({ url: chrome.runtime.getURL("popup.html"), active: true });
    });

    openGuideBtn?.addEventListener("click", () => {
        chrome.tabs.create({
            url: "https://screen-time-manager.jackster0627.workers.dev/",
            active: true
        });
    });
}

function hydrateHeader() {
    const params = new URLSearchParams(window.location.search);
    const reason = formatReason(params.get("reason"));
    const version = String(params.get("version") || "unknown");

    const reasonPill = document.getElementById("reasonPill");
    const versionPill = document.getElementById("versionPill");

    if (reasonPill) {
        reasonPill.textContent = reason;
    }

    if (versionPill) {
        versionPill.textContent = `v${version}`;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    hydrateHeader();
    bindActions();
});
