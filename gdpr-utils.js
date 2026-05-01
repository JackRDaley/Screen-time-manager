// GDPR Compliance Utilities
// Provides data export and deletion capabilities

const GdprUtils = {
    /**
     * Exports all user data in JSON format
     * @returns {Promise<Object>} Complete user data snapshot
     */
    async exportAllData() {
        const allKeys = [
            'blockedDomains',
            'statsToday',
            'allStatsToday',
            'hourlyUsageHistory',
            'statsDayKey',
            'scheduledBlocks',
            'activeBlocks',
            'snoozedDomains',
            'snoozeHistory',
            'statsHistory',
            'onboardingState',
            'onboardingMetrics',
            'analyticsClientId',
            'analyticsInstallTimestampMs',
            'analyticsLastActiveDay',
            'analyticsLastActiveWeek',
            'analyticsRetentionMilestones'
        ];

        try {
            const data = await chrome.storage.local.get(allKeys);
            
            return {
                exportedAt: new Date().toISOString(),
                extensionVersion: chrome.runtime.getManifest().version,
                data: data
            };
        } catch (error) {
            console.error('[GDPR] Export failed:', error);
            throw error;
        }
    },

    /**
     * Exports data as CSV for easy viewing in spreadsheet apps
     * @returns {Promise<string>} CSV formatted data
     */
    async exportDataAsCSV() {
        const allData = await this.exportAllData();
        const data = allData.data;
        
        let csv = 'Screen Time Manager - Data Export\n';
        csv += `Exported: ${allData.exportedAt}\n`;
        csv += `Version: ${allData.extensionVersion}\n\n`;

        // Export usage statistics
        if (data.statsHistory) {
            csv += 'Day,Domain,Time (minutes),Visits\n';
            Object.entries(data.statsHistory).forEach(([day, dayStats]) => {
                Object.entries(dayStats).forEach(([domain, stats]) => {
                    const timeMs = stats.timeMs || 0;
                    const minutes = Math.round(timeMs / 60000);
                    const visits = stats.visits || 0;
                    csv += `"${day}","${domain}",${minutes},${visits}\n`;
                });
            });
        }

        return csv;
    },

    /**
     * Exports data as JSON file content
     * @returns {Promise<string>} JSON formatted data
     */
    async exportDataAsJSON() {
        const allData = await this.exportAllData();
        return JSON.stringify(allData, null, 2);
    },

    /**
     * Deletes all user data permanently
     * @param {boolean} confirmDelete - Requires explicit confirmation
     * @returns {Promise<boolean>} Success status
     */
    async deleteAllUserData(confirmDelete = false) {
        if (!confirmDelete) {
            throw new Error('Data deletion requires explicit confirmation');
        }

        const allKeys = [
            'blockedDomains',
            'statsToday',
            'allStatsToday',
            'hourlyUsageHistory',
            'statsDayKey',
            'alertsSent',
            'scheduledBlocks',
            'activeBlocks',
            'snoozedDomains',
            'snoozeHistory',
            'statsHistory',
            'onboardingState',
            'onboardingMetrics',
            'postInstallRedirectMeta',
            'uiSettings',
            'premiumState',
            'whopAccessToken',
            'whopPendingToken',
            'whopLinkState',
            'analyticsClientId',
            'analyticsInstallTimestampMs',
            'analyticsLastActiveDay',
            'analyticsLastActiveWeek',
            'analyticsRetentionMilestones',
            'lastKnownTimezoneOffset'
        ];

        try {
            // Clear all extension data
            await chrome.storage.local.remove(allKeys);
            
            // Send analytics event about deletion
            try {
                await fetch('https://screen-time-manager.jackster0627.workers.dev/analytics/event', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clientId: 'deleted-user',
                        eventName: 'user_data_deleted',
                        extensionVersion: chrome.runtime.getManifest().version,
                        params: {}
                    })
                }).catch(() => null); // Silently fail if analytics unavailable
            } catch {}
            
            console.info('[GDPR] All user data has been deleted');
            return true;
        } catch (error) {
            console.error('[GDPR] Deletion failed:', error);
            throw error;
        }
    },

    /**
     * Deletes only usage history (keeps settings)
     * @returns {Promise<boolean>} Success status
     */
    async deleteUsageHistory() {
        const historyKeys = [
            'statsToday',
            'allStatsToday',
            'hourlyUsageHistory',
            'snoozeHistory',
            'statsHistory',
            'alertsSent'
        ];

        try {
            await chrome.storage.local.remove(historyKeys);
            console.info('[GDPR] Usage history has been deleted');
            return true;
        } catch (error) {
            console.error('[GDPR] History deletion failed:', error);
            throw error;
        }
    },

    /**
     * Deletes analytics data
     * @returns {Promise<boolean>} Success status
     */
    async deleteAnalyticsData() {
        const analyticsKeys = [
            'analyticsClientId',
            'analyticsInstallTimestampMs',
            'analyticsLastActiveDay',
            'analyticsLastActiveWeek',
            'analyticsRetentionMilestones'
        ];

        try {
            await chrome.storage.local.remove(analyticsKeys);
            console.info('[GDPR] Analytics data has been deleted');
            return true;
        } catch (error) {
            console.error('[GDPR] Analytics deletion failed:', error);
            throw error;
        }
    },

    /**
     * Gets data deletion options summary
     * @returns {Promise<Object>} Summary of what can be deleted
     */
    async getDataSummary() {
        try {
            const allData = await chrome.storage.local.get(null);
            
            return {
                totalStorageItems: Object.keys(allData).length,
                usageHistory: {
                    present: Boolean(allData.statsHistory),
                    canDelete: true
                },
                analyticsData: {
                    present: Boolean(allData.analyticsClientId),
                    canDelete: true
                },
                allData: {
                    canDelete: true
                },
                exportFormats: ['JSON', 'CSV']
            };
        } catch (error) {
            console.error('[GDPR] Failed to get data summary:', error);
            throw error;
        }
    }
};

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GdprUtils;
}
if (typeof globalThis !== 'undefined') {
    globalThis.GdprUtils = GdprUtils;
}
