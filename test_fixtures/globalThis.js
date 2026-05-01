// Mock globalThis for testing
global.StmSharedUtils = {
    formatTimeSec: (sec) => {
        sec = Math.max(0, Math.floor(sec || 0));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    },
    getDayKey: (d = new Date()) => {
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${mo}-${day}`;
    },
    parseDayKey: (dayKey) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ''))) {
            return null;
        }
        const [year, month, day] = String(dayKey).split('-').map(Number);
        const parsed = new Date(year, month - 1, day);
        if (Number.isNaN(parsed.getTime())) {
            return null;
        }
        parsed.setHours(0, 0, 0, 0);
        return parsed;
    },
    getOrCreateAnalyticsClientId: async () => 'test-client-id'
};

module.exports = global.StmSharedUtils;
