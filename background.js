importScripts("shared-extension-utils.js");
importScripts("gdpr-utils.js");
importScripts("insights.js");

const {
    formatTimeSec,
    getDayKey,
    getOrCreateAnalyticsClientId
} = globalThis.StmSharedUtils || {};

const InsightEngine = globalThis.StmInsights || {};
const getInsightSettings = typeof InsightEngine.getInsightSettings === "function"
    ? InsightEngine.getInsightSettings
    : ((raw = {}) => {
        const maxNotifications = Number(raw.insightMaxNotificationsPerDay);
        const sensitivity = ["low", "normal", "high"].includes(String(raw.insightSensitivity || "").toLowerCase())
            ? String(raw.insightSensitivity).toLowerCase()
            : "normal";

        return {
            personalInsightsEnabled: raw.personalInsightsEnabled !== false,
            insightNotificationsEnabled: raw.insightNotificationsEnabled !== false,
            insightMaxNotificationsPerDay: Number.isFinite(maxNotifications) ? Math.max(0, Math.round(maxNotifications)) : 1,
            insightSensitivity: sensitivity
        };
    });
const analyzeUsagePatterns = typeof InsightEngine.analyzeUsagePatterns === "function"
    ? InsightEngine.analyzeUsagePatterns
    : (() => []);

function normalizeDomain(input) {
    const raw = String(input || "").trim().toLowerCase();
    if (!raw) return "";

    try {
        const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
        return new URL(withProtocol).hostname.replace(/^www\./, "");
    } catch {
        return raw.replace(/^www\./, "").split("/")[0];
    }
}

function isValidDomain(domain) {
    const value = normalizeDomain(domain);
    if (!value || value.length > 255 || value.includes("..")) return false;
    if (!/^[a-z0-9.-]+$/.test(value)) return false;
    return value.split(".").every((part) => part && !part.startsWith("-") && !part.endsWith("-"));
}

const KEYS = Object.freeze({
    blockedDomains: "blockedDomains",
    statsToday: "statsToday",
    allStatsToday: "allStatsToday",
    hourlyUsageHistory: "hourlyUsageHistory",
    dayKey: "statsDayKey",
    alertsSent: "alertsSent",
    scheduledBlocks: "scheduledBlocks",
    activeBlocks: "activeBlocks",
    snoozedDomains: "snoozedDomains",
    snoozeHistory: "snoozeHistory",
    statsHistory: "statsHistory",
    recentlyReset: "recentlyReset",
    activeSession: "activeSession",
    personalInsights: "personalInsights",
    dismissedInsights: "dismissedInsights",
    insightNotificationHistory: "insightNotificationHistory",
    insightNotificationDaily: "insightNotificationDaily",
    lastInsightNotificationDate: "lastInsightNotificationDate",
    lastInsightAnalysisAt: "lastInsightAnalysisAt",
    uiSettings: "uiSettings",
    onboarding: "onboardingState",
    onboardingMetrics: "onboardingMetrics",
    postInstallRedirectMeta: "postInstallRedirectMeta",
    enforceIntervalSec: "enforceIntervalSec"
});

const PREMIUM_KEY = "premiumState";
const ADMIN_OVERRIDE_KEY = "immutableAdminOverrideEnabled";
const ADMIN_OVERRIDE_LAST_USED_KEY = "immutableAdminOverrideLastUsedDay";
const ANALYTICS_EVENT_URL = "https://screen-time-manager.jackster0627.workers.dev/analytics/event";
const WHOP_VERIFY_URL = "https://screen-time-manager.jackster0627.workers.dev/whop/verify";
const WHOP_TOKEN_KEY = "whopAccessToken";
const WHOP_PENDING_TOKEN_KEY = "whopPendingToken";
const WHOP_LINK_STATE_KEY = "whopLinkState";
const WHOP_ACTIVATION_NOTICE_KEY = "whopActivationNotice";
const BROWSER_FOCUS_KEY = "browserFocusState";
const ALLOWED_EXTERNAL_ORIGIN = "https://screen-time-manager.jackster0627.workers.dev/";
const RESET_TOKEN_TTL_MS = 5000;
const STRICT_TOKEN_TTL_MS = 2 * 60 * 1000;
const RECENT_RESET_GRACE_MS = 5000;
const ENFORCEMENT_TIERS = Object.freeze(["lenient", "standard", "strict", "immutable"]);
const ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const DNR_RULE_ID_BASE = 1000000;
const DNR_RULE_ID_MAX = 1999999;
const DNR_DEFAULT_MAX_RULES = 1000;
const ACTIVE_LIMIT_ALARM_PREFIX = "activeLimitThreshold:";
const ACTIVE_LIMIT_BADGE_ALARM = "activeLimitBadgeTick";
const ACTIVE_LIMIT_WAKE_THRESHOLDS = Object.freeze([75, 90, 100]);
const ACTIVE_HEARTBEAT_MAX_DELTA_MS = 2 * 1000;
const INSIGHT_ANALYSIS_THROTTLE_MS = 5 * 60 * 1000;
const INSIGHT_NOTIFICATION_DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;
const INSIGHT_MAX_STORED = 24;
const DISMISSED_INSIGHT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const tokenCaches = {
    reset: new Map(),
    strict: new Map()
};
const alertClaims = new Set();
const insightNotificationClaims = new Set();
const snoozeEnforcementTimers = new Map();

let activeTabId = null;
let activeDomain = "";
let activeLastHeartbeatAt = 0;
let activeSessionStartedAt = 0;
let activeContextHydration = null;
let insightAnalysisPromise = null;
let lastInsightAnalysisAtMemory = 0;
let browserFocused = true;
let browserFocusStateLoaded = false;
let dnrRulesStateKey = "";
let dnrRulesSyncPromise = null;
let dnrRulesSyncQueued = false;
let dnrRulesSyncForceQueued = false;

async function get(keys) {
    return chrome.storage.local.get(keys);
}

async function set(items) {
    return chrome.storage.local.set(items);
}

function randomToken(prefix) {
    const id = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}_${id}`;
}

function pruneTokens(cache, now = Date.now()) {
    for (const [token, record] of cache.entries()) {
        if (!record || record.expiresAt <= now) cache.delete(token);
    }
}

async function createResetToken(domain) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return null;

    const token = randomToken("reset");
    tokenCaches.reset.set(token, {
        domain: normalized,
        expiresAt: Date.now() + RESET_TOKEN_TTL_MS
    });
    pruneTokens(tokenCaches.reset);
    return token;
}

async function verifyResetToken(token, domain) {
    const normalized = normalizeDomain(domain);
    const record = tokenCaches.reset.get(token);
    if (!record || !isValidDomain(normalized)) return false;

    tokenCaches.reset.delete(token);
    return record.domain === normalized && record.expiresAt > Date.now();
}

async function createStrictChallengeToken(domain, gameType = "math") {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return null;

    const token = randomToken("strict");
    tokenCaches.strict.set(token, {
        domain: normalized,
        gameType: String(gameType || "math"),
        expiresAt: Date.now() + STRICT_TOKEN_TTL_MS
    });
    pruneTokens(tokenCaches.strict);
    return token;
}

async function verifyStrictChallengeToken(token, domain) {
    const normalized = normalizeDomain(domain);
    const record = tokenCaches.strict.get(token);
    if (!record || !isValidDomain(normalized)) return false;

    tokenCaches.strict.delete(token);
    return record.domain === normalized && record.expiresAt > Date.now();
}

function normalizeTier(tier, fallback = "lenient") {
    const value = String(tier || "").toLowerCase();
    return ENFORCEMENT_TIERS.includes(value) ? value : fallback;
}

function normalizeLimitConfig(raw) {
    if (typeof raw === "number") {
        return { enabled: true, limitSeconds: Math.max(60, Math.round(raw * 60)), tier: "lenient" };
    }

    const limitSeconds = Number(raw?.limitSeconds ?? (Number(raw?.limitMinutes || 0) * 60));
    return {
        enabled: raw?.enabled !== false,
        limitSeconds: Number.isFinite(limitSeconds) && limitSeconds > 0
            ? Math.min(86400, Math.max(60, Math.round(limitSeconds)))
            : 0,
        tier: normalizeTier(raw?.tier, "lenient")
    };
}

function normalizeBlock(block = {}) {
    const domain = normalizeDomain(block.domain);
    return {
        id: String(block.id || `${domain}_${Date.now()}`),
        domain,
        startTime: String(block.startTime || "09:00"),
        endTime: String(block.endTime || "17:00"),
        days: normalizeDays(block.days),
        enabled: block.enabled !== false,
        tier: normalizeTier(block.tier, "standard")
    };
}

function normalizeDays(days) {
    const clean = Array.isArray(days)
        ? days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        : [];
    return clean.length ? Array.from(new Set(clean)) : [...ALL_DAYS];
}

function domainFromUrl(url) {
    try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) return "";
        return normalizeDomain(parsed.hostname);
    } catch {
        return "";
    }
}

function isOwnExtensionUrl(url) {
    try {
        const parsed = new URL(String(url || ""));
        const extensionRoot = new URL(chrome.runtime.getURL(""));
        return parsed.origin === extensionRoot.origin;
    } catch {
        return false;
    }
}

function originalUrlFromBlockedUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.searchParams.get("u") || "";
    } catch {
        return "";
    }
}

function safeOriginalUrlForDomain(domain, candidate) {
    const normalized = normalizeDomain(domain);
    const value = String(candidate || "").trim();
    if (!isValidDomain(normalized) || !value) return "";

    try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol)) return "";
        return normalizeDomain(parsed.hostname) === normalized ? parsed.toString() : "";
    } catch {
        return "";
    }
}

function redirectUrlForDomain(domain, request = {}, sender = {}) {
    const normalized = normalizeDomain(domain);
    const requestOriginal = safeOriginalUrlForDomain(normalized, request?.original);
    if (requestOriginal) return requestOriginal;

    const senderOriginal = safeOriginalUrlForDomain(
        normalized,
        originalUrlFromBlockedUrl(sender?.tab?.url || "")
    );
    return senderOriginal || `https://${normalized}/`;
}

function blockedUrl(domain, source = "limit", tier = "lenient", originalUrl = "") {
    const params = new URLSearchParams({
        d: domain,
        source,
        tier,
        eid: randomToken("block")
    });
    if (originalUrl) params.set("u", originalUrl);
    return chrome.runtime.getURL(`blocked.html?${params.toString()}`);
}

