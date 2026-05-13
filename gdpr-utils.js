const GdprUtils = (() => {
    "use strict";

    const DATA_KEYS = Object.freeze([
        "blockedDomains",
        "statsToday",
        "allStatsToday",
        "hourlyUsageHistory",
        "statsDayKey",
        "alertsSent",
        "scheduledBlocks",
        "activeBlocks",
        "snoozedDomains",
        "snoozeHistory",
        "statsHistory",
        "recentlyReset",
        "personalInsights",
        "dismissedInsights",
        "insightNotificationHistory",
        "insightNotificationDaily",
        "lastInsightNotificationDate",
        "lastInsightAnalysisAt",
        "onboardingState",
        "onboardingMetrics",
        "uiSettings",
        "premiumState",
        "whopAccessToken",
        "whopPendingToken",
        "whopLinkState",
        "analyticsClientId",
        "analyticsInstallTimestampMs",
        "analyticsLastActiveDay",
        "analyticsLastActiveWeek",
        "analyticsRetentionMilestones"
    ]);

    const USAGE_KEYS = Object.freeze([
        "statsToday",
        "allStatsToday",
        "hourlyUsageHistory",
        "snoozeHistory",
        "statsHistory",
        "alertsSent",
        "recentlyReset",
        "personalInsights",
        "dismissedInsights",
        "insightNotificationHistory",
        "insightNotificationDaily",
        "lastInsightNotificationDate",
        "lastInsightAnalysisAt"
    ]);

    const ANALYTICS_KEYS = Object.freeze([
        "analyticsClientId",
        "analyticsInstallTimestampMs",
        "analyticsLastActiveDay",
        "analyticsLastActiveWeek",
        "analyticsRetentionMilestones"
    ]);

    function storage() {
        if (!chrome?.storage?.local) throw new Error("chrome.storage.local is unavailable");
        return chrome.storage.local;
    }

    async function exportAllData() {
        return {
            exportedAt: new Date().toISOString(),
            extensionVersion: chrome.runtime?.getManifest?.().version || "unknown",
            data: await storage().get(DATA_KEYS)
        };
    }

    async function exportDataAsJSON() {
        return JSON.stringify(await exportAllData(), null, 2);
    }

    async function exportDataAsCSV() {
        const snapshot = await exportAllData();
        const rows = [["day", "domain", "minutes", "visits"]];
        const history = snapshot.data.statsHistory || {};

        for (const [day, domains] of Object.entries(history)) {
            for (const [domain, stats] of Object.entries(domains || {})) {
                rows.push([
                    day,
                    domain,
                    Math.round(Number(stats?.timeMs || 0) / 60000),
                    Number(stats?.visits || 0)
                ]);
            }
        }

        return rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    }

    async function removeKeys(keys) {
        await storage().remove(keys);
        return true;
    }

    async function deleteUsageHistory() {
        return removeKeys(USAGE_KEYS);
    }

    async function deleteAnalyticsData() {
        return removeKeys(ANALYTICS_KEYS);
    }

    async function deleteAllUserData(confirmDelete = false) {
        if (!confirmDelete) throw new Error("Data deletion requires confirmation");
        return removeKeys(DATA_KEYS);
    }

    async function getDataSummary() {
        const data = await storage().get(null);
        return {
            totalStorageItems: Object.keys(data || {}).length,
            usageHistory: { present: Boolean(data?.statsHistory || data?.statsToday), canDelete: true },
            analyticsData: { present: Boolean(data?.analyticsClientId), canDelete: true },
            allData: { canDelete: true },
            exportFormats: ["JSON", "CSV"]
        };
    }

    return Object.freeze({
        exportAllData,
        exportDataAsJSON,
        exportDataAsCSV,
        deleteUsageHistory,
        deleteAnalyticsData,
        deleteAllUserData,
        getDataSummary
    });
})();

if (typeof module !== "undefined" && module.exports) module.exports = GdprUtils;
globalThis.GdprUtils = GdprUtils;
