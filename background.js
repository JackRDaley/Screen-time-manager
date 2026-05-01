// blockedDomains: { [domain]: { limitMinutes: number } }
// statsToday: { [domain]: { timeSec: number, visits: number } }
// activeBlocks: [{ domain: string, endsAt: number|null, remainingSec?: number }]

importScripts("shared-extension-utils.js");
importScripts("gdpr-utils.js");
const {
    formatTimeSec,
    getDayKey,
    parseDayKey,
    getOrCreateAnalyticsClientId
} = globalThis.StmSharedUtils || {};

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
    postInstallRedirectMeta: "postInstallRedirectMeta", // { reason: "install"|"update", version: string, shownAt: number }
    lastKnownTimezoneOffset: "lastKnownTimezoneOffset" // number: minutes offset from UTC
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
const DOMAIN_CONFIG_VALIDATION = Object.freeze({
    MIN_LIMIT_SECONDS: 60,        // 1 minute minimum
    MAX_LIMIT_SECONDS: 86400,     // 24 hours maximum
    ALLOWED_TIERS: ['lenient', 'standard', 'strict', 'immutable']
});
const ALL_SCHEDULE_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const ENFORCEMENT_TIERS = Object.freeze({
    LENIENT: "lenient",
    STANDARD: "standard",
    STRICT: "strict",
    IMMUTABLE: "immutable"
});
const DEFAULT_ENFORCEMENT_TIER = ENFORCEMENT_TIERS.LENIENT;
const DEFAULT_NEW_RULE_TIER = ENFORCEMENT_TIERS.STANDARD;
const ADMIN_OVERRIDE_KEY = "immutableAdminOverrideEnabled";
const ADMIN_OVERRIDE_LAST_USED_KEY = "immutableAdminOverrideLastUsedDay";
const TIER_POLICIES = Object.freeze({
    [ENFORCEMENT_TIERS.LENIENT]: Object.freeze({
        allowImmediateUndo: true,
        allowedSnoozeMinutes: [5, 15, 30],
        requiresChallenge: false,
        blockedPageImmutable: false
    }),
    [ENFORCEMENT_TIERS.STANDARD]: Object.freeze({
        allowImmediateUndo: false,
        allowedSnoozeMinutes: [5, 15, 30],
        requiresChallenge: false,
        blockedPageImmutable: false
    }),
    [ENFORCEMENT_TIERS.STRICT]: Object.freeze({
        allowImmediateUndo: false,
        allowedSnoozeMinutes: [5, 10],
        requiresChallenge: true,
        blockedPageImmutable: false
    }),
    [ENFORCEMENT_TIERS.IMMUTABLE]: Object.freeze({
        allowImmediateUndo: false,
        allowedSnoozeMinutes: [],
        requiresChallenge: false,
        blockedPageImmutable: true
    })
});

const strictChallengeTokens = new Map();

// Reset token management: Secure reset operations by requiring short-lived tokens
const resetLimitTokens = new Map(); // { token: { domain, expiresAt } }
const RESET_TOKEN_TTL_MS = 5000; // 5 second expiry
const TOKEN_STORAGE_KEYS = Object.freeze({
    strictChallenge: "strictChallengeTokens",
    resetLimit: "resetLimitTokens"
});

function getSessionStorageArea() {
    return chrome.storage?.session || null;
}

async function hydrateTokenCache(storageKey, cache) {
    const storage = getSessionStorageArea();
    if (!storage?.get || cache.size > 0) {
        return;
    }

    const data = await storage.get([storageKey]);
    const stored = data?.[storageKey];
    if (!stored || typeof stored !== "object") {
        return;
    }

    const now = Date.now();
    for (const [token, record] of Object.entries(stored)) {
        if (record?.expiresAt > now) {
            cache.set(token, record);
        }
    }
}

function pruneExpiredTokens(cache, now = Date.now()) {
    let changed = false;
    for (const [token, record] of cache) {
        if (!record || Number(record.expiresAt) <= now) {
            cache.delete(token);
            changed = true;
        }
    }
    return changed;
}

async function persistTokenCache(storageKey, cache) {
    try {
        const storage = getSessionStorageArea();
        if (!storage || typeof storage.set !== 'function') {
            // Session storage unavailable in this context (worker suspended or older runtime) - no-op
            return;
        }

        const obj = {};
        for (const [token, record] of cache) {
            if (record && Number(record.expiresAt) > Date.now()) {
                obj[token] = record;
            }
        }

        await storage.set({ [storageKey]: obj });
    } catch (err) {
        // Don't throw - token persistence is best-effort. Log for diagnostics.
        ExtensionLogger.debug('persistTokenCache', 'Failed to persist token cache', { storageKey, error: String(err) });
    }
}

