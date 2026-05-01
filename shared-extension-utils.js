(function initStmSharedUtils(globalObject) {
    "use strict";

    function formatTimeSec(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }

    function getDayKey(d = new Date()) {
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${mo}-${day}`;
    }

    function parseDayKey(dayKey) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ""))) {
            return null;
        }

        const [year, month, day] = String(dayKey).split("-").map(Number);
        const parsed = new Date(year, month - 1, day);
        if (Number.isNaN(parsed.getTime())) {
            return null;
        }

        parsed.setHours(0, 0, 0, 0);
        return parsed;
    }

    async function getOrCreateAnalyticsClientId(storageArea, key = "analyticsClientId") {
        const resolvedStorage = storageArea
            || ((typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) ? chrome.storage.local : null);

        if (!resolvedStorage || typeof resolvedStorage.get !== "function" || typeof resolvedStorage.set !== "function") {
            throw new Error("Chrome storage.local is unavailable");
        }

        const { [key]: storedClientId = "" } = await resolvedStorage.get([key]);
        if (storedClientId) {
            return storedClientId;
        }

        const clientId = typeof crypto?.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}.${Math.random().toString(36).slice(2, 12)}`;

        await resolvedStorage.set({ [key]: clientId });
        return clientId;
    }

    globalObject.StmSharedUtils = Object.freeze({
        formatTimeSec,
        getDayKey,
        parseDayKey,
        getOrCreateAnalyticsClientId
    });
})(globalThis);