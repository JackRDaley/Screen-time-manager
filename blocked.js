const params = new URLSearchParams(location.search);
const d = params.get("d") || "this site";
const source = params.get("source") || "limit";
const eventId = params.get("eid") || "";
const ANALYTICS_CLIENT_ID_KEY = "analyticsClientId";
const BLOCK_EVENT_TRACKER_KEY = "blockedAnalyticsEvent";
const BLOCK_ANALYTICS_URL = "https://screen-time-manager.jackster0627.workers.dev/analytics/block-event";

document.getElementById("domain").textContent = d;

function getTrackedEventStorageKey(id) {
    return `${BLOCK_EVENT_TRACKER_KEY}:${id}`;
}

async function getAnalyticsClientId() {
    const { [ANALYTICS_CLIENT_ID_KEY]: storedClientId = "" } =
        await chrome.storage.local.get([ANALYTICS_CLIENT_ID_KEY]);

    if (storedClientId) {
        return storedClientId;
    }

    const clientId = typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}.${Math.random().toString(36).slice(2, 12)}`;

    await chrome.storage.local.set({ [ANALYTICS_CLIENT_ID_KEY]: clientId });
    return clientId;
}

async function trackBlockedPageView() {
    if (!eventId) return;

    const trackedEventKey = getTrackedEventStorageKey(eventId);
    if (sessionStorage.getItem(trackedEventKey) === "1") {
        return;
    }

    sessionStorage.setItem(trackedEventKey, "1");

    try {
        const clientId = await getAnalyticsClientId();
        const response = await fetch(BLOCK_ANALYTICS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                clientId,
                eventId,
                source,
                extensionVersion: chrome.runtime.getManifest().version
            })
        });

        if (!response.ok) {
            throw new Error(`Analytics request failed (${response.status})`);
        }
    } catch (error) {
        sessionStorage.removeItem(trackedEventKey);
        console.debug("Blocked-page analytics failed", error);
    }
}

trackBlockedPageView();

if (source === "scheduled") {
    document.getElementById("badge").textContent = "Scheduled block active";
    document.getElementById("limitActions").style.display = "none";
    document.getElementById("scheduledActions").style.display = "flex";

    // Show when the block ends
    chrome.storage.local.get(["activeBlocks"], (data) => {
        const block = (data.activeBlocks || []).find((b) => b.domain === d);
        if (block?.endTime) {
            const endTime = new Date(block.endTime).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit"
            });
            const el = document.getElementById("blockedUntil");
            el.textContent = `Session active until ${endTime}`;
        }
    });
} else {
    document.getElementById("scheduledActions").style.display = "none";
    document.getElementById("limitActions").style.display = "flex";
}

// Time-limit: reset stats and go to site
document.getElementById("goBackBtn").addEventListener("click", async () => {
    const { statsToday = {}, alertsSent = {} } = await chrome.storage.local.get(["statsToday", "alertsSent"]);
    const nextStats = { ...statsToday };
    delete nextStats[d];
    const nextAlerts = { ...alertsSent };
    delete nextAlerts[d];
    await chrome.storage.local.set({ statsToday: nextStats, alertsSent: nextAlerts });
    window.location.href = `https://${d}`;
});

// Time-limit: close tab
document.getElementById("closeTabBtn").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) chrome.tabs.remove(tab.id);
});

// Scheduled: snooze 5 min then redirect
document.getElementById("snoozeBtn").addEventListener("click", async () => {
    try {
        await chrome.runtime.sendMessage({ action: "snoozeBlock", domain: d, minutes: 5 });
        window.location.href = `https://${d}`;
    } catch (err) {
        console.error("Snooze failed:", err);
    }
});

// Scheduled: end session early
document.getElementById("endSessionBtn").addEventListener("click", async () => {
    try {
        await chrome.runtime.sendMessage({ action: "endScheduledBlock", domain: d });
        window.location.href = `https://${d}`;
    } catch (err) {
        console.error("End session failed:", err);
    }
});

