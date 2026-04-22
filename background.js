// blockedDomains: { [domain]: { limitMinutes: number } }
// statsToday: { [domain]: { timeSec: number, visits: number } }
// activeBlocks: [{ domain: string, endsAt: number|null, remainingSec?: number }]

const KEYS = {
    blockedDomains: "blockedDomains", // { [domain]: { limitMinutes } }
    statsToday: "statsToday",         // { [domain]: { timeSec, visits, lastSeenDay } }
    allStatsToday: "allStatsToday",   // { [domain]: { timeMs, visits } } for all websites
    hourlyUsageHistory: "hourlyUsageHistory", // { [dayKey]: { [hour]: { timeMs, visits } } }
    dayKey: "statsDayKey",            // "YYYY-MM-DD"
    enforceIntervalSec: "enforceIntervalSec", // optional: number of seconds between enforce checks
    alertsSent: "alertsSent",          // { [domain]: Set of alert thresholds already notified ("75", "90") }
    scheduledBlocks: "scheduledBlocks", // [{ domain: string, startTime: number, endTime: number }]
    activeBlocks: "activeBlocks",       // [{ domain: string, startTime: number, endTime: number }]
    snoozedDomains: "snoozedDomains",   // { [domain]: expiresAt (ms) }
    snoozeHistory: "snoozeHistory",     // { [dayKey]: number }
    statsHistory: "statsHistory",       // { [dayKey]: { [domain]: { timeMs, visits } } }
    onboarding: "onboardingState",      // { step: 0|1|2, completed: boolean, completedAt: number|null }
    onboardingMetrics: "onboardingMetrics", // { installed, setupStarted, setupCompleted, setupSkipped, firstBlockEvent, firstBlockedPageView, day1Return, day7Return }
    postInstallRedirectMeta: "postInstallRedirectMeta" // { reason: "install"|"update", version: string, shownAt: number }
};

const PREMIUM_KEY = "premiumState";
const WHOP_TOKEN_KEY = "whopAccessToken";
const WHOP_PENDING_TOKEN_KEY = "whopPendingToken";
const WHOP_LINK_STATE_KEY = "whopLinkState";
const WHOP_VERIFY_URL = "https://screen-time-manager.jackster0627.workers.dev/whop/verify";
const WHOP_LINK_STATE_URL = "https://screen-time-manager.jackster0627.workers.dev/whop/link-state";
const WHOP_LINK_STATE_MAX_AGE_MS = 60 * 60 * 1000;
const ALLOWED_EXTERNAL_CALLBACK_ORIGIN = "https://screen-time-manager.jackster0627.workers.dev/";
const ANALYTICS_EVENT_URL = "https://screen-time-manager.jackster0627.workers.dev/analytics/event";
const ANALYTICS_CLIENT_ID_KEY = "analyticsClientId";
const ANALYTICS_INSTALL_TS_KEY = "analyticsInstallTimestampMs";
const ANALYTICS_LAST_ACTIVE_DAY_KEY = "analyticsLastActiveDay";
const ANALYTICS_LAST_ACTIVE_WEEK_KEY = "analyticsLastActiveWeek";
const ANALYTICS_RETENTION_MILESTONES_KEY = "analyticsRetentionMilestones";
const RETENTION_MILESTONE_DAYS = Object.freeze([1, 3, 7, 14, 30]);
const PREMIUM_SYNC_ALARM = "premiumSync";
const PREMIUM_SYNC_INTERVAL_MINUTES = 60;
const FREE_PLAN_LIMITS = Object.freeze({
    maxTrackedDomains: 3,
    maxScheduledBlocks: 2
});
const ALL_SCHEDULE_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

const DEFAULT_ONBOARDING_STATE = Object.freeze({
    step: 0,
    completed: false,
    completedAt: null
});

const DEFAULT_ONBOARDING_METRICS = Object.freeze({
    installed: null,
    setupStarted: null,
    setupCompleted: null,
    setupSkipped: null,
    firstBlockEvent: null,
    firstBlockedPageView: null,
    day1Return: null,
    day7Return: null
});

let activeTabId = null;
let activeDomain = null;
let activeStartMs = null;
let dynamicRuleSync = Promise.resolve();

const ACTION_BADGE_COLOR = Object.freeze({
    background: "#8B6FFF",
    text: "#FFFFFF"
});
const ENFORCE_GAP_FLOOR_MS = 90 * 1000;
const ENFORCE_GAP_MULTIPLIER = 30;
let lastEnforceAlarmAtMs = 0;

function getDayKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function getIsoWeekKey(d = new Date()) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);

    const day = date.getDay() || 7;
    date.setDate(date.getDate() + 4 - day);

    const yearStart = new Date(date.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);

    return `${date.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
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

function calculateInactiveGapDays(previousDayKey, currentDayKey) {
    const previousDate = parseDayKey(previousDayKey);
    const currentDate = parseDayKey(currentDayKey);

    if (!previousDate || !currentDate) {
        return 0;
    }

    const dayDifference = Math.floor((currentDate.getTime() - previousDate.getTime()) / 86400000);
    return Math.max(0, dayDifference - 1);
}

function sanitizeAnalyticsText(value, fallback = "unknown", maxLength = 80) {
    const normalized = String(value || "").trim();
    if (!normalized) {
        return fallback;
    }
    return normalized.slice(0, maxLength);
}

function sanitizeAnalyticsEventName(value) {
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

    if (!normalized || !/^[a-z]/.test(normalized)) {
        return "";
    }

    return normalized.slice(0, 40);
}

function sanitizeAnalyticsParams(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
        return {};
    }

    const entries = Object.entries(params).slice(0, 25);
    const sanitized = {};

    for (const [rawKey, rawValue] of entries) {
        const key = sanitizeAnalyticsEventName(rawKey);
        if (!key) continue;

        if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
            sanitized[key] = rawValue;
        } else if (typeof rawValue === "boolean") {
            sanitized[key] = rawValue ? 1 : 0;
        } else {
            sanitized[key] = sanitizeAnalyticsText(rawValue, "", 100);
        }
    }

    return sanitized;
}

function formatBadgeDuration(sec) {
    const totalSec = Math.max(0, Math.floor(sec || 0));
    if (totalSec < 60) {
        return `${totalSec}s`;
    }

    const totalMin = Math.floor(totalSec / 60);
    if (totalMin < 60) {
        return `${totalMin}m`;
    }

    const totalHours = Math.floor(totalMin / 60);
    return `${Math.min(totalHours, 99)}h`;
}

async function setActionBadgeStyle() {
    try {
        await chrome.action.setBadgeBackgroundColor({ color: ACTION_BADGE_COLOR.background });
    } catch {
        // Ignore badge styling failures on browsers that do not support it.
    }

    if (typeof chrome.action.setBadgeTextColor === "function") {
        try {
            await chrome.action.setBadgeTextColor({ color: ACTION_BADGE_COLOR.text });
        } catch {
            // Ignore badge styling failures on browsers that do not support it.
        }
    }
}

async function syncActionBadge() {
    await setActionBadgeStyle();

    if (!activeDomain) {
        await chrome.action.setBadgeText({ text: "" }).catch(() => {});
        return;
    }

    const { [KEYS.blockedDomains]: blockedDomains = {}, [KEYS.statsToday]: statsToday = {} } =
        await chrome.storage.local.get([KEYS.blockedDomains, KEYS.statsToday]);

    const domain = activeDomain;
    const storedTimeMs = statsToday?.[domain]?.timeMs || 0;
    const liveTimeMs = activeStartMs ? Math.max(0, Date.now() - activeStartMs) : 0;
    const usedTimeMs = storedTimeMs + liveTimeMs;
    const limitMs = limitMsFor(domain, blockedDomains);

    if (limitMs != null && limitMs > 0 && isBlockedDomain(domain, blockedDomains)) {
        const usedPct = Math.min(100, Math.round((usedTimeMs / limitMs) * 100));
        await chrome.action.setBadgeText({ text: `${usedPct}%` }).catch(() => {});
        return;
    }

    await chrome.action.setBadgeText({ text: formatBadgeDuration(Math.round(usedTimeMs / 1000)) }).catch(() => {});
}

async function getOrCreateAnalyticsClientId() {
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

async function sendAnalyticsEvent(eventName, params = {}) {
    const normalizedEventName = sanitizeAnalyticsEventName(eventName);
    if (!normalizedEventName) {
        return;
    }

    const clientId = await getOrCreateAnalyticsClientId();
    const extensionVersion = sanitizeAnalyticsText(chrome.runtime.getManifest().version, "unknown", 32);

    await fetch(ANALYTICS_EVENT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            clientId,
            eventName: normalizedEventName,
            extensionVersion,
            params: sanitizeAnalyticsParams(params)
        })
    });
}

async function sendAnalyticsEventSafe(eventName, params = {}) {
    try {
        await sendAnalyticsEvent(eventName, params);
    } catch {
        // Never block extension behavior on analytics failures.
    }
}

async function ensureInstallTimestampMs() {
    const { [ANALYTICS_INSTALL_TS_KEY]: storedTimestamp = 0 } =
        await chrome.storage.local.get([ANALYTICS_INSTALL_TS_KEY]);

    if (Number.isFinite(storedTimestamp) && storedTimestamp > 0) {
        return storedTimestamp;
    }

    const now = Date.now();
    await chrome.storage.local.set({ [ANALYTICS_INSTALL_TS_KEY]: now });
    return now;
}

async function trackRetentionMetrics(trigger, installReason = "") {
    const installTimestampMs = await ensureInstallTimestampMs();
    const now = Date.now();
    const daysSinceInstall = Math.max(0, Math.floor((now - installTimestampMs) / (24 * 60 * 60 * 1000)));
    const nowDate = new Date(now);
    const todayKey = getDayKey(nowDate);
    const currentWeekKey = getIsoWeekKey(nowDate);

    await sendAnalyticsEventSafe("extension_session_start", {
        trigger,
        install_reason: installReason || "none",
        days_since_install: daysSinceInstall
    });

    if (trigger === "installed") {
        await sendAnalyticsEventSafe("extension_installed", {
            install_reason: installReason || "unknown"
        });
    }

    const {
        [ANALYTICS_LAST_ACTIVE_DAY_KEY]: lastActiveDay = "",
        [ANALYTICS_LAST_ACTIVE_WEEK_KEY]: lastActiveWeek = "",
        [ANALYTICS_RETENTION_MILESTONES_KEY]: milestoneState = {}
    } = await chrome.storage.local.get([
        ANALYTICS_LAST_ACTIVE_DAY_KEY,
        ANALYTICS_LAST_ACTIVE_WEEK_KEY,
        ANALYTICS_RETENTION_MILESTONES_KEY
    ]);

    const isFirstActivityToday = lastActiveDay !== todayKey;
    const isFirstActivityThisWeek = lastActiveWeek !== currentWeekKey;
    const nextStorageState = {};

    if (isFirstActivityToday) {
        await sendAnalyticsEventSafe("retention_day_active", {
            trigger,
            days_since_install: daysSinceInstall
        });

        await sendAnalyticsEventSafe("retention_activity_day_marked", {
            trigger,
            days_since_install: daysSinceInstall,
            activity_day_key: todayKey,
            activity_week_key: currentWeekKey,
            previous_activity_day_key: lastActiveDay || "none",
            is_first_activity_today: true,
            is_first_activity_this_week: isFirstActivityThisWeek
        });

        const inactiveGapDays = calculateInactiveGapDays(lastActiveDay, todayKey);
        if (inactiveGapDays >= 2) {
            await sendAnalyticsEventSafe("retention_inactive_gap_resolved", {
                trigger,
                days_since_install: daysSinceInstall,
                activity_day_key: todayKey,
                activity_week_key: currentWeekKey,
                previous_activity_day_key: lastActiveDay || "none",
                inactive_gap_days: inactiveGapDays
            });
        }

        nextStorageState[ANALYTICS_LAST_ACTIVE_DAY_KEY] = todayKey;
    }

    if (isFirstActivityThisWeek) {
        await sendAnalyticsEventSafe("retention_weekly_active_marked", {
            trigger,
            days_since_install: daysSinceInstall,
            activity_day_key: todayKey,
            activity_week_key: currentWeekKey,
            is_first_activity_this_week: true
        });

        nextStorageState[ANALYTICS_LAST_ACTIVE_WEEK_KEY] = currentWeekKey;
    }

    if (RETENTION_MILESTONE_DAYS.includes(daysSinceInstall) && !milestoneState[String(daysSinceInstall)]) {
        await sendAnalyticsEventSafe("retention_milestone_reached", {
            trigger,
            days_since_install: daysSinceInstall,
            milestone_day: daysSinceInstall,
            activity_day_key: todayKey,
            activity_week_key: currentWeekKey
        });

        nextStorageState[ANALYTICS_RETENTION_MILESTONES_KEY] = {
            ...milestoneState,
            [String(daysSinceInstall)]: now
        };
    }

    if (Object.keys(nextStorageState).length > 0) {
        await chrome.storage.local.set(nextStorageState);
    }
}

function normalizeScheduleDays(days) {
    const source = Array.isArray(days) ? days : ALL_SCHEDULE_DAYS;
    const normalized = [...new Set(source
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
        .sort((a, b) => a - b);

    return normalized.length > 0 ? normalized : [...ALL_SCHEDULE_DAYS];
}

function normalizeScheduledBlock(block) {
    return {
        ...block,
        enabled: block?.enabled !== false,
        daysOfWeek: normalizeScheduleDays(block?.daysOfWeek)
    };
}

function domainFromUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        return u.hostname.replace(/^www\./, "");
    } catch {
        return null;
    }
}

async function ensureDayReset() {
    const { [KEYS.dayKey]: storedDay } = await chrome.storage.local.get([KEYS.dayKey]);
    const today = getDayKey();
    if (storedDay !== today) {
        if (storedDay) {
            const {
                [KEYS.allStatsToday]: allStats = {},
                [KEYS.statsHistory]: history = {},
                [KEYS.hourlyUsageHistory]: hourlyUsageHistory = {}
            } = await chrome.storage.local.get([KEYS.allStatsToday, KEYS.statsHistory, KEYS.hourlyUsageHistory]);
            if (Object.keys(allStats).length > 0) {
                history[storedDay] = allStats;
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - 31);
                const cutoff = getDayKey(cutoffDate);
                for (const key of Object.keys(history)) {
                    if (key < cutoff) delete history[key];
                }
                for (const key of Object.keys(hourlyUsageHistory)) {
                    if (key < cutoff) delete hourlyUsageHistory[key];
                }
                await chrome.storage.local.set({
                    [KEYS.statsHistory]: history,
                    [KEYS.statsToday]: {},
                    [KEYS.allStatsToday]: {},
                    [KEYS.hourlyUsageHistory]: hourlyUsageHistory,
                    [KEYS.dayKey]: today
                });
                return;
            }
        }
        await chrome.storage.local.set({ [KEYS.statsToday]: {}, [KEYS.allStatsToday]: {}, [KEYS.dayKey]: today });
    }
}

function getOrCreateHourlyBucket(hourlyUsageHistory, dayKey, hourKey) {
    if (!hourlyUsageHistory[dayKey]) {
        hourlyUsageHistory[dayKey] = {};
    }

    if (!hourlyUsageHistory[dayKey][hourKey]) {
        hourlyUsageHistory[dayKey][hourKey] = { timeMs: 0, visits: 0, domains: {} };
    }

    return hourlyUsageHistory[dayKey][hourKey];
}

function recordHourlyUsage(hourlyUsageHistory, startMs, endMs, countVisit = false, domain = null) {
    if (!hourlyUsageHistory || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return hourlyUsageHistory;
    }

    let cursorMs = startMs;
    while (cursorMs < endMs) {
        const cursor = new Date(cursorMs);
        const nextHour = new Date(cursor);
        nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
        const segmentEndMs = Math.min(endMs, nextHour.getTime());
        const durationMs = Math.max(0, segmentEndMs - cursorMs);

        if (durationMs > 0) {
            const dayKey = getDayKey(cursor);
            const hourKey = String(cursor.getHours()).padStart(2, "0");
            const bucket = getOrCreateHourlyBucket(hourlyUsageHistory, dayKey, hourKey);
            bucket.timeMs += durationMs;
            if (countVisit) {
                bucket.visits += 1;
            }
            // Track per-domain hourly usage if domain provided
            if (domain) {
                if (!bucket.domains) bucket.domains = {};
                if (!bucket.domains[domain]) bucket.domains[domain] = 0;
                bucket.domains[domain] += durationMs;
            }
        }

        cursorMs = segmentEndMs;
    }

    return hourlyUsageHistory;
}

async function updateDomainActivity(domain, { deltaMs = 0, countVisit = false, startMs = null, endMs = null } = {}) {
    if (!domain) return;
    if (deltaMs <= 0 && !countVisit) return;
    await ensureDayReset();

    const storageKeys = [KEYS.blockedDomains, KEYS.statsToday, KEYS.allStatsToday];
    if (deltaMs > 0) {
        storageKeys.push(KEYS.hourlyUsageHistory);
    }

    const {
        blockedDomains = {},
        [KEYS.statsToday]: stats = {},
        [KEYS.allStatsToday]: allStats = {},
        [KEYS.hourlyUsageHistory]: hourlyUsageHistory = {}
    } = await chrome.storage.local.get(storageKeys);

    const cur = stats[domain] || { timeMs: 0, visits: 0 };
    const allCur = allStats[domain] || { timeMs: 0, visits: 0 };

    if (deltaMs > 0) {
        cur.timeMs = (cur.timeMs || 0) + deltaMs;
        allCur.timeMs = (allCur.timeMs || 0) + deltaMs;
    }
    if (countVisit) {
        cur.visits = (cur.visits || 0) + 1;
        allCur.visits = (allCur.visits || 0) + 1;
    }

    if (deltaMs > 0) {
        const usageStartMs = Number.isFinite(startMs) ? startMs : Date.now() - deltaMs;
        const usageEndMs = Number.isFinite(endMs) ? endMs : usageStartMs + deltaMs;
        recordHourlyUsage(hourlyUsageHistory, usageStartMs, usageEndMs, false, domain);
    }

    stats[domain] = cur;
    allStats[domain] = allCur;
    const nextStorage = {
        [KEYS.statsToday]: stats,
        [KEYS.allStatsToday]: allStats
    };

    if (deltaMs > 0) {
        nextStorage[KEYS.hourlyUsageHistory] = hourlyUsageHistory;
    }

    await chrome.storage.local.set(nextStorage);

    if (deltaMs > 0) {
        // Check for alerts after updating time
        await checkAndSendAlerts(domain, blockedDomains, stats);

        // ENFORCE LIMIT (only if domain is currently blocked)
        if (isBlockedDomain(domain, blockedDomains)) {
            const limitMs = limitMsFor(domain, blockedDomains);
            if (limitMs != null && cur.timeMs >= limitMs && activeTabId != null) {
                const t = await chrome.tabs.get(activeTabId).catch(() => null);
                const tabDomain = t?.url ? domainFromUrl(t.url) : null;

                // only redirect if the active tracked tab is STILL on this domain
                if (t?.id != null && tabDomain === domain) {
                    await sendAnalyticsEventSafe("limit_block_enforced", {
                        domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
                        used_ms: cur.timeMs,
                        limit_ms: limitMs,
                        block_source: "limit"
                    });
                    await chrome.tabs.update(t.id, { url: blockedUrl(domain) }).catch(() => {});
                }
            }
        }
    }
}

function isBlockedDomain(domain, blockedDomains) {
    const config = blockedDomains?.[domain];
    return Boolean(config) && config.enabled !== false;
}

function limitMsFor(domain, blockedDomains) {
    const config = blockedDomains?.[domain];
    if (!config || config.enabled === false) return null;
    const sec = config.limitSeconds;
    if (!Number.isFinite(sec) || sec <= 0) return null;
    return sec * 1000;
}

function createBlockedEventId() {
    if (typeof crypto?.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function blockedUrl(domain, source = "limit") {
    const params = new URLSearchParams({
        d: domain,
        source,
        eid: createBlockedEventId()
    });
    return chrome.runtime.getURL(`blocked.html?${params.toString()}`);
}

async function redirectOpenTabsForDomains(domains) {
    const domainSet = new Set(domains.filter(Boolean));
    if (domainSet.size === 0) return;

    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(async (tab) => {
        if (!tab.id || !tab.url) return;
        if (tab.url.startsWith(chrome.runtime.getURL("blocked.html"))) return;

        const domain = domainFromUrl(tab.url);
        if (!domainSet.has(domain)) return;

        await chrome.tabs.update(tab.id, { url: blockedUrl(domain, "scheduled") }).catch(() => {});
    }));
}

function parseHourMinute(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return { h, m };
}

function getTodayTime(timeStr, baseDate = new Date()) {
    const { h: hours, m: minutes } = parseHourMinute(timeStr);
    const target = new Date(baseDate);
    target.setHours(hours, minutes, 0, 0);
    return target.getTime();
}

function getScheduleWindowForAnchorDate(block, anchorDate) {
    const normalizedBlock = normalizeScheduledBlock(block);
    const normalizedAnchor = new Date(anchorDate);
    normalizedAnchor.setHours(0, 0, 0, 0);

    if (!normalizedBlock.daysOfWeek.includes(normalizedAnchor.getDay())) {
        return null;
    }

    const start = getTodayTime(normalizedBlock.startTime, normalizedAnchor);
    let end = getTodayTime(normalizedBlock.endTime, normalizedAnchor);
    if (end <= start) {
        end += 24 * 60 * 60 * 1000;
    }

    return { start, end };
}

function getScheduleActiveWindow(block, now = Date.now()) {
    const reference = new Date(now);
    const todayWindow = getScheduleWindowForAnchorDate(block, reference);
    if (todayWindow && now >= todayWindow.start && now < todayWindow.end) {
        return todayWindow;
    }

    const previousDay = new Date(reference);
    previousDay.setDate(previousDay.getDate() - 1);
    const previousWindow = getScheduleWindowForAnchorDate(block, previousDay);
    if (previousWindow && now >= previousWindow.start && now < previousWindow.end) {
        return previousWindow;
    }

    return null;
}

function getNextScheduledStartTime(block, now = Date.now()) {
    const normalizedBlock = normalizeScheduledBlock(block);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    for (let offset = 0; offset <= 7; offset += 1) {
        const candidateDay = new Date(startOfToday);
        candidateDay.setDate(candidateDay.getDate() + offset);
        if (!normalizedBlock.daysOfWeek.includes(candidateDay.getDay())) {
            continue;
        }

        const candidateStart = getTodayTime(normalizedBlock.startTime, candidateDay);
        if (candidateStart > now) {
            return candidateStart;
        }
    }

    return null;
}

function getNextScheduledEndTime(block, now = Date.now()) {
    const activeWindow = getScheduleActiveWindow(block, now);
    if (activeWindow) {
        return activeWindow.end;
    }

    const nextStart = getNextScheduledStartTime(block, now);
    if (nextStart == null) {
        return null;
    }

    return getScheduleWindowForAnchorDate(block, new Date(nextStart))?.end ?? null;
}

function isScheduleActiveNow(block, now = Date.now()) {
    return Boolean(getScheduleActiveWindow(block, now));
}

function stableRuleIdForDomain(domain) {
    let hash = 0;
    for (let index = 0; index < domain.length; index += 1) {
        hash = ((hash * 31) + domain.charCodeAt(index)) % 1000000;
    }
    return hash + 1;
}

async function checkAndSendAlerts(domain, blockedDomains, statsToday) {
    if (!isBlockedDomain(domain, blockedDomains)) return;

    const limitMs = limitMsFor(domain, blockedDomains);
    const usedMs = statsToday?.[domain]?.timeMs || 0;

    if (limitMs == null || usedMs < limitMs * 0.75) return; // Only alert if at 75%+

    const { [KEYS.alertsSent]: alertsSent = {} } = await chrome.storage.local.get([KEYS.alertsSent]);
    let sent = alertsSent[domain] || {};

    const pct75 = usedMs >= limitMs * 0.75;
    const pct90 = usedMs >= limitMs * 0.9;

    const remainingMs = Math.max(0, limitMs - usedMs);
    const remainingSec = Math.round(remainingMs / 1000);

    if (pct90 && !sent["90"]) {
        chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("icon.png"),
            title: `90% of limit used: ${domain}`,
            message: `You have ~${formatTimeSec(remainingSec)} left today.`,
            priority: 2
        });
        await sendAnalyticsEventSafe("threshold_reached", {
            domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
            threshold_percent: 90,
            used_ms: usedMs,
            limit_ms: limitMs
        });
        sent["90"] = true;
    } else if (pct75 && !sent["75"]) {
        chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("icon.png"),
            title: `75% of limit used: ${domain}`,
            message: `You have ~${formatTimeSec(remainingSec)} left today.`,
            priority: 1
        });
        await sendAnalyticsEventSafe("threshold_reached", {
            domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
            threshold_percent: 75,
            used_ms: usedMs,
            limit_ms: limitMs
        });
        sent["75"] = true;
    }

    alertsSent[domain] = sent;
    await chrome.storage.local.set({ [KEYS.alertsSent]: alertsSent });
}

async function enforceIfNeeded(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url) return;
    if (tab.url.startsWith(chrome.runtime.getURL("blocked.html"))) return;

    const domain = domainFromUrl(tab.url);
    if (!domain) return;

    const { [KEYS.blockedDomains]: blockedDomains = {}, [KEYS.statsToday]: statsToday = {} } =
        await chrome.storage.local.get([KEYS.blockedDomains, KEYS.statsToday]);

    const limitMs = limitMsFor(domain, blockedDomains);
    if (limitMs == null) return;

    const usedMs = statsToday?.[domain]?.timeMs || 0;
    if (usedMs >= limitMs) {
        await sendAnalyticsEventSafe("limit_block_enforced", {
            domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
            used_ms: usedMs,
            limit_ms: limitMs,
            block_source: "limit"
        });
        await chrome.tabs.update(tabId, { url: blockedUrl(domain) }).catch(() => {});
    }
}

function formatTimeSec(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function normalizePremium(raw) {
    return {
        active: Boolean(raw?.active),
        planName: typeof raw?.planName === "string" && raw.planName.trim() ? raw.planName.trim() : (raw?.active ? "Premium" : "Free"),
        source: typeof raw?.source === "string" && raw.source.trim() ? raw.source : (raw?.active ? "whop" : "free"),
        checkedAt: typeof raw?.checkedAt === "string" ? raw.checkedAt : null,
        expiresAt: typeof raw?.expiresAt === "string" ? raw.expiresAt : null
    };
}

async function verifyAndPersistWhopToken(token, source = "whop-callback") {
    const trimmedToken = String(token || "").trim();
    if (!trimmedToken) {
        throw new Error("Missing token");
    }
    if (/\{[^}]+\}/.test(trimmedToken)) {
        throw new Error("Whop callback returned a placeholder token (e.g. {user_id}) instead of a real ID");
    }

    // Persist immediately so manual/background refresh can recover from transient verify failures.
    await chrome.storage.local.set({ [WHOP_PENDING_TOKEN_KEY]: trimmedToken });

    const response = await fetch(WHOP_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmedToken, extension: "screen-time-manager" })
    });

    if (!response.ok) {
        throw new Error(`Verification failed (${response.status})`);
    }

    const payload = await response.json();
    const nextPremium = normalizePremium({
        active: Boolean(payload?.active),
        planName: payload?.planName || (payload?.active ? "Premium" : "Free"),
        source,
        checkedAt: new Date().toISOString(),
        expiresAt: payload?.expiresAt || null
    });

    const payloadToStore = {
        [PREMIUM_KEY]: nextPremium,
        [WHOP_TOKEN_KEY]: trimmedToken
    };

    // Keep pending token until premium is confirmed active.
    payloadToStore[WHOP_PENDING_TOKEN_KEY] = nextPremium.active ? "" : trimmedToken;

    await chrome.storage.local.set(payloadToStore);

    await sendAnalyticsEventSafe("premium_checkout_complete_result", {
        source,
        status: nextPremium.active ? "active" : "pending",
        plan_name: nextPremium.planName
    });

    return nextPremium;
}

async function refreshStoredPremiumStatus(source = "background-sync") {
    const {
        [WHOP_TOKEN_KEY]: storedToken = "",
        [WHOP_PENDING_TOKEN_KEY]: pendingToken = "",
        [WHOP_LINK_STATE_KEY]: linkState = null,
        [PREMIUM_KEY]: premiumStored = {}
    } = await chrome.storage.local.get([WHOP_TOKEN_KEY, WHOP_PENDING_TOKEN_KEY, WHOP_LINK_STATE_KEY, PREMIUM_KEY]);

    const linkStateId = String(linkState?.id || "").trim();
    const linkStateCreatedAtMs = Date.parse(String(linkState?.createdAt || ""));
    const hasFreshLinkState =
        /^[A-Za-z0-9_-]{16,128}$/.test(linkStateId) &&
        Number.isFinite(linkStateCreatedAtMs) &&
        (Date.now() - linkStateCreatedAtMs) <= WHOP_LINK_STATE_MAX_AGE_MS;

    if (linkState && !hasFreshLinkState) {
        await chrome.storage.local.set({ [WHOP_LINK_STATE_KEY]: null });
    }

    let trimmedToken = String(storedToken || "").trim() || String(pendingToken || "").trim();
    if (!trimmedToken) {
        if (hasFreshLinkState) {
            const resolveUrl = new URL(WHOP_LINK_STATE_URL);
            resolveUrl.searchParams.set("client_state", linkStateId);

            const linkResponse = await fetch(resolveUrl.toString(), { method: "GET" });
            if (linkResponse.ok) {
                const linkPayload = await linkResponse.json();
                const resolvedToken = String(linkPayload?.token || "").trim();
                if (resolvedToken) {
                    trimmedToken = resolvedToken;
                    await chrome.storage.local.set({
                        [WHOP_PENDING_TOKEN_KEY]: resolvedToken,
                        [WHOP_LINK_STATE_KEY]: {
                            ...(linkState || {}),
                            resolvedAt: new Date().toISOString()
                        }
                    });
                }
            }
        }
    }

    if (!trimmedToken) {
        return {
            success: false,
            error: "No linked billing identity found.",
            hasLinkedIdentity: false,
            pendingActivation: hasFreshLinkState
        };
    }

    if (/\{[^}]+\}/.test(trimmedToken)) {
        return { success: false, error: "Stored billing identity is invalid.", hasLinkedIdentity: false };
    }

    const response = await fetch(WHOP_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmedToken, extension: "screen-time-manager" })
    });

    if (!response.ok) {
        throw new Error(`Verification failed (${response.status})`);
    }

    const payload = await response.json();
    const nextPremium = normalizePremium({
        active: Boolean(payload?.active),
        planName: payload?.planName || (payload?.active ? "Premium" : "Free"),
        source,
        checkedAt: new Date().toISOString(),
        expiresAt: payload?.expiresAt || null
    });

    const nextStorage = {
        [PREMIUM_KEY]: nextPremium,
        [WHOP_TOKEN_KEY]: trimmedToken,
        [WHOP_PENDING_TOKEN_KEY]: nextPremium.active ? "" : trimmedToken,
        [WHOP_LINK_STATE_KEY]: nextPremium.active ? null : linkState
    };

    await chrome.storage.local.set(nextStorage);

    const becameInactive = Boolean(premiumStored?.active) && !nextPremium.active;
    return {
        success: true,
        premiumState: nextPremium,
        becameInactive,
        hasLinkedIdentity: true,
        pendingActivation: !nextPremium.active
    };
}

async function flushAllStats() {
    const { [KEYS.allStatsToday]: allStats = {}, [KEYS.blockedDomains]: blockedDomains = {} } = 
        await chrome.storage.local.get([KEYS.allStatsToday, KEYS.blockedDomains]);

    const TOP_N = 3;

    // Build a normalized list once, then retain only ranking-relevant entries.
    const allDomains = Object.entries(allStats).map(([domain, stats]) => ({
        domain,
        timeMs: stats.timeMs || 0,
        visits: stats.visits || 0
    }));

    const topByTime = [...allDomains]
        .sort((a, b) => b.timeMs - a.timeMs)
        .slice(0, TOP_N);

    const topByVisits = [...allDomains]
        .sort((a, b) => b.visits - a.visits)
        .slice(0, TOP_N);

    // Always include blocked domains
    const blockedDomainList = Object.keys(blockedDomains);
    const blockedEntries = allDomains.filter((d) => blockedDomainList.includes(d.domain));

    // Keep union of top-by-time, top-by-visits, and blocked domains.
    const combined = [...topByTime, ...topByVisits, ...blockedEntries].reduce((acc, item) => {
        if (!acc[item.domain]) {
            acc[item.domain] = { timeMs: item.timeMs, visits: item.visits };
        }
        return acc;
    }, {});

    // Update with the combined list
    await chrome.storage.local.set({ [KEYS.allStatsToday]: combined });
}

async function flushTime({ ignoreCurrentGap = false } = {}) {
    if (!activeDomain || !activeStartMs) return;
    const nowMs = Date.now();
    const deltaMs = nowMs - activeStartMs;
    activeStartMs = nowMs; // reset start for continued tracking

    // When a sleep/resume gap is detected by alarm drift, we reset baseline without counting stale time.
    if (!ignoreCurrentGap && deltaMs > 0) {
        await updateDomainActivity(activeDomain, { deltaMs, startMs: nowMs - deltaMs, endMs: nowMs });
    }
    
    // immediately check if we should enforce on the active tab
    if (activeTabId != null) {
        await enforceIfNeeded(activeTabId);
    }

    await syncActionBadge();
}

async function setActiveDomain(tabId, countVisit = false) {
    await flushTime();

    activeTabId = tabId;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const d = tab?.url ? domainFromUrl(tab.url) : null;

    if (countVisit && d && d !== activeDomain) await updateDomainActivity(d, { countVisit: true });

    activeDomain = d;
    activeStartMs = d ? Date.now() : null;

    await syncActionBadge();
}

async function initActive() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id != null) await setActiveDomain(tab.id);
    else await syncActionBadge();
}

async function ensureActiveTrackingState() {
    if (activeTabId != null && activeDomain && activeStartMs) return;
    await initActive();
}

async function createEnforceAlarm() {
    const { [KEYS.enforceIntervalSec]: stored = 2 } = await chrome.storage.local.get([KEYS.enforceIntervalSec]);
    let sec = Number(stored);
    if (!Number.isFinite(sec) || sec <= 0) sec = 2;
    const whenMs = Date.now() + sec * 1000;
    // create a one-shot alarm; onAlarm will reschedule the next one
    chrome.alarms.create("enforce", { when: whenMs });
}

async function createFlushAlarm() {
    const whenMs = Date.now() + 60 * 1000; // every minute
    chrome.alarms.create("flush", { when: whenMs });
}

async function createPremiumSyncAlarm() {
    chrome.alarms.create(PREMIUM_SYNC_ALARM, {
        delayInMinutes: PREMIUM_SYNC_INTERVAL_MINUTES,
        periodInMinutes: PREMIUM_SYNC_INTERVAL_MINUTES
    });
}

// When user switches tabs
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await setActiveDomain(tabId, true)
    await enforceIfNeeded(tabId); // Check new tab for enforcement
});

// When the active tab’s URL changes (navigation)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!changeInfo.url) return;

    // If we navigated to blocked.html, stop tracking immediately
    if (changeInfo.url.startsWith(chrome.runtime.getURL("blocked.html"))) {
        activeDomain = null;
        activeStartMs = null;
        await syncActionBadge();
        return;
    }

    // Check for enforcement on this tab
    await enforceIfNeeded(tabId);

    // existing behavior: if this is the active tab, update active domain tracking
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab?.id === tabId) {
        await setActiveDomain(tabId, true);
    }
});

// When window focus changes (pause timing if Chrome not focused)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        await flushTime();
        activeTabId = null;
        activeDomain = null;
        activeStartMs = null;
        await syncActionBadge();
        return;
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id != null) await setActiveDomain(tab.id, false);
    else await syncActionBadge();
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTabId) {
        activeTabId = null;
        activeDomain = null;
        activeStartMs = null;
        syncActionBadge().catch(() => {});
    }
});

function buildRulesFromActiveBlocks(activeBlocks) {
    const uniqueDomains = [...new Set(activeBlocks.map((block) => block.domain).filter(Boolean))];
    return uniqueDomains.map((domain) => ({
        id: stableRuleIdForDomain(domain),
        priority: 1,
        action: {
            type: "redirect",
            redirect: {
                extensionPath: `/blocked.html?d=${encodeURIComponent(domain)}&source=scheduled`
            }
        },
        condition: {
            urlFilter: `||${domain}^`,
            resourceTypes: ["main_frame"]
        }
    }));
}

async function syncBlockRulesNow() {
    const { activeBlocks = [], [KEYS.snoozedDomains]: snoozedDomains = {} } =
        await chrome.storage.local.get([KEYS.activeBlocks, KEYS.snoozedDomains]);
    const now = Date.now();
    const unsnoozedBlocks = activeBlocks.filter((b) => {
        const expiry = snoozedDomains[b.domain];
        return !expiry || expiry <= now;
    });
    const rules = buildRulesFromActiveBlocks(unsnoozedBlocks);
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map((rule) => rule.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [],
        removeRuleIds: existingRuleIds
    });

    if (rules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: rules,
            removeRuleIds: []
        });
    }
}

function updateBlockRules() {
    dynamicRuleSync = dynamicRuleSync
        .catch(() => {})
        .then(() => syncBlockRulesNow());
    return dynamicRuleSync;
}

// Schedule alarms for scheduled blocks
async function scheduleAlarms() {
    const { [KEYS.scheduledBlocks]: scheduled = [] } = await chrome.storage.local.get([KEYS.scheduledBlocks]);
    scheduled.map(normalizeScheduledBlock).forEach((block) => {
        if (!block.enabled) return;
        const startMs = getNextScheduledStartTime(block);
        const endMs = getNextScheduledEndTime(block);
        if (startMs != null) {
            chrome.alarms.create(`startBlock_${block.id}`, { when: startMs });
        }
        if (endMs != null) {
            chrome.alarms.create(`endBlock_${block.id}`, { when: endMs });
        }
    });
}

async function clearScheduledBlockAlarms(id) {
    await Promise.all([
        chrome.alarms.clear(`startBlock_${id}`),
        chrome.alarms.clear(`endBlock_${id}`)
    ]);
}

async function refreshScheduledBlockRuntime(id) {
    await clearScheduledBlockAlarms(id);

    const { [KEYS.scheduledBlocks]: scheduled = [] } = await chrome.storage.local.get([KEYS.scheduledBlocks]);
    const block = scheduled.map(normalizeScheduledBlock).find((entry) => entry.id === id);

    if (!block) {
        await deactivateScheduledBlock(id, "reconcile_or_refresh");
        return false;
    }

    if (!block.enabled) {
        await deactivateScheduledBlock(id, "disabled");
        return true;
    }

    if (isScheduleActiveNow(block)) {
        await activateScheduledBlock(id, "reconcile_or_refresh");
    } else {
        await deactivateScheduledBlock(id, "reconcile_or_refresh");
    }

    return true;
}

async function activateScheduledBlock(id, activationSource = "runtime") {
    const { [KEYS.scheduledBlocks]: scheduled = [], [KEYS.activeBlocks]: activeBlocks = [] } =
        await chrome.storage.local.get([KEYS.scheduledBlocks, KEYS.activeBlocks]);
    const block = scheduled.map(normalizeScheduledBlock).find((entry) => entry.id === id);
    if (!block) return;
    if (!block.enabled) return;

    const activeWindow = getScheduleActiveWindow(block, Date.now());
    if (!activeWindow) {
        const nextStart = getNextScheduledStartTime(block, Date.now() + 1000);
        const nextEnd = getNextScheduledEndTime(block, Date.now() + 1000);
        if (nextStart != null) {
            chrome.alarms.create(`startBlock_${id}`, { when: nextStart });
        }
        if (nextEnd != null) {
            chrome.alarms.create(`endBlock_${id}`, { when: nextEnd });
        }
        return;
    }

    const nextActiveBlocks = activeBlocks.filter((entry) => entry.id !== id);
    nextActiveBlocks.push({
        id,
        domain: block.domain,
        startTime: activeWindow.start,
        endTime: activeWindow.end
    });

    await chrome.storage.local.set({ [KEYS.activeBlocks]: nextActiveBlocks });
    await updateBlockRules();
    await redirectOpenTabsForDomains([block.domain]);
    await sendAnalyticsEventSafe("schedule_block_activated", {
        schedule_id: id,
        domain_host: sanitizeAnalyticsText(block.domain, "unknown", 100),
        activation_source: activationSource
    });

    const nextStart = getNextScheduledStartTime(block, Date.now() + 1000);
    const nextEnd = getNextScheduledEndTime(block, Date.now());
    if (nextStart != null) {
        chrome.alarms.create(`startBlock_${id}`, { when: nextStart });
    }
    if (nextEnd != null) {
        chrome.alarms.create(`endBlock_${id}`, { when: nextEnd });
    }
}

async function deactivateScheduledBlock(id, deactivationSource = "runtime") {
    const { [KEYS.scheduledBlocks]: scheduled = [], [KEYS.activeBlocks]: activeBlocks = [] } =
        await chrome.storage.local.get([KEYS.scheduledBlocks, KEYS.activeBlocks]);
    const block = scheduled.map(normalizeScheduledBlock).find((entry) => entry.id === id);
    const nextActiveBlocks = activeBlocks.filter((entry) => entry.id !== id);

    await chrome.storage.local.set({ [KEYS.activeBlocks]: nextActiveBlocks });
    await updateBlockRules();

    if (activeBlocks.length !== nextActiveBlocks.length) {
        await sendAnalyticsEventSafe("schedule_block_deactivated", {
            schedule_id: id,
            domain_host: sanitizeAnalyticsText(block?.domain || "unknown", "unknown", 100),
            deactivation_source: deactivationSource
        });
    }

    if (block?.enabled) {
        const nextStart = getNextScheduledStartTime(block, Date.now() + 1000);
        const nextEnd = getNextScheduledEndTime(block, Date.now() + 1000);
        if (nextStart != null) {
            chrome.alarms.create(`startBlock_${id}`, { when: nextStart });
        }
        if (nextEnd != null) {
            chrome.alarms.create(`endBlock_${id}`, { when: nextEnd });
        }
    }
}

async function reconcileActiveScheduledBlocks() {
    const { [KEYS.scheduledBlocks]: scheduled = [] } = await chrome.storage.local.get([KEYS.scheduledBlocks]);
    const nextActiveBlocks = scheduled
        .map(normalizeScheduledBlock)
        .filter((block) => block.enabled)
        .map((block) => ({ block, activeWindow: getScheduleActiveWindow(block) }))
        .filter(({ activeWindow }) => Boolean(activeWindow))
        .map(({ block, activeWindow }) => ({
            id: block.id,
            domain: block.domain,
            startTime: activeWindow.start,
            endTime: activeWindow.end
        }));

    await chrome.storage.local.set({ [KEYS.activeBlocks]: nextActiveBlocks });
    await updateBlockRules();
    await redirectOpenTabsForDomains(nextActiveBlocks.map((block) => block.domain));
}

async function initializeOnboarding() {
    // Initialize onboarding state on first install only
    const { [KEYS.onboarding]: existingOnboarding } = await chrome.storage.local.get([KEYS.onboarding]);
    if (!existingOnboarding) {
        const now = Date.now();
        await chrome.storage.local.set({
            [KEYS.onboarding]: { ...DEFAULT_ONBOARDING_STATE, step: 0 },
            [KEYS.onboardingMetrics]: { ...DEFAULT_ONBOARDING_METRICS, installed: now }
        });
    }
}

async function logOnboardingMetric(metricKey, value) {
    const { [KEYS.onboardingMetrics]: metrics = {} } = await chrome.storage.local.get([KEYS.onboardingMetrics]);
    const updated = { ...DEFAULT_ONBOARDING_METRICS, ...metrics, [metricKey]: value };
    await chrome.storage.local.set({ [KEYS.onboardingMetrics]: updated });
}

async function initializeExtension() {
    await initActive();
    await createEnforceAlarm();
    await createFlushAlarm();
    await createPremiumSyncAlarm();
    await scheduleAlarms();
    await reconcileActiveScheduledBlocks();
    await refreshStoredPremiumStatus("startup-sync").catch(() => null);
    await initializeOnboarding().catch(() => null);
    await syncActionBadge();
}

async function maybeOpenPostInstallRedirect(details) {
    const installReason = String(details?.reason || "");
    if (installReason !== "install" && installReason !== "update") {
        return;
    }

    const version = String(chrome.runtime.getManifest()?.version || "unknown");
    const shownAt = Date.now();
    await chrome.storage.local.set({
        [KEYS.postInstallRedirectMeta]: {
            reason: installReason,
            version,
            shownAt
        }
    });

    const welcomeUrl = new URL(chrome.runtime.getURL("welcome.html"));
    welcomeUrl.searchParams.set("reason", installReason);
    welcomeUrl.searchParams.set("version", version);

    try {
        await chrome.tabs.create({ url: welcomeUrl.toString(), active: true });
        await sendAnalyticsEventSafe("post_install_redirect_shown", {
            install_reason: installReason,
            extension_version: sanitizeAnalyticsText(version, "unknown", 40)
        });
    } catch (error) {
        await sendAnalyticsEventSafe("post_install_redirect_failed", {
            install_reason: installReason,
            extension_version: sanitizeAnalyticsText(version, "unknown", 40),
            error_name: sanitizeAnalyticsText(error?.name, "unknown_error", 40)
        });
    }
}

async function maybeForceOpenExtensionOnInstall(details) {
    const installReason = String(details?.reason || "");
    if (installReason !== "install") {
        return;
    }

    try {
        if (typeof chrome.action?.openPopup === "function") {
            await chrome.action.openPopup();
            await sendAnalyticsEventSafe("post_install_extension_opened", {
                method: "action_popup"
            });
            return;
        }

        throw new Error("open_popup_unavailable");
    } catch (error) {
        try {
            await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html"), active: true });
            await sendAnalyticsEventSafe("post_install_extension_opened", {
                method: "popup_tab_fallback",
                error_name: sanitizeAnalyticsText(error?.name, "unknown_error", 40)
            });
        } catch (fallbackError) {
            await sendAnalyticsEventSafe("post_install_extension_open_failed", {
                method: "popup_tab_fallback",
                error_name: sanitizeAnalyticsText(fallbackError?.name, "unknown_error", 40)
            });
        }
    }
}

chrome.runtime.onStartup?.addListener(() => {
    (async () => {
        await initializeExtension();
        await trackRetentionMetrics("startup");
    })().catch(console.error);
});

chrome.runtime.onInstalled.addListener((details) => {
    (async () => {
        await initializeExtension();
        await maybeOpenPostInstallRedirect(details);
        await maybeForceOpenExtensionOnInstall(details);
        await trackRetentionMetrics("installed", details?.reason || "unknown");
    })().catch(console.error);
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "enforce") {
        const nowMs = Date.now();
        const { [KEYS.enforceIntervalSec]: storedIntervalSec = 2 } =
            await chrome.storage.local.get([KEYS.enforceIntervalSec]);
        let intervalSec = Number(storedIntervalSec);
        if (!Number.isFinite(intervalSec) || intervalSec <= 0) intervalSec = 2;

        const expectedIntervalMs = intervalSec * 1000;
        const driftThresholdMs = Math.max(
            ENFORCE_GAP_FLOOR_MS,
            expectedIntervalMs * ENFORCE_GAP_MULTIPLIER
        );
        const hasPreviousTick = lastEnforceAlarmAtMs > 0;
        const elapsedSinceLastTick = hasPreviousTick ? nowMs - lastEnforceAlarmAtMs : 0;
        const likelySleepGap = hasPreviousTick && elapsedSinceLastTick > driftThresholdMs;
        lastEnforceAlarmAtMs = nowMs;

        await ensureActiveTrackingState();
        await flushTime({ ignoreCurrentGap: likelySleepGap });
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (activeTab?.id != null) await enforceIfNeeded(activeTab.id);
        await createEnforceAlarm();
    } else if (alarm.name === "flush") {
        await flushAllStats();
        await createFlushAlarm();
    } else if (alarm.name === PREMIUM_SYNC_ALARM) {
        await refreshStoredPremiumStatus("alarm-sync").catch(() => null);
    } else if (alarm.name.startsWith('startBlock_')) {
        const id = parseInt(alarm.name.split('_')[1], 10);
        await activateScheduledBlock(id, "alarm_start");
    } else if (alarm.name.startsWith('endBlock_')) {
        const id = parseInt(alarm.name.split('_')[1], 10);
        await deactivateScheduledBlock(id, "alarm_end");
    } else if (alarm.name.startsWith('snoozeEnd_')) {
        const domain = alarm.name.slice('snoozeEnd_'.length);
        const { [KEYS.snoozedDomains]: snoozedDomains = {} } =
            await chrome.storage.local.get([KEYS.snoozedDomains]);
        delete snoozedDomains[domain];
        await chrome.storage.local.set({ [KEYS.snoozedDomains]: snoozedDomains });
        await updateBlockRules();
        await sendAnalyticsEventSafe("snooze_ended", {
            domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
            resume_reason: "alarm_expired"
        });
    }
});

function buildBackgroundMessageActionHandlers(deps) {
    const {
        ensureActiveTrackingState,
        flushTime,
        getActiveTabId,
        enforceIfNeeded,
        storage,
        keys,
        updateBlockRules,
        sendAnalyticsEventSafe,
        sanitizeAnalyticsText,
        logOnboardingMetric,
        refreshStoredPremiumStatus,
        syncActionBadge,
        verifyAndPersistWhopToken
    } = deps;

    return {
        flushActiveTimeNow(_request, sendResponse) {
            (async () => {
                await ensureActiveTrackingState();
                await flushTime();
                const activeTabId = getActiveTabId();
                if (activeTabId != null) {
                    await enforceIfNeeded(activeTabId);
                }
                sendResponse({ success: true });
            })().catch((error) => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Failed to flush active time"
                });
            });
        },

        endScheduledBlock(request, sendResponse) {
            const domain = String(request?.domain || "").trim();

            (async () => {
                const { [keys.activeBlocks]: activeBlocks = [] } =
                    await storage.get([keys.activeBlocks]);
                const next = activeBlocks.filter((block) => block.domain !== domain);
                await storage.set({ [keys.activeBlocks]: next });
                await updateBlockRules();
                if (activeBlocks.length !== next.length) {
                    await sendAnalyticsEventSafe("schedule_block_deactivated", {
                        domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
                        deactivation_source: "manual_end"
                    });
                }
                sendResponse({ success: true });
            })().catch((error) => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Failed to end scheduled block"
                });
            });
        },

        logOnboardingMetric(request, sendResponse) {
            const { metric, value } = request;

            (async () => {
                await logOnboardingMetric(metric, value);
                sendResponse({ success: true });
            })().catch((error) => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Failed to log onboarding metric"
                });
            });
        },

        refreshPremiumStatus(_request, sendResponse) {
            (async () => {
                try {
                    const result = await refreshStoredPremiumStatus("manual-refresh");
                    sendResponse(result);
                } catch (error) {
                    sendResponse({
                        success: false,
                        error: error instanceof Error ? error.message : "Premium refresh failed"
                    });
                }
            })();
        },

        refreshActionBadge(_request, sendResponse) {
            (async () => {
                await syncActionBadge();
                sendResponse({ success: true });
            })().catch((error) => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Failed to refresh badge"
                });
            });
        },

        completeWhopCheckout(request, sendResponse) {
            (async () => {
                try {
                    const premiumState = await verifyAndPersistWhopToken(request.token, "whop-popup-fallback");
                    sendResponse({
                        success: true,
                        premiumState
                    });
                } catch (error) {
                    sendResponse({
                        success: false,
                        error: error instanceof Error ? error.message : "Token verification failed"
                    });
                }
            })();
        },

        trackAnalyticsEvent(request, sendResponse) {
            (async () => {
                await sendAnalyticsEventSafe(request.eventName, request.params || {});
                sendResponse({ success: true });
            })().catch((error) => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Failed to track analytics event"
                });
            });
        }
    };
}

const MESSAGE_ACTION_HANDLERS = buildBackgroundMessageActionHandlers({
    ensureActiveTrackingState,
    flushTime,
    getActiveTabId: () => activeTabId,
    enforceIfNeeded,
    storage: chrome.storage.local,
    keys: {
        activeBlocks: KEYS.activeBlocks
    },
    updateBlockRules,
    sendAnalyticsEventSafe,
    sanitizeAnalyticsText,
    logOnboardingMetric,
    refreshStoredPremiumStatus,
    syncActionBadge,
    verifyAndPersistWhopToken
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== "object") return;

    const actionHandler = MESSAGE_ACTION_HANDLERS[request.action];
    if (typeof actionHandler === "function") {
        actionHandler(request, sendResponse);
        return true;
    }

    if (request.action === 'addScheduledBlock') {
        const { domain, startTime, endTime, daysOfWeek } = request;
        chrome.storage.local.get([KEYS.scheduledBlocks, PREMIUM_KEY], async (data) => {
            const scheduled = data[KEYS.scheduledBlocks] || [];
            const premiumState = data[PREMIUM_KEY] || {};
            const isPremium = Boolean(premiumState?.active);
            if (!isPremium && scheduled.length >= FREE_PLAN_LIMITS.maxScheduledBlocks) {
                sendResponse({ success: false, error: `Free plan allows up to ${FREE_PLAN_LIMITS.maxScheduledBlocks} scheduled blocks.` });
                return;
            }
            const id = Date.now();
            const nextBlock = normalizeScheduledBlock({ id, domain, startTime, endTime, daysOfWeek, enabled: true });
            scheduled.push(nextBlock);
            await chrome.storage.local.set({ [KEYS.scheduledBlocks]: scheduled });
            // Set alarms for next occurrences
            const startMs = getNextScheduledStartTime(nextBlock);
            const endMs = getNextScheduledEndTime(nextBlock);
            if (startMs != null) {
                chrome.alarms.create(`startBlock_${id}`, { when: startMs });
            }
            if (endMs != null) {
                chrome.alarms.create(`endBlock_${id}`, { when: endMs });
            }

            if (isScheduleActiveNow(nextBlock)) {
                await activateScheduledBlock(id, "created_active_now");
            }

            await sendAnalyticsEventSafe("schedule_created", {
                schedule_id: id,
                domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
                window_start_min: startTime,
                window_end_min: endTime,
                days_mask: normalizeScheduleDays(daysOfWeek).join(",")
            });

            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === "updateScheduledBlock") {
        const id = Number(request.id);
        const { domain, startTime, endTime, daysOfWeek } = request;

        if (!Number.isInteger(id) || id <= 0) {
            sendResponse({ success: false, error: "Scheduled block not found." });
            return true;
        }

        chrome.storage.local.get([KEYS.scheduledBlocks], async (data) => {
            const scheduled = (data[KEYS.scheduledBlocks] || []).map(normalizeScheduledBlock);
            const blockIndex = scheduled.findIndex((block) => block.id === id);

            if (blockIndex === -1) {
                sendResponse({ success: false, error: "Scheduled block not found." });
                return;
            }

            const previousBlock = scheduled[blockIndex];
            scheduled[blockIndex] = normalizeScheduledBlock({
                ...previousBlock,
                id,
                domain,
                startTime,
                endTime,
                daysOfWeek
            });

            await chrome.storage.local.set({ [KEYS.scheduledBlocks]: scheduled });
            await refreshScheduledBlockRuntime(id);

            let changedFieldsCount = 0;
            if (previousBlock.domain !== domain) changedFieldsCount += 1;
            if (previousBlock.startTime !== startTime) changedFieldsCount += 1;
            if (previousBlock.endTime !== endTime) changedFieldsCount += 1;
            if (normalizeScheduleDays(previousBlock.daysOfWeek).join(",") !== normalizeScheduleDays(daysOfWeek).join(",")) {
                changedFieldsCount += 1;
            }

            await sendAnalyticsEventSafe("schedule_updated", {
                schedule_id: id,
                domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
                changed_fields_count: changedFieldsCount
            });

            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === "toggleScheduledBlockEnabled") {
        const id = Number(request.id);
        const enabled = Boolean(request.enabled);

        if (!Number.isInteger(id) || id <= 0) {
            sendResponse({ success: false, error: "Scheduled block not found." });
            return true;
        }

        chrome.storage.local.get([KEYS.scheduledBlocks], async (data) => {
            const scheduled = (data[KEYS.scheduledBlocks] || []).map(normalizeScheduledBlock);
            const blockIndex = scheduled.findIndex((block) => block.id === id);

            if (blockIndex === -1) {
                sendResponse({ success: false, error: "Scheduled block not found." });
                return;
            }

            const previous = scheduled[blockIndex];
            if (previous.enabled === enabled) {
                sendResponse({ success: true });
                return;
            }

            scheduled[blockIndex] = { ...previous, enabled };
            await chrome.storage.local.set({ [KEYS.scheduledBlocks]: scheduled });
            await refreshScheduledBlockRuntime(id);

            await sendAnalyticsEventSafe("schedule_toggled", {
                schedule_id: id,
                domain_host: sanitizeAnalyticsText(previous.domain, "unknown", 100),
                enabled: enabled ? 1 : 0
            });

            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === "toggleDomainLimitEnabled") {
        const domain = String(request.domain || "").trim().toLowerCase();
        const enabled = Boolean(request.enabled);

        if (!domain) {
            sendResponse({ success: false, error: "Domain not found." });
            return true;
        }

        chrome.storage.local.get([KEYS.blockedDomains], async (data) => {
            const blockedDomains = { ...(data[KEYS.blockedDomains] || {}) };
            const existingConfig = blockedDomains[domain];

            if (!existingConfig) {
                sendResponse({ success: false, error: "Domain not found." });
                return;
            }

            const previousEnabled = existingConfig.enabled !== false;
            if (previousEnabled === enabled) {
                sendResponse({ success: true });
                return;
            }

            blockedDomains[domain] = {
                ...existingConfig,
                enabled
            };

            await chrome.storage.local.set({ [KEYS.blockedDomains]: blockedDomains });

            if (enabled) {
                const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                if (activeTab?.id != null) {
                    await enforceIfNeeded(activeTab.id);
                }
            }

            await syncActionBadge();

            await sendAnalyticsEventSafe("domain_limit_toggled", {
                domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
                enabled: enabled ? 1 : 0
            });

            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === "snoozeBlock") {
        const { domain, minutes = 5 } = request;
        (async () => {
            const expiresAt = Date.now() + minutes * 60 * 1000;
            const {
                [KEYS.snoozedDomains]: snoozedDomains = {},
                [KEYS.snoozeHistory]: snoozeHistory = {}
            } = await chrome.storage.local.get([KEYS.snoozedDomains, KEYS.snoozeHistory]);

            const todayKey = getDayKey();
            const nextSnoozeHistory = { ...snoozeHistory };
            nextSnoozeHistory[todayKey] = Number(nextSnoozeHistory[todayKey] || 0) + 1;

            snoozedDomains[domain] = expiresAt;
            await chrome.storage.local.set({
                [KEYS.snoozedDomains]: snoozedDomains,
                [KEYS.snoozeHistory]: nextSnoozeHistory
            });
            await updateBlockRules();
            chrome.alarms.create(`snoozeEnd_${domain}`, { when: expiresAt });
            await sendAnalyticsEventSafe("snooze_started", {
                domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
                snooze_minutes: minutes,
                block_source: "scheduled"
            });
            sendResponse({ success: true, expiresAt });
        })();
        return true;
    }
});

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== "object") return;

    if (request.action !== "whopCheckoutComplete") {
        sendResponse({ success: false, error: "unsupported-action" });
        return;
    }

    const senderUrl = typeof sender?.url === "string" ? sender.url : "";
    if (!senderUrl.startsWith(ALLOWED_EXTERNAL_CALLBACK_ORIGIN)) {
        sendResponse({ success: false, error: "unauthorized-origin" });
        return;
    }

    (async () => {
        try {
            const premiumState = await verifyAndPersistWhopToken(request.token, "whop-callback");
            let popupOpened = false;
            try {
                await chrome.action.openPopup();
                popupOpened = true;
            } catch {
                popupOpened = false;
            }

            sendResponse({
                success: true,
                active: premiumState.active,
                planName: premiumState.planName,
                popupOpened
            });
        } catch (error) {
            await sendAnalyticsEventSafe("premium_checkout_complete_result", {
                source: "whop_callback",
                status: "error"
            });
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : "Token verification failed"
            });
        }
    })();

    return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.activeBlocks) {
        updateBlockRules();
    }
});
