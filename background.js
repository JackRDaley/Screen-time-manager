// blockedDomains: { [domain]: { limitMinutes: number } }
// statsToday: { [domain]: { timeSec: number, visits: number } }
// activeBlocks: [{ domain: string, endsAt: number|null, remainingSec?: number }]

const KEYS = {
    blockedDomains: "blockedDomains", // { [domain]: { limitMinutes } }
    statsToday: "statsToday",         // { [domain]: { timeSec, visits, lastSeenDay } }
    allStatsToday: "allStatsToday",   // { [domain]: { timeMs, visits } } for all websites
    dayKey: "statsDayKey",            // "YYYY-MM-DD"
    enforceIntervalSec: "enforceIntervalSec", // optional: number of seconds between enforce checks
    alertsSent: "alertsSent",          // { [domain]: Set of alert thresholds already notified ("75", "90") }
    scheduledBlocks: "scheduledBlocks", // [{ domain: string, startTime: number, endTime: number }]
    activeBlocks: "activeBlocks",       // [{ domain: string, startTime: number, endTime: number }]
    snoozedDomains: "snoozedDomains",   // { [domain]: expiresAt (ms) }
    statsHistory: "statsHistory"        // { [dayKey]: { [domain]: { timeMs, visits } } }
};

const PREMIUM_KEY = "premiumState";
const WHOP_TOKEN_KEY = "whopAccessToken";
const WHOP_VERIFY_URL = "https://screen-time-manager.jackster0627.workers.dev/whop/verify";
const ALLOWED_EXTERNAL_CALLBACK_ORIGIN = "https://screen-time-manager.jackster0627.workers.dev/";
const PREMIUM_SYNC_ALARM = "premiumSync";
const PREMIUM_SYNC_INTERVAL_MINUTES = 60;
const FREE_PLAN_LIMITS = Object.freeze({
    maxTrackedDomains: 3,
    maxScheduledBlocks: 2
});
const ALL_SCHEDULE_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

let activeTabId = null;
let activeDomain = null;
let activeStartMs = null;
let dynamicRuleSync = Promise.resolve();

function getDayKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
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
            const { [KEYS.allStatsToday]: allStats = {}, [KEYS.statsHistory]: history = {} } =
                await chrome.storage.local.get([KEYS.allStatsToday, KEYS.statsHistory]);
            if (Object.keys(allStats).length > 0) {
                history[storedDay] = allStats;
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - 31);
                const cutoff = getDayKey(cutoffDate);
                for (const key of Object.keys(history)) {
                    if (key < cutoff) delete history[key];
                }
                await chrome.storage.local.set({
                    [KEYS.statsHistory]: history,
                    [KEYS.statsToday]: {},
                    [KEYS.allStatsToday]: {},
                    [KEYS.dayKey]: today
                });
                return;
            }
        }
        await chrome.storage.local.set({ [KEYS.statsToday]: {}, [KEYS.allStatsToday]: {}, [KEYS.dayKey]: today });
    }
}

async function updateDomainActivity(domain, { deltaMs = 0, countVisit = false } = {}) {
    if (!domain) return;
    if (deltaMs <= 0 && !countVisit) return;
    await ensureDayReset();

    const { blockedDomains = {}, [KEYS.statsToday]: stats = {}, [KEYS.allStatsToday]: allStats = {} } =
        await chrome.storage.local.get([KEYS.blockedDomains, KEYS.statsToday, KEYS.allStatsToday]);

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

    stats[domain] = cur;
    allStats[domain] = allCur;
    await chrome.storage.local.set({ [KEYS.statsToday]: stats, [KEYS.allStatsToday]: allStats });

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
                    await chrome.tabs.update(t.id, { url: blockedUrl(domain) }).catch(() => {});
                }
            }
        }
    }
}

function isBlockedDomain(domain, blockedDomains) {
    return !!blockedDomains?.[domain];
}

function limitMsFor(domain, blockedDomains) {
    const sec = blockedDomains?.[domain]?.limitSeconds;
    if (!Number.isFinite(sec) || sec <= 0) return null;
    return sec * 1000;
}

