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
    const openUpdateLogBtn = document.getElementById("openUpdateLogBtn");

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

    openUpdateLogBtn?.addEventListener("click", () => {
        const params = new URLSearchParams(window.location.search);
        const url = new URL("https://saturnfocus.com/changelog");

        chrome.tabs.create({
            url: url.toString(),
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