function blockedPageInfoFromUrl(url) {
    try {
        const parsed = new URL(String(url || ""));
        const blockedPage = new URL(chrome.runtime.getURL("blocked.html"));
        if (parsed.origin !== blockedPage.origin || parsed.pathname !== blockedPage.pathname) return null;

        const domain = normalizeDomain(parsed.searchParams.get("d"));
        const source = parsed.searchParams.get("source") === "scheduled" ? "scheduled" : "limit";
        const tier = normalizeTier(parsed.searchParams.get("tier"), "lenient");
        if (!isValidDomain(domain) || tier !== "immutable") return null;

        return {
            domain,
            source,
            tier,
            original: safeOriginalUrlForDomain(domain, parsed.searchParams.get("u"))
        };
    } catch {
        return null;
    }
}

function immutableScheduledBlockForDomain(domain, data = {}, now = Date.now()) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized) || isSnoozed(normalized, data[KEYS.snoozedDomains] || {}, now)) return null;

    const block = activeScheduledBlockFor(normalized, data[KEYS.activeBlocks] || []);
    if (!block || normalizeTier(block.tier, "standard") !== "immutable") return null;
    return { ...block, domain: normalized, source: "scheduled", tier: "immutable" };
}

function immutableLimitBlockForDomain(domain, data = {}, now = Date.now()) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return null;
    if (
        isSnoozed(normalized, data[KEYS.snoozedDomains] || {}, now)
        || wasRecentlyReset(normalized, data[KEYS.recentlyReset] || {}, now)
    ) {
        return null;
    }

    const config = normalizeLimitConfig(entryForDomain(data[KEYS.blockedDomains] || {}, normalized));
    const limitMs = config.enabled ? config.limitSeconds * 1000 : 0;
    if (!limitMs || config.tier !== "immutable") return null;

    const usedMs = activeLimitUsedMs(normalized, data[KEYS.statsToday] || {});
    if (usedMs < limitMs) return null;
    return { domain: normalized, source: "limit", tier: "immutable", limitSeconds: config.limitSeconds, usedMs };
}

function immutableBlockForDomain(domain, source, data = {}, now = Date.now()) {
    if (source === "scheduled") return immutableScheduledBlockForDomain(domain, data, now);
    if (source === "limit") return immutableLimitBlockForDomain(domain, data, now);
    return immutableScheduledBlockForDomain(domain, data, now) || immutableLimitBlockForDomain(domain, data, now);
}

function immutableOverrideUsedToday(lastUsedDay) {
    return String(lastUsedDay || "") === getDayKey();
}

function dnrApi() {
    return chrome.declarativeNetRequest;
}

function dnrSupported() {
    const api = dnrApi();
    return Boolean(api?.getDynamicRules && api?.updateDynamicRules);
}

function escapeDnrRegex(value) {
    return String(value || "").replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function isManagedDnrRule(rule) {
    const id = Number(rule?.id);
    return Number.isInteger(id) && id >= DNR_RULE_ID_BASE && id <= DNR_RULE_ID_MAX;
}

function dnrBlockedPagePath(domain, source, tier) {
    const params = new URLSearchParams({
        d: domain,
        source,
        tier,
        dnr: "1"
    });
    return `/blocked.html?${params.toString()}`;
}

function buildDnrRedirectRule(entry, id) {
    const domain = normalizeDomain(entry?.domain);
    const source = entry?.source === "scheduled" ? "scheduled" : "limit";
    const tier = normalizeTier(entry?.tier, source === "scheduled" ? "standard" : "lenient");

    return {
        id,
        priority: source === "scheduled" ? 20 : 10,
        action: {
            type: "redirect",
            redirect: {
                extensionPath: dnrBlockedPagePath(domain, source, tier)
            }
        },
        condition: {
            regexFilter: `^https?://(www\\.)?${escapeDnrRegex(domain)}([/:?#]|$)`,
            resourceTypes: ["main_frame"],
            requestMethods: ["get"]
        }
    };
}

function buildDnrBlockEntries(data = {}, now = Date.now()) {
    const blockedDomains = data[KEYS.blockedDomains] || {};
    const statsToday = data[KEYS.statsToday] || {};
    const snoozedDomains = data[KEYS.snoozedDomains] || {};
    const recentlyReset = data[KEYS.recentlyReset] || {};
    const entriesByDomain = new Map();

    for (const rawBlock of data[KEYS.activeBlocks] || []) {
        const block = normalizeBlock(rawBlock);
        const domain = normalizeDomain(block.domain);
        if (!isValidDomain(domain) || isSnoozed(domain, snoozedDomains, now)) continue;
        entriesByDomain.set(domain, {
            domain,
            source: "scheduled",
            tier: normalizeTier(block.tier, "standard")
        });
    }

    for (const [rawDomain, rawConfig] of Object.entries(blockedDomains)) {
        const domain = normalizeDomain(rawDomain);
        if (!isValidDomain(domain) || entriesByDomain.has(domain)) continue;

        const config = normalizeLimitConfig(rawConfig);
        const limitMs = config.enabled ? config.limitSeconds * 1000 : 0;
        const usedMs = entryTimeMs(entryForDomain(statsToday, domain) || {});
        if (
            limitMs > 0
            && usedMs >= limitMs
            && !isSnoozed(domain, snoozedDomains, now)
            && !wasRecentlyReset(domain, recentlyReset, now)
        ) {
            entriesByDomain.set(domain, {
                domain,
                source: "limit",
                tier: config.tier
            });
        }
    }

    return Array.from(entriesByDomain.values())
        .sort((a, b) => a.domain.localeCompare(b.domain) || a.source.localeCompare(b.source));
}

function dnrEntriesStateKey(entries) {
    return entries.map((entry) => `${entry.source}:${entry.domain}:${entry.tier}`).join("|");
}

async function readDnrRelevantState() {
    return get([
        KEYS.activeBlocks,
        KEYS.blockedDomains,
        KEYS.statsToday,
        KEYS.snoozedDomains,
        KEYS.recentlyReset
    ]);
}

async function syncDnrRules(options = {}) {
    if (!dnrSupported()) return false;

    const api = dnrApi();
    const entries = buildDnrBlockEntries(await readDnrRelevantState());
    const stateKey = dnrEntriesStateKey(entries);
    if (!options.force && stateKey === dnrRulesStateKey) return true;

    const maxRules = Math.max(
        0,
        Math.min(
            DNR_RULE_ID_MAX - DNR_RULE_ID_BASE + 1,
            Number(api.MAX_NUMBER_OF_REGEX_RULES || api.MAX_NUMBER_OF_DYNAMIC_RULES || DNR_DEFAULT_MAX_RULES)
        )
    );
    const nextRules = entries
        .slice(0, maxRules)
        .map((entry, index) => buildDnrRedirectRule(entry, DNR_RULE_ID_BASE + index));
    const currentRules = await api.getDynamicRules().catch(() => []);
    const removeRuleIds = (Array.isArray(currentRules) ? currentRules : [])
        .filter(isManagedDnrRule)
        .map((rule) => rule.id);

    if (!removeRuleIds.length && !nextRules.length) {
        dnrRulesStateKey = stateKey;
        return true;
    }

    await api.updateDynamicRules({
        removeRuleIds,
        addRules: nextRules
    });
    dnrRulesStateKey = stateKey;
    return true;
}

function queueDnrRulesSync(options = {}) {
    if (!dnrSupported()) return Promise.resolve(false);

    if (dnrRulesSyncPromise) {
        dnrRulesSyncQueued = true;
        dnrRulesSyncForceQueued = dnrRulesSyncForceQueued || Boolean(options.force);
        return dnrRulesSyncPromise;
    }

    dnrRulesSyncForceQueued = Boolean(options.force);
    dnrRulesSyncPromise = (async () => {
        do {
            const force = dnrRulesSyncForceQueued;
            dnrRulesSyncQueued = false;
            dnrRulesSyncForceQueued = false;
            await syncDnrRules({ force });
        } while (dnrRulesSyncQueued);
        return true;
    })().catch((error) => {
        console.warn("DNR rule sync failed", error);
        return false;
    }).finally(() => {
        dnrRulesSyncPromise = null;
    });

    return dnrRulesSyncPromise;
}

function dnrRelevantStorageChanged(changes = {}) {
    if (changes.activeBlocks || changes.blockedDomains || changes.statsToday || changes.recentlyReset) {
        return true;
    }

    if (!changes.snoozedDomains) return false;

    const oldSnoozes = changes.snoozedDomains.oldValue || {};
    const newSnoozes = changes.snoozedDomains.newValue || {};
    const domains = Array.from(new Set(
        [...Object.keys(oldSnoozes), ...Object.keys(newSnoozes)]
            .map(normalizeDomain)
            .filter(isValidDomain)
    ));

    if (!domains.length) return true;
    return domains.some((domain) => !snoozeEnforcementTimers.has(domain));
}

function activeLimitAlarmName(domain, threshold) {
    return `${ACTIVE_LIMIT_ALARM_PREFIX}${threshold}:${encodeURIComponent(normalizeDomain(domain))}`;
}

function parseActiveLimitAlarmName(name) {
    const raw = String(name || "");
    if (!raw.startsWith(ACTIVE_LIMIT_ALARM_PREFIX)) return null;

    const rest = raw.slice(ACTIVE_LIMIT_ALARM_PREFIX.length);
    const separator = rest.indexOf(":");
    if (separator < 0) return null;

    const threshold = Number(rest.slice(0, separator));
    const domain = normalizeDomain(decodeURIComponent(rest.slice(separator + 1)));
    if (!ACTIVE_LIMIT_WAKE_THRESHOLDS.includes(threshold) || !isValidDomain(domain)) return null;
    return { domain, threshold };
}

async function clearActiveLimitAlarms(domain = "") {
    const api = chrome.alarms;
    if (!api?.clear) return;

    const normalized = normalizeDomain(domain);
    if (isValidDomain(normalized)) {
        await Promise.all(ACTIVE_LIMIT_WAKE_THRESHOLDS.map((threshold) => (
            api.clear(activeLimitAlarmName(normalized, threshold)).catch(() => false)
        )));
        return;
    }

    await api.clear(ACTIVE_LIMIT_BADGE_ALARM).catch(() => false);
    if (!api.getAll) return;

    const alarms = await api.getAll().catch(() => []);
    await Promise.all((alarms || [])
        .filter((alarm) => String(alarm?.name || "").startsWith(ACTIVE_LIMIT_ALARM_PREFIX))
        .map((alarm) => api.clear(alarm.name).catch(() => false)));
}

function activeLimitUsedMs(domain, statsToday = {}) {
    return entryTimeMs(entryForDomain(statsToday, domain) || {});
}

async function scheduleActiveLimitWakeups(domain = activeDomain) {
    const api = chrome.alarms;
    if (!api?.create || !api?.clear) return false;

    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) {
        await clearActiveLimitAlarms();
        return false;
    }

    await clearActiveLimitAlarms(normalized);

    const data = await get([
        KEYS.activeBlocks,
        KEYS.blockedDomains,
        KEYS.statsToday,
        KEYS.snoozedDomains,
        KEYS.recentlyReset
    ]);
    const now = Date.now();
    const config = normalizeLimitConfig(entryForDomain(data[KEYS.blockedDomains] || {}, normalized));
    const limitMs = config.enabled ? config.limitSeconds * 1000 : 0;

    if (
        !limitMs
        || activeScheduledBlockFor(normalized, data[KEYS.activeBlocks] || [])
        || isSnoozed(normalized, data[KEYS.snoozedDomains] || {}, now)
        || wasRecentlyReset(normalized, data[KEYS.recentlyReset] || {}, now)
    ) {
        if (normalized === activeDomain) {
            await api.clear(ACTIVE_LIMIT_BADGE_ALARM).catch(() => false);
        }
        return false;
    }

    const usedMs = activeLimitUsedMs(normalized, data[KEYS.statsToday] || {});
    for (const threshold of ACTIVE_LIMIT_WAKE_THRESHOLDS) {
        const targetMs = limitMs * (threshold / 100);
        const delayMs = Math.ceil(targetMs - usedMs);
        if (delayMs > 0) {
            api.create(activeLimitAlarmName(normalized, threshold), { when: now + delayMs });
        }
    }

    if (normalized === activeDomain) {
        await api.clear(ACTIVE_LIMIT_BADGE_ALARM).catch(() => false);
    }

    return true;
}

