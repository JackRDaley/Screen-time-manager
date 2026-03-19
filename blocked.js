const params = new URLSearchParams(location.search);
const d = params.get("d") || "this site";
const source = params.get("source") || "limit";

document.getElementById("domain").textContent = d;

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