function blockedUrl(domain, source = "limit") {
    return chrome.runtime.getURL(`blocked.html?d=${encodeURIComponent(domain)}&source=${source}`);
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

function getNextTime(timeStr) {
    const { h: hours, m: minutes } = parseHourMinute(timeStr);
    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target <= now) {
        target.setDate(target.getDate() + 1);
    }
    return target.getTime();
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
        sent["90"] = true;
    } else if (pct75 && !sent["75"]) {
        chrome.notifications.create({
            type: "basic",
            iconUrl: chrome.runtime.getURL("icon.png"),
            title: `75% of limit used: ${domain}`,
            message: `You have ~${formatTimeSec(remainingSec)} left today.`,
            priority: 1
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
        [PREMIUM_KEY]: nextPremium
    };
    if (nextPremium.active) {
        payloadToStore[WHOP_TOKEN_KEY] = trimmedToken;
    }

    await chrome.storage.local.set(payloadToStore);

    return nextPremium;
}

async function refreshStoredPremiumStatus(source = "background-sync") {
    const { [WHOP_TOKEN_KEY]: storedToken = "", [PREMIUM_KEY]: premiumStored = {} } =
        await chrome.storage.local.get([WHOP_TOKEN_KEY, PREMIUM_KEY]);

    const trimmedToken = String(storedToken || "").trim();
    if (!trimmedToken) {
        return { success: false, error: "No linked billing identity found." };
    }

    if (/\{[^}]+\}/.test(trimmedToken)) {
        return { success: false, error: "Stored billing identity is invalid." };
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
        [WHOP_TOKEN_KEY]: trimmedToken
    };

    await chrome.storage.local.set(nextStorage);

    const becameInactive = Boolean(premiumStored?.active) && !nextPremium.active;
    return { success: true, premiumState: nextPremium, becameInactive };
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

async function flushTime() {
    if (!activeDomain || !activeStartMs) return;
    const deltaMs = Date.now() - activeStartMs;
    activeStartMs = Date.now(); // reset start for continued tracking
    if (deltaMs > 0) await updateDomainActivity(activeDomain, { deltaMs });
    
    // immediately check if we should enforce on the active tab
    if (activeTabId != null) {
        await enforceIfNeeded(activeTabId);
    }
}

async function setActiveDomain(tabId, countVisit = false) {
    await flushTime();

    activeTabId = tabId;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const d = tab?.url ? domainFromUrl(tab.url) : null;

    if (countVisit && d && d !== activeDomain) await updateDomainActivity(d, { countVisit: true });

    activeDomain = d;
    activeStartMs = d ? Date.now() : null;
}

async function initActive() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id != null) await setActiveDomain(tab.id);
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
        return;
    }
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id != null) await setActiveDomain(tab.id, false);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTabId) {
        activeTabId = null;
        activeDomain = null;
        activeStartMs = null;
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

async function activateScheduledBlock(id) {
    const { [KEYS.scheduledBlocks]: scheduled = [], [KEYS.activeBlocks]: activeBlocks = [] } =
        await chrome.storage.local.get([KEYS.scheduledBlocks, KEYS.activeBlocks]);
    const block = scheduled.map(normalizeScheduledBlock).find((entry) => entry.id === id);
    if (!block) return;

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

    const nextStart = getNextScheduledStartTime(block, Date.now() + 1000);
    const nextEnd = getNextScheduledEndTime(block, Date.now());
    if (nextStart != null) {
        chrome.alarms.create(`startBlock_${id}`, { when: nextStart });
    }
    if (nextEnd != null) {
        chrome.alarms.create(`endBlock_${id}`, { when: nextEnd });
    }
}

async function deactivateScheduledBlock(id) {
    const { [KEYS.scheduledBlocks]: scheduled = [], [KEYS.activeBlocks]: activeBlocks = [] } =
        await chrome.storage.local.get([KEYS.scheduledBlocks, KEYS.activeBlocks]);
    const block = scheduled.map(normalizeScheduledBlock).find((entry) => entry.id === id);
    const nextActiveBlocks = activeBlocks.filter((entry) => entry.id !== id);

    await chrome.storage.local.set({ [KEYS.activeBlocks]: nextActiveBlocks });
    await updateBlockRules();

    if (block) {
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

async function initializeExtension() {
    await initActive();
    await createEnforceAlarm();
    await createFlushAlarm();
    await createPremiumSyncAlarm();
    await scheduleAlarms();
    await reconcileActiveScheduledBlocks();
    await refreshStoredPremiumStatus("startup-sync").catch(() => null);
}

chrome.runtime.onStartup?.addListener(() => {
    initializeExtension().catch(console.error);
});

chrome.runtime.onInstalled.addListener(() => {
    initializeExtension().catch(console.error);
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "enforce") {
        await ensureActiveTrackingState();
        await flushTime();
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
        await activateScheduledBlock(id);
    } else if (alarm.name.startsWith('endBlock_')) {
        const id = parseInt(alarm.name.split('_')[1], 10);
        await deactivateScheduledBlock(id);
    } else if (alarm.name.startsWith('snoozeEnd_')) {
        const domain = alarm.name.slice('snoozeEnd_'.length);
        const { [KEYS.snoozedDomains]: snoozedDomains = {} } =
            await chrome.storage.local.get([KEYS.snoozedDomains]);
        delete snoozedDomains[domain];
        await chrome.storage.local.set({ [KEYS.snoozedDomains]: snoozedDomains });
        await updateBlockRules();
    }
});

async function runSelfTest() {
    const checks = [];

    try {
        const manifest = chrome.runtime.getManifest();
        const resources = manifest.web_accessible_resources || [];
        const hasBlockedPage = resources.some((entry) =>
            Array.isArray(entry.resources) && entry.resources.includes("blocked.html")
        );

        checks.push({
            name: "blocked page is web accessible",
            pass: hasBlockedPage,
            details: hasBlockedPage ? "blocked.html found in manifest" : "blocked.html missing from web_accessible_resources"
        });
    } catch (error) {
        checks.push({
            name: "blocked page is web accessible",
            pass: false,
            details: String(error)
        });
    }

    try {
        await updateBlockRules();
        const rulesAfterFirstSync = await chrome.declarativeNetRequest.getDynamicRules();

        await updateBlockRules();
        const rulesAfterSecondSync = await chrome.declarativeNetRequest.getDynamicRules();

        const idsOne = rulesAfterFirstSync.map((rule) => rule.id).sort((a, b) => a - b);
        const idsTwo = rulesAfterSecondSync.map((rule) => rule.id).sort((a, b) => a - b);
        const stableIds = JSON.stringify(idsOne) === JSON.stringify(idsTwo);

        checks.push({
            name: "dynamic rule sync is idempotent",
            pass: stableIds,
            details: stableIds ? `stable IDs: [${idsTwo.join(", ")}]` : "rule IDs changed between identical sync passes"
        });

        const uniqueCount = new Set(idsTwo).size;
        checks.push({
            name: "dynamic rule IDs are unique",
            pass: uniqueCount === idsTwo.length,
            details: uniqueCount === idsTwo.length ? `unique IDs: ${uniqueCount}` : "duplicate rule IDs detected"
        });

        const allRedirectRules = rulesAfterSecondSync.every((rule) => rule.action?.type === "redirect");
        checks.push({
            name: "scheduled rules use redirect action",
            pass: allRedirectRules,
            details: allRedirectRules ? "all dynamic rules are redirect rules" : "one or more dynamic rules are not redirect"
        });
    } catch (error) {
        checks.push({
            name: "dynamic rule validation",
            pass: false,
            details: String(error)
        });
    }

    return {
        ok: checks.every((check) => check.pass),
        checkedAt: new Date().toISOString(),
        checks
    };
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== "object") return;

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
            const nextBlock = normalizeScheduledBlock({ id, domain, startTime, endTime, daysOfWeek });
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
                await activateScheduledBlock(id);
            }

            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === "snoozeBlock") {
        const { domain, minutes = 5 } = request;
        (async () => {
            const expiresAt = Date.now() + minutes * 60 * 1000;
            const { [KEYS.snoozedDomains]: snoozedDomains = {} } =
                await chrome.storage.local.get([KEYS.snoozedDomains]);
            snoozedDomains[domain] = expiresAt;
            await chrome.storage.local.set({ [KEYS.snoozedDomains]: snoozedDomains });
            await updateBlockRules();
            chrome.alarms.create(`snoozeEnd_${domain}`, { when: expiresAt });
            sendResponse({ success: true, expiresAt });
        })();
        return true;
    }

    if (request.action === "flushActiveTimeNow") {
        (async () => {
            await ensureActiveTrackingState();
            await flushTime();
            if (activeTabId != null) {
                await enforceIfNeeded(activeTabId);
            }
            sendResponse({ success: true });
        })();
        return true;
    }

    if (request.action === "endScheduledBlock") {
        const { domain } = request;
        (async () => {
            const { [KEYS.activeBlocks]: activeBlocks = [] } =
                await chrome.storage.local.get([KEYS.activeBlocks]);
            const next = activeBlocks.filter((b) => b.domain !== domain);
            await chrome.storage.local.set({ [KEYS.activeBlocks]: next });
            await updateBlockRules();
            sendResponse({ success: true });
        })();
        return true;
    }

    if (request.action === "refreshPremiumStatus") {
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