async function handleActiveLimitWakeup(alarmName = "") {
    const alarmInfo = parseActiveLimitAlarmName(alarmName);
    await hydrateActiveContext({ countVisit: false, badge: false });
    await queueDnrRulesSync();
    await enforceIfNeeded();
    await syncActionBadge({ hydrate: false });

    if (alarmInfo?.domain && alarmInfo.domain !== activeDomain) {
        await clearActiveLimitAlarms(alarmInfo.domain);
    }
    await scheduleActiveLimitWakeups(activeDomain);
}

async function handleActivePageHeartbeat(sender = {}, request = {}) {
    const tabId = sender?.tab?.id;
    if (tabId == null) return { success: true, ignored: true };

    const tabUrl = String(sender?.tab?.url || "");
    const domain = domainFromUrl(tabUrl);
    if (!domain) return { success: true, ignored: true };

    const focusedHint = request?.pageFocused === true && request?.visibilityState === "visible";
    if (!focusedHint) {
        await pauseActiveTracking();
        return { success: true, ignored: true, reason: "browser-unfocused" };
    }

    const isActive = await isActiveHeartbeatTab(sender.tab);
    if (!isActive) return { success: true, ignored: true };

    if (!browserFocusStateLoaded || !browserFocused) {
        await setBrowserFocused(true);
    }

    const now = Date.now();
    const previousDomain = activeDomain;
    const previousHeartbeatAt = activeLastHeartbeatAt;
    const contextChanged = tabId !== activeTabId || domain !== activeDomain;
    const baselineOnly = contextChanged || !previousHeartbeatAt || request?.reason !== "interval";

    setActiveContext(tabId, domain, now);
    await persistActiveSession();

    if (previousDomain && previousDomain !== domain) {
        await clearActiveLimitAlarms(previousDomain);
    }

    let countedMs = 0;
    if (!baselineOnly) {
        countedMs = Math.min(ACTIVE_HEARTBEAT_MAX_DELTA_MS, Math.max(0, now - previousHeartbeatAt));
        if (countedMs > 0) {
            await updateDomainActivity(domain, { deltaMs: countedMs, startMs: now - countedMs, endMs: now });
        }
    }

    await enforceIfNeeded(tabId);
    if (!countedMs) {
        await queueDnrRulesSync();
        await scheduleActiveLimitWakeups(domain);
    }
    await syncActionBadge({ hydrate: false });
    return { success: true, domain, countedMs };
}

function entryTimeMs(entry = {}) {
    if (Number.isFinite(entry.timeMs)) return Number(entry.timeMs);
    if (Number.isFinite(entry.timeSec)) return Number(entry.timeSec) * 1000;
    return 0;
}

function addUsage(stats, domain, deltaMs, countVisit = false) {
    if (!domain || deltaMs < 0) return stats;
    const current = stats[domain] || {};
    stats[domain] = {
        timeMs: entryTimeMs(current) + deltaMs,
        visits: Number(current.visits || 0) + (countVisit ? 1 : 0)
    };
    return stats;
}

function addHourlyUsage(history, domain, startMs, endMs, countVisit = false) {
    if (!domain || endMs <= startMs) return history;

    let cursor = startMs;
    while (cursor < endMs) {
        const date = new Date(cursor);
        const day = getDayKey(date);
        const hour = String(date.getHours()).padStart(2, "0");
        const nextHour = new Date(date);
        nextHour.setMinutes(60, 0, 0);
        const sliceEnd = Math.min(endMs, nextHour.getTime());

        history[day] ||= {};
        history[day][hour] ||= { timeMs: 0, visits: 0, domains: {}, domainVisits: {} };
        history[day][hour].timeMs += sliceEnd - cursor;
        history[day][hour].visits += countVisit ? 1 : 0;
        history[day][hour].domains[domain] = (history[day][hour].domains[domain] || 0) + (sliceEnd - cursor);
        if (countVisit) {
            history[day][hour].domainVisits ||= {};
            history[day][hour].domainVisits[domain] = (history[day][hour].domainVisits[domain] || 0) + 1;
        }

        countVisit = false;
        cursor = sliceEnd;
    }

    return history;
}

async function ensureDayReset() {
    const today = getDayKey();
    const data = await get([KEYS.dayKey, KEYS.statsToday, KEYS.statsHistory]);
    if (!data[KEYS.dayKey]) {
        await set({ [KEYS.dayKey]: today });
        return;
    }
    if (data[KEYS.dayKey] === today) return;

    const history = data[KEYS.statsHistory] || {};
    history[data[KEYS.dayKey]] = data[KEYS.statsToday] || {};
    await set({
        [KEYS.dayKey]: today,
        [KEYS.statsHistory]: history,
        [KEYS.statsToday]: {},
        [KEYS.allStatsToday]: {},
        [KEYS.alertsSent]: {},
        [KEYS.snoozeHistory]: {}
    });
    await queueDnrRulesSync();
}

async function updateDomainActivity(domain, options = {}) {
    const normalized = normalizeDomain(domain);
    const deltaMs = Math.max(0, Math.round(Number(options.deltaMs || 0)));
    const countVisit = Boolean(options.countVisit);
    if (!isValidDomain(normalized) || (deltaMs <= 0 && !countVisit)) return;

    await ensureDayReset();
    const data = await get([KEYS.statsToday, KEYS.allStatsToday, KEYS.hourlyUsageHistory]);
    const startMs = Number(options.startMs || Date.now() - deltaMs);
    const endMs = Number(options.endMs || Date.now());

    await set({
        [KEYS.statsToday]: addUsage(data[KEYS.statsToday] || {}, normalized, deltaMs, countVisit),
        [KEYS.allStatsToday]: addUsage(data[KEYS.allStatsToday] || {}, normalized, deltaMs, countVisit),
        [KEYS.hourlyUsageHistory]: addHourlyUsage(data[KEYS.hourlyUsageHistory] || {}, normalized, startMs, endMs, countVisit)
    });

    const fresh = await get([KEYS.blockedDomains, KEYS.statsToday]);
    await checkAndSendAlerts(normalized, fresh[KEYS.blockedDomains] || {}, fresh[KEYS.statsToday] || {});
    await maybeGenerateInsightsAfterActivity({ allowNotifications: true });
    await queueDnrRulesSync();
    if (normalized === activeDomain) {
        await scheduleActiveLimitWakeups(normalized);
    }
}

function activeSessionRecord() {
    return activeDomain
        ? {
            tabId: activeTabId,
            domain: activeDomain,
            startedAt: activeSessionStartedAt || activeLastHeartbeatAt || 0,
            lastHeartbeatAt: activeLastHeartbeatAt || 0
        }
        : null;
}

function setActiveContext(tabId, domain, lastHeartbeatAt = 0) {
    const numericTabId = tabId == null ? NaN : Number(tabId);
    const nextTabId = Number.isFinite(numericTabId) ? numericTabId : null;
    const nextDomain = normalizeDomain(domain);
    const sameSession = nextDomain && nextDomain === activeDomain && nextTabId === activeTabId;

    activeTabId = nextTabId;
    activeDomain = nextDomain;
    activeLastHeartbeatAt = Number.isFinite(lastHeartbeatAt) ? Math.max(0, lastHeartbeatAt) : 0;
    if (!activeDomain) {
        activeSessionStartedAt = 0;
    } else if (!sameSession || !activeSessionStartedAt) {
        activeSessionStartedAt = activeLastHeartbeatAt || Date.now();
    }
}

function clearActiveSessionState() {
    activeTabId = null;
    activeDomain = "";
    activeLastHeartbeatAt = 0;
    activeSessionStartedAt = 0;
}

async function persistActiveSession(record = activeSessionRecord()) {
    await set({ [KEYS.activeSession]: record });
}

async function restoreActiveSession() {
    if (activeDomain) return true;

    const data = await get([KEYS.activeSession]);
    const session = data[KEYS.activeSession] || {};
    const domain = normalizeDomain(session.domain);
    if (!isValidDomain(domain)) return false;

    const tabId = Number(session.tabId);
    const lastHeartbeatAt = Number(session.lastHeartbeatAt || session.startedAt || 0);
    const startedAt = Number(session.startedAt || lastHeartbeatAt || 0);
    setActiveContext(tabId, domain, Number.isFinite(lastHeartbeatAt) ? lastHeartbeatAt : 0);
    if (Number.isFinite(startedAt) && startedAt > 0) {
        activeSessionStartedAt = startedAt;
    }
    return true;
}

async function clearActiveSession() {
    clearActiveSessionState();
    await persistActiveSession(null);
}

async function pauseActiveTracking() {
    clearActiveSessionState();
    await Promise.all([
        persistActiveSession(null),
        clearActiveLimitAlarms()
    ]);
}

async function flushTime() {
    if (!activeDomain) await restoreActiveSession();
    await persistActiveSession();
}