async function createResetToken(domain) {
    if (!domain || typeof domain !== "string") return null;
    await hydrateTokenCache(TOKEN_STORAGE_KEYS.resetLimit, resetLimitTokens);
    const token = typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `reset_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    resetLimitTokens.set(token, {
        domain: domain.toLowerCase(),
        expiresAt: Date.now() + RESET_TOKEN_TTL_MS
    });

    pruneExpiredTokens(resetLimitTokens);
    await persistTokenCache(TOKEN_STORAGE_KEYS.resetLimit, resetLimitTokens);

    return token;
}

async function verifyResetToken(token, domain) {
    if (!token || typeof token !== "string") return false;
    const normalizedDomain = String(domain || "").trim().toLowerCase();
    if (!normalizedDomain) return false;

    await hydrateTokenCache(TOKEN_STORAGE_KEYS.resetLimit, resetLimitTokens);
    pruneExpiredTokens(resetLimitTokens);

    const record = resetLimitTokens.get(token);
    if (!record) return false;

    resetLimitTokens.delete(token); // One-time use only
    await persistTokenCache(TOKEN_STORAGE_KEYS.resetLimit, resetLimitTokens);

    if (record.domain !== normalizedDomain) return false;
    if (record.expiresAt < Date.now()) return false; // Expired

    return true;
}

async function createStrictChallengeToken(domain, gameType) {
    if (!domain || typeof domain !== "string") return null;

    await hydrateTokenCache(TOKEN_STORAGE_KEYS.strictChallenge, strictChallengeTokens);
    const token = typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    strictChallengeTokens.set(token, {
        domain: domain.toLowerCase(),
        gameType: gameType || null,
        expiresAt: Date.now() + (2 * 60 * 1000)
    });

    pruneExpiredTokens(strictChallengeTokens);
    await persistTokenCache(TOKEN_STORAGE_KEYS.strictChallenge, strictChallengeTokens);

    // Diagnostic log: token created (masked)
    try {
        const masked = `${String(token).slice(0, 6)}...${String(token).slice(-4)}`;
        ExtensionLogger.info('createStrictChallengeToken', `created token ${masked}`, { domain, gameType });
    } catch (e) {
        /* ignore logging failures */
    }

    return token;
}

async function validateStrictChallengeToken(token, domain) {
    const tokenValue = String(token || "").trim();
    const normalizedDomain = String(domain || "").trim().toLowerCase();
    if (!tokenValue || !normalizedDomain) return false;

    await hydrateTokenCache(TOKEN_STORAGE_KEYS.strictChallenge, strictChallengeTokens);
    pruneExpiredTokens(strictChallengeTokens);

    const record = strictChallengeTokens.get(tokenValue);
    if (!record) return false;

    strictChallengeTokens.delete(tokenValue);
    await persistTokenCache(TOKEN_STORAGE_KEYS.strictChallenge, strictChallengeTokens);

    const domainMatch = record.domain === normalizedDomain;
    const notExpired = record.expiresAt > Date.now();

    // Diagnostic log: validation attempt (masked token)
    try {
        const masked = `${String(tokenValue).slice(0, 6)}...${String(tokenValue).slice(-4)}`;
        ExtensionLogger.info('validateStrictChallengeToken', `validate ${masked}`, { domain: normalizedDomain, domainMatch, notExpired });
    } catch (e) {
        /* ignore logging failures */
    }

    if (!domainMatch) return false;
    return notExpired;
}
// Standardized logging utility
const ExtensionLogger = {
    error(operation, error, details = {}) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[STM][${operation}] Error:`, message, details);
    },
    
    warn(operation, message, details = {}) {
        console.warn(`[STM][${operation}] Warning:`, message, details);
    },
    
    info(operation, message, details = {}) {
        console.info(`[STM][${operation}]`, message, details);
    },
    
    debug(operation, message, details = {}) {
        if (process?.env?.NODE_ENV === 'development') {
            console.debug(`[STM][${operation}]`, message, details);
        }
    }
};

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

