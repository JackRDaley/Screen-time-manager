importScripts("shared-extension-utils.js");
importScripts("gdpr-utils.js");

const {
    formatTimeSec,
    getDayKey,
    getOrCreateAnalyticsClientId
} = globalThis.StmSharedUtils || {};

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
const ALLOWED_EXTERNAL_ORIGIN = "https://screen-time-manager.jackster0627.workers.dev/";
const RESET_TOKEN_TTL_MS = 5000;
const STRICT_TOKEN_TTL_MS = 2 * 60 * 1000;
const RECENT_RESET_GRACE_MS = 5000;
const ENFORCEMENT_TIERS = Object.freeze(["lenient", "standard", "strict", "immutable"]);
const ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

const tokenCaches = {
    reset: new Map(),
    strict: new Map()
};
const alertClaims = new Set();
const snoozeEnforcementTimers = new Map();

let activeTabId = null;
let activeDomain = "";
let activeStartedAt = 0;
let activeContextHydration = null;

function local() {
    return chrome.storage.local;
}

async function get(keys) {
    return local().get(keys);
}

async function set(items) {
    return local().set(items);
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
        history[day][hour] ||= { timeMs: 0, visits: 0, domains: {} };
        history[day][hour].timeMs += sliceEnd - cursor;
        history[day][hour].visits += countVisit ? 1 : 0;
        history[day][hour].domains[domain] = (history[day][hour].domains[domain] || 0) + (sliceEnd - cursor);

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
}

function activeSessionRecord() {
    return activeDomain && activeStartedAt
        ? { tabId: activeTabId, domain: activeDomain, startedAt: activeStartedAt }
        : null;
}

async function persistActiveSession() {
    await set({ [KEYS.activeSession]: activeSessionRecord() });
}

async function restoreActiveSession() {
    if (activeDomain && activeStartedAt) return true;

    const data = await get([KEYS.activeSession]);
    const session = data[KEYS.activeSession] || {};
    const domain = normalizeDomain(session.domain);
    const startedAt = Number(session.startedAt || 0);
    if (!isValidDomain(domain) || !Number.isFinite(startedAt) || startedAt <= 0) return false;

    const tabId = Number(session.tabId);
    activeTabId = Number.isFinite(tabId) ? tabId : null;
    activeDomain = domain;
    activeStartedAt = startedAt;
    return true;
}

async function clearActiveSession() {
    activeTabId = null;
    activeDomain = "";
    activeStartedAt = 0;
    await persistActiveSession();
}

async function flushTime({ ignoreCurrentGap = false } = {}) {
    if (!activeDomain || !activeStartedAt) {
        await restoreActiveSession();
    }
    if (!activeDomain || !activeStartedAt) return;

    const now = Date.now();
    const deltaMs = now - activeStartedAt;
    activeStartedAt = now;
    await persistActiveSession();

    if (ignoreCurrentGap || deltaMs < 0 || deltaMs > 5 * 60 * 1000) return;
    await updateDomainActivity(activeDomain, { deltaMs, startMs: now - deltaMs, endMs: now });
}

async function setActiveDomain(tabId, countVisit = false, options = {}) {
    const shouldEnforce = options.enforce !== false;
    const shouldBadge = options.badge !== false;
    await flushTime();
    activeTabId = tabId;

    const tab = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
    const domain = domainFromUrl(tab?.url || "");
    activeDomain = domain;
    activeStartedAt = domain ? Date.now() : 0;
    await persistActiveSession();

    if (domain && countVisit) {
        await updateDomainActivity(domain, { deltaMs: 0, countVisit: true });
    }
    if (shouldEnforce) await enforceIfNeeded(tabId);
    if (shouldBadge) await syncActionBadge({ hydrate: false });
}

async function currentActiveTab() {
    const queries = [
        { active: true, lastFocusedWindow: true },
        { active: true, currentWindow: true },
        { active: true }
    ];

    for (const query of queries) {
        const [tab] = await chrome.tabs.query(query).catch(() => []);
        if (tab) return tab;
    }
    return null;
}

async function isCurrentActiveTabId(tabId) {
    const tab = await currentActiveTab();
    return tab?.id === tabId;
}