async function flushPopupActiveTick() {
    if (!(await isBrowserFocused())) return 0;
    if (!activeDomain) await restoreActiveSession();
    if (!isValidDomain(activeDomain)) return 0;

    const now = Date.now();
    const previousHeartbeatAt = Number(activeLastHeartbeatAt || 0);
    setActiveContext(activeTabId, activeDomain, now);
    await persistActiveSession();

    if (!previousHeartbeatAt) return 0;

    const deltaMs = Math.min(ACTIVE_HEARTBEAT_MAX_DELTA_MS, Math.max(0, now - previousHeartbeatAt));
    if (deltaMs > 0) {
        await updateDomainActivity(activeDomain, {
            deltaMs,
            startMs: now - deltaMs,
            endMs: now
        });
    }
    return deltaMs;
}

async function setActiveDomain(tabId, countVisit = false, options = {}) {
    const shouldEnforce = options.enforce !== false;
    const shouldBadge = options.badge !== false;
    const previousDomain = activeDomain;
    if (!(await isBrowserFocused())) {
        await clearActiveLimitAlarms();
        await clearActiveSession();
        return;
    }

    const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
    const domain = domainFromUrl(tab?.url || "");
    setActiveContext(tabId, domain, 0);
    await persistActiveSession();

    if (domain && countVisit) {
        await updateDomainActivity(domain, { deltaMs: 0, countVisit: true });
    }
    if (previousDomain && previousDomain !== domain) {
        await clearActiveLimitAlarms(previousDomain);
    }
    await scheduleActiveLimitWakeups(domain);
    if (shouldEnforce) await enforceIfNeeded(tabId);
    if (shouldBadge) await syncActionBadge({ hydrate: false });
}

async function currentActiveTab(options = {}) {
    const skipOwnExtension = Boolean(options.skipOwnExtension);
    const queries = [
        { active: true, lastFocusedWindow: true },
        { active: true, currentWindow: true },
        { active: true }
    ];

    for (const query of queries) {
        const tabs = await chrome.tabs.query(query).catch(() => []);
        for (const tab of tabs || []) {
            if (skipOwnExtension && isOwnExtensionUrl(tab.url)) continue;
            if (tab) return tab;
        }
    }
    return null;
}

async function isBrowserFocused() {
    if (browserFocusStateLoaded) return browserFocused;

    const data = await get([BROWSER_FOCUS_KEY]).catch(() => ({}));
    const stored = data?.[BROWSER_FOCUS_KEY];
    if (typeof stored?.focused === "boolean") {
        browserFocused = stored.focused;
    }
    browserFocusStateLoaded = true;
    return browserFocused;
}

async function setBrowserFocused(focused) {
    browserFocused = Boolean(focused);
    browserFocusStateLoaded = true;
    await set({
        [BROWSER_FOCUS_KEY]: {
            focused: browserFocused,
            updatedAt: Date.now()
        }
    }).catch(() => {});
    return browserFocused;
}

async function isCurrentActiveTabId(tabId) {
    const tab = await currentActiveTab();
    return tab?.id === tabId;
}

async function isActiveHeartbeatTab(tab = {}) {
    if (tab?.id == null) return false;
    if (tab.active === true) return true;

    const windowId = Number(tab.windowId);
    if (Number.isFinite(windowId) && windowId >= 0) {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
        if (activeTab?.id === tab.id) return true;
    }

    return isCurrentActiveTabId(tab.id);
}

async function hydrateActiveContext({ countVisit = false, badge = false, force = false, preserveOwnExtensionContext = false } = {}) {
    if (!activeContextHydration) {
        activeContextHydration = (async () => {
            const tab = await currentActiveTab({ skipOwnExtension: preserveOwnExtensionContext });
            if (!tab) {
                if (!activeDomain) await restoreActiveSession();
                return null;
            }

            const domain = domainFromUrl(tab.url || "");
            if (force || tab.id !== activeTabId || domain !== activeDomain) {
                await setActiveDomain(tab.id ?? null, countVisit, { enforce: false, badge });
            }
            return tab;
        })().finally(() => {
            activeContextHydration = null;
        });
    }
    return activeContextHydration;
}

async function initActive(countVisit = false, options = {}) {
    await hydrateActiveContext({ countVisit, badge: false });
    if (options.enforce !== false) await enforceIfNeeded();
    await scheduleActiveLimitWakeups(activeDomain);
    await syncActionBadge({ hydrate: false });
}

async function activeImmutableOverrideTarget() {
    const tab = await currentActiveTab();
    const pageInfo = blockedPageInfoFromUrl(tab?.url || "");
    if (!pageInfo) return null;

    const data = await get([
        KEYS.activeBlocks,
        KEYS.blockedDomains,
        KEYS.statsToday,
        KEYS.snoozedDomains,
        KEYS.recentlyReset,
        ADMIN_OVERRIDE_LAST_USED_KEY
    ]);
    const block = immutableBlockForDomain(pageInfo.domain, pageInfo.source, data);
    if (!block) return null;

    return {
        ...block,
        tabId: tab?.id ?? null,
        tabUrl: tab?.url || "",
        original: pageInfo.original,
        label: pageInfo.source === "scheduled" ? "scheduled block" : "daily limit",
        overrideUsedToday: immutableOverrideUsedToday(data[ADMIN_OVERRIDE_LAST_USED_KEY])
    };
}

async function getImmutableOverrideState() {
    const target = await activeImmutableOverrideTarget();
    if (!target) {
        return {
            available: false,
            message: "Available only while this tab is blocked by an active immutable rule."
        };
    }

    if (target.overrideUsedToday) {
        return {
            available: false,
            usedToday: true,
            domain: target.domain,
            source: target.source,
            label: target.label,
            message: "Emergency override already used today."
        };
    }

    return {
        available: true,
        domain: target.domain,
        source: target.source,
        label: target.label,
        message: `Immutable ${target.label} active for ${target.domain}.`
    };
}

async function useImmutableOverrideForTarget(target) {
    if (!target || !isValidDomain(target.domain)) {
        return { success: false, error: "No active immutable block found." };
    }

    const usage = await get([ADMIN_OVERRIDE_LAST_USED_KEY]);
    if (immutableOverrideUsedToday(usage[ADMIN_OVERRIDE_LAST_USED_KEY])) {
        await set({ [ADMIN_OVERRIDE_KEY]: false }).catch(() => {});
        return { success: false, usedToday: true, error: "Emergency override already used today." };
    }

    const redirectUrl = redirectUrlForDomain(
        target.domain,
        { original: target.original },
        { tab: { url: target.tabUrl } }
    );

    if (target.source === "scheduled") {
        const data = await get([KEYS.activeBlocks, KEYS.scheduledBlocks]);
        const activeBlocks = data[KEYS.activeBlocks] || [];
        const removed = [];
        const nextActiveBlocks = activeBlocks.filter((block) => {
            const matches = normalizeDomain(block.domain) === target.domain
                && normalizeTier(block.tier, "standard") === "immutable";
            if (matches) removed.push(block);
            return !matches;
        });

        if (!removed.length) {
            return { success: false, error: "No active immutable block found." };
        }

        await set({ [KEYS.activeBlocks]: nextActiveBlocks });
        await queueDnrRulesSync();
        await scheduleActiveLimitWakeups(target.domain);

        const scheduled = data[KEYS.scheduledBlocks] || [];
        await Promise.all(removed.map(async (block) => {
            const schedule = scheduled.find((item) => item.id === block.id);
            if (schedule) await scheduleBlockAlarms(normalizeBlock(schedule));
        }));
    } else {
        const reset = await resetDomainUsage(target.domain);
        if (!reset) return { success: false, error: "No active immutable block found." };
    }

    await set({
        [ADMIN_OVERRIDE_KEY]: false,
        [ADMIN_OVERRIDE_LAST_USED_KEY]: getDayKey()
    });

    let redirected = false;
    if (target.tabId != null) {
        redirected = Boolean(await chrome.tabs.update(target.tabId, { url: redirectUrl }).then(() => true).catch(() => false));
    }

    return {
        success: true,
        domain: target.domain,
        source: target.source,
        redirectUrl,
        redirected
    };
}

async function useImmutableOverrideFromActiveTab() {
    const target = await activeImmutableOverrideTarget();
    if (!target) {
        await set({ [ADMIN_OVERRIDE_KEY]: false }).catch(() => {});
        return {
            success: false,
            error: "Open an active immutable block page before using the emergency override."
        };
    }

    return useImmutableOverrideForTarget(target);
}

function domainKeysFor(records = {}, domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return [];
    return Object.keys(records).filter((key) => normalizeDomain(key) === normalized);
}

function entryForDomain(records = {}, domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return undefined;
    if (Object.prototype.hasOwnProperty.call(records, normalized)) {
        return records[normalized];
    }
    const matchingKey = domainKeysFor(records, normalized)[0];
    return matchingKey ? records[matchingKey] : undefined;
}

function limitMsFor(domain, blockedDomains = {}) {
    const config = normalizeLimitConfig(entryForDomain(blockedDomains, domain));
    return config.enabled ? config.limitSeconds * 1000 : 0;
}

function limitMsFromConfig(raw) {
    const config = normalizeLimitConfig(raw);
    return config.enabled ? config.limitSeconds * 1000 : 0;
}

function limitNotificationsEnabled(settings = {}) {
    return settings.limitNotificationsEnabled !== false;
}

function isSnoozed(domain, snoozedDomains = {}, now = Date.now()) {
    const entry = entryForDomain(snoozedDomains, domain);
    const expiresAt = typeof entry === "object" ? Number(entry.expiresAt || 0) : Number(entry || 0);
    return Number.isFinite(expiresAt) && expiresAt > now;
}

function deleteSnoozeEntriesForDomain(snoozedDomains = {}, domain) {
    const removed = [];
    domainKeysFor(snoozedDomains, domain).forEach((key) => {
        delete snoozedDomains[key];
        removed.push(key);
    });
    return removed;
}

function wasRecentlyReset(domain, recentlyReset = {}, now = Date.now()) {
    const ts = Number(recentlyReset[domain] || 0);
    return Number.isFinite(ts) && ts > 0 && now - ts < RECENT_RESET_GRACE_MS;
}

async function isDomainLimitCurrentlyBlocking(domain) {
    const data = await get([KEYS.blockedDomains, KEYS.statsToday, KEYS.snoozedDomains, KEYS.recentlyReset]);
    const usedMs = entryTimeMs(data[KEYS.statsToday]?.[domain] || {});
    const limitMs = limitMsFor(domain, data[KEYS.blockedDomains] || {});
    return limitMs > 0
        && usedMs >= limitMs
        && !isSnoozed(domain, data[KEYS.snoozedDomains] || {})
        && !wasRecentlyReset(domain, data[KEYS.recentlyReset] || {});
}

function activeScheduledBlockFor(domain, activeBlocks = []) {
    return activeBlocks.find((block) => normalizeDomain(block.domain) === domain);
}