function getIsoWeekKey(d = new Date()) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);

    const day = date.getDay() || 7;
    date.setDate(date.getDate() + 4 - day);

    const yearStart = new Date(date.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);

    return `${date.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
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
    const totalMin = Math.floor(totalSec / 60);

    if (totalMin >= 60) {
        const hours = Math.floor(totalMin / 60);
        const minutes = totalMin % 60;
        return `${hours}h ${minutes}m`;
    }

    return `${totalMin}m`;
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

    const {
        [KEYS.blockedDomains]: blockedDomains = {},
        [KEYS.statsToday]: statsToday = {},
        [KEYS.snoozedDomains]: snoozedDomains = {}
    } = await chrome.storage.local.get([KEYS.blockedDomains, KEYS.statsToday, KEYS.snoozedDomains]);

    const domain = activeDomain;
    const snoozeExpiresAt = getSnoozeExpiresAt(snoozedDomains?.[domain]);
    if (snoozeExpiresAt > Date.now()) {
        const remainingSec = Math.max(1, Math.ceil((snoozeExpiresAt - Date.now()) / 1000));
        await chrome.action.setBadgeText({ text: formatBadgeDuration(remainingSec) }).catch(() => {});
        return;
    }

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

const ANALYTICS_RETRY_CONFIG = Object.freeze({
    maxRetries: 3,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2
});

async function sendAnalyticsEventWithRetry(eventName, params = {}, retryCount = 0) {
    const normalizedEventName = sanitizeAnalyticsEventName(eventName);
    if (!normalizedEventName) {
        return;
    }

    const clientId = await getOrCreateAnalyticsClientId();
    const extensionVersion = sanitizeAnalyticsText(chrome.runtime.getManifest().version, "unknown", 32);

    try {
        const response = await fetch(ANALYTICS_EVENT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                clientId,
                eventName: normalizedEventName,
                extensionVersion,
                params: sanitizeAnalyticsParams(params)
            }),
            signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined
        });

        if (!response.ok) {
            throw new Error(`Analytics request failed with status ${response.status}`);
        }
    } catch (error) {
        if (retryCount < ANALYTICS_RETRY_CONFIG.maxRetries) {
            const delayMs = Math.min(
                ANALYTICS_RETRY_CONFIG.initialDelayMs * Math.pow(ANALYTICS_RETRY_CONFIG.backoffMultiplier, retryCount),
                ANALYTICS_RETRY_CONFIG.maxDelayMs
            );
            
            ExtensionLogger.info('analytics_retry', `Retrying after ${delayMs}ms`, {
                eventName,
                attempt: retryCount + 1,
                maxRetries: ANALYTICS_RETRY_CONFIG.maxRetries
            });

            await new Promise(resolve => setTimeout(resolve, delayMs));
            return sendAnalyticsEventWithRetry(eventName, params, retryCount + 1);
        } else {
            ExtensionLogger.warn('analytics_failed', `Analytics event discarded after ${ANALYTICS_RETRY_CONFIG.maxRetries} retries`, {
                eventName,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

async function sendAnalyticsEvent(eventName, params = {}) {
    await sendAnalyticsEventWithRetry(eventName, params, 0);
}

async function sendAnalyticsEventSafe(eventName, params = {}) {
    try {
        await sendAnalyticsEvent(eventName, params);
    } catch (error) {
        // Never block extension behavior on analytics failures
        ExtensionLogger.debug('analytics_safe', 'Analytics operation was silently handled', {
            eventName,
            error: error instanceof Error ? error.message : String(error)
        });
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

function normalizeTier(rawTier, fallbackTier = DEFAULT_ENFORCEMENT_TIER) {
    const value = String(rawTier || "").trim().toLowerCase();
    if (Object.values(ENFORCEMENT_TIERS).includes(value)) {
        return value;
    }
    return fallbackTier;
}

function normalizeBlockedDomainConfig(rawConfig) {
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
        return {
            enabled: true,
            limitSeconds: 0,
            tier: DEFAULT_ENFORCEMENT_TIER
        };
    }

    // Validate and constrain limitSeconds
    let limitSeconds = Number(rawConfig.limitSeconds || 0);
    if (!Number.isFinite(limitSeconds)) {
        ExtensionLogger.warn('normalizeBlockedDomainConfig', 'Invalid limitSeconds value', { value: rawConfig.limitSeconds });
        limitSeconds = 0;
    } else if (limitSeconds > 0) {
        // Enforce valid range
        limitSeconds = Math.max(
            DOMAIN_CONFIG_VALIDATION.MIN_LIMIT_SECONDS,
            Math.min(DOMAIN_CONFIG_VALIDATION.MAX_LIMIT_SECONDS, limitSeconds)
        );
    }

    // Validate tier
    const tier = normalizeTier(rawConfig.tier, DEFAULT_ENFORCEMENT_TIER);
    if (!DOMAIN_CONFIG_VALIDATION.ALLOWED_TIERS.includes(tier)) {
        ExtensionLogger.warn('normalizeBlockedDomainConfig', 'Invalid tier value', { tier });
        return {
            enabled: rawConfig.enabled !== false,
            limitSeconds,
            tier: DEFAULT_ENFORCEMENT_TIER
        };
    }

    return {
        enabled: rawConfig.enabled !== false,
        limitSeconds,
        tier
    };
}

function getTierPolicyForTier(tier) {
    return TIER_POLICIES[normalizeTier(tier)] || TIER_POLICIES[DEFAULT_ENFORCEMENT_TIER];
}

function getEffectiveTierForDomain(domain, blockedDomains = {}, activeBlocks = []) {
    const activeMatch = (Array.isArray(activeBlocks) ? activeBlocks : [])
        .find((block) => block?.domain === domain);
    if (activeMatch?.tier) {
        return normalizeTier(activeMatch.tier, DEFAULT_ENFORCEMENT_TIER);
    }

    const normalizedConfig = normalizeBlockedDomainConfig(blockedDomains?.[domain]);
    return normalizeTier(normalizedConfig?.tier, DEFAULT_ENFORCEMENT_TIER);
}

function getSnoozeExpiresAt(snoozeEntry) {
    if (Number.isFinite(snoozeEntry)) {
        return Number(snoozeEntry);
    }

    if (snoozeEntry && typeof snoozeEntry === "object" && Number.isFinite(snoozeEntry.expiresAt)) {
        return Number(snoozeEntry.expiresAt);
    }

    return 0;
}

function isDomainSnoozed(domain, snoozedDomains = {}, now = Date.now()) {
    const expiresAt = getSnoozeExpiresAt(snoozedDomains?.[domain]);
    return expiresAt > now;
}

async function clearDomainSnooze(domain, { emitAnalytics = false, resumeReason = "manual_clear" } = {}) {
    const normalizedDomain = String(domain || "").trim().toLowerCase();
    if (!normalizedDomain) {
        return false;
    }

    const { [KEYS.snoozedDomains]: snoozedDomains = {} } =
        await chrome.storage.local.get([KEYS.snoozedDomains]);
    if (!Object.prototype.hasOwnProperty.call(snoozedDomains, normalizedDomain)) {
        return false;
    }

    delete snoozedDomains[normalizedDomain];
    await chrome.storage.local.set({ [KEYS.snoozedDomains]: snoozedDomains });
    await chrome.alarms.clear(`snoozeEnd_${normalizedDomain}`);
    await syncActionBadge();
    await updateBlockRules();

    if (emitAnalytics) {
        await sendAnalyticsEventSafe("snooze_ended", {
            domain_host: sanitizeAnalyticsText(normalizedDomain, "unknown", 100),
            resume_reason: sanitizeAnalyticsText(resumeReason, "manual_clear", 40)
        });
    }

    return true;
}

async function resetDomainUsage(domain) {
    const normalizedDomain = String(domain || "").trim().toLowerCase();
    if (!normalizedDomain) {
        return false;
    }

    const {
        [KEYS.statsToday]: statsToday = {},
        [KEYS.allStatsToday]: allStatsToday = {},
        [KEYS.alertsSent]: alertsSent = {}
    } = await chrome.storage.local.get([KEYS.statsToday, KEYS.allStatsToday, KEYS.alertsSent]);

    const hadStats = Object.prototype.hasOwnProperty.call(statsToday, normalizedDomain);
    const hadAllStats = Object.prototype.hasOwnProperty.call(allStatsToday, normalizedDomain);
    const hadAlerts = Object.prototype.hasOwnProperty.call(alertsSent, normalizedDomain);

    if (!hadStats && !hadAllStats && !hadAlerts) {
        return false;
    }

    if (hadStats) {
        delete statsToday[normalizedDomain];
    }
    if (hadAllStats) {
        delete allStatsToday[normalizedDomain];
    }
    if (hadAlerts) {
        delete alertsSent[normalizedDomain];
    }

    await chrome.storage.local.set({
        [KEYS.statsToday]: statsToday,
        [KEYS.allStatsToday]: allStatsToday,
        [KEYS.alertsSent]: alertsSent
    });

    await clearDomainSnooze(normalizedDomain, {
        emitAnalytics: true,
        resumeReason: "limit_reset"
    });
    await syncActionBadge();

    return true;
}

function normalizeScheduledBlock(block) {
    const normalizedTier = normalizeTier(block?.tier, DEFAULT_NEW_RULE_TIER);
    return {
        ...block,
        tier: normalizedTier,
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

    const storageKeys = [KEYS.blockedDomains, KEYS.statsToday, KEYS.allStatsToday, KEYS.snoozedDomains];
    if (deltaMs > 0) {
        storageKeys.push(KEYS.hourlyUsageHistory);
    }

    const {
        blockedDomains = {},
        [KEYS.statsToday]: stats = {},
        [KEYS.allStatsToday]: allStats = {},
        [KEYS.hourlyUsageHistory]: hourlyUsageHistory = {},
        [KEYS.snoozedDomains]: snoozedDomains = {}
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

        // ENFORCE LIMIT (only if domain is currently blocked and not snoozed)
        if (isBlockedDomain(domain, blockedDomains) && !isDomainSnoozed(domain, snoozedDomains)) {
            const limitMs = limitMsFor(domain, blockedDomains);
            if (limitMs != null && cur.timeMs >= limitMs) {
                const tabs = await chrome.tabs.query({});
                const targetTab =
                    tabs.find((tab) => tab.active && (tab.url ? domainFromUrl(tab.url) : null) === domain) ||
                    tabs.find((tab) => (tab.url ? domainFromUrl(tab.url) : null) === domain);
                const tier = getEffectiveTierForDomain(domain, blockedDomains);

                // Enforce on any currently open tab for this domain, preferring active tabs.
                if (targetTab?.id != null) {
                    await sendAnalyticsEventSafe("limit_block_enforced", {
                        domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
                        used_ms: cur.timeMs,
                        limit_ms: limitMs,
                        tier,
                        block_source: "limit"
                    });
                    await chrome.tabs.update(targetTab.id, { url: blockedUrl(domain, "limit", tier, targetTab.url) }).catch(() => {});
                }
            }
        }
    }
}

function isBlockedDomain(domain, blockedDomains) {
    const config = normalizeBlockedDomainConfig(blockedDomains?.[domain]);
    return Boolean(config) && config.enabled !== false;
}

function limitMsFor(domain, blockedDomains) {
    const config = normalizeBlockedDomainConfig(blockedDomains?.[domain]);
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

function blockedUrl(domain, source = "limit", tier = DEFAULT_ENFORCEMENT_TIER, originalUrl = null) {
    const params = new URLSearchParams({
        d: domain,
        source,
        tier: normalizeTier(tier, DEFAULT_ENFORCEMENT_TIER),
        eid: createBlockedEventId()
    });
    try {
        if (originalUrl) {
            // Only include when provided; background callers should ensure this is safe/validated.
            params.set('o', String(originalUrl));
        }
    } catch (e) {}
    return chrome.runtime.getURL(`blocked.html?${params.toString()}`);
}

async function redirectOpenTabsForDomains(blocks) {
    const blockEntries = Array.isArray(blocks) ? blocks : [];
    const domainSet = new Set(blockEntries.map((block) => block?.domain).filter(Boolean));
    if (domainSet.size === 0) return;

    const tierByDomain = new Map(blockEntries.map((block) => [
        block.domain,
        normalizeTier(block.tier, DEFAULT_NEW_RULE_TIER)
    ]));

    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(async (tab) => {
        if (!tab.id || !tab.url) return;
        if (tab.url.startsWith(chrome.runtime.getURL("blocked.html"))) return;

        const domain = domainFromUrl(tab.url);
        if (!domainSet.has(domain)) return;

        await chrome.tabs.update(tab.id, {
            url: blockedUrl(domain, "scheduled", tierByDomain.get(domain) || DEFAULT_NEW_RULE_TIER, tab.url)
        }).catch(() => {});
    }));
}

function parseHourMinute(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return { h, m };
}

// Timezone awareness: Scheduled blocks use local browser time.
// If device timezone changes, blocks may activate/deactivate at unexpected times.
// TODO: Store timezone offset and handle DST transitions properly in future version
async function detectTimezoneChange() {
    const { [KEYS.lastKnownTimezoneOffset]: lastOffset = null } = 
        await chrome.storage.local.get([KEYS.lastKnownTimezoneOffset]);
    
    const currentOffset = new Date().getTimezoneOffset();
    if (lastOffset !== null && Math.abs(currentOffset - lastOffset) > 30) {
        // Timezone offset changed by more than 30 minutes (likely actual change, not DST)
        ExtensionLogger.warn('timezone_change_detected', 'Device timezone may have changed', {
            previousOffset: lastOffset,
            currentOffset: currentOffset,
            differenceMinutes: Math.abs(currentOffset - lastOffset)
        });
        return true;
    }
    
    // Store current offset
    await chrome.storage.local.set({ [KEYS.lastKnownTimezoneOffset]: currentOffset });
    
    return false;
}

function getTodayTime(timeStr, baseDate = new Date()) {
    // NOTE: All times are in local browser timezone
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

    const {
        [KEYS.blockedDomains]: blockedDomains = {},
        [KEYS.statsToday]: statsToday = {},
        [KEYS.snoozedDomains]: snoozedDomains = {}
    } = await chrome.storage.local.get([KEYS.blockedDomains, KEYS.statsToday, KEYS.snoozedDomains]);

    const limitMs = limitMsFor(domain, blockedDomains);
    if (limitMs == null) return;
    if (isDomainSnoozed(domain, snoozedDomains)) return;

    const usedMs = statsToday?.[domain]?.timeMs || 0;
    if (usedMs >= limitMs) {
        const tier = getEffectiveTierForDomain(domain, blockedDomains);
        await sendAnalyticsEventSafe("limit_block_enforced", {
            domain_host: sanitizeAnalyticsText(domain, "unknown", 100),
            used_ms: usedMs,
            limit_ms: limitMs,
            tier,
            block_source: "limit"
        });
        await chrome.tabs.update(tabId, { url: blockedUrl(domain, "limit", tier, tab?.url) }).catch(() => {});
    }
}

async function isDomainLimitCurrentlyBlocking(domain) {
    const normalizedDomain = String(domain || "").trim().toLowerCase();
    if (!normalizedDomain) return false;

    const {
        [KEYS.blockedDomains]: blockedDomains = {},
        [KEYS.statsToday]: statsToday = {},
        [KEYS.snoozedDomains]: snoozedDomains = {}
    } = await chrome.storage.local.get([KEYS.blockedDomains, KEYS.statsToday, KEYS.snoozedDomains]);

    if (!isBlockedDomain(normalizedDomain, blockedDomains)) return false;
    if (isDomainSnoozed(normalizedDomain, snoozedDomains)) return false;

    const limitMs = limitMsFor(normalizedDomain, blockedDomains);
    if (limitMs == null) return false;

    const usedMs = statsToday?.[normalizedDomain]?.timeMs || 0;
    return usedMs >= limitMs;
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
    return uniqueDomains.map((domain) => {
        const matchedBlock = activeBlocks.find((block) => block.domain === domain) || {};
        const tier = normalizeTier(matchedBlock.tier, DEFAULT_NEW_RULE_TIER);
        return {
        id: stableRuleIdForDomain(domain),
        priority: 1,
        action: {
            type: "redirect",
            redirect: {
                extensionPath: `/blocked.html?d=${encodeURIComponent(domain)}&source=scheduled&tier=${encodeURIComponent(tier)}`
            }
        },
        condition: {
            urlFilter: `||${domain}^`,
            resourceTypes: ["main_frame"]
        }
    };
    });
}

async function syncBlockRulesNow() {
    const {
        activeBlocks = [],
        [KEYS.snoozedDomains]: snoozedDomains = {},
        [KEYS.blockedDomains]: blockedDomains = {}
    } = await chrome.storage.local.get([KEYS.activeBlocks, KEYS.snoozedDomains, KEYS.blockedDomains]);
    const now = Date.now();
    const unsnoozedBlocks = activeBlocks.filter((b) => {
        const snoozeEntry = snoozedDomains?.[b.domain];
        const snoozeExpiresAt = getSnoozeExpiresAt(snoozeEntry);
        const tier = getEffectiveTierForDomain(b.domain, blockedDomains, activeBlocks);
        if (tier === ENFORCEMENT_TIERS.IMMUTABLE) {
            if (Boolean(snoozeEntry?.adminOverride) && snoozeExpiresAt > now) {
                return false;
            }
            return true;
        }
        return !isDomainSnoozed(b.domain, snoozedDomains, now);
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
            endTime: activeWindow.end,
            tier: normalizeTier(block.tier, DEFAULT_NEW_RULE_TIER)
        }));

    await chrome.storage.local.set({ [KEYS.activeBlocks]: nextActiveBlocks });
    await updateBlockRules();
    await redirectOpenTabsForDomains(nextActiveBlocks);
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
        await clearDomainSnooze(domain, {
            emitAnalytics: true,
            resumeReason: "alarm_expired"
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
        verifyAndPersistWhopToken,
        getEffectiveTierForDomain
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
            const fromBlockedPage = Boolean(request?.fromBlockedPage);

            (async () => {
                const {
                    [keys.activeBlocks]: activeBlocks = [],
                    [keys.blockedDomains]: blockedDomains = {},
                    [keys.immutableAdminOverride]: immutableAdminOverrideEnabled = false
                } = await storage.get([keys.activeBlocks, keys.blockedDomains, keys.immutableAdminOverride]);

                const tier = getEffectiveTierForDomain(domain, blockedDomains, activeBlocks);
                const immutableBypassAllowed = tier === ENFORCEMENT_TIERS.IMMUTABLE && Boolean(immutableAdminOverrideEnabled);
                if (fromBlockedPage && tier === ENFORCEMENT_TIERS.IMMUTABLE && !immutableBypassAllowed) {
                    sendResponse({
                        success: false,
                        error: "Immutable blocks can only be ended from popup advanced override."
                    });
                    return;
                }

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

        setImmutableAdminOverride(request, sendResponse) {
            (async () => {
                const enabled = Boolean(request?.enabled);
                const { [ADMIN_OVERRIDE_LAST_USED_KEY]: lastUsedDay = "" } = await storage.get([ADMIN_OVERRIDE_LAST_USED_KEY]);
                if (enabled && String(lastUsedDay || "") === getDayKey()) {
                    sendResponse({ success: false, error: "Immutable override has already been used today." });
                    return;
                }

                await storage.set({ [keys.immutableAdminOverride]: enabled });
                sendResponse({ success: true, enabled });
            })().catch((error) => {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Failed to update immutable override"
                });
            });
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
        activeBlocks: KEYS.activeBlocks,
        blockedDomains: KEYS.blockedDomains,
        immutableAdminOverride: ADMIN_OVERRIDE_KEY
    },
    updateBlockRules,
    sendAnalyticsEventSafe,
    sanitizeAnalyticsText,
    logOnboardingMetric,
    refreshStoredPremiumStatus,
    syncActionBadge,
    verifyAndPersistWhopToken,
    getEffectiveTierForDomain
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
        const { domain, startTime, endTime, daysOfWeek, tier } = request;
        chrome.storage.local.get([KEYS.scheduledBlocks, PREMIUM_KEY], async (data) => {
            const scheduled = data[KEYS.scheduledBlocks] || [];
            const premiumState = data[PREMIUM_KEY] || {};
            const isPremium = Boolean(premiumState?.active);
            if (!isPremium && scheduled.length >= FREE_PLAN_LIMITS.maxScheduledBlocks) {
                sendResponse({ success: false, error: `Free plan allows up to ${FREE_PLAN_LIMITS.maxScheduledBlocks} scheduled blocks.` });
                return;
            }
            const id = Date.now();
            const nextBlock = normalizeScheduledBlock({
                id,
                domain,
                startTime,
                endTime,
                daysOfWeek,
                tier: normalizeTier(tier, DEFAULT_NEW_RULE_TIER),
                enabled: true
            });
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
        const { domain, startTime, endTime, daysOfWeek, tier } = request;

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
                daysOfWeek,
                tier: normalizeTier(tier, previousBlock.tier || DEFAULT_NEW_RULE_TIER)
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
            sendResponse({ success: false, error: "Domain is required." });
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

            if (!enabled) {
                await clearDomainSnooze(domain, {
                    emitAnalytics: true,
                    resumeReason: "limit_disabled"
                });
            }

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

    if (request.action === "clearDomainSnooze") {
        const domain = String(request.domain || "").trim().toLowerCase();
        if (!domain) {
            sendResponse({ success: false, error: "Domain is required." });
            return true;
        }

        (async () => {
            await clearDomainSnooze(domain, {
                emitAnalytics: true,
                resumeReason: String(request.reason || "manual_clear")
            });
            sendResponse({ success: true });
        })().catch((error) => {
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : "Failed to clear pause"
            });
        });
        return true;
    }

    if (request.action === "adminOverrideBypassImmutable") {
        const requestedDomain = String(request.domain || "").trim().toLowerCase();
        const source = String(request.source || "limit").trim().toLowerCase();

        if (!requestedDomain) {
            sendResponse({ success: false, error: "Missing domain." });
            return true;
        }

        (async () => {
            const {
                [KEYS.blockedDomains]: blockedDomains = {},
                [KEYS.activeBlocks]: activeBlocks = [],
                [KEYS.snoozedDomains]: snoozedDomains = {},
                [ADMIN_OVERRIDE_KEY]: immutableAdminOverrideEnabled = false
            } = await chrome.storage.local.get([
                KEYS.blockedDomains,
                KEYS.activeBlocks,
                KEYS.snoozedDomains,
                ADMIN_OVERRIDE_KEY
            ]);

            if (!immutableAdminOverrideEnabled) {
                sendResponse({ success: false, error: "Admin override is disabled." });
                return;
            }

            const tier = getEffectiveTierForDomain(requestedDomain, blockedDomains, activeBlocks);
            if (tier !== ENFORCEMENT_TIERS.IMMUTABLE) {
                sendResponse({ success: false, error: "Admin override is only available for immutable blocks." });
                return;
            }

            if (source === "scheduled") {
                const nextActiveBlocks = (Array.isArray(activeBlocks) ? activeBlocks : [])
                    .filter((block) => block.domain !== requestedDomain);
                await chrome.storage.local.set({ [KEYS.activeBlocks]: nextActiveBlocks });
                await chrome.storage.local.set({
                    [ADMIN_OVERRIDE_KEY]: false,
                    [ADMIN_OVERRIDE_LAST_USED_KEY]: getDayKey()
                });
                await updateBlockRules();
                await sendAnalyticsEventSafe("immutable_admin_override_used", {
                    domain_host: sanitizeAnalyticsText(requestedDomain, "unknown", 100),
                    block_source: "scheduled"
                });
                sendResponse({ success: true, action: "end_scheduled" });
                return;
            }

            const expiresAt = Date.now() + 5 * 60 * 1000;
            const todayKey = getDayKey();
            const nextSnoozed = {
                ...snoozedDomains,
                [requestedDomain]: {
                    expiresAt,
                    source: "limit",
                    tier,
                    adminOverride: true
                }
            };

            await chrome.storage.local.set({ [KEYS.snoozedDomains]: nextSnoozed });
            await chrome.storage.local.set({
                [ADMIN_OVERRIDE_KEY]: false,
                [ADMIN_OVERRIDE_LAST_USED_KEY]: todayKey
            });
            chrome.alarms.create(`snoozeEnd_${requestedDomain}`, { when: expiresAt });
            await updateBlockRules();
            await syncActionBadge();
            await sendAnalyticsEventSafe("immutable_admin_override_used", {
                domain_host: sanitizeAnalyticsText(requestedDomain, "unknown", 100),
                block_source: "limit"
            });
            sendResponse({ success: true, action: "snooze_limit", expiresAt });
        })().catch((error) => {
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : "Failed immutable admin override"
            });
        });
        return true;
    }

    if (request.action === "snoozeBlock") {
        const { domain, minutes = 5, source = "scheduled", challengeToken = "" } = request;
        (async () => {
            const requestedDomain = String(domain || "").trim().toLowerCase();
            if (!requestedDomain) {
                sendResponse({ success: false, error: "Missing domain." });
                return;
            }

            const {
                [KEYS.snoozedDomains]: snoozedDomains = {},
                [KEYS.snoozeHistory]: snoozeHistory = {},
                [KEYS.blockedDomains]: blockedDomains = {},
                [KEYS.activeBlocks]: activeBlocks = [],
                [ADMIN_OVERRIDE_KEY]: immutableAdminOverrideEnabled = false
            } = await chrome.storage.local.get([
                KEYS.snoozedDomains,
                KEYS.snoozeHistory,
                KEYS.blockedDomains,
                KEYS.activeBlocks,
                ADMIN_OVERRIDE_KEY
            ]);

            const tier = getEffectiveTierForDomain(requestedDomain, blockedDomains, activeBlocks);
            const tierPolicy = getTierPolicyForTier(tier);
            const requestedMinutes = Number(minutes);

            const immutableBypassAllowed = tier === ENFORCEMENT_TIERS.IMMUTABLE && Boolean(immutableAdminOverrideEnabled);
            if (tierPolicy.blockedPageImmutable && !immutableBypassAllowed) {
                sendResponse({ success: false, error: "This block cannot be snoozed.", reason: "immutable_locked" });
                return;
            }

            if (!tierPolicy.allowedSnoozeMinutes.includes(requestedMinutes)) {
                sendResponse({ success: false, error: "Invalid snooze duration for this tier.", reason: "invalid_snooze_duration" });
                return;
            }

            if (tierPolicy.requiresChallenge && !await validateStrictChallengeToken(challengeToken, requestedDomain)) {
                sendResponse({ success: false, error: "Challenge required before snoozing.", reason: "challenge_required" });
                return;
            }

            const expiresAt = Date.now() + requestedMinutes * 60 * 1000;

            const todayKey = getDayKey();
            const nextSnoozeHistory = { ...snoozeHistory };
            nextSnoozeHistory[todayKey] = Number(nextSnoozeHistory[todayKey] || 0) + 1;

            // Optionally persist the original full URL that initiated the snooze
            // so the blocked page can redirect back to the exact location (path/query/token).
            let savedOriginal = null;
            try {
                const rawOriginal = String(request.original || "").trim();
                if (rawOriginal) {
                    const parsed = new URL(rawOriginal);
                    const host = parsed.hostname.replace(/^www\./, "");
                    if (host === requestedDomain) {
                        savedOriginal = parsed.toString();
                    }
                }
            } catch (e) {
                // ignore invalid original URLs
            }

            snoozedDomains[requestedDomain] = {
                expiresAt,
                source,
                tier,
                original: savedOriginal
            };
            await chrome.storage.local.set({
                [KEYS.snoozedDomains]: snoozedDomains,
                [KEYS.snoozeHistory]: nextSnoozeHistory
            });
            await updateBlockRules();
            chrome.alarms.create(`snoozeEnd_${requestedDomain}`, { when: expiresAt });
            await sendAnalyticsEventSafe("snooze_started", {
                domain_host: sanitizeAnalyticsText(requestedDomain, "unknown", 100),
                snooze_minutes: requestedMinutes,
                block_source: source,
                tier
            });
            const redirectUrl = savedOriginal || (`https://${requestedDomain}`);
            sendResponse({ success: true, expiresAt, redirectUrl });
        })();
        return true;
    }

    if (request.action === "requestStrictChallengeToken") {
        const requestedDomain = String(request.domain || "").trim().toLowerCase();
        if (!requestedDomain) {
            sendResponse({ success: false, error: "Missing domain." });
            return true;
        }

        (async () => {
            const challengeToken = await createStrictChallengeToken(requestedDomain, request.gameType || null);
            if (!challengeToken) {
                sendResponse({ success: false, error: "Failed to create challenge token." });
                return;
            }

            // Log issuance for debugging (masked)
            try {
                const masked = `${String(challengeToken).slice(0,6)}...${String(challengeToken).slice(-4)}`;
                ExtensionLogger.info('requestStrictChallengeToken', `issued ${masked}`, { requestedDomain, gameType: request.gameType || null });
            } catch (e) {}

            sendResponse({ success: true, challengeToken, expiresAt: Date.now() + (2 * 60 * 1000), gameType: request.gameType || null });
        })().catch((error) => {
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : "Failed to create challenge token."
            });
        });
        return true;
    }

    if (request.action === "requestResetToken") {
        const domain = String(request.domain || "").trim().toLowerCase();
        if (!domain) {
            sendResponse({ success: false, error: "Domain is required." });
            return true;
        }

        (async () => {
            const isLimitBlocking = await isDomainLimitCurrentlyBlocking(domain);
            if (isLimitBlocking) {
                sendResponse({
                    success: false,
                    error: "Cannot reset usage while this site is actively blocked by its limit."
                });
                return;
            }

            const token = await createResetToken(domain);
            if (!token) {
                sendResponse({ success: false, error: "Failed to create reset token." });
                return;
            }

            sendResponse({ success: true, token, expiresIn: RESET_TOKEN_TTL_MS });
        })().catch((error) => {
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : "Failed to evaluate reset request."
            });
        });
        return true;
    }

    if (request.action === "verifyResetToken") {
        (async () => {
            const domain = String(request.domain || "").trim().toLowerCase();
            const token = String(request.token || "").trim();

            if (!domain || !token) {
                sendResponse({ success: false, authorized: false, error: "Missing domain or token." });
                return;
            }

            const authorized = await verifyResetToken(token, domain);
            if (!authorized) {
                sendResponse({ success: false, authorized: false, error: "Invalid or expired reset token." });
                return;
            }

            const isLimitBlocking = await isDomainLimitCurrentlyBlocking(domain);
            if (isLimitBlocking) {
                sendResponse({
                    success: false,
                    authorized: false,
                    error: "Cannot reset usage while this site is actively blocked by its limit."
                });
                return;
            }

            await sendAnalyticsEventSafe("domain_limit_reset_authorized", {
                domain_host: sanitizeAnalyticsText(domain, "unknown", 100)
            });

            sendResponse({ success: true, authorized: true });
        })().catch((error) => {
            sendResponse({
                success: false,
                authorized: false,
                error: error instanceof Error ? error.message : "Failed to verify reset token."
            });
        });
        return true;
    }

    if (request.action === "resetDomainLimit") {
        const domain = String(request.domain || "").trim().toLowerCase();
        if (!domain) {
            sendResponse({ success: false, error: "Domain is required." });
            return true;
        }

        (async () => {
            const reset = await resetDomainUsage(domain);
            if (!reset) {
                sendResponse({ success: false, error: "No resettable usage found for this domain." });
                return;
            }

            await sendAnalyticsEventSafe("domain_limit_reset", {
                domain_host: sanitizeAnalyticsText(domain, "unknown", 100)
            });

            sendResponse({ success: true });
        })().catch((error) => {
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : "Failed to reset domain limit."
            });
        });
        return true;
    }

    if (request.action === "exportUserData") {
        const format = String(request.format || "json").toLowerCase();
        (async () => {
            try {
                // Import GDPR utils if available
                let exportData;
                if (format === "csv") {
                    exportData = await GdprUtils?.exportDataAsCSV() || "CSV export not available";
                } else {
                    exportData = await GdprUtils?.exportDataAsJSON() || "{}";
                }
                
                sendResponse({
                    success: true,
                    data: exportData,
                    format: format,
                    exportedAt: new Date().toISOString()
                });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Export failed"
                });
            }
        })();
        return true;
    }

    if (request.action === "deleteUsageHistory") {
        const confirmed = Boolean(request.confirmed);
        if (!confirmed) {
            sendResponse({ success: false, error: "Deletion requires confirmation" });
            return true;
        }

        (async () => {
            try {
                await GdprUtils?.deleteUsageHistory?.();
                await sendAnalyticsEventSafe("user_action", {
                    action: "delete_usage_history"
                });
                sendResponse({ success: true, message: "Usage history deleted" });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Deletion failed"
                });
            }
        })();
        return true;
    }

    if (request.action === "deleteAnalyticsData") {
        const confirmed = Boolean(request.confirmed);
        if (!confirmed) {
            sendResponse({ success: false, error: "Deletion requires confirmation" });
            return true;
        }

        (async () => {
            try {
                await GdprUtils?.deleteAnalyticsData?.();
                sendResponse({ success: true, message: "Analytics data deleted" });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Deletion failed"
                });
            }
        })();
        return true;
    }

    if (request.action === "deleteAllData") {
        const confirmed = Boolean(request.confirmed);
        if (!confirmed) {
            sendResponse({ success: false, error: "Deletion requires explicit confirmation" });
            return true;
        }

        (async () => {
            try {
                await GdprUtils?.deleteAllUserData?.(true);
                sendResponse({ success: true, message: "All user data deleted" });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Deletion failed"
                });
            }
        })();
        return true;
    }

    if (request.action === "getDataSummary") {
        (async () => {
            try {
                const summary = await GdprUtils?.getDataSummary?.();
                sendResponse({ success: true, summary });
            } catch (error) {
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : "Failed to get data summary"
                });
            }
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