async function hydrateActiveContext({ countVisit = false, badge = false, force = false } = {}) {
    if (!activeContextHydration) {
        activeContextHydration = (async () => {
            const tab = await currentActiveTab();
            if (!tab) {
                if (!activeDomain || !activeStartedAt) await restoreActiveSession();
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
    await syncActionBadge({ hydrate: false });
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
        await enforceIfNeeded();
        return false;
    }

    const scheduled = activeScheduledBlockFor(normalized, data[KEYS.activeBlocks] || []);
    if (scheduled) {
        await redirectOpenTabsForDomain(normalized, "scheduled", normalizeTier(scheduled.tier, "standard"));
        await enforceIfNeeded();
        return true;
    }

    const config = normalizeLimitConfig(entryForDomain(data[KEYS.blockedDomains] || {}, normalized));
    const limitMs = config.enabled ? config.limitSeconds * 1000 : 0;
    const usedMs = entryTimeMs(data[KEYS.statsToday]?.[normalized] || {});
    if (limitMs > 0 && usedMs >= limitMs && !wasRecentlyReset(normalized, data[KEYS.recentlyReset] || {})) {
        await redirectOpenTabsForDomain(normalized, "limit", config.tier);
        await enforceIfNeeded();
        return true;
    }

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
            iconUrl: "assets/icons/extension_icon.png",
            title: `${threshold}% of ${normalized} limit used`,
            message: `${formatTimeSec(Math.round(usedMs / 1000))} used today.`
        });
    } finally {
        alertClaims.delete(alertKey);
    }
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
    const usedMs = entryTimeMs(data[KEYS.statsToday]?.[activeDomain] || {});
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
    await redirectOpenTabsForDomain(block.domain, "scheduled", block.tier);
    await scheduleBlockAlarms(block);
}

async function deactivateScheduledBlock(id) {
    const data = await get([KEYS.scheduledBlocks, KEYS.activeBlocks]);
    const activeBlocks = (data[KEYS.activeBlocks] || []).filter((item) => item.id !== id);
    await set({ [KEYS.activeBlocks]: activeBlocks });

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
    return enforceDomainAfterSnoozeCleared(normalized);
}

async function sendAnalyticsEvent(eventName, params = {}) {
    try {
        const clientId = await getOrCreateAnalyticsClientId(local());
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
    const token = data[WHOP_TOKEN_KEY] || data[WHOP_PENDING_TOKEN_KEY] || "";
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
    const data = await get([KEYS.onboarding, KEYS.blockedDomains, KEYS.scheduledBlocks]);
    await set({
        [KEYS.onboarding]: data[KEYS.onboarding] || { step: 0, completed: false, completedAt: null },
        [KEYS.blockedDomains]: data[KEYS.blockedDomains] || {},
        [KEYS.scheduledBlocks]: data[KEYS.scheduledBlocks] || []
    });
    await reconcileSchedules();
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

async function flushActiveTimeNow() {
    await hydrateActiveContext({ countVisit: false, badge: false });
    await flushTime();
    await syncActionBadge({ hydrate: false });
    return { success: true, activeDomain };
}

const handlers = {
    flushActiveTimeNow,
    refreshActionBadge: async () => {
        await syncActionBadge({ recheckActiveTab: true });
        return { success: true };
    },
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
        return { success: true, block };
    },
    updateScheduledBlock: async (request) => {
        const block = normalizeBlock({ ...request.block, ...request });
        const data = await get([KEYS.scheduledBlocks]);
        const scheduled = (data[KEYS.scheduledBlocks] || []).map((item) => item.id === block.id ? block : item);
        await set({ [KEYS.scheduledBlocks]: scheduled });
        await scheduleBlockAlarms(block);
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
    setImmutableAdminOverride: async (request) => {
        await set({
            [ADMIN_OVERRIDE_KEY]: Boolean(request.enabled),
            [ADMIN_OVERRIDE_LAST_USED_KEY]: request.enabled ? getDayKey() : ""
        });
        return { success: true };
    },
    adminOverrideBypassImmutable: async (request, sender) => {
        const data = await get([ADMIN_OVERRIDE_KEY]);
        if (!data[ADMIN_OVERRIDE_KEY]) return { success: false, error: "Admin override is off." };
        await resetDomainUsage(request.domain);
        await set({ [ADMIN_OVERRIDE_LAST_USED_KEY]: getDayKey() });
        return { success: true, redirectUrl: redirectUrlForDomain(request.domain, request, sender) };
    },
    endScheduledBlock: async (request, sender) => {
        const domain = normalizeDomain(request.domain);
        const data = await get([KEYS.activeBlocks]);
        const next = (data[KEYS.activeBlocks] || []).filter((block) => normalizeDomain(block.domain) !== domain);
        await set({ [KEYS.activeBlocks]: next });
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
    return respond(sendResponse, handlers.completeWhopCheckout(request));
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
        flushTime().then(clearActiveSession).catch(() => {});
    }
});
chrome.windows?.onFocusChanged?.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) flushTime();
    else initActive();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "flush") {
        await hydrateActiveContext({ countVisit: false, badge: false });
        await flushTime();
        await syncActionBadge({ hydrate: false });
    }
    if (alarm.name === "enforce") {
        await hydrateActiveContext({ countVisit: false, badge: false });
        await flushTime();
        await enforceIfNeeded();
        await syncActionBadge({ hydrate: false });
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
    global.clearDomainSnooze = clearDomainSnooze;
    global.enforceIfNeeded = enforceIfNeeded;
    global.flushActiveTimeNow = flushActiveTimeNow;
    global.flushTime = flushTime;
    global.setActiveDomain = setActiveDomain;
    global.syncActionBadge = syncActionBadge;
    global.redirectUrlForDomain = redirectUrlForDomain;
    global.isScheduleActive = isScheduleActive;
    global.nextScheduleTime = nextScheduleTime;
}