async function enforceIfNeeded(tabId = activeTabId) {
    if (tabId == null) return false;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const domain = domainFromUrl(tab?.url || "");
    if (!domain) return false;

    const data = await get([
        KEYS.activeBlocks,
        KEYS.blockedDomains,
        KEYS.statsToday,
        KEYS.snoozedDomains,
        KEYS.recentlyReset
    ]);

    const scheduled = activeScheduledBlockFor(domain, data[KEYS.activeBlocks] || []);
    if (scheduled && !isSnoozed(domain, data[KEYS.snoozedDomains] || {})) {
        await chrome.tabs.update(tabId, {
            url: blockedUrl(domain, "scheduled", normalizeTier(scheduled.tier, "standard"), tab.url)
        }).catch(() => {});
        return true;
    }

    if (await isDomainLimitCurrentlyBlocking(domain)) {
        const tier = normalizeLimitConfig(entryForDomain(data[KEYS.blockedDomains] || {}, domain)).tier;
        await chrome.tabs.update(tabId, { url: blockedUrl(domain, "limit", tier, tab.url) }).catch(() => {});
        return true;
    }

    return false;
}

async function redirectOpenTabsForDomain(domain, source, tier) {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    await Promise.all(tabs.map(async (tab) => {
        if (domainFromUrl(tab.url || "") === domain) {
            await chrome.tabs.update(tab.id, { url: blockedUrl(domain, source, tier, tab.url) }).catch(() => {});
        }
    }));
}

async function enforceDomainAfterSnoozeCleared(domain) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return false;

    const data = await get([
        KEYS.activeBlocks,
        KEYS.blockedDomains,
        KEYS.statsToday,
        KEYS.snoozedDomains,
        KEYS.recentlyReset
    ]);

    if (isSnoozed(normalized, data[KEYS.snoozedDomains] || {})) {
        await queueDnrRulesSync();
        await scheduleActiveLimitWakeups(normalized);
        await enforceIfNeeded();
        return false;
    }

    const scheduled = activeScheduledBlockFor(normalized, data[KEYS.activeBlocks] || []);
    if (scheduled) {
        await queueDnrRulesSync();
        await clearActiveLimitAlarms(normalized);
        await redirectOpenTabsForDomain(normalized, "scheduled", normalizeTier(scheduled.tier, "standard"));
        await enforceIfNeeded();
        return true;
    }

    const config = normalizeLimitConfig(entryForDomain(data[KEYS.blockedDomains] || {}, normalized));
    const limitMs = config.enabled ? config.limitSeconds * 1000 : 0;
    const usedMs = entryTimeMs(data[KEYS.statsToday]?.[normalized] || {});
    if (limitMs > 0 && usedMs >= limitMs && !wasRecentlyReset(normalized, data[KEYS.recentlyReset] || {})) {
        await queueDnrRulesSync();
        await scheduleActiveLimitWakeups(normalized);
        await redirectOpenTabsForDomain(normalized, "limit", config.tier);
        await enforceIfNeeded();
        return true;
    }

    await queueDnrRulesSync();
    await scheduleActiveLimitWakeups(normalized);
    await enforceIfNeeded();
    return false;
}

function scheduleSnoozeEnforcement(domain, delayMs = 0) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return false;

    const existing = snoozeEnforcementTimers.get(normalized);
    if (existing) clearTimeout(existing);

    const run = () => {
        snoozeEnforcementTimers.delete(normalized);
        enforceDomainAfterSnoozeCleared(normalized).catch(() => {});
    };

    const delay = Math.max(0, Math.min(5000, Number(delayMs) || 0));
    if (!delay) {
        run();
        return true;
    }

    snoozeEnforcementTimers.set(normalized, setTimeout(run, delay));
    return true;
}

async function checkAndSendAlerts(domain, blockedDomains, statsToday) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return;

    const limitMs = limitMsFromConfig(entryForDomain(blockedDomains, normalized) ?? blockedDomains?.[domain]);
    if (!limitMs) return;

    const usedMs = entryTimeMs(statsToday?.[normalized] || statsToday?.[domain] || {});
    const percent = Math.floor((usedMs / limitMs) * 100);
    const threshold = percent >= 90 ? 90 : percent >= 75 ? 75 : 0;
    if (!threshold) return;

    const alertKey = `${normalized}:${threshold}`;
    if (alertClaims.has(alertKey)) return;
    alertClaims.add(alertKey);

    try {
        const data = await get([KEYS.alertsSent, KEYS.uiSettings]);
        if (!limitNotificationsEnabled(data[KEYS.uiSettings] || {})) return;

        const alertsSent = data[KEYS.alertsSent] || {};
        alertsSent[normalized] ||= {};
        if (alertsSent[normalized][threshold]) return;

        alertsSent[normalized][threshold] = true;
        await set({ [KEYS.alertsSent]: alertsSent });

        await chrome.notifications?.create?.(`stmalert:${normalized}:${threshold}`, {
            type: "basic",
            iconUrl: "new_logo.png",
            title: `${threshold}% of ${normalized} limit used`,
            message: `${formatTimeSec(Math.round(usedMs / 1000))} used today.`
        });
    } finally {
        alertClaims.delete(alertKey);
    }
}

function normalizeInsightRecord(insight = {}) {
    if (!insight || typeof insight !== "object") return null;
    const type = String(insight.type || "").trim();
    const domain = normalizeDomain(insight.domain);
    const id = String(insight.id || `${type}:${domain}:${getDayKey()}`).trim();
    if (!id || !type || !isValidDomain(domain)) return null;

    return {
        id,
        type,
        domain,
        title: String(insight.title || "Personal insight").slice(0, 80),
        message: String(insight.message || "").slice(0, 220),
        action: insight.action === "addLimit" ? "addLimit" : "viewUsage",
        priority: Number(insight.priority || 0),
        notify: Boolean(insight.notify),
        timestamp: Number(insight.timestamp || Date.now()),
        dateKey: String(insight.dateKey || getDayKey()),
        context: typeof insight.context === "object" && insight.context ? insight.context : {}
    };
}

function pruneDismissedInsights(dismissed = {}, now = Date.now()) {
    return Object.entries(dismissed || {}).reduce((result, [id, timestamp]) => {
        const dismissedAt = Number(timestamp || 0);
        if (Number.isFinite(dismissedAt) && now - dismissedAt < DISMISSED_INSIGHT_TTL_MS) {
            result[id] = dismissedAt;
        }
        return result;
    }, {});
}

function mergeInsightList(existing = [], insight, dismissed = {}) {
    const normalized = normalizeInsightRecord(insight);
    if (!normalized || dismissed[normalized.id]) return existing.filter(Boolean).map(normalizeInsightRecord).filter(Boolean);

    const byId = new Map();
    existing.forEach((item) => {
        const record = normalizeInsightRecord(item);
        if (record && !dismissed[record.id]) byId.set(record.id, record);
    });
    byId.set(normalized.id, {
        ...byId.get(normalized.id),
        ...normalized,
        timestamp: Math.max(Number(byId.get(normalized.id)?.timestamp || 0), normalized.timestamp)
    });

    return Array.from(byId.values())
        .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .slice(0, INSIGHT_MAX_STORED);
}

async function saveInsight(insight) {
    const data = await get([KEYS.personalInsights, KEYS.dismissedInsights]);
    const dismissed = pruneDismissedInsights(data[KEYS.dismissedInsights] || {});
    const personalInsights = mergeInsightList(data[KEYS.personalInsights] || [], insight, dismissed);
    await set({
        [KEYS.personalInsights]: personalInsights,
        [KEYS.dismissedInsights]: dismissed
    });
    return normalizeInsightRecord(insight);
}

async function dismissInsight(id) {
    const insightId = String(id || "").trim();
    if (!insightId) return { success: false, error: "Missing insight id." };

    const data = await get([KEYS.personalInsights, KEYS.dismissedInsights]);
    const dismissed = pruneDismissedInsights(data[KEYS.dismissedInsights] || {});
    dismissed[insightId] = Date.now();
    await set({
        [KEYS.personalInsights]: (data[KEYS.personalInsights] || []).filter((insight) => insight?.id !== insightId),
        [KEYS.dismissedInsights]: dismissed
    });
    return { success: true, id: insightId };
}

function notificationKeyForInsight(insight = {}) {
    const record = normalizeInsightRecord(insight);
    return record ? `${record.type}:${record.domain}` : "";
}

async function shouldSendNotification(insight, options = {}) {
    const record = normalizeInsightRecord(insight);
    if (!record?.notify) return false;
    if (!chrome.notifications?.create) return false;

    const now = Number(options.now || Date.now());
    const settings = getInsightSettings(options.settings || (await get([KEYS.uiSettings]))[KEYS.uiSettings] || {});
    if (!settings.personalInsightsEnabled || !settings.insightNotificationsEnabled) return false;
    if (settings.insightMaxNotificationsPerDay <= 0) return false;

    const data = options.data || await get([
        KEYS.insightNotificationHistory,
        KEYS.insightNotificationDaily
    ]);
    const today = getDayKey(new Date(now));
    const daily = data[KEYS.insightNotificationDaily] || {};
    const todaysCount = daily.date === today ? Number(daily.count || 0) : 0;
    if (todaysCount >= settings.insightMaxNotificationsPerDay) return false;

    const history = data[KEYS.insightNotificationHistory] || {};
    const notificationKey = notificationKeyForInsight(record);
    const lastSentAt = Number(history[notificationKey] || 0);
    return !lastSentAt || now - lastSentAt >= INSIGHT_NOTIFICATION_DEDUPE_MS;
}

async function sendPatternNotification(insight, options = {}) {
    const record = normalizeInsightRecord(insight);
    const notificationKey = notificationKeyForInsight(record);
    if (!record || !notificationKey || insightNotificationClaims.has(notificationKey)) return false;

    insightNotificationClaims.add(notificationKey);
    try {
        const data = await get([
            KEYS.uiSettings,
            KEYS.insightNotificationHistory,
            KEYS.insightNotificationDaily
        ]);
        const settings = getInsightSettings(data[KEYS.uiSettings] || {});
        const now = Number(options.now || Date.now());
        if (!(await shouldSendNotification(record, { ...options, now, settings, data }))) return false;

        try {
            await chrome.notifications.create(`stminsight:${record.id}:${now}`, {
                type: "basic",
                iconUrl: "new_logo.png",
                title: record.title,
                message: record.message
            });
        } catch (error) {
            console.warn("Insight notification failed", error);
            return false;
        }

        const today = getDayKey(new Date(now));
        const daily = data[KEYS.insightNotificationDaily] || {};
        const count = daily.date === today ? Number(daily.count || 0) : 0;
        await set({
            [KEYS.insightNotificationHistory]: {
                ...(data[KEYS.insightNotificationHistory] || {}),
                [notificationKey]: now
            },
            [KEYS.insightNotificationDaily]: {
                date: today,
                count: count + 1,
                lastAt: now
            },
            [KEYS.lastInsightNotificationDate]: today
        });

        return true;
    } finally {
        insightNotificationClaims.delete(notificationKey);
    }
}

async function generateInsights(options = {}) {
    await ensureDayReset();
    const data = await get([
        KEYS.statsToday,
        KEYS.allStatsToday,
        KEYS.statsHistory,
        KEYS.hourlyUsageHistory,
        KEYS.blockedDomains,
        KEYS.activeSession,
        KEYS.personalInsights,
        KEYS.dismissedInsights,
        KEYS.uiSettings
    ]);
    const settings = getInsightSettings(data[KEYS.uiSettings] || {});
    const now = Number(options.now || Date.now());
    const dismissed = pruneDismissedInsights(data[KEYS.dismissedInsights] || {}, now);

    if (!settings.personalInsightsEnabled) {
        await set({ [KEYS.dismissedInsights]: dismissed });
        return { success: true, insights: [] };
    }

    const generated = analyzeUsagePatterns({
        statsToday: data[KEYS.statsToday] || {},
        allStatsToday: data[KEYS.allStatsToday] || data[KEYS.statsToday] || {},
        statsHistory: data[KEYS.statsHistory] || {},
        hourlyUsageHistory: data[KEYS.hourlyUsageHistory] || {},
        blockedDomains: data[KEYS.blockedDomains] || {},
        activeSession: data[KEYS.activeSession] || activeSessionRecord(),
        settings,
        now
    }).map(normalizeInsightRecord).filter(Boolean);

    let personalInsights = [];
    generated.forEach((insight) => {
        personalInsights = mergeInsightList(personalInsights, insight, dismissed);
    });

    await set({
        [KEYS.personalInsights]: personalInsights,
        [KEYS.dismissedInsights]: dismissed,
        [KEYS.lastInsightAnalysisAt]: now
    });

    if (options.allowNotifications !== false) {
        for (const insight of generated) {
            if (await sendPatternNotification(insight, { now, settings })) break;
        }
    }

    return { success: true, insights: personalInsights };
}

async function maybeGenerateInsightsAfterActivity(options = {}) {
    const now = Number(options.now || Date.now());
    if (!options.force && now - lastInsightAnalysisAtMemory < INSIGHT_ANALYSIS_THROTTLE_MS) {
        return false;
    }

    const data = await get([KEYS.lastInsightAnalysisAt, KEYS.uiSettings]);
    const settings = getInsightSettings(data[KEYS.uiSettings] || {});
    if (!settings.personalInsightsEnabled) return false;

    const lastStored = Number(data[KEYS.lastInsightAnalysisAt] || 0);
    if (!options.force && lastStored && now - lastStored < INSIGHT_ANALYSIS_THROTTLE_MS) {
        lastInsightAnalysisAtMemory = Math.max(lastInsightAnalysisAtMemory, lastStored);
        return false;
    }

    if (!insightAnalysisPromise) {
        lastInsightAnalysisAtMemory = now;
        insightAnalysisPromise = generateInsights({
            now,
            allowNotifications: options.allowNotifications !== false
        }).catch((error) => {
            console.warn("Insight generation failed", error);
            return false;
        }).finally(() => {
            insightAnalysisPromise = null;
        });
    }

    return insightAnalysisPromise;
}

async function syncActionBadge(options = {}) {
    if (!chrome.action?.setBadgeText) return;
    if (options.hydrate !== false && (!activeDomain || options.recheckActiveTab)) {
        await hydrateActiveContext({
            countVisit: false,
            badge: false
        });
    }
    if (!activeDomain) {
        await chrome.action.setBadgeText({ text: "" }).catch(() => {});
        return;
    }

    const data = await get([KEYS.blockedDomains, KEYS.statsToday, KEYS.snoozedDomains]);
    if (isSnoozed(activeDomain, data[KEYS.snoozedDomains] || {})) {
        await chrome.action.setBadgeBackgroundColor?.({ color: "#6b7280" }).catch(() => {});
        await chrome.action.setBadgeText({ text: "II" }).catch(() => {});
        return;
    }

    const limitMs = limitMsFor(activeDomain, data[KEYS.blockedDomains] || {});
    const usedMs = activeLimitUsedMs(activeDomain, data[KEYS.statsToday] || {});
    const text = limitMs ? `${Math.min(99, Math.round((usedMs / limitMs) * 100))}%` : "";

    await chrome.action.setBadgeBackgroundColor?.({ color: "#2563eb" }).catch(() => {});
    await chrome.action.setBadgeText({ text }).catch(() => {});
}

async function resetDomainUsage(domain) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return false;

    const data = await get([KEYS.statsToday, KEYS.allStatsToday, KEYS.alertsSent, KEYS.recentlyReset]);
    const statsToday = data[KEYS.statsToday] || {};
    const allStatsToday = data[KEYS.allStatsToday] || {};
    const alertsSent = data[KEYS.alertsSent] || {};
    const recentlyReset = data[KEYS.recentlyReset] || {};

    delete statsToday[normalized];
    delete allStatsToday[normalized];
    delete alertsSent[normalized];
    recentlyReset[normalized] = Date.now();

    await set({
        [KEYS.statsToday]: statsToday,
        [KEYS.allStatsToday]: allStatsToday,
        [KEYS.alertsSent]: alertsSent,
        [KEYS.recentlyReset]: recentlyReset
    });
    await queueDnrRulesSync();
    await scheduleActiveLimitWakeups(normalized);
    await syncActionBadge();
    return true;
}

function parseTime(value) {
    const match = String(value || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!match) return null;

    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridian = match[3]?.toLowerCase();
    if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
    if (meridian === "pm" && hour < 12) hour += 12;
    if (meridian === "am" && hour === 12) hour = 0;

    return { hour, minute };
}

function scheduleWindowsForDate(block, now = new Date()) {
    const start = parseTime(block.startTime);
    const end = parseTime(block.endTime);
    const days = Array.isArray(block.days) ? block.days : [];
    if (!start || !end) return [];

    const makeWindow = (anchorDate) => {
        const startAt = new Date(anchorDate);
        startAt.setHours(start.hour, start.minute, 0, 0);
        const endAt = new Date(anchorDate);
        endAt.setHours(end.hour, end.minute, 0, 0);
        if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1);
        return { startAt: startAt.getTime(), endAt: endAt.getTime() };
    };

    const windows = [];
    const overnight = end.hour < start.hour || (end.hour === start.hour && end.minute <= start.minute);

    if (overnight) {
        const previous = new Date(now);
        previous.setDate(previous.getDate() - 1);
        if (days.includes(previous.getDay())) windows.push(makeWindow(previous));
    }

    if (days.includes(now.getDay())) windows.push(makeWindow(now));
    return windows;
}

function scheduledWindow(block, now = new Date()) {
    const windows = scheduleWindowsForDate(block, now);
    const nowMs = now.getTime();
    return windows.find((window) => nowMs >= window.startAt && nowMs < window.endAt) || windows[0] || null;
}

function isScheduleActive(block, nowMs = Date.now()) {
    const window = scheduledWindow(block, new Date(nowMs));
    return Boolean(window && nowMs >= window.startAt && nowMs < window.endAt);
}

function nextScheduleTime(block, kind, fromMs = Date.now()) {
    let next = null;

    for (let offset = 0; offset < 8; offset += 1) {
        const date = new Date(fromMs);
        date.setDate(date.getDate() + offset);
        const windows = scheduleWindowsForDate(block, date);
        for (const window of windows) {
            const time = kind === "start" ? window.startAt : window.endAt;
            if (time > fromMs && (next == null || time < next)) next = time;
        }
    }

    return next;
}

async function scheduleBlockAlarms(block) {
    await chrome.alarms.clear(`startBlock_${block.id}`).catch(() => {});
    await chrome.alarms.clear(`endBlock_${block.id}`).catch(() => {});
    if (!block.enabled) return;

    const start = nextScheduleTime(block, "start");
    const end = nextScheduleTime(block, "end");
    if (start) chrome.alarms.create(`startBlock_${block.id}`, { when: start });
    if (end) chrome.alarms.create(`endBlock_${block.id}`, { when: end });
}

async function activateScheduledBlock(id) {
    const data = await get([KEYS.scheduledBlocks, KEYS.activeBlocks]);
    const block = (data[KEYS.scheduledBlocks] || []).map(normalizeBlock).find((item) => item.id === id);
    if (!block || !block.enabled) return;

    const activeBlocks = (data[KEYS.activeBlocks] || []).filter((item) => item.id !== id);
    activeBlocks.push({ ...block, startedAt: Date.now() });
    await set({ [KEYS.activeBlocks]: activeBlocks });
    await queueDnrRulesSync();
    await redirectOpenTabsForDomain(block.domain, "scheduled", block.tier);
    await scheduleBlockAlarms(block);
}

async function deactivateScheduledBlock(id) {
    const data = await get([KEYS.scheduledBlocks, KEYS.activeBlocks]);
    const activeBlocks = (data[KEYS.activeBlocks] || []).filter((item) => item.id !== id);
    await set({ [KEYS.activeBlocks]: activeBlocks });
    await queueDnrRulesSync();

    const block = (data[KEYS.scheduledBlocks] || []).map(normalizeBlock).find((item) => item.id === id);
    if (block) await scheduleBlockAlarms(block);
}

async function reconcileSchedules() {
    const data = await get([KEYS.scheduledBlocks, KEYS.activeBlocks]);
    const scheduled = (data[KEYS.scheduledBlocks] || []).map(normalizeBlock);
    const active = [];

    for (const block of scheduled) {
        if (block.enabled && isScheduleActive(block)) active.push({ ...block, startedAt: Date.now() });
        await scheduleBlockAlarms(block);
    }

    await set({ [KEYS.scheduledBlocks]: scheduled, [KEYS.activeBlocks]: active });
    await queueDnrRulesSync();
}

async function snoozeDomain(domain, minutes, challengeToken = null) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) throw new Error("Invalid domain");

    const data = await get([KEYS.blockedDomains, KEYS.snoozedDomains, KEYS.snoozeHistory]);
    const tier = normalizeLimitConfig(data[KEYS.blockedDomains]?.[normalized]).tier;
    if (tier === "strict" && !(await verifyStrictChallengeToken(challengeToken, normalized))) {
        throw new Error("Complete the challenge before snoozing.");
    }
    if (tier === "immutable") throw new Error("Immutable blocks cannot be snoozed.");

    const expiresAt = Date.now() + Math.max(1, Number(minutes || 5)) * 60 * 1000;
    const snoozedDomains = data[KEYS.snoozedDomains] || {};
    snoozedDomains[normalized] = { expiresAt, minutes: Number(minutes || 5) };

    const today = getDayKey();
    const snoozeHistory = data[KEYS.snoozeHistory] || {};
    snoozeHistory[today] = Number(snoozeHistory[today] || 0) + 1;

    await set({ [KEYS.snoozedDomains]: snoozedDomains, [KEYS.snoozeHistory]: snoozeHistory });
    chrome.alarms.create(`snoozeEnd_${normalized}`, { when: expiresAt });
    await queueDnrRulesSync();
    await clearActiveLimitAlarms(normalized);
    if (normalized === activeDomain) {
        await chrome.alarms.clear(ACTIVE_LIMIT_BADGE_ALARM).catch(() => false);
    }

    return { expiresAt, redirectUrl: `https://${normalized}/` };
}

async function clearDomainSnooze(domain, options = {}) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return false;

    const data = await get([KEYS.snoozedDomains]);
    const snoozedDomains = data[KEYS.snoozedDomains] || {};
    const removed = deleteSnoozeEntriesForDomain(snoozedDomains, normalized);
    const enforceDelayMs = Math.max(0, Math.min(5000, Number(options.enforceDelayMs) || 0));
    if (removed.length && enforceDelayMs) {
        scheduleSnoozeEnforcement(normalized, enforceDelayMs);
    }
    await set({ [KEYS.snoozedDomains]: snoozedDomains });
    const alarmDomains = Array.from(new Set([normalized, ...removed, ...removed.map(normalizeDomain)]));
    await Promise.all(alarmDomains.map((alarmDomain) => (
        chrome.alarms.clear(`snoozeEnd_${alarmDomain}`).catch(() => {})
    )));
    if (!removed.length) return false;
    if (enforceDelayMs) return true;
    await queueDnrRulesSync();
    await scheduleActiveLimitWakeups(normalized);
    return enforceDomainAfterSnoozeCleared(normalized);
}

async function sendAnalyticsEvent(eventName, params = {}) {
    try {
        const clientId = await getOrCreateAnalyticsClientId(chrome.storage.local);
        await fetch(ANALYTICS_EVENT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                clientId,
                eventName: String(eventName || "event").replace(/[^a-z0-9_]/gi, "_").slice(0, 40),
                extensionVersion: chrome.runtime.getManifest?.().version || "unknown",
                params
            })
        });
    } catch {
        // Analytics should never interrupt extension behavior.
    }
}

async function refreshStoredPremiumStatus(source = "manual") {
    const data = await get([WHOP_TOKEN_KEY, WHOP_PENDING_TOKEN_KEY, PREMIUM_KEY]);
    // Prefer pending checkout tokens so re-linking can replace stale stored access.
    const token = data[WHOP_PENDING_TOKEN_KEY] || data[WHOP_TOKEN_KEY] || "";
    const fallback = data[PREMIUM_KEY] || { active: false, planName: "Free" };

    if (!token || typeof fetch !== "function") {
        await set({ [PREMIUM_KEY]: { ...fallback, checkedAt: Date.now(), source } });
        return { ...fallback, checkedAt: Date.now(), source };
    }

    try {
        const response = await fetch(WHOP_VERIFY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        });
        const result = await response.json();
        const premium = {
            active: Boolean(result.active),
            planName: result.planName || (result.active ? "Pro" : "Free"),
            checkedAt: Date.now(),
            source
        };
        await set({ [PREMIUM_KEY]: premium, [WHOP_TOKEN_KEY]: token, [WHOP_PENDING_TOKEN_KEY]: null });
        return premium;
    } catch {
        return fallback;
    }
}

async function initializeExtension(options = {}) {
    const enforceActive = Boolean(options.enforceActive);
    const countVisit = Boolean(options.countVisit);
    await ensureDayReset();
    const data = await get([
        KEYS.onboarding,
        KEYS.blockedDomains,
        KEYS.scheduledBlocks,
        KEYS.personalInsights,
        KEYS.dismissedInsights,
        KEYS.insightNotificationHistory,
        KEYS.insightNotificationDaily
    ]);
    await set({
        [KEYS.onboarding]: data[KEYS.onboarding] || { step: 0, completed: false, completedAt: null },
        [KEYS.blockedDomains]: data[KEYS.blockedDomains] || {},
        [KEYS.scheduledBlocks]: data[KEYS.scheduledBlocks] || [],
        [KEYS.personalInsights]: Array.isArray(data[KEYS.personalInsights]) ? data[KEYS.personalInsights] : [],
        [KEYS.dismissedInsights]: data[KEYS.dismissedInsights] || {},
        [KEYS.insightNotificationHistory]: data[KEYS.insightNotificationHistory] || {},
        [KEYS.insightNotificationDaily]: data[KEYS.insightNotificationDaily] || {}
    });
    await reconcileSchedules();
    await queueDnrRulesSync({ force: true });
    await initActive(countVisit, { enforce: enforceActive });
    chrome.alarms.create("flush", { periodInMinutes: 1 });
    chrome.alarms.create("enforce", { periodInMinutes: 1 });
}

function welcomeRedirectUrl(reason) {
    const version = String(chrome.runtime.getManifest?.().version || "unknown");
    const url = new URL(chrome.runtime.getURL("welcome.html"));
    url.searchParams.set("reason", reason);
    url.searchParams.set("version", version);
    return { url: url.toString(), version };
}

async function openPostInstallRedirect(details = {}) {
    const reason = String(details.reason || "");
    if (reason !== "install" && reason !== "update") {
        return false;
    }

    const { url, version } = welcomeRedirectUrl(reason);
    await set({
        [KEYS.postInstallRedirectMeta]: {
            reason,
            version,
            shownAt: Date.now()
        }
    });

    try {
        await chrome.tabs.create({ url, active: true });
        await sendAnalyticsEvent("post_install_redirect_shown", {
            install_reason: reason,
            extension_version: version
        });
        return true;
    } catch (error) {
        await sendAnalyticsEvent("post_install_redirect_failed", {
            install_reason: reason,
            extension_version: version,
            error_name: String(error?.name || "unknown_error").slice(0, 40)
        });
        return false;
    }
}

function respond(sendResponse, promise) {
    promise
        .then((value) => sendResponse(value))
        .catch((error) => sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error)
        }));
    return true;
}

async function openPremiumActivationPopup() {
    if (!chrome.action?.openPopup) return false;

    try {
        await chrome.action.openPopup();
        return true;
    } catch {
        return false;
    }
}

async function flushActiveTimeNow(request = {}) {
    const fromPopup = request?.source === "popup";
    if (fromPopup) {
        await setBrowserFocused(true);
    }

    await hydrateActiveContext({
        countVisit: false,
        badge: false,
        preserveOwnExtensionContext: fromPopup
    });
    const countedMs = fromPopup ? await flushPopupActiveTick() : 0;
    await flushTime();
    await syncActionBadge({ hydrate: false });
    return { success: true, activeDomain, countedMs };
}

const handlers = {
    flushActiveTimeNow,
    activePageHeartbeat: async (request, sender) => handleActivePageHeartbeat(sender, request),
    refreshActionBadge: async () => {
        await syncActionBadge({ recheckActiveTab: true });
        return { success: true };
    },
    generateInsights: async (request) => generateInsights({
        allowNotifications: request.allowNotifications === true,
        now: request.now
    }),
    dismissInsight: async (request) => dismissInsight(request.id),
    trackAnalyticsEvent: async (request) => {
        await sendAnalyticsEvent(request.eventName, request.params || {});
        return { success: true };
    },
    logOnboardingMetric: async (request) => {
        const data = await get([KEYS.onboardingMetrics]);
        await set({
            [KEYS.onboardingMetrics]: {
                ...(data[KEYS.onboardingMetrics] || {}),
                [request.metric || "event"]: request.value ?? Date.now()
            }
        });
        return { success: true };
    },
    refreshPremiumStatus: async () => ({ success: true, premium: await refreshStoredPremiumStatus("popup") }),
    completeWhopCheckout: async (request) => {
        const token = String(request.token || "").trim();
        if (!token) return { success: false, error: "Missing token" };
        await set({ [WHOP_PENDING_TOKEN_KEY]: token, [WHOP_LINK_STATE_KEY]: null });
        return { success: true, premium: await refreshStoredPremiumStatus("checkout") };
    },
    addScheduledBlock: async (request) => {
        const block = normalizeBlock({ ...request.block, ...request });
        if (!isValidDomain(block.domain)) return { success: false, error: "Enter a valid domain." };

        const data = await get([KEYS.scheduledBlocks]);
        const scheduled = [...(data[KEYS.scheduledBlocks] || []), block];
        await set({ [KEYS.scheduledBlocks]: scheduled });
        await scheduleBlockAlarms(block);
        await queueDnrRulesSync();
        await scheduleActiveLimitWakeups(activeDomain);
        return { success: true, block };
    },
    updateScheduledBlock: async (request) => {
        const block = normalizeBlock({ ...request.block, ...request });
        const data = await get([KEYS.scheduledBlocks]);
        const scheduled = (data[KEYS.scheduledBlocks] || []).map((item) => item.id === block.id ? block : item);
        await set({ [KEYS.scheduledBlocks]: scheduled });
        await scheduleBlockAlarms(block);
        await queueDnrRulesSync();
        await scheduleActiveLimitWakeups(activeDomain);
        return { success: true, block };
    },
    toggleScheduledBlockEnabled: async (request) => {
        const id = String(request.id || "");
        const data = await get([KEYS.scheduledBlocks]);
        const scheduled = (data[KEYS.scheduledBlocks] || []).map((item) => (
            item.id === id ? { ...item, enabled: request.enabled !== false } : item
        ));
        await set({ [KEYS.scheduledBlocks]: scheduled });
        const block = scheduled.find((item) => item.id === id);
        if (block) await scheduleBlockAlarms(normalizeBlock(block));
        await queueDnrRulesSync();
        await scheduleActiveLimitWakeups(activeDomain);
        return { success: true };
    },
    toggleDomainLimitEnabled: async (request) => {
        const domain = normalizeDomain(request.domain);
        const data = await get([KEYS.blockedDomains]);
        const blockedDomains = data[KEYS.blockedDomains] || {};
        const keys = domainKeysFor(blockedDomains, domain);
        if (!keys.length) return { success: false, error: "Domain not found." };
        keys.forEach((key) => {
            blockedDomains[key] = { ...normalizeLimitConfig(blockedDomains[key]), enabled: request.enabled !== false };
        });
        await set({ [KEYS.blockedDomains]: blockedDomains });
        await queueDnrRulesSync();
        await scheduleActiveLimitWakeups(domain);
        return { success: true };
    },
    clearDomainSnooze: async (request) => {
        return {
            success: true,
            enforced: await clearDomainSnooze(request.domain, {
                enforceDelayMs: request.enforceDelayMs
            })
        };
    },
    getImmutableOverrideState: async () => ({
        success: true,
        ...(await getImmutableOverrideState())
    }),
    useImmutableAdminOverride: async () => useImmutableOverrideFromActiveTab(),
    setImmutableAdminOverride: async (request) => {
        if (request.enabled) {
            const state = await getImmutableOverrideState();
            if (!state.available) {
                await set({ [ADMIN_OVERRIDE_KEY]: false });
                return { success: false, error: state.message };
            }
        }
        const items = { [ADMIN_OVERRIDE_KEY]: Boolean(request.enabled) };
        if (!request.enabled) items[ADMIN_OVERRIDE_LAST_USED_KEY] = "";
        await set(items);
        return { success: true };
    },
    adminOverrideBypassImmutable: async (request, sender) => {
        const data = await get([
            ADMIN_OVERRIDE_KEY,
            KEYS.activeBlocks,
            KEYS.blockedDomains,
            KEYS.statsToday,
            KEYS.snoozedDomains,
            KEYS.recentlyReset
        ]);
        if (!data[ADMIN_OVERRIDE_KEY]) return { success: false, error: "Admin override is off." };

        const domain = normalizeDomain(request.domain);
        const source = request.source === "scheduled" ? "scheduled" : "limit";
        const block = immutableBlockForDomain(domain, source, data);
        if (!block) return { success: false, error: "No active immutable block found." };

        return useImmutableOverrideForTarget({
            ...block,
            tabId: sender?.tab?.id ?? null,
            tabUrl: sender?.tab?.url || "",
            original: safeOriginalUrlForDomain(domain, request.original)
        });
    },
    endScheduledBlock: async (request, sender) => {
        const domain = normalizeDomain(request.domain);
        const data = await get([KEYS.activeBlocks]);
        const next = (data[KEYS.activeBlocks] || []).filter((block) => normalizeDomain(block.domain) !== domain);
        await set({ [KEYS.activeBlocks]: next });
        await queueDnrRulesSync();
        await scheduleActiveLimitWakeups(domain);
        return { success: true, redirectUrl: redirectUrlForDomain(domain, request, sender) };
    },
    snoozeBlock: async (request, sender) => ({
        success: true,
        ...(await snoozeDomain(request.domain, request.minutes, request.challengeToken)),
        redirectUrl: redirectUrlForDomain(request.domain, request, sender)
    }),
    requestStrictChallengeToken: async (request) => ({
        success: true,
        challengeToken: await createStrictChallengeToken(request.domain, request.gameType)
    }),
    requestResetToken: async (request) => ({ success: true, resetToken: await createResetToken(request.domain) }),
    verifyResetToken: async (request) => ({ success: await verifyResetToken(request.token, request.domain) }),
    resetDomainLimit: async (request, sender) => ({
        success: await resetDomainUsage(request.domain),
        redirectUrl: redirectUrlForDomain(request.domain, request, sender)
    }),
    exportUserData: async (request) => ({
        success: true,
        format: request.format || "json",
        data: String(request.format || "").toLowerCase() === "csv"
            ? await GdprUtils.exportDataAsCSV()
            : await GdprUtils.exportDataAsJSON(),
        exportedAt: new Date().toISOString()
    }),
    deleteUsageHistory: async (request) => {
        if (!request.confirmed) return { success: false, error: "Confirmation required." };
        await GdprUtils.deleteUsageHistory();
        return { success: true };
    },
    deleteAnalyticsData: async (request) => {
        if (!request.confirmed) return { success: false, error: "Confirmation required." };
        await GdprUtils.deleteAnalyticsData();
        return { success: true };
    },
    deleteAllData: async (request) => {
        if (!request.confirmed) return { success: false, error: "Confirmation required." };
        await GdprUtils.deleteAllUserData(true);
        return { success: true };
    },
    getDataSummary: async () => ({ success: true, summary: await GdprUtils.getDataSummary() })
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handler = handlers[request?.action];
    if (!handler) {
        sendResponse({ success: false, error: "unsupported-action" });
        return false;
    }
    return respond(sendResponse, handler(request, sender));
});

chrome.runtime.onMessageExternal?.addListener((request, sender, sendResponse) => {
    if (request?.action !== "whopCheckoutComplete") {
        sendResponse({ success: false, error: "unsupported-action" });
        return false;
    }
    if (!String(sender?.url || "").startsWith(ALLOWED_EXTERNAL_ORIGIN)) {
        sendResponse({ success: false, error: "unauthorized-origin" });
        return false;
    }
    return respond(sendResponse, (async () => {
        const result = await handlers.completeWhopCheckout(request);
        if (result?.success && result?.premium?.active) {
            await set({ [WHOP_ACTIVATION_NOTICE_KEY]: { createdAt: Date.now() } });
            const openedPopup = await openPremiumActivationPopup();
            return {
                ...result,
                openedExtension: openedPopup,
                openedPopup
            };
        }
        return result;
    })());
});

chrome.tabs.onActivated?.addListener(({ tabId }) => setActiveDomain(tabId, true));
chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "complete" && !changeInfo.url) return;
    isCurrentActiveTabId(tabId)
        .then((isActive) => {
            if (isActive) return setActiveDomain(tabId, Boolean(changeInfo.url));
            return null;
        })
        .catch(() => {});
});
chrome.tabs.onRemoved?.addListener((tabId) => {
    if (tabId === activeTabId) {
        clearActiveSession().catch(() => {});
    }
});

async function handleWindowFocusChanged(windowId) {
    const isUnfocused = windowId === chrome.windows.WINDOW_ID_NONE || windowId === -1;

    if (isUnfocused) {
        await Promise.all([
            setBrowserFocused(false),
            pauseActiveTracking()
        ]);
        return;
    }

    await setBrowserFocused(true);
    await initActive();
}

chrome.windows?.onFocusChanged?.addListener((windowId) => {
    handleWindowFocusChanged(windowId).catch(() => {});
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ACTIVE_LIMIT_BADGE_ALARM || alarm.name.startsWith(ACTIVE_LIMIT_ALARM_PREFIX)) {
        await handleActiveLimitWakeup(alarm.name);
    }
    if (alarm.name === "flush") {
        if (!(await isBrowserFocused())) {
            await pauseActiveTracking();
            return;
        }
        await hydrateActiveContext({ countVisit: false, badge: false });
        await syncActionBadge({ hydrate: false });
        await scheduleActiveLimitWakeups(activeDomain);
    }
    if (alarm.name === "enforce") {
        if (!(await isBrowserFocused())) {
            await pauseActiveTracking();
            return;
        }
        await hydrateActiveContext({ countVisit: false, badge: false });
        await enforceIfNeeded();
        await syncActionBadge({ hydrate: false });
        await scheduleActiveLimitWakeups(activeDomain);
    }
    if (alarm.name.startsWith("startBlock_")) await activateScheduledBlock(alarm.name.replace("startBlock_", ""));
    if (alarm.name.startsWith("endBlock_")) await deactivateScheduledBlock(alarm.name.replace("endBlock_", ""));
    if (alarm.name.startsWith("snoozeEnd_")) await clearDomainSnooze(alarm.name.replace("snoozeEnd_", ""));
});

chrome.runtime.onStartup?.addListener(() => initializeExtension({ enforceActive: true, countVisit: true }));
chrome.runtime.onInstalled?.addListener(async (details) => {
    await initializeExtension({ enforceActive: false, countVisit: false });
    await openPostInstallRedirect(details);
});

chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && (changes.blockedDomains || changes.activeBlocks || changes.statsToday || changes.snoozedDomains)) {
        syncActionBadge();
    }
    if (area === "local" && dnrRelevantStorageChanged(changes)) {
        queueDnrRulesSync();
        scheduleActiveLimitWakeups(activeDomain);
    }
    if (area === "local" && changes.snoozedDomains) {
        const oldSnoozes = changes.snoozedDomains.oldValue || {};
        const newSnoozes = changes.snoozedDomains.newValue || {};
        const now = Date.now();
        const clearedDomains = Array.from(new Set(
            Object.keys(oldSnoozes)
                .map(normalizeDomain)
                .filter((domain) => (
                    isValidDomain(domain)
                    && isSnoozed(domain, oldSnoozes, now)
                    && !isSnoozed(domain, newSnoozes, now)
                ))
        ));
        clearedDomains.forEach((domain) => {
            if (snoozeEnforcementTimers.has(domain)) return;
            enforceDomainAfterSnoozeCleared(domain).catch(() => {});
        });
    }
});

initializeExtension({ enforceActive: false, countVisit: false }).catch(() => {});

if (typeof module !== "undefined" && module.exports) {
    global.createResetToken = createResetToken;
    global.verifyResetToken = verifyResetToken;
    global.resetDomainUsage = resetDomainUsage;
    global.checkAndSendAlerts = checkAndSendAlerts;
    global.analyzeUsagePatterns = analyzeUsagePatterns;
    global.generateInsights = generateInsights;
    global.shouldSendNotification = shouldSendNotification;
    global.sendPatternNotification = sendPatternNotification;
    global.getInsightSettings = getInsightSettings;
    global.saveInsight = saveInsight;
    global.dismissInsight = dismissInsight;
    global.clearDomainSnooze = clearDomainSnooze;
    global.enforceIfNeeded = enforceIfNeeded;
    global.flushActiveTimeNow = flushActiveTimeNow;
    global.flushTime = flushTime;
    global.setActiveDomain = setActiveDomain;
    global.syncActionBadge = syncActionBadge;
    global.redirectUrlForDomain = redirectUrlForDomain;
    global.isScheduleActive = isScheduleActive;
    global.nextScheduleTime = nextScheduleTime;
    global.buildDnrBlockEntries = buildDnrBlockEntries;
    global.buildDnrRedirectRule = buildDnrRedirectRule;
    global.syncDnrRules = syncDnrRules;
    global.scheduleActiveLimitWakeups = scheduleActiveLimitWakeups;
    global.handleActiveLimitWakeup = handleActiveLimitWakeup;
    global.handleActivePageHeartbeat = handleActivePageHeartbeat;
    global.handleWindowFocusChanged = handleWindowFocusChanged;
    global.ACTIVE_LIMIT_BADGE_ALARM = ACTIVE_LIMIT_BADGE_ALARM;
}
