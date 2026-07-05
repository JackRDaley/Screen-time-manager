const $ = (id) => document.getElementById(id);
const Shared = globalThis.StmSharedUtils || {};
const formatTimeSec = Shared.formatTimeSec || ((sec) => `${Math.max(0, Math.round(sec || 0))}s`);
const getDayKey = Shared.getDayKey || ((date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
});

const SETTINGS_KEY = "uiSettings";
const PERSONAL_INSIGHTS_KEY = "personalInsights";
const DISMISSED_INSIGHTS_KEY = "dismissedInsights";
const PREMIUM_KEY = "premiumState";
const WHOP_ACTIVATION_NOTICE_KEY = "whopActivationNotice";
const ONBOARDING_KEY = "onboardingState";
const ONBOARDING_VERSION = 2;
const FUNNEL_STATE_KEY = "activationFunnelState";
const FUNNEL_VERSION = 1;
const WHOP_CHECKOUT_URL = "https://whop.com/screen-time-manager/screen-time-manager-pro/";
const WHOP_CHECKOUT_START_URL = "https://screen-time-manager.jackster0627.workers.dev/whop/start";
const WHOP_MANAGE_URL = "https://whop.com/hub/memberships/";
const CHROME_WEBSTORE_REVIEW_URL = "https://chromewebstore.google.com/detail/screen-time-manager/pecaajdaecdmikcgfdgldcofdebhfbgo/reviews";
const SURVEYMONKEY_FEEDBACK_URL = "https://www.surveymonkey.com/r/QF2RJ58";
const REVIEW_PROMPT_STATE_KEY = "reviewPromptState";
const BLOCK_RECLAIM_KEY = "saturnBlockReclaimStats";
const JOURNEY_DISPLAY_KEY = "saturnJourneyDisplayState";
const RECLAIM_MS_PER_BLOCK = 5 * 60 * 1000;
const REVIEW_PROMPT_FIRST_DELAY_MS = 5 * 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_MIN_DASHBOARD_OPENS = 4;
const REVIEW_PROMPT_MIN_RECLAIM_MS = 20 * 60 * 1000;
const LIVE_REFRESH_INTERVAL_MS = 1000;
const LIVE_REFRESH_MOTION_SUPPRESSION_MS = 120;
const MAX_DAILY_LIMIT_MINUTES = 1440;
const LIVE_REFRESH_TARGET_IDS = Object.freeze([
    "ranking",
    "rankingByVisits"
]);
const HOURLY_BAR_MIN_ACTIVE_HEIGHT_PCT = 6;
const HOURLY_BAR_DAILY_SHARE_SCALE = 0.25;

const HOUR_MS = 60 * 60 * 1000;
const PLANET_STOPS = Object.freeze([
    { id: "earth", label: "Earth", shortLabel: "Earth", thresholdMs: 0, distanceKm: 0 },
    { id: "moon", label: "Moon", shortLabel: "Moon", thresholdMs: 2 * HOUR_MS, distanceKm: 384400 },
    { id: "mars", label: "Mars Orbit", shortLabel: "Mars", thresholdMs: 10 * HOUR_MS, distanceKm: 78000000 },
    { id: "jupiter", label: "Jupiter", shortLabel: "Jupiter", thresholdMs: 25 * HOUR_MS, distanceKm: 628000000 },
    { id: "saturn", label: "Saturn", shortLabel: "Saturn", thresholdMs: 50 * HOUR_MS, distanceKm: 1275000000 },
    { id: "uranus", label: "Uranus", shortLabel: "Uranus", thresholdMs: 100 * HOUR_MS, distanceKm: 2723000000 },
    { id: "neptune", label: "Neptune", shortLabel: "Neptune", thresholdMs: 200 * HOUR_MS, distanceKm: 4351000000 },
    { id: "interstellar", label: "Interstellar Space", shortLabel: "Deep", thresholdMs: 500 * HOUR_MS, distanceKm: 7500000000 }
]);

const PLANET_ICON_PATHS = Object.freeze({
    earth: "assets/planets/earth.png",
    moon: "assets/planets/moon.png",
    mars: "assets/planets/mars.png",
    jupiter: "assets/planets/jupiter.png",
    saturn: "assets/planets/saturn.png",
    uranus: "assets/planets/uranus.png",
    neptune: "assets/planets/neptune.png",
    interstellar: "assets/planets/interstellar.png"
});

const TIMELINE_PLANET_ICON_PATHS = Object.freeze({
    ...PLANET_ICON_PATHS,
    saturn: "assets/planets/saturn-timeline.png"
});

const DEFAULT_SETTINGS = Object.freeze({
    defaultLimitMinutes: 30,
    use24HourTime: false,
    limitNotificationsEnabled: true,
    personalInsightsEnabled: true,
    insightNotificationsEnabled: true,
    insightMaxNotificationsPerDay: 1,
    insightSensitivity: "normal",
    journeyCollapsed: false
});

const DEFAULT_PREMIUM = Object.freeze({
    active: false,
    planName: "Free"
});

const FREE_LIMITS = Object.freeze({
    maxTrackedDomains: 3,
    maxScheduledBlocks: 1
});

const PRESET_TEMPLATES = Object.freeze([
    {
        id: "study",
        name: "Study Mode",
        description: "Moderate daily limits for common student distractions so homework starts faster.",
        recommendedFor: "Homework and evening study sessions",
        ruleType: "Daily limits",
        tier: "standard",
        limitMinutes: 30,
        sites: ["youtube.com", "reddit.com", "tiktok.com", "instagram.com", "netflix.com"]
    },
    {
        id: "deep-work",
        name: "Deep Work Mode",
        description: "Stricter limits for social, video, news, and sports sites during serious work blocks.",
        recommendedFor: "Focused 60-120 minute sessions",
        ruleType: "Daily limits",
        tier: "strict",
        limitMinutes: 10,
        sites: ["youtube.com", "reddit.com", "x.com", "espn.com", "cnn.com"]
    },
    {
        id: "sleep",
        name: "Sleep Schedule",
        description: "Recurring late-night blocks for the sites most likely to pull you back in after bedtime.",
        recommendedFor: "Late evening and night hours",
        ruleType: "Scheduled blocks",
        tier: "standard",
        schedule: { startTime: "10:30 PM", endTime: "06:30 AM", days: [0, 1, 2, 3, 4, 5, 6] },
        sites: ["youtube.com", "netflix.com", "reddit.com", "tiktok.com", "instagram.com"]
    }
]);

const ONBOARDING_STEPS = Object.freeze([
    {
        tabId: "tab1",
        target: ".stat-strip",
        title: "Start on your dashboard",
        copy: "The top cards summarize today, while the lists and hourly chart help you spot where your time is going."
    },
    {
        tabId: "tab2",
        target: "#addForm",
        title: "Add a daily limit",
        copy: "Enter a site, choose a daily minute budget, and pick how strongly you want the limit enforced."
    },
    {
        tabId: "tab3",
        target: "#scheduledForm",
        title: "Schedule focus blocks",
        copy: "Scheduled blocks create recurring sessions. Add a domain, choose start and end times, choose an enforcement level, select days, then deploy the schedule."
    },
    {
        tabId: "tab2",
        target: "#limitList",
        title: "What happens at the limit",
        copy: "When time runs out, you'll be redirected to the blocked page. Lenient and standard limits can be undone or snoozed; stricter modes may ask for a challenge first.",
        showRedirectPreview: true,
        placement: "center"
    }
]);

const DAY_OPTIONS = Object.freeze([
    ["S", 0],
    ["M", 1],
    ["T", 2],
    ["W", 3],
    ["T", 4],
    ["F", 5],
    ["S", 6]
]);

const state = {
    data: {},
    settings: { ...DEFAULT_SETTINGS },
    premium: { ...DEFAULT_PREMIUM },
    onboarding: { step: 0, completed: false, completedAt: null, version: ONBOARDING_VERSION },
    immutableOverride: { available: false },
    selectedDays: [],
    selectedHourlyHour: null,
    selectedInsightIndex: 0,
    editingScheduleId: null,
    applyingPresetId: null,
    rankingSignature: "",
    journeyVisual: null
};

let liveRefreshPromise = null;
let rankingMotionRestoreTimer = null;
let settingsOverlayCloseTimer = null;
let journeyAnimationCleanupTimer = null;
const viewedInsightsThisSession = new Set();

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

function parseScheduleTimeInput(value) {
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

function isValidScheduleTimeInput(value) {
    return Boolean(parseScheduleTimeInput(value));
}

function send(action, payload = {}) {
    return chrome.runtime.sendMessage({ action, ...payload }).catch((error) => ({
        success: false,
        error: error instanceof Error ? error.message : String(error)
    }));
}

function trackBlockRuleAdded(blockSource, tier) {
    return send("trackAnalyticsEvent", {
        eventName: "domain_added",
        params: {
            block_source: blockSource,
            block_tier: tier || "unknown",
            extension_version: chrome.runtime.getManifest?.().version || "unknown"
        }
    });
}

function trackFunnelEvent(eventName, params = {}) {
    return send("trackAnalyticsEvent", {
        eventName,
        params: {
            funnel_version: FUNNEL_VERSION,
            extension_version: chrome.runtime.getManifest?.().version || "unknown",
            ...params
        }
    });
}

async function trackFunnelEventOnce(flag, eventName, params = {}) {
    const normalizedFlag = String(flag || "").trim();
    if (!normalizedFlag) return;

    try {
        const data = await chrome.storage.local.get([FUNNEL_STATE_KEY]);
        const state = data[FUNNEL_STATE_KEY] || {};
        if (state[normalizedFlag]) return;

        await chrome.storage.local.set({
            [FUNNEL_STATE_KEY]: {
                ...state,
                [normalizedFlag]: Date.now(),
                version: FUNNEL_VERSION
            }
        });
        await trackFunnelEvent(eventName, params);
    } catch {
        // Funnel analytics should never interrupt extension behavior.
    }
}

function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
}

function setAnimatedText(id, text) {
    const el = $(id);
    if (!el) return;
    setAnimatedElementText(el, text);
}

function setAnimatedElementText(el, text) {
    if (!el) return;
    const nextText = String(text);
    if (el.textContent === nextText) return;

    el.textContent = nextText;
    if (!el.classList.contains("is-live-refresh-render")) {
        el.classList.remove("motion-value-pop");
        void el.offsetWidth;
        el.classList.add("motion-value-pop");
    }
}

function setAllText(selector, text) {
    document.querySelectorAll(selector).forEach((el) => {
        el.textContent = text;
    });
}

function setAllAnimatedText(selector, text) {
    document.querySelectorAll(selector).forEach((el) => setAnimatedElementText(el, text));
}

function setFeedback(id, text = "", ok = true) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("is-error", Boolean(text && !ok));
    el.classList.toggle("is-visible", Boolean(text));
    if (text && !el.classList.contains("is-live-refresh-render")) {
        el.classList.remove("is-visible");
        void el.offsetWidth;
        el.classList.add("is-visible");
    }
}

function timeMs(entry = {}) {
    return Number(entry.timeMs ?? Number(entry.timeSec || 0) * 1000) || 0;
}

function visits(entry = {}) {
    return Number(entry.visits || 0);
}

function limitConfig(raw = {}) {
    const limitSeconds = Number(raw.limitSeconds ?? Number(raw.limitMinutes || 0) * 60);
    return {
        enabled: raw.enabled !== false,
        limitSeconds: Number.isFinite(limitSeconds) ? limitSeconds : 0,
        tier: raw.tier || "lenient"
    };
}

function formatShortTime(ms) {
    return formatTimeSec(Math.round(Math.max(0, Number(ms) || 0) / 1000));
}

function formatCountdownMSS(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatTierLabel(tier) {
    const value = String(tier || "standard").toLowerCase();
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatTimeForDisplay(time) {
    return String(time || "").trim() || "--:--";
}

function formatScheduleDays(days) {
    const values = Array.isArray(days) ? days : [];
    if (values.length === 7) return "Every day";
    return values
        .map((day) => DAY_OPTIONS.find(([, value]) => value === Number(day))?.[0])
        .filter(Boolean)
        .join("") || "Every day";
}

function formatHourLabel(hour) {
    if (hour === 0) return "12am";
    if (hour === 12) return "12pm";
    return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function formatHourRangeTooltip(hour) {
    const next = (hour + 1) % 24;
    return `${formatHourLabel(hour)}-${formatHourLabel(next)}`;
}

function getColorGradientForIntensity(value) {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    const start = [143, 210, 216];
    const end = [212, 106, 68];
    const r = Math.round(start[0] + (end[0] - start[0]) * ratio);
    const g = Math.round(start[1] + (end[1] - start[1]) * ratio);
    const b = Math.round(start[2] + (end[2] - start[2]) * ratio);
    return `linear-gradient(180deg, rgba(${r},${g},${b},.95), rgba(${Math.round(r * .85)},${Math.round(g * .85)},${Math.round(b * .85)},.82))`;
}

function getHourlyChartScaleMs(buckets = []) {
    const totals = buckets.reduce((summary, bucket) => {
        const timeMs = Math.max(0, Number(bucket.timeMs || 0));
        summary.totalMs += timeMs;
        summary.maxMs = Math.max(summary.maxMs, timeMs);
        return summary;
    }, { totalMs: 0, maxMs: 0 });
    return Math.max(totals.maxMs, totals.totalMs * HOURLY_BAR_DAILY_SHARE_SCALE);
}

function getHourlyBarMetrics(timeMs, scaleMs) {
    const usageMs = Math.max(0, Number(timeMs || 0));
    if (usageMs <= 0 || scaleMs <= 0) {
        return { heightPct: 0, normalized: 0 };
    }

    const normalized = Math.min(1, usageMs / scaleMs);
    return {
        heightPct: Math.max(HOURLY_BAR_MIN_ACTIVE_HEIGHT_PCT, Math.round(normalized * 100)),
        normalized
    };
}

function getTopDomainsForHour(bucket = {}, limit = 3) {
    const domains = bucket.domains || {};
    return Object.entries(domains)
        .map(([domain, ms]) => ({ domain, timeMs: Number(ms || 0) }))
        .filter((entry) => entry.timeMs > 0)
        .sort((a, b) => b.timeMs - a.timeMs)
        .slice(0, limit);
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

function deleteEntriesForDomain(records = {}, domain) {
    domainKeysFor(records, domain).forEach((key) => {
        delete records[key];
    });
}

function deleteSnoozeEntriesForDomain(snoozedDomains = {}, domain) {
    deleteEntriesForDomain(snoozedDomains, domain);
}

function wasRecentlyReset(domain, recentlyReset = {}, now = Date.now()) {
    const ts = Number(entryForDomain(recentlyReset, domain) || 0);
    return Number.isFinite(ts) && ts > 0 && now - ts < 5000;
}

function isLimitCurrentlyBlocking(domain, cfg, statsToday = {}, snoozedDomains = {}, recentlyReset = {}) {
    const limit = limitConfig(cfg);
    if (!limit.enabled || !limit.limitSeconds) return false;
    if (wasRecentlyReset(domain, recentlyReset)) return false;
    const snooze = entryForDomain(snoozedDomains, domain);
    const snoozeExpiresAt = Number(snooze?.expiresAt || snooze || 0);
    if (snoozeExpiresAt > Date.now()) return false;
    return timeMs(entryForDomain(statsToday, domain) || statsToday?.[domain]) >= limit.limitSeconds * 1000;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function dayKeyOffset(offset) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return getDayKey(date);
}

function statsForRange(rangeLabel) {
    const today = state.data.allStatsToday || state.data.statsToday || {};
    const history = state.data.statsHistory || {};
    const label = String(rangeLabel || "Today").toLowerCase();

    if (label === "today") return { ...today };
    if (label === "yesterday") return { ...(history[dayKeyOffset(1)] || {}) };

    const days = label.includes("month") ? 30 : 7;
    const result = {};

    for (let offset = days - 1; offset >= 1; offset -= 1) {
        mergeStats(result, history[dayKeyOffset(offset)] || {});
    }
    mergeStats(result, today);
    return result;
}

function offsetsForRange(rangeLabel) {
    const label = String(rangeLabel || "Today").toLowerCase();
    if (label === "today") return [0];
    if (label === "yesterday") return [1];

    const days = label.includes("month") ? 30 : 7;
    return Array.from({ length: days }, (_, index) => days - 1 - index);
}

function statsForOffsets(offsets = []) {
    const result = {};
    const today = state.data.allStatsToday || state.data.statsToday || {};
    const history = state.data.statsHistory || {};

    offsets.forEach((offset) => {
        mergeStats(result, offset === 0 ? today : (history[dayKeyOffset(offset)] || {}));
    });

    return result;
}

function previousOffsets(offsets = []) {
    const periodLength = offsets.length || 1;
    return offsets.map((offset) => offset + periodLength);
}

function snoozeHistoryCount(value) {
    const direct = Number(value || 0);
    if (Number.isFinite(direct)) return Math.max(0, direct);
    if (!value || typeof value !== "object") return 0;

    return Object.values(value).reduce((sum, entry) => {
        const count = typeof entry === "object"
            ? Number(entry?.count ?? entry?.snoozes ?? 0)
            : Number(entry || 0);
        return sum + (Number.isFinite(count) ? Math.max(0, count) : 0);
    }, 0);
}

function snoozesForOffsets(offsets = []) {
    const history = state.data.snoozeHistory || {};
    return offsets.reduce((sum, offset) => sum + snoozeHistoryCount(history[dayKeyOffset(offset)]), 0);
}

function emptyReclaimSummary() {
    return { count: 0, estimatedMs: 0, bySource: {}, byTier: {} };
}

function normalizeBlockSourceKey(source) {
    return source === "scheduled" ? "scheduled" : "limit";
}

function mergeCountMap(target, source = {}, normalizeKey = (key) => key) {
    Object.entries(source || {}).forEach(([rawKey, value]) => {
        const key = normalizeKey(rawKey);
        target[key] = Number(target[key] || 0) + Math.max(0, Number(value || 0));
    });
}

function addReclaimDay(summary, day = {}) {
    const count = Math.max(0, Number(day.count || day.blockedCount || 0));
    const estimatedMs = Math.max(0, Number(day.estimatedMs || count * RECLAIM_MS_PER_BLOCK || 0));
    summary.count += count;
    summary.estimatedMs += estimatedMs;

    const sourceTotal = Object.values(day.bySource || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    if (sourceTotal > 0) {
        mergeCountMap(summary.bySource, day.bySource, normalizeBlockSourceKey);
    } else if (count > 0) {
        summary.bySource.limit = Number(summary.bySource.limit || 0) + count;
    }

    mergeCountMap(summary.byTier, day.byTier);
    return summary;
}

function reclaimStatsForOffsets(offsets = []) {
    const history = state.data[BLOCK_RECLAIM_KEY] || {};
    return offsets.reduce((summary, offset) => {
        return addReclaimDay(summary, history[dayKeyOffset(offset)] || {});
    }, emptyReclaimSummary());
}

function reclaimStatsForHistory() {
    const history = state.data[BLOCK_RECLAIM_KEY] || {};
    return Object.values(history).reduce((summary, day) => addReclaimDay(summary, day), emptyReclaimSummary());
}

function sourceCount(summary, source) {
    return Math.max(0, Number(summary?.bySource?.[source] || 0));
}

function formatBlockCount(count) {
    const total = Math.max(0, Number(count) || 0);
    return `${total.toLocaleString()} ${total === 1 ? "block" : "blocks"}`;
}

function formatDayCount(count) {
    const total = Math.max(0, Number(count) || 0);
    return `${total} ${total === 1 ? "day" : "days"}`;
}

function planetIconPath(id) {
    return PLANET_ICON_PATHS[id] || PLANET_ICON_PATHS.earth;
}

function timelinePlanetIconPath(id) {
    return TIMELINE_PLANET_ICON_PATHS[id] || PLANET_ICON_PATHS.earth;
}

function formatDistanceKm(value) {
    const distance = Math.max(0, Number(value) || 0);
    if (distance >= 1000000000) {
        const billions = distance / 1000000000;
        return `${billions >= 10 ? Math.round(billions) : billions.toFixed(1)}B km`;
    }
    if (distance >= 1000000) return `${Math.round(distance / 1000000)}M km`;
    if (distance >= 1000) return `${Math.round(distance / 1000)}k km`;
    return `${Math.round(distance)} km`;
}

function formatJourneyThreshold(ms) {
    const hours = Math.max(0, Number(ms) || 0) / HOUR_MS;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function journeyDestinationLabel(stop = {}) {
    if (stop.id === "moon") return "The Moon";
    return stop.shortLabel || stop.label || "destination";
}

function journeyForTime(estimatedMs = 0) {
    const savedMs = Math.max(0, Number(estimatedMs) || 0);
    let currentIndex = 0;
    PLANET_STOPS.forEach((stop, index) => {
        if (savedMs >= stop.thresholdMs) currentIndex = index;
    });

    const current = PLANET_STOPS[currentIndex];
    const next = PLANET_STOPS[currentIndex + 1] || null;
    const start = current.thresholdMs;
    const end = next?.thresholdMs || Math.max(current.thresholdMs, savedMs);
    const span = Math.max(1, end - start);
    const progress = next ? Math.max(0, Math.min(100, Math.round(((savedMs - start) / span) * 100))) : 100;

    return {
        current,
        currentIndex,
        next,
        progress,
        remainingMs: next ? Math.max(0, next.thresholdMs - savedMs) : 0
    };
}

function journeyVisualKey(journey) {
    return `${journey.current.id}:${journey.progress}`;
}

function journeyMarkerLeft(progress = 0) {
    const pathStart = 7.75;
    const pathEnd = 92.12;
    const pct = Math.max(0, Math.min(100, Number(progress) || 0));
    return pathStart + ((pathEnd - pathStart) * pct / 100);
}

function journeyDisplaySnapshot(summary) {
    const journey = journeyForTime(summary?.estimatedMs || 0);
    return {
        estimatedMs: Math.max(0, Number(summary?.estimatedMs) || 0),
        currentId: journey.current.id,
        currentIndex: journey.currentIndex,
        progress: journey.progress
    };
}

function prepareJourneyVisual(reclaimSummary, options = {}) {
    const current = journeyDisplaySnapshot(reclaimSummary);
    const previous = state.data[JOURNEY_DISPLAY_KEY] || {};
    const previousJourney = journeyForTime(previous.estimatedMs);
    const previousKey = previous.estimatedMs == null ? null : journeyVisualKey(previousJourney);
    const currentJourney = journeyForTime(current.estimatedMs);
    const currentKey = journeyVisualKey(currentJourney);
    const shouldAnimate = Boolean(previousKey && previousKey !== currentKey);

    state.journeyVisual = {
        summary: { ...reclaimSummary },
        previousSummary: previousKey ? { estimatedMs: Number(previous.estimatedMs) || 0 } : null,
        shouldAnimate,
        reachedPlanet: shouldAnimate && current.currentIndex > Number(previous.currentIndex || previousJourney.currentIndex || 0),
        showUnlock: options.persist !== false,
        unlockedStop: currentJourney.current,
        totalReclaimedMs: current.estimatedMs
    };

    if (options.persist !== false) {
        chrome.storage.local.set({ [JOURNEY_DISPLAY_KEY]: current });
        state.data[JOURNEY_DISPLAY_KEY] = current;
    }
}

function animateJourneyPercent(progress, animate = false) {
    const el = $("journeyProgressPct");
    if (!el) return;

    const nextValue = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    const previousValue = Number.parseInt(el.dataset.value || el.textContent, 10);
    const safePreviousValue = Number.isFinite(previousValue) ? previousValue : nextValue;
    const nextText = `${nextValue}%`;
    el.dataset.value = String(nextValue);
    el.setAttribute("aria-label", nextText);

    if (!animate || safePreviousValue === nextValue) {
        el.classList.remove("is-scrolling");
        if (safePreviousValue !== nextValue || !el.querySelector(".journey-percent-odometer")) {
            el.innerHTML = odometerPercentHtml(nextValue, nextValue);
        }
        return;
    }

    el.classList.remove("is-scrolling");
    el.innerHTML = odometerPercentHtml(safePreviousValue, nextValue);
    void el.offsetWidth;
    el.classList.add("is-scrolling");
}

function odometerDigitSequence(fromDigit, toDigit) {
    if (fromDigit === "" || toDigit === "") return [fromDigit, toDigit];
    const sequence = [fromDigit];
    let current = Number(fromDigit);
    const target = Number(toDigit);
    while (current !== target && sequence.length < 11) {
        current = (current + 1) % 10;
        sequence.push(String(current));
    }
    return sequence;
}

function odometerPercentHtml(previousValue, nextValue) {
    const from = String(Math.max(0, Math.min(100, Math.round(previousValue))));
    const to = String(Math.max(0, Math.min(100, Math.round(nextValue))));
    const width = Math.max(from.length, to.length);
    const fromPadded = from.padStart(width, " ");
    const toPadded = to.padStart(width, " ");
    const digits = Array.from({ length: width }, (_, index) => {
        const fromDigit = fromPadded[index] === " " ? "" : fromPadded[index];
        const toDigit = toPadded[index] === " " ? "" : toPadded[index];
        const sequence = odometerDigitSequence(fromDigit, toDigit);
        const steps = Math.max(0, sequence.length - 1);
        const delay = index * 0.055;
        const cells = sequence.map((digit) => (
            `<span>${digit === "" ? "&nbsp;" : escapeHtml(digit)}</span>`
        )).join("");
        return `
            <span class="journey-percent-digit" style="--digit-steps:${steps}; --digit-delay:${delay}s;">
                <span class="journey-percent-wheel">${cells}</span>
            </span>
        `;
    }).join("");

    return `
        <span class="journey-percent-odometer" aria-hidden="true">
            ${digits}
            <span class="journey-percent-symbol">%</span>
        </span>
    `;
}

function clearJourneyMotionClasses() {
    $("journeyCard")?.classList.remove("is-journey-moving", "is-planet-reached");
    $("journeyRouteTrack")?.classList.remove("is-journey-moving", "is-planet-reached");
    journeyAnimationCleanupTimer = null;
}

function startJourneyMotion(card, routeTrack, reachedPlanet) {
    if (journeyAnimationCleanupTimer) {
        window.clearTimeout(journeyAnimationCleanupTimer);
        journeyAnimationCleanupTimer = null;
    }

    card.classList.remove("is-journey-moving", "is-planet-reached");
    routeTrack?.classList.remove("is-journey-moving", "is-planet-reached");
    void card.offsetWidth;
    card.classList.add("is-journey-moving");
    routeTrack?.classList.add("is-journey-moving");

    if (reachedPlanet) {
        card.classList.add("is-planet-reached");
        routeTrack?.classList.add("is-planet-reached");
    }

    journeyAnimationCleanupTimer = window.setTimeout(clearJourneyMotionClasses, 1450);
}

function showPlanetUnlockModal(stop, totalReclaimedMs = 0) {
    const modal = $("planetUnlockModal");
    if (!modal || !stop) return;

    const planet = $("planetUnlockImage");
    if (planet) {
        planet.src = planetIconPath(stop.id);
        planet.className = "planet-unlock-image";
    }

    setText("planetUnlockTitle", `${stop.label} unlocked`);
    setText("planetUnlockTime", formatShortTime(totalReclaimedMs));
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    window.requestAnimationFrame(() => modal.classList.add("is-visible"));
    $("planetUnlockCloseBtn")?.focus({ preventScroll: true });
}

function closePlanetUnlockModal() {
    const modal = $("planetUnlockModal");
    if (!modal || modal.hidden) return;
    modal.classList.remove("is-visible");
    modal.setAttribute("aria-hidden", "true");
    window.setTimeout(() => {
        modal.hidden = true;
    }, 160);
}

function renderJourney(reclaimSummary = { count: 0, estimatedMs: 0 }) {
    const card = $("journeyCard");
    if (!card) return;

    const collapsed = Boolean(state.settings.journeyCollapsed);
    card.classList.toggle("is-collapsed", collapsed);
    const toggle = $("journeyToggleBtn");
    if (toggle) {
        toggle.setAttribute("aria-label", collapsed ? "Show journey" : "Hide journey");
        toggle.title = collapsed ? "Show journey" : "Hide journey";
        toggle.setAttribute("aria-expanded", String(!collapsed));
    }
    const collapsedTitle = $("journeyCollapsedTitle");
    if (collapsedTitle) collapsedTitle.hidden = !collapsed;

    const visual = state.journeyVisual || { summary: reclaimSummary };
    if (journeyAnimationCleanupTimer && !visual.shouldAnimate) return;

    const journey = journeyForTime(visual.summary?.estimatedMs || reclaimSummary.estimatedMs);
    const previousJourney = visual.previousSummary ? journeyForTime(visual.previousSummary.estimatedMs) : null;
    const displayJourney = visual.reachedPlanet && previousJourney
        ? { ...previousJourney, progress: 100 }
        : journey;
    const planet = $("journeyPlanet");
    if (planet) {
        planet.className = `journey-stop-planet planet-${displayJourney.current.id}`;
        planet.src = planetIconPath(displayJourney.current.id);
    }

    setText("journeyLocation", displayJourney.current.label);
    setText("journeyNext", displayJourney.next ? displayJourney.next.label : "Mission complete");
    setText("journeyCurrentThreshold", formatJourneyThreshold(displayJourney.current.thresholdMs));

    const fill = $("journeyProgressFill");
    if (fill) fill.style.removeProperty("width");
    animateJourneyPercent(displayJourney.progress, visual.shouldAnimate);
    setText(
        "journeyProgressCopy",
        visual.reachedPlanet && visual.unlockedStop
            ? `${journeyDestinationLabel(visual.unlockedStop)} unlocked`
            : (displayJourney.next ? `Next destination: ${journeyDestinationLabel(displayJourney.next)}` : "Journey complete")
    );

    const nextPlanet = $("journeyNextPlanet");
    const nextTarget = visual.reachedPlanet && visual.unlockedStop
        ? visual.unlockedStop
        : (displayJourney.next || displayJourney.current);
    if (nextPlanet) {
        nextPlanet.className = `journey-stop-planet planet-${nextTarget.id}`;
        nextPlanet.src = planetIconPath(nextTarget.id);
    }
    setText("journeyNextThreshold", formatJourneyThreshold(nextTarget.thresholdMs));

    const routeTrack = $("journeyRouteTrack");
    if (routeTrack) {
        const progress = Math.max(0, Math.min(100, displayJourney.progress));
        const markerLeft = journeyMarkerLeft(progress);
        const previousLeft = previousJourney ? journeyMarkerLeft(previousJourney.progress) : markerLeft;
        routeTrack.style.setProperty("--journey-progress-left", `${journeyMarkerLeft(0)}%`);
        routeTrack.style.setProperty("--journey-previous-right", `${previousLeft}%`);
        routeTrack.style.setProperty("--journey-progress-right", `${markerLeft}%`);
        routeTrack.style.setProperty("--journey-marker-left", `${markerLeft}%`);
        if (visual.shouldAnimate) {
            startJourneyMotion(card, routeTrack, visual.reachedPlanet);
            if (visual.reachedPlanet && visual.showUnlock) {
                window.setTimeout(() => showPlanetUnlockModal(visual.unlockedStop, visual.totalReclaimedMs), 650);
            }
        } else if (!journeyAnimationCleanupTimer) {
            card.classList.remove("is-journey-moving", "is-planet-reached");
            routeTrack.classList.remove("is-journey-moving", "is-planet-reached");
        }
    }
    if (state.journeyVisual) {
        state.journeyVisual.shouldAnimate = false;
        state.journeyVisual.reachedPlanet = false;
        state.journeyVisual.previousSummary = null;
    }
}

function renderProfile() {
    const reclaim = reclaimStatsForHistory();
    const journey = journeyForTime(reclaim.estimatedMs);
    const limitBlocks = sourceCount(reclaim, "limit");
    const scheduledBlocks = sourceCount(reclaim, "scheduled");
    const topSource = limitBlocks || scheduledBlocks
        ? (scheduledBlocks > limitBlocks ? "Schedules" : "Limits")
        : "--";
    const limitPct = reclaim.count ? Math.round((limitBlocks / reclaim.count) * 100) : 0;
    const scheduledPct = reclaim.count ? Math.round((scheduledBlocks / reclaim.count) * 100) : 0;

    setText("profileTotalReclaimed", formatShortTime(reclaim.estimatedMs));
    setText("profileBlockedCount", reclaim.count.toLocaleString());
    setText("profileCurrentLocation", journey.current.label);
    setText("profileNextDestination", journey.next ? journey.next.label : "Complete");
    setText("profileTopSource", topSource);
    setText("profileJourneySummary", `${formatDistanceKm(journey.current.distanceKm)} traveled`);
    setText("profileSourceTotal", formatBlockCount(reclaim.count));
    setText("profileLimitBlocks", formatBlockCount(limitBlocks));
    setText("profileScheduleBlocks", formatBlockCount(scheduledBlocks));
    setText("profileJourneyPhrase", `${journey.current.label} orbit`);
    setText(
        "profileJourneyDetail",
        journey.next
            ? `${journey.next.label} is ${formatShortTime(journey.remainingMs)} away`
            : "Interstellar course complete"
    );

    const limitFill = $("profileLimitSourceFill");
    if (limitFill) limitFill.style.width = `${limitPct}%`;
    const scheduledFill = $("profileScheduleSourceFill");
    if (scheduledFill) scheduledFill.style.width = `${scheduledPct}%`;

    const milestones = $("profileJourneyMilestones");
    if (!milestones) return;
    milestones.innerHTML = PLANET_STOPS.map((stop, index) => {
        const stateClass = index < journey.currentIndex
            ? " is-reached"
            : index === journey.currentIndex
            ? " is-current"
            : " is-locked";
        const meta = index <= journey.currentIndex ? "reached" : "";
        return `
            <div class="profile-map-stop profile-map-stop-${escapeHtml(stop.id)}${stateClass}">
                <span class="profile-map-connector" aria-hidden="true"></span>
                <img class="profile-map-icon" src="${escapeHtml(timelinePlanetIconPath(stop.id))}" alt="" aria-hidden="true" />
                <span class="profile-map-dot" aria-hidden="true"></span>
                <div class="profile-map-label">${escapeHtml(stop.shortLabel || stop.label)}</div>
                <div class="profile-map-meta">${escapeHtml(meta)}</div>
            </div>
        `;
    }).join("");
}

function hourlyUsageForOffsets(offsets = []) {
    const history = state.data.hourlyUsageHistory || {};
    return offsets.reduce((hours, offset) => {
        const dayBuckets = history[dayKeyOffset(offset)] || {};
        Object.entries(dayBuckets).forEach(([hourKey, bucket]) => {
            const normalizedHour = String(hourKey).padStart(2, "0");
            hours[normalizedHour] ||= { timeMs: 0, visits: 0, domains: {} };
            hours[normalizedHour].timeMs += Number(bucket?.timeMs || 0);
            hours[normalizedHour].visits += Number(bucket?.visits || 0);

            Object.entries(bucket?.domains || {}).forEach(([domain, ms]) => {
                hours[normalizedHour].domains[domain] = Number(hours[normalizedHour].domains[domain] || 0) + Number(ms || 0);
            });
        });
        return hours;
    }, {});
}

function mergeStats(target, source) {
    Object.entries(source || {}).forEach(([domain, entry]) => {
        target[domain] ||= { timeMs: 0, visits: 0 };
        target[domain].timeMs += timeMs(entry);
        target[domain].visits += visits(entry);
    });
    return target;
}

function totals(stats) {
    return Object.values(stats || {}).reduce((sum, entry) => ({
        timeMs: sum.timeMs + timeMs(entry),
        visits: sum.visits + visits(entry)
    }), { timeMs: 0, visits: 0 });
}

function formatPercentDelta(current, previous) {
    const currentValue = Number(current || 0);
    const previousValue = Number(previous || 0);
    if (previousValue <= 0 && currentValue <= 0) return "0%";
    if (previousValue <= 0) return "+100%";
    const pct = Math.round(((currentValue - previousValue) / previousValue) * 100);
    return `${pct > 0 ? "+" : ""}${pct}%`;
}

function actionChip(label, action, extra = "action-chip-primary", attrs = "") {
    return `<button type="button" class="tag action-chip ${extra}" data-action="${action}" ${attrs}>${escapeHtml(label)}</button>`;
}

function renderList(id, html, emptyText) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("muted", !html);
    el.innerHTML = html || escapeHtml(emptyText);
    if (!html || el.classList.contains("is-live-refresh-render")) return;
    el.querySelectorAll(".row").forEach((row, index) => {
        row.style.setProperty("--row-index", String(Math.min(index, 8)));
    });
}

function presetScheduleId(presetId, domain) {
    return `preset_${presetId}_${normalizeDomain(domain).replace(/[^a-z0-9]+/g, "_")}`;
}

function premiumIsActive() {
    return Boolean(state.premium?.active);
}

function countBlockedDomains(blockedDomains = {}) {
    return Object.keys(blockedDomains || {}).filter((domain) => isValidDomain(domain)).length;
}

function countScheduledBlocks(scheduledBlocks = []) {
    return Array.isArray(scheduledBlocks) ? scheduledBlocks.length : 0;
}

function presetAppliedCount(preset) {
    if (preset.ruleType === "Scheduled blocks") {
        const scheduled = state.data.scheduledBlocks || [];
        return preset.sites.filter((domain) => (
            scheduled.some((block) => normalizeDomain(block.domain) === normalizeDomain(domain))
        )).length;
    }

    const blockedDomains = state.data.blockedDomains || {};
    return preset.sites.filter((domain) => Boolean(entryForDomain(blockedDomains, domain))).length;
}

function presetListTarget(preset) {
    return preset.ruleType === "Scheduled blocks"
        ? { listId: "schedulePresetList", msgId: "schedulePresetMsg" }
        : { listId: "limitPresetList", msgId: "limitPresetMsg" };
}

function renderPresetList(listId, presets) {
    const container = $(listId);
    if (!container) return;

    const visiblePresets = presets.filter((preset) => presetAppliedCount(preset) < preset.sites.length);
    const card = container.closest(".card");
    if (card) card.hidden = visiblePresets.length === 0;

    container.innerHTML = visiblePresets.map((preset, index) => {
        const applying = state.applyingPresetId === preset.id;
        const detail = preset.ruleType === "Scheduled blocks"
            ? `${formatTimeForDisplay(preset.schedule.startTime)} - ${formatTimeForDisplay(preset.schedule.endTime)}`
            : `${preset.limitMinutes} min daily`;

        return `
            <div class="preset-option" data-preset-id="${escapeHtml(preset.id)}" style="--row-index:${Math.min(index, 8)}">
                <div class="preset-main">
                    <div class="preset-meta">${escapeHtml(preset.recommendedFor)} &bull; ${escapeHtml(formatTierLabel(preset.tier))} &bull; ${escapeHtml(detail)}</div>
                    <div class="preset-title">${escapeHtml(preset.name)}</div>
                    <div class="preset-sites">
                        ${preset.sites.slice(0, 4).map((site) => `<span>${escapeHtml(site)}</span>`).join("")}
                        ${preset.sites.length > 4 ? `<span>+${preset.sites.length - 4}</span>` : ""}
                    </div>
                </div>
                <button type="button" class="btn preset-apply-btn" data-action="apply-preset" data-preset-id="${escapeHtml(preset.id)}" ${state.applyingPresetId ? "disabled" : ""}>
                    ${applying ? "Applying" : "Apply"}
                </button>
            </div>
        `;
    }).join("");
}

function renderPresets() {
    renderPresetList(
        "limitPresetList",
        PRESET_TEMPLATES.filter((preset) => preset.ruleType !== "Scheduled blocks")
    );
    renderPresetList(
        "schedulePresetList",
        PRESET_TEMPLATES.filter((preset) => preset.ruleType === "Scheduled blocks")
    );
}

function reclaimForSelectedRange() {
    return reclaimStatsForOffsets(offsetsForRange($("statRange")?.value || "Today"));
}

function usageStatsForOffset(offset) {
    if (Number(offset) === 0) return state.data.allStatsToday || state.data.statsToday || {};
    return (state.data.statsHistory || {})[dayKeyOffset(offset)] || {};
}

function limitWasRespectedForStats(config, entry) {
    const limit = limitConfig(config);
    if (!limit.enabled || !limit.limitSeconds) return true;
    return timeMs(entry) < limit.limitSeconds * 1000;
}

function daysUnderLimits(offsets = []) {
    const blockedDomains = state.data.blockedDomains || {};
    const activeLimits = Object.entries(blockedDomains)
        .filter(([domain, config]) => isValidDomain(domain) && limitConfig(config).enabled && limitConfig(config).limitSeconds);
    if (!activeLimits.length) return 0;

    return offsets.reduce((count, offset) => {
        const stats = usageStatsForOffset(offset);
        const hadTrackedLimit = activeLimits.some(([domain]) => timeMs(entryForDomain(stats, domain)) > 0);
        if (!hadTrackedLimit) return count;
        const stayedUnder = activeLimits.every(([domain, config]) => {
            return limitWasRespectedForStats(config, entryForDomain(stats, domain));
        });
        return count + (stayedUnder ? 1 : 0);
    }, 0);
}

function consecutiveDaysUnderLimits(maxDays = 30) {
    let streak = 0;
    for (let offset = 0; offset < maxDays; offset += 1) {
        if (daysUnderLimits([offset]) !== 1) break;
        streak += 1;
    }
    return streak;
}

function renderBenefitCards(currentOffsets) {
    const weekReclaim = reclaimStatsForOffsets(offsetsForRange("This week"));
    const rangeReclaim = reclaimStatsForOffsets(currentOffsets);
    const underLimitDays = daysUnderLimits(currentOffsets);
    const underLimitStreak = consecutiveDaysUnderLimits();

    setAllAnimatedText('[data-benefit-value="saved-week"]', formatShortTime(weekReclaim.estimatedMs));
    setAllText(
        '[data-benefit-copy="saved-week"]',
        `${formatShortTime(rangeReclaim.estimatedMs)} reclaimed on this route.`
    );
    setAllAnimatedText('[data-benefit-value="avoided-visits"]', String(rangeReclaim.count));
    setAllText('[data-benefit-copy="avoided-visits"]', rangeReclaim.count === 1 ? "Distracting visit avoided." : "Distracting visits avoided.");
    setAllAnimatedText('[data-benefit-value="under-limit-days"]', formatDayCount(underLimitDays));
    setAllText(
        '[data-benefit-copy="under-limit-days"]',
        underLimitStreak > 1
            ? `${formatDayCount(underLimitStreak)} in a row.`
            : "Days stayed within active limits."
    );
}

function presetApplyMessage(preset, result) {
    const limit = preset.ruleType === "Scheduled blocks" ? FREE_LIMITS.maxScheduledBlocks : FREE_LIMITS.maxTrackedDomains;
    const unit = preset.ruleType === "Scheduled blocks" ? "scheduled blocks" : "limits";
    const parts = [];

    if (result.createdCount > 0) {
        parts.push(`${preset.name} added ${result.createdCount} new ${result.createdCount === 1 ? "rule" : "rules"}.`);
    } else {
        parts.push(`No new rules added for ${preset.name}.`);
    }

    if (result.conflictCount > 0) {
        parts.push(`${result.conflictCount} overlapping ${result.conflictCount === 1 ? "domain was" : "domains were"} left unchanged. Remove conflicting domains to apply the full preset.`);
    }

    if (result.cappedCount > 0) {
        parts.push(`Free plan allows ${limit} ${unit}.`);
    }

    return parts.join(" ");
}

function renderStats(options = {}) {
    const animateValues = options.animateValues !== false;
    const setStatText = animateValues ? setAnimatedText : setText;
    const range = $("statRange")?.value || "Today";
    const currentOffsets = offsetsForRange(range);
    const previousPeriodOffsets = previousOffsets(currentOffsets);
    const currentStats = statsForOffsets(currentOffsets);
    const previousStats = statsForOffsets(previousPeriodOffsets);
    const currentTotals = totals(currentStats);
    const previousTotals = totals(previousStats);
    const reclaim = reclaimStatsForOffsets(currentOffsets);
    const snoozes = snoozesForOffsets(currentOffsets);
    const previousSnoozes = snoozesForOffsets(previousPeriodOffsets);

    setStatText("statScreenTime", formatShortTime(currentTotals.timeMs));
    setStatText("statVisits", String(currentTotals.visits));
    setStatText("statSnoozes", String(snoozes));
    setText("statScreenTimeDelta", formatPercentDelta(currentTotals.timeMs, previousTotals.timeMs));
    setText("statVisitsDelta", formatPercentDelta(currentTotals.visits, previousTotals.visits));
    setText("statSnoozesDelta", formatPercentDelta(snoozes, previousSnoozes));
    renderJourney(reclaim);
}

function renderActive() {
    const activeBlocks = state.data.activeBlocks || [];
    const blockedDomains = state.data.blockedDomains || {};
    const statsToday = state.data.statsToday || {};
    const snoozeRowsByDomain = new Map();
    Object.entries(state.data.snoozedDomains || {}).forEach(([domain, entry]) => {
        const normalized = normalizeDomain(domain);
        const until = Number(entry?.expiresAt || entry || 0);
        if (!normalized || until <= Date.now()) return;
        const existing = snoozeRowsByDomain.get(normalized);
        if (!existing || until > existing.until) {
            snoozeRowsByDomain.set(normalized, { domain: normalized, until });
        }
    });
    const snoozed = Array.from(snoozeRowsByDomain.values());

    const activeDomains = new Set(activeBlocks.map((block) => normalizeDomain(block.domain)));
    const limitRows = Object.entries(blockedDomains)
        .filter(([domain, cfg]) => !activeDomains.has(normalizeDomain(domain)) && isLimitCurrentlyBlocking(domain, cfg, statsToday, state.data.snoozedDomains, state.data.recentlyReset))
        .map(([domain, cfg]) => ({ domain, cfg }));

    const activeRows = activeBlocks.map((block) => {
        const endMs = Number(block.endsAt || block.endAt || 0);
        const remainingSec = endMs > Date.now() ? Math.floor((endMs - Date.now()) / 1000) : 0;
        const endsText = endMs && Number.isFinite(endMs)
            ? new Date(endMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : formatTimeForDisplay(block.endTime);

        return `
            <div class="row row-accent-cyan" data-domain="${escapeHtml(block.domain)}">
                <div class="row-main">
                    <div class="row-title">${escapeHtml(block.domain)}</div>
                    <div class="row-meta">Ends: ${escapeHtml(endsText)}</div>
                    <div class="row-metrics"><span class="tag metric-chip metric-chip-glass">${formatTierLabel(block.tier)}</span></div>
                </div>
                <div class="row-right">
                    ${remainingSec > 0 ? `<span class="timer">${formatTimeSec(remainingSec)} left</span>` : ""}
                    ${actionChip("Stop", "stop-active", "action-chip-primary", `data-domain="${escapeHtml(block.domain)}"`)}
                </div>
            </div>
        `;
    });

    const pausedRows = snoozed.map(({ domain, until }) => {
        const remainingSec = Math.max(0, Math.floor((until - Date.now()) / 1000));
        const tierLabel = formatTierLabel(entryForDomain(blockedDomains, domain)?.tier);
        return `
            <div class="row row-accent-purple is-paused" data-domain="${escapeHtml(domain)}">
                <div class="row-main">
                    <div class="row-title">${escapeHtml(domain)}</div>
                </div>
                <div class="row-right">
                    <span class="tag metric-chip metric-chip-glass">${tierLabel}</span>
                    ${remainingSec > 0 ? `<span class="timer">${formatCountdownMSS(remainingSec)}</span>` : ""}
                    ${actionChip("End Pause", "clear-snooze", "action-chip-primary", `data-domain="${escapeHtml(domain)}"`)}
                </div>
            </div>
        `;
    });

    const reachedRows = limitRows.map(({ domain, cfg }) => `
        <div class="row row-with-bar row-accent-red" data-domain="${escapeHtml(domain)}">
            <div class="row-top">
                <div class="row-main">
                    <div class="row-title">${escapeHtml(domain)}</div>
                </div>
                <div class="row-right">
                    <div class="row-metrics"><span class="tag metric-chip metric-chip-glass">${formatTierLabel(cfg?.tier)}</span></div>
                    <span class="tag metric-chip metric-chip-glass">Daily limit reached</span>
                </div>
            </div>
        </div>
    `);

    const html = [...activeRows, ...pausedRows, ...reachedRows].join("");
    const activeBlockCount = activeRows.length;
    const statusPill = $("statusPill");
    if (statusPill) {
        statusPill.classList.toggle("is-inactive", activeBlockCount === 0);
        statusPill.setAttribute("aria-label", activeBlockCount > 0
            ? `${activeBlockCount} active ${activeBlockCount === 1 ? "block" : "blocks"}`
            : "No active blocks or schedules");
    }
    setAnimatedText("activeCount", activeBlockCount > 0 ? `${activeBlockCount} active` : "Idle");
    $("activeCard")?.style.setProperty("display", html ? "" : "none");
    renderList("activeList", html, "No active blocks.");
}

function rankClass(index) {
    return ["gold", "silver", "bronze"][index] || "";
}

function rankingRows(sortByVisits, range = $("statRange")?.value || "Today") {
    return Object.entries(statsForRange(range))
        .filter(([, entry]) => sortByVisits ? visits(entry) > 0 : timeMs(entry) > 0)
        .sort((a, b) => sortByVisits ? visits(b[1]) - visits(a[1]) : timeMs(b[1]) - timeMs(a[1]))
        .slice(0, 3);
}

function rankingSignature(range = $("statRange")?.value || "Today") {
    const blockedDomains = state.data.blockedDomains || {};
    const serializeRows = (sortByVisits) => rankingRows(sortByVisits, range)
        .map(([domain]) => {
            const config = blockedDomains[domain] ? limitConfig(blockedDomains[domain]) : null;
            return [
                domain,
                config ? Number(config.enabled) : 0,
                config?.limitSeconds || 0,
                config?.tier || ""
            ].join(":");
        })
        .join(",");

    return `${range}|${serializeRows(false)}|${serializeRows(true)}`;
}

function renderRankingStyled() {
    const range = $("statRange")?.value || "Today";
    const blockedDomains = state.data.blockedDomains || {};
    const todayStats = state.data.statsToday || {};

    const makeRows = (sortByVisits) => rankingRows(sortByVisits, range)
        .map(([domain, entry], index) => {
            const cfg = blockedDomains[domain];
            const config = cfg ? limitConfig(cfg) : null;
            const metricValue = sortByVisits ? String(visits(entry)) : formatShortTime(timeMs(entry));
            const hasProgress = Boolean(config?.limitSeconds && range === "Today");
            const usedSec = Math.round(timeMs(todayStats[domain]) / 1000);
            const pct = hasProgress ? Math.min(100, Math.round((usedSec / config.limitSeconds) * 100)) : 0;
            const accentClass = hasProgress
                ? (pct >= 100 ? "row-accent-red" : "row-accent-purple")
                : (cfg ? "row-accent-cyan" : "row-accent-muted");
            const right = `
                <div class="row-right ranking-row-right">
                    <span class="tag metric-chip metric-chip-glass ranking-stat-chip">${escapeHtml(metricValue)}</span>
                    ${cfg
                        ? `<span class="tag ranking-limit-chip action-chip-primary">Limited</span>`
                        : actionChip("+ Limit", "quick-limit", "action-chip-primary ranking-limit-chip", `data-domain="${escapeHtml(domain)}"`)}
                </div>
            `;

            if (hasProgress) {
                return `
                    <div class="row row-ranking row-with-bar ${accentClass}" data-domain="${escapeHtml(domain)}">
                        <div class="row-top">
                            <div class="row-main-inline">
                                <span class="rank-num ${rankClass(index)}">${index + 1}</span>
                                <div class="row-title">${escapeHtml(domain)}</div>
                            </div>
                            ${right}
                        </div>
                        <div class="row-meta">Limit used: ${formatTimeSec(usedSec)} / ${formatTimeSec(config.limitSeconds)}</div>
                        <div class="prog-wrap row-progress"><div class="prog-fill" style="width:${pct}%"></div></div>
                    </div>
                `;
            }

            return `
                <div class="row row-ranking ${accentClass}" data-domain="${escapeHtml(domain)}">
                    <span class="rank-num ${rankClass(index)}">${index + 1}</span>
                    <div class="row-main">
                        <div class="row-title">${escapeHtml(domain)}</div>
                    </div>
                    ${right}
                </div>
            `;
        })
        .join("");

    const timeTitle = $("ranking")?.parentElement?.querySelector(".card-title");
    const visitsTitle = $("rankingByVisits")?.parentElement?.querySelector(".card-title");
    if (timeTitle) timeTitle.textContent = `Time Spent - ${range}`;
    if (visitsTitle) visitsTitle.textContent = `Most Visited - ${range}`;
    state.rankingSignature = rankingSignature(range);
    renderList("ranking", makeRows(false), "No data yet.");
    renderList("rankingByVisits", makeRows(true), "No data yet.");
}

function updateRankingMetricsInPlace(options = {}) {
    const allowRerender = options.allowRerender !== false;
    const range = $("statRange")?.value || "Today";
    const nextSignature = rankingSignature(range);
    if (nextSignature !== state.rankingSignature) {
        if (allowRerender) renderRankingStyled();
        return;
    }

    const stats = statsForRange(range);
    const todayStats = state.data.statsToday || {};
    const blockedDomains = state.data.blockedDomains || {};

    const updateRows = (listId, sortByVisits) => {
        $(listId)?.querySelectorAll(".row-ranking[data-domain]").forEach((row) => {
            const domain = row.dataset.domain || "";
            const entry = stats[domain] || {};
            const statChip = row.querySelector(".ranking-stat-chip");
            if (statChip) {
                statChip.textContent = sortByVisits ? String(visits(entry)) : formatShortTime(timeMs(entry));
            }

            const config = blockedDomains[domain] ? limitConfig(blockedDomains[domain]) : null;
            if (!config?.limitSeconds || range !== "Today") return;

            const usedSec = Math.round(timeMs(todayStats[domain]) / 1000);
            const pct = Math.min(100, Math.round((usedSec / config.limitSeconds) * 100));
            const meta = row.querySelector(".row-meta");
            const fill = row.querySelector(".prog-fill");
            if (meta) meta.textContent = `Limit used: ${formatTimeSec(usedSec)} / ${formatTimeSec(config.limitSeconds)}`;
            if (fill) fill.style.width = `${pct}%`;
            row.classList.toggle("row-accent-red", pct >= 100);
            row.classList.toggle("row-accent-purple", pct < 100);
        });
    };

    updateRows("ranking", false);
    updateRows("rankingByVisits", true);
}

function insightTimeLabel(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return "Today";

    const date = new Date(value);
    const today = getDayKey();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (getDayKey(date) === today) return "Today";
    if (getDayKey(date) === getDayKey(yesterday)) return "Yesterday";
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function selectedStatsRangeLabel() {
    return $("statRange")?.value || "Today";
}

function benefitInsightItems() {
    const dismissed = state.data[DISMISSED_INSIGHTS_KEY] || {};
    const range = selectedStatsRangeLabel();
    const currentOffsets = offsetsForRange(range);
    const rangeReclaim = reclaimStatsForOffsets(currentOffsets);
    const weekReclaim = reclaimStatsForOffsets(offsetsForRange("This week"));
    const underLimitDays = daysUnderLimits(currentOffsets);
    const underLimitStreak = consecutiveDaysUnderLimits();
    const items = [];
    const now = Date.now();

    if (rangeReclaim.estimatedMs > 0) {
        items.push({
            id: `benefit_time_saved:${range}`,
            type: "benefit_time_saved",
            title: `You've reclaimed ${formatInsightReadableTime(rangeReclaim.estimatedMs)} ${insightRangePhrase(range)} with Saturn`,
            message: saturnBlockedSitesText(rangeReclaim.count),
            priority: 120,
            timestamp: now,
            context: {
                range,
                estimatedMs: rangeReclaim.estimatedMs,
                count: rangeReclaim.count,
                weekEstimatedMs: weekReclaim.estimatedMs
            }
        });
    } else if (weekReclaim.estimatedMs > 0) {
        items.push({
            id: "benefit_time_saved:week",
            type: "benefit_time_saved",
            title: `You've reclaimed ${formatInsightReadableTime(weekReclaim.estimatedMs)} this week with Saturn`,
            message: insightTimeSavedOutcome(weekReclaim.estimatedMs),
            priority: 120,
            timestamp: now,
            context: {
                range: "This week",
                estimatedMs: weekReclaim.estimatedMs,
                count: weekReclaim.count,
                weekEstimatedMs: weekReclaim.estimatedMs
            }
        });
    }

    if (rangeReclaim.count > 0) {
        items.push({
            id: `benefit_avoided_visits:${range}`,
            type: "benefit_avoided_visits",
            title: `${rangeReclaim.count} ${rangeReclaim.count === 1 ? "detour" : "detours"} stopped early`,
            message: rangeReclaim.count === 1
                ? "One impulse did not get to turn into a session."
                : "Those impulses did not get to turn into sessions.",
            priority: 118,
            timestamp: now,
            context: { range, count: rangeReclaim.count }
        });
    }

    if (underLimitDays > 0) {
        items.push({
            id: `benefit_under_limits:${range}`,
            type: "benefit_under_limits",
            title: `${formatDayCount(underLimitDays)} of limit discipline`,
            message: underLimitStreak > 1
                ? `${formatDayCount(underLimitStreak)} in a row shows the limits are becoming a habit.`
                : "You stayed inside the boundary you set for yourself.",
            priority: 116,
            timestamp: now,
            context: { range, days: underLimitDays, streak: underLimitStreak }
        });
    }

    return items.filter((insight) => !dismissed[insight.id]).slice(0, 3);
}

function personalInsightItems() {
    if (state.settings.personalInsightsEnabled === false) return [];

    const dismissed = state.data[DISMISSED_INSIGHTS_KEY] || {};
    const byDomain = new Map();

    (state.data[PERSONAL_INSIGHTS_KEY] || [])
        .filter((insight) => insight?.id && !dismissed[insight.id])
        .forEach((insight) => {
            const domain = normalizeDomain(insight.domain);
            if (!isValidDomain(domain)) return;

            const existing = byDomain.get(domain);
            const insightPriority = Number(insight.priority || 0);
            const existingPriority = Number(existing?.priority || 0);
            const insightTimestamp = Number(insight.timestamp || 0);
            const existingTimestamp = Number(existing?.timestamp || 0);

            if (!existing || insightPriority > existingPriority || (
                insightPriority === existingPriority && insightTimestamp > existingTimestamp
            )) {
                byDomain.set(domain, { ...insight, domain });
            }
        });

    const sorted = Array.from(byDomain.values())
        .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .slice(0, 4);
    return [
        ...benefitInsightItems(),
        ...withDisambiguatedInsightLabels(sorted)
    ].slice(0, 6);
}

function formatInsightMinutes(ms) {
    return `${Math.max(1, Math.round(Number(ms || 0) / 60000))} min`;
}

function formatInsightCompactTime(ms) {
    const minutes = Math.max(1, Math.round(Number(ms || 0) / 60000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatInsightReadableTime(ms) {
    const minutes = Math.max(1, Math.round(Number(ms || 0) / 60000));
    if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
    if (!remainder) return hourText;
    return `${hourText} ${remainder} ${remainder === 1 ? "minute" : "minutes"}`;
}

function insightRangePhrase(range = "") {
    const normalized = String(range || "").toLowerCase();
    if (normalized === "today") return "today";
    if (normalized === "yesterday") return "yesterday";
    if (normalized === "this month") return "this month";
    return "this week";
}

function saturnBlockedSitesText(count) {
    const total = Math.max(0, Number(count) || 0);
    if (total <= 0) return "Saturn blocked distracting sites";
    return `Saturn blocked ${total} distracting ${total === 1 ? "site" : "sites"}`;
}

function formatInsightIncreasePercent(value) {
    const ratio = Number(value || 0);
    if (!Number.isFinite(ratio) || ratio <= 0) return "";
    return `${Math.max(0, Math.round((ratio - 1) * 100))}%`;
}

function insightTimeSavedOutcome(ms) {
    const minutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
    if (minutes >= 90) return "That is enough space for a serious work block, homework session, or real downtime.";
    if (minutes >= 45) return "That is enough space for a focused work sprint or a proper reset.";
    if (minutes >= 20) return "That is enough space for a short walk, a delayed task, or a clean break.";
    if (minutes >= 10) return "That is enough space to reset before the next thing.";
    return "Even small saves matter when they interrupt the automatic scroll.";
}

function pluralizeInsight(value, singular, plural = `${singular}s`) {
    return `${Number(value || 0)} ${Number(value || 0) === 1 ? singular : plural}`;
}

function insightTitleCase(value) {
    return String(value || "")
        .split(/[\s.-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function insightDomainLabel(domain, options = {}) {
    const normalized = normalizeDomain(domain);
    const labels = {
        "youtube.com": "YouTube",
        "youtu.be": "YouTube",
        "reddit.com": "Reddit",
        "tiktok.com": "TikTok",
        "linkedin.com": "LinkedIn",
        "instagram.com": "Instagram",
        "facebook.com": "Facebook",
        "twitter.com": "Twitter",
        "x.com": "X",
        "netflix.com": "Netflix",
        "twitch.tv": "Twitch",
        "discord.com": "Discord",
        "gmail.com": "Gmail",
        "accounts.google.com": "Google Account",
        "analytics.google.com": "Google Analytics",
        "calendar.google.com": "Google Calendar",
        "chat.google.com": "Google Chat",
        "chrome.google.com": "Chrome Web Store",
        "classroom.google.com": "Google Classroom",
        "docs.google.com": "Google Docs",
        "drive.google.com": "Google Drive",
        "mail.google.com": "Gmail",
        "maps.google.com": "Google Maps",
        "meet.google.com": "Google Meet",
        "news.google.com": "Google News",
        "photos.google.com": "Google Photos",
        "translate.google.com": "Google Translate"
    };

    if (options.expanded) return normalized || "";
    if (labels[normalized]) return labels[normalized];

    const parts = normalized.split(".").filter(Boolean);
    if (!parts.length) return normalized;

    const last = parts[parts.length - 1] || "";
    const secondLast = parts[parts.length - 2] || "";
    const rootIndex = parts.length > 2 && last.length === 2 && secondLast.length <= 3
        ? parts.length - 3
        : Math.max(0, parts.length - 2);
    return insightTitleCase(parts[rootIndex] || parts[0]);
}

function withDisambiguatedInsightLabels(insights = []) {
    const labelCounts = insights.reduce((counts, insight) => {
        const label = insightDomainLabel(insight.domain);
        if (label) counts[label] = (counts[label] || 0) + 1;
        return counts;
    }, {});

    return insights.map((insight) => {
        const label = insightDomainLabel(insight.domain);
        return {
            ...insight,
            displayDomainLabel: labelCounts[label] > 1
                ? insightDomainLabel(insight.domain, { expanded: true })
                : label
        };
    });
}

function insightDaypartForHour(hour) {
    const value = ((Number(hour) % 24) + 24) % 24;
    if (value >= 5 && value < 12) return "mornings";
    if (value >= 12 && value < 17) return "afternoons";
    if (value >= 17 && value < 22) return "evenings";
    return "late nights";
}

function normalizeInsightDaypart(value, plural = true) {
    const text = String(value || "").toLowerCase();
    if (text.includes("late")) return plural ? "late nights" : "late night";
    if (text.includes("morning")) return plural ? "mornings" : "morning";
    if (text.includes("afternoon")) return plural ? "afternoons" : "afternoon";
    if (text.includes("evening")) return plural ? "evenings" : "evening";
    return "";
}

function insightDaypartAdjective(value) {
    const daypart = normalizeInsightDaypart(value, false);
    if (daypart === "late night") return "Late-night";
    if (daypart) return insightTitleCase(daypart);
    return "";
}

function insightAfterHourText(hour) {
    const value = ((Number(hour) % 24) + 24) % 24;
    if (value === 0) return "after midnight";
    if (value === 12) return "after noon";
    return `after ${formatHourLabel(value)}`;
}

function insightWindowPhrase(context = {}, options = {}) {
    const usePeak = options.usePeak !== false;
    const hour = Number(usePeak ? (context.peakHour ?? context.hour) : context.hour);
    const daypart = normalizeInsightDaypart(
        (usePeak ? (context.peakDaypart || context.daypart) : context.daypart)
            || (Number.isFinite(hour) ? insightDaypartForHour(hour) : ""),
        false
    );

    if (daypart === "morning") return "before noon";
    if (daypart === "afternoon") return "in the afternoon";
    if (daypart === "evening") return Number.isFinite(hour) ? insightAfterHourText(hour) : "in the evening";
    if (daypart === "late night") return Number.isFinite(hour) ? insightAfterHourText(hour) : "late at night";
    if (Number.isFinite(hour)) return `around ${formatHourLabel(hour)}`;
    return "";
}

function insightDayCountText(context = {}, preferStraight = false) {
    const consecutiveDays = Number(context.consecutiveDays || 0);
    const activeDays = Number(context.activeDays || context.peakActiveDays || consecutiveDays || 0);
    const windowDays = Number(context.windowDays || 0);

    if (preferStraight && consecutiveDays > 0) return `${consecutiveDays} straight days`;
    if (windowDays > 0 && activeDays > 0) {
        return activeDays >= windowDays
            ? `each of the last ${windowDays} days`
            : `${activeDays} of the last ${windowDays} days`;
    }
    if (consecutiveDays > 0) return `${consecutiveDays} straight days`;
    if (activeDays > 0) return pluralizeInsight(activeDays, "day");
    return "";
}

function hourlyDomainEntry(bucket = {}, domain = "") {
    const normalized = normalizeDomain(domain);
    const result = { timeMs: 0, visits: 0 };

    Object.entries(bucket.domains || {}).forEach(([rawDomain, ms]) => {
        if (normalizeDomain(rawDomain) === normalized) result.timeMs += Math.max(0, Number(ms || 0));
    });
    Object.entries(bucket.domainVisits || {}).forEach(([rawDomain, visitCount]) => {
        if (normalizeDomain(rawDomain) === normalized) result.visits += Math.max(0, Number(visitCount || 0));
    });

    return result;
}

function recentDomainHourlyPattern(domain, days = 7) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return {};

    const history = state.data.hourlyUsageHistory || {};
    const hours = Array.from({ length: 24 }, () => ({ activeDays: 0, totalMs: 0, visits: 0 }));

    for (let offset = 0; offset < days; offset += 1) {
        const day = history[dayKeyOffset(offset)] || {};
        for (let hour = 0; hour < 24; hour += 1) {
            const bucket = day[String(hour).padStart(2, "0")] || {};
            const entry = hourlyDomainEntry(bucket, normalized);
            if (entry.timeMs <= 0 && entry.visits <= 0) continue;
            hours[hour].activeDays += 1;
            hours[hour].totalMs += entry.timeMs;
            hours[hour].visits += entry.visits;
        }
    }

    const best = hours
        .map((entry, hour) => ({ hour, ...entry }))
        .filter((entry) => entry.activeDays > 0)
        .sort((a, b) => (
            b.activeDays - a.activeDays
            || b.totalMs - a.totalMs
            || b.visits - a.visits
        ))[0];

    if (!best) return {};
    return {
        peakHour: best.hour,
        peakDaypart: insightDaypartForHour(best.hour),
        peakActiveDays: best.activeDays,
        peakTotalMs: best.totalMs,
        peakVisits: best.visits
    };
}

function recentDomainSummary(domain, days = 7) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return { activeDays: 0, totalMs: 0, visits: 0 };

    let activeDays = 0;
    let totalMs = 0;
    let visitCount = 0;

    for (let offset = 0; offset < days; offset += 1) {
        const stats = offset === 0
            ? (state.data.allStatsToday || state.data.statsToday || {})
            : ((state.data.statsHistory || {})[dayKeyOffset(offset)] || {});
        const entry = entryForDomain(stats, normalized) || {};
        const dayMs = timeMs(entry);
        const dayVisits = visits(entry);
        if (dayMs > 0 || dayVisits > 0) activeDays += 1;
        totalMs += dayMs;
        visitCount += dayVisits;
    }

    return { activeDays, totalMs, visits: visitCount };
}

function insightContextWithFallback(insight = {}, domain = "") {
    const context = { ...(insight.context || {}) };
    const baseWindowDays = Math.max(1, Number(context.windowDays || 7));
    const hourlyPattern = recentDomainHourlyPattern(domain, baseWindowDays);

    if (context.daypart == null && Number.isFinite(Number(context.hour))) {
        context.daypart = insightDaypartForHour(Number(context.hour));
    }
    if (context.peakHour == null && Number.isFinite(Number(hourlyPattern.peakHour))) {
        context.peakHour = hourlyPattern.peakHour;
    }
    if (!context.peakDaypart && context.peakHour != null) {
        context.peakDaypart = insightDaypartForHour(Number(context.peakHour));
    }
    if (!context.peakDaypart && hourlyPattern.peakDaypart) {
        context.peakDaypart = hourlyPattern.peakDaypart;
    }
    if (!context.peakActiveDays && hourlyPattern.peakActiveDays) {
        context.peakActiveDays = hourlyPattern.peakActiveDays;
    }
    if (!context.peakTotalMs && hourlyPattern.peakTotalMs) {
        context.peakTotalMs = hourlyPattern.peakTotalMs;
    }
    if (!context.peakVisits && hourlyPattern.peakVisits) {
        context.peakVisits = hourlyPattern.peakVisits;
    }

    if (insight.type !== "limit_suggestion") return context;

    const windowDays = baseWindowDays;
    const summary = recentDomainSummary(domain, windowDays);
    return {
        ...context,
        windowDays,
        activeDays: Number(context.activeDays || summary.activeDays || 0),
        totalMs: Number(context.totalMs || summary.totalMs || 0),
        visits: Number(context.visits || summary.visits || 0)
    };
}

function insightHeadlineEmphasis(value, className = "insight-stat-emphasis") {
    return `<span class="${className}">${escapeHtml(value)}</span>`;
}

function insightUsageMetricText(context = {}) {
    if (Number(context.totalMs || 0) > 0) return formatInsightCompactTime(context.totalMs);
    if (Number(context.todayMs || 0) > 0) return formatInsightCompactTime(context.todayMs);
    if (Number(context.visits || 0) > 0) return pluralizeInsight(context.visits, "visit");
    return "";
}

function isBenefitInsight(insight = {}) {
    return String(insight.type || "").startsWith("benefit_");
}

function insightPersonalHeadlineHtml(insight = {}, domain = "") {
    const context = insightContextWithFallback(insight, domain);
    const domainHtml = insightHeadlineEmphasis(insight.displayDomainLabel || insightDomainLabel(domain), "insight-domain-emphasis");

    if (insight.type === "benefit_time_saved") {
        const savedText = formatInsightReadableTime(context.estimatedMs || context.weekEstimatedMs);
        const rangeText = insightRangePhrase(context.range);
        return `You've reclaimed ${insightHeadlineEmphasis(savedText)} ${escapeHtml(rangeText)} with Saturn`;
    }
    if (insight.type === "benefit_avoided_visits") {
        return `${insightHeadlineEmphasis(pluralizeInsight(context.count, "impulse"))} stopped early`;
    }
    if (insight.type === "benefit_under_limits") {
        return `${insightHeadlineEmphasis(formatDayCount(context.days))} of follow-through`;
    }
    if (insight.type === "long_session" && context.durationMs) {
        return `${domainHtml} is holding your attention right now`;
    }
    if (insight.type === "recurring_time_block" && context.consecutiveDays) {
        const hour = Number(context.hour);
        const daypart = normalizeInsightDaypart(context.daypart || insightDaypartForHour(hour));
        return `${domainHtml} often appears during your ${escapeHtml(daypart || "routine")}`;
    }
    if (insight.type === "high_visit_frequency" && context.visits) {
        const hour = Number(context.hour);
        const daypart = normalizeInsightDaypart(context.daypart || insightDaypartForHour(hour), false);
        return `${domainHtml} keeps showing up ${escapeHtml(daypart ? `this ${daypart}` : "right now")}`;
    }
    if (insight.type === "usage_increase" && context.ratio) {
        const daypart = context.peakDaypart || context.daypart;
        const adjective = insightDaypartAdjective(daypart);
        return `${adjective ? `${escapeHtml(adjective)} ` : ""}${domainHtml} activity is increasing`;
    }
    if (insight.type === "limit_suggestion" && context.activeDays) {
        if (context.peakDaypart && Number(context.peakActiveDays || context.activeDays || 0) >= 2) {
            return `${domainHtml} often appears during your ${escapeHtml(normalizeInsightDaypart(context.peakDaypart))}`;
        }
        return `${domainHtml} has been a frequent stop this week`;
    }
    return `${escapeHtml(insight.title || "New pattern")} for ${domainHtml}`;
}

function insightPersonalSubheadingHtml(insight = {}, domain = "") {
    const context = insightContextWithFallback(insight, domain);

    if (insight.type === "benefit_time_saved") {
        const count = Number(context.count || 0);
        return saturnBlockedSitesText(count);
    }
    if (insight.type === "benefit_avoided_visits") {
        return "Those urges did not get to become full sessions";
    }
    if (insight.type === "benefit_under_limits") {
        const streak = Number(context.streak || 0);
        if (streak > 1) return `${insightHeadlineEmphasis(formatDayCount(streak))} in a row shows the boundary is becoming a habit`;
        return "You stayed inside the boundary you set for yourself";
    }
    if (insight.type === "long_session" && context.durationMs) {
        return `Active for ${insightHeadlineEmphasis(formatInsightMinutes(context.durationMs))} straight`;
    }
    if (insight.type === "recurring_time_block" && context.consecutiveDays) {
        const windowText = insightWindowPhrase(context, { usePeak: false });
        const daysText = insightDayCountText(context, true);
        if (windowText && daysText) {
            return `Active ${escapeHtml(windowText)} for ${insightHeadlineEmphasis(daysText)}`;
        }
        if (daysText) return `Active for ${insightHeadlineEmphasis(daysText)}`;
        return "";
    }
    if (insight.type === "high_visit_frequency" && context.visits) {
        return `Opened ${insightHeadlineEmphasis(pluralizeInsight(context.visits, "time"))} this hour`;
    }
    if (insight.type === "usage_increase" && context.ratio) {
        const windowText = insightWindowPhrase(context);
        return `Usage ${windowText ? `${escapeHtml(windowText)} ` : ""}rose ${insightHeadlineEmphasis(formatInsightIncreasePercent(context.ratio))} today`;
    }
    if (insight.type === "limit_suggestion" && context.activeDays) {
        const windowText = insightWindowPhrase(context);
        const daysText = insightDayCountText(context);
        if (windowText && daysText) {
            return `Active ${escapeHtml(windowText)} on ${insightHeadlineEmphasis(daysText)}`;
        }
        if (daysText) return `Active on ${insightHeadlineEmphasis(daysText)}`;

        const metricText = insightUsageMetricText(context);
        return metricText ? `Logged ${insightHeadlineEmphasis(metricText)} this week` : "";
    }
    return "";
}

function insightSlideHtml(insight, index) {
    const blockedDomains = state.data.blockedDomains || {};
    const domain = normalizeDomain(insight.domain);
    const isBenefit = isBenefitInsight(insight);
    const isLimited = Boolean(entryForDomain(blockedDomains, domain));
    const action = !isBenefit && !isLimited
        ? actionChip("Add Limit", "insight-add-limit", "action-chip-primary insight-primary-action", `data-domain="${escapeHtml(domain)}"`)
        : "";
    const accent = isBenefit
        ? "row-accent-cyan"
        : insight.action === "addLimit" && !isLimited
        ? "row-accent-purple"
        : (index % 2 ? "row-accent-cyan" : "row-accent-muted");
    const subheading = insightPersonalSubheadingHtml(insight, domain);

    return `
        <div class="row insight-row ${accent}" data-insight-id="${escapeHtml(insight.id)}" data-insight-type="${escapeHtml(insight.type || "")}" ${domain ? `data-domain="${escapeHtml(domain)}"` : ""}>
            <div class="row-main">
                <div class="insight-headline-row">
                    <div class="insight-copy-block">
                        <div class="insight-stat-headline">${insightPersonalHeadlineHtml(insight, domain)}</div>
                        ${subheading ? `<div class="insight-stat-subheading">${subheading}</div>` : ""}
                    </div>
                </div>
            </div>
            <div class="row-right insight-actions">
                ${action}
                ${actionChip("x", "dismiss-insight", "action-chip-primary insight-close-x", `data-id="${escapeHtml(insight.id)}" aria-label="Close insight"`)}
            </div>
        </div>
    `;
}

function insightHeaderControls(count) {
    if (count <= 1) return "";

    return `
        ${actionChip("", "insight-prev", "action-chip-primary insight-nav-chip insight-nav-prev", `aria-label="Previous insight"`)}
        <span class="insight-carousel-count">${state.selectedInsightIndex + 1} / ${count}</span>
        ${actionChip("", "insight-next", "action-chip-primary insight-nav-chip insight-nav-next", `aria-label="Next insight"`)}
    `;
}

function renderPersonalInsights() {
    const insights = personalInsightItems();
    const card = $("personalInsightsCard");
    const list = $("personalInsightsList");
    const nav = $("personalInsightsNav");
    if (nav) nav.innerHTML = "";
    if (!list) return;

    if (!insights.length) {
        if (card) {
            card.hidden = true;
            card.classList.add("dashboard-card-hidden");
        }
        list.classList.add("muted");
        list.innerHTML = "";
        return;
    }

    if (card) {
        card.hidden = false;
        card.classList.remove("dashboard-card-hidden");
    }
    state.selectedInsightIndex = Math.max(0, Math.min(state.selectedInsightIndex, insights.length - 1));
    if (nav) nav.innerHTML = insightHeaderControls(insights.length);
    list.classList.remove("muted");
    list.innerHTML = `
        <div class="insight-carousel">
            ${insightSlideHtml(insights[state.selectedInsightIndex], state.selectedInsightIndex)}
        </div>
    `;

    const visibleInsight = insights[state.selectedInsightIndex];
    if (visibleInsight?.id && !viewedInsightsThisSession.has(visibleInsight.id)) {
        viewedInsightsThisSession.add(visibleInsight.id);
        trackFunnelEvent("insight_viewed", {
            trigger: "dashboard",
            action: visibleInsight.action || "view"
        });
    }
}

function moveInsightCarousel(direction) {
    const insights = personalInsightItems();
    if (insights.length <= 1) return;
    const nextIndex = (state.selectedInsightIndex + direction + insights.length) % insights.length;
    state.selectedInsightIndex = nextIndex;
    renderPersonalInsights();
}

function renderHourlyStyled() {
    const list = $("hourlyDistribution");
    const insight = $("usageInsight");
    const title = $("usageCardTitle");
    if (!list) return;
    const range = $("statRange")?.value || "Today";
    if (title) title.textContent = `Usage Distribution - ${range}`;

    const bucketsByHour = hourlyUsageForOffsets(offsetsForRange(range));
    const buckets = Array.from({ length: 24 }, (_, hour) => {
        const key = String(hour).padStart(2, "0");
        const bucket = bucketsByHour[key] || {};
        const hasDomains = Object.keys(bucket.domains || {}).length > 0;
        return {
            hour,
            timeMs: Number(bucket.timeMs || 0),
            domains: bucket.domains || {},
            hasDomainBreakdown: hasDomains
        };
    });
    const scaleMs = getHourlyChartScaleMs(buckets);
    const peakHour = buckets.reduce((peak, bucket) => bucket.timeMs > peak.timeMs ? bucket : peak, buckets[0]);

    if (scaleMs <= 0) {
        list.classList.add("muted");
        list.textContent = "No data yet.";
        if (insight) {
            insight.classList.add("muted");
            insight.textContent = "Click a bar to view details.";
        }
        return;
    }

    list.classList.remove("muted");
    list.innerHTML = `
        <div class="hourly-chart-wrap">
            <div class="hourly-chart" aria-label="Hourly usage distribution">
                ${buckets.map((bucket) => {
                    const { heightPct, normalized } = getHourlyBarMetrics(bucket.timeMs, scaleMs);
                    const isPeak = bucket.hour === peakHour.hour && peakHour.timeMs > 0;
                    return `
                        <div class="hourly-slot${isPeak ? " is-peak" : ""}${bucket.timeMs > 0 ? "" : " is-empty"}"
                             data-hour="${bucket.hour}"
                             data-time-ms="${bucket.timeMs}"
                             data-height-pct="${heightPct}"
                             data-scale-ms="${scaleMs}"
                             data-domains='${escapeHtml(JSON.stringify(getTopDomainsForHour(bucket, 3)))}'
                             data-has-domain-breakdown="${bucket.hasDomainBreakdown}"
                             data-is-peak="${isPeak}"
                             role="button"
                             tabindex="0"
                             aria-pressed="false"
                             title="${formatHourRangeTooltip(bucket.hour)}: ${formatShortTime(bucket.timeMs)}">
                            <div class="hourly-slot-bar">
                                <div class="hourly-slot-fill" style="height:${heightPct}%; background:${getColorGradientForIntensity(normalized)};"></div>
                            </div>
                            <div class="hourly-slot-label">${bucket.hour % 3 === 0 ? formatHourLabel(bucket.hour) : "&nbsp;"}</div>
                        </div>
                    `;
                }).join("")}
            </div>
        </div>
    `;

    const slots = list.querySelectorAll(".hourly-slot");

    slots.forEach((slot) => {
        slot.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectHourlySlot(slot, { persist: true });
            }
        });
    });

    const selectedSlot = Number.isInteger(state.selectedHourlyHour)
        ? Array.from(slots).find((slot) => Number(slot.dataset.hour) === state.selectedHourlyHour)
        : null;
    const defaultSlot = selectedSlot || Array.from(slots).find((slot) => Number(slot.dataset.hour) === peakHour.hour) || slots[0];
    if (defaultSlot) selectHourlySlot(defaultSlot, { persist: false });
}

function selectHourlySlot(slot, options = {}) {
    const list = slot?.closest("#hourlyDistribution");
    const slots = list?.querySelectorAll(".hourly-slot") || [];
    const hour = Number(slot?.dataset.hour);
    if (options.persist !== false && Number.isInteger(hour)) {
        state.selectedHourlyHour = hour;
    }
    slots.forEach((item) => {
        item.classList.remove("is-selected");
        item.setAttribute("aria-pressed", "false");
    });
    slot.classList.add("is-selected");
    slot.setAttribute("aria-pressed", "true");
    renderHourInsightStyled(slot);
}

function renderHourInsightStyled(slot) {
    const insight = $("usageInsight");
    if (!insight) return;

    const hour = Number(slot.dataset.hour || 0);
    const time = Number(slot.dataset.timeMs || 0);
    const isPeak = slot.dataset.isPeak === "true";
    const hasDomainBreakdown = slot.dataset.hasDomainBreakdown === "true";
    let domains = [];
    try {
        domains = JSON.parse(slot.dataset.domains || "[]");
    } catch {
        domains = [];
    }

    if (time <= 0) {
        insight.classList.add("muted");
        insight.textContent = `${formatHourRangeTooltip(hour)} has no tracked usage.`;
        return;
    }

    insight.classList.remove("muted");
    insight.innerHTML = `
        <div class="hourly-tip-header">
            <div class="hourly-tip-time">${formatHourRangeTooltip(hour)}${isPeak ? ' - <span class="hourly-tip-inline-peak">Peak</span>' : ""}</div>
            <div class="hourly-tip-time-spent">${formatShortTime(time)} spent</div>
        </div>
        ${domains.length > 0
            ? `<div class="hourly-tip-sites">${domains.map((entry) => `
                <div class="hourly-tip-site-row">
                    <div class="hourly-tip-site-main"><div class="hourly-tip-site-domain">${escapeHtml(entry.domain)}</div></div>
                    <div class="hourly-tip-site-time">${formatShortTime(entry.timeMs)}</div>
                </div>
            `).join("")}</div>`
            : `<div class="hourly-tip-sites"><div class="hourly-tip-empty">${hasDomainBreakdown ? "No tracked sites this hour" : "Site breakdown unavailable for this hour"}</div></div>`}
        <div class="hourly-tip-footer">
            <div class="hourly-tip-actions">
                <button class="hourly-action-btn primary is-compact" data-action="hour-limit" data-domain="${escapeHtml(domains[0]?.domain || "")}">Limit</button>
                <button class="hourly-action-btn secondary is-compact" data-action="hour-schedule" data-domain="${escapeHtml(domains[0]?.domain || "")}" data-hour="${hour}">Schedule</button>
            </div>
        </div>
    `;
}

function renderLimitsStyled() {
    const blockedDomains = state.data.blockedDomains || {};
    const stats = state.data.statsToday || {};
    const rows = Object.entries(blockedDomains)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([domain, raw]) => {
            const config = limitConfig(raw);
            const statEntry = entryForDomain(stats, domain) || stats[domain];
            const usedSec = Math.round(timeMs(statEntry) / 1000);
            const pct = config.limitSeconds ? Math.min(100, Math.round((usedSec / config.limitSeconds) * 100)) : 0;
            const isActive = isLimitCurrentlyBlocking(domain, config, stats, state.data.snoozedDomains, state.data.recentlyReset);
            const accent = !config.enabled
                ? "row-accent-muted"
                : (pct >= 100 ? "row-accent-red" : (pct >= 85 ? "row-accent-purple" : "row-accent-cyan"));

            return `
                <div class="row row-limit row-with-bar ${accent}${config.enabled ? "" : " is-disabled"}">
                    <div class="row-top">
                        <div class="row-main">
                            <div class="row-title">${escapeHtml(domain)}</div>
                            <div class="row-metrics">
                                <span class="tag metric-chip metric-chip-glass">${formatTierLabel(config.tier)}</span>
                                <span class="tag metric-chip metric-chip-glass">Limit ${config.limitSeconds ? `${Math.round(config.limitSeconds / 60)} min` : "--"}</span>
                                <span class="tag metric-chip metric-chip-glass limit-used-chip" data-domain="${escapeHtml(domain)}">Today ${formatTimeSec(usedSec)}</span>
                                <span class="tag metric-chip metric-chip-glass">${visits(statEntry)} visits</span>
                            </div>
                        </div>
                        <div class="row-right">
                            <label class="switch" title="Enable or disable this limit">
                                <input class="switch-input" type="checkbox" data-action="toggle-domain" data-domain="${escapeHtml(domain)}" ${config.enabled ? "checked" : ""} aria-label="Toggle ${escapeHtml(domain)} limit" />
                                <span class="switch-slider" aria-hidden="true"></span>
                            </label>
                            ${actionChip("Remove", "remove-domain", "action-chip-danger", `data-domain="${escapeHtml(domain)}" ${isActive ? "disabled" : ""}`)}
                        </div>
                    </div>
                    ${config.limitSeconds ? `<div class="prog-wrap row-progress"><div class="prog-fill" style="width:${pct}%"></div></div>` : ""}
                </div>
            `;
        })
        .join("");

    renderList("limitList", rows, "No limits set yet.");
    renderPaywalls();
}

function updateLimitUsageChipsInPlace() {
    const stats = state.data.statsToday || {};
    document.querySelectorAll("#limitList .limit-used-chip[data-domain]").forEach((chip) => {
        const domain = chip.dataset.domain;
        const statEntry = entryForDomain(stats, domain) || stats[domain];
        const usedSec = Math.round(timeMs(statEntry) / 1000);
        chip.textContent = `Today ${formatTimeSec(usedSec)}`;
    });
}

function renderScheduleDays() {
    const container = $("scheduledDays");
    if (!container) return;

    container.innerHTML = DAY_OPTIONS.map(([label, value]) => `
        <button type="button" class="day-bubble ${state.selectedDays.includes(value) ? "is-selected" : ""}" data-day="${value}">
            ${label}
        </button>
    `).join("");

    container.querySelectorAll(".day-bubble").forEach((button) => {
        button.addEventListener("click", () => {
            const day = Number(button.dataset.day);
            state.selectedDays = state.selectedDays.includes(day)
                ? state.selectedDays.filter((value) => value !== day)
                : [...state.selectedDays, day].sort((a, b) => a - b);
            if (state.selectedDays.length) container.classList.remove("is-invalid");
            renderScheduleDays();
        });
    });
}

function renderSchedulesStyled() {
    const activeIds = new Set((state.data.activeBlocks || []).map((block) => block.id));
    const rows = (state.data.scheduledBlocks || []).map((block) => {
        const days = block.days || block.daysOfWeek || [];
        const enabled = block.enabled !== false;
        const active = enabled && activeIds.has(block.id);
        const accent = !enabled ? "row-accent-muted is-disabled" : (active ? "row-accent-purple" : "row-accent-cyan");

        return `
            <div class="row ${accent}">
                <div class="row-main">
                    <div class="row-title">${escapeHtml(block.domain)}</div>
                    <div class="row-metrics schedule-row-metrics">
                        <span class="tag metric-chip metric-chip-glass">${formatTierLabel(block.tier)}</span>
                        <span class="tag metric-chip metric-chip-glass">${formatScheduleDays(days)}</span>
                        <span class="tag metric-chip metric-chip-glass">${formatTimeForDisplay(block.startTime)} - ${formatTimeForDisplay(block.endTime)}</span>
                    </div>
                </div>
                <div class="row-right">
                    <label class="switch" title="Enable or pause this scheduled block">
                        <input class="switch-input" type="checkbox" data-action="toggle-schedule" data-id="${escapeHtml(block.id)}" data-enabled="${enabled ? "false" : "true"}" ${enabled ? "checked" : ""} aria-label="Toggle ${escapeHtml(block.domain)} scheduled block" />
                        <span class="switch-slider" aria-hidden="true"></span>
                    </label>
                    ${actionChip("Edit", "edit-schedule", "action-chip-primary", `data-id="${escapeHtml(block.id)}"`)}
                    ${actionChip("Cancel", "remove-schedule", "action-chip-danger", `data-id="${escapeHtml(block.id)}" ${active ? "disabled" : ""}`)}
                </div>
            </div>
        `;
    }).join("");

    renderList("scheduledList", rows, "No scheduled sessions.");
    renderPaywalls();
}

function renderPaywalls() {
    const isPremium = premiumIsActive();
    const blockedCount = countBlockedDomains(state.data.blockedDomains || {});
    const scheduleCount = countScheduledBlocks(state.data.scheduledBlocks || []);

    const limitsPaywall = $("limitsPaywallCard");
    if (limitsPaywall) {
        limitsPaywall.style.display = !isPremium && blockedCount >= FREE_LIMITS.maxTrackedDomains ? "block" : "none";
    }
    setText("limitsPaywallNotice", `Free users can manage up to ${FREE_LIMITS.maxTrackedDomains} websites. Upgrade to Saturn Pro Lifetime to manage unlimited sites.`);

    const schedulePaywall = $("schedulePaywallCard");
    if (schedulePaywall) {
        schedulePaywall.style.display = !isPremium && scheduleCount >= FREE_LIMITS.maxScheduledBlocks ? "block" : "none";
    }
    setText("schedulePaywallNotice", "Schedule blocks are one of Saturn's most powerful tools. Upgrade to create unlimited blocks.");

    const profileUpgradeCard = $("profileUpgradeCard");
    if (profileUpgradeCard) profileUpgradeCard.hidden = isPremium;
}

function renderStreak() {
    const todayStats = state.data.allStatsToday || state.data.statsToday || {};
    const history = state.data.statsHistory || {};
    let streak = Object.values(todayStats).some((entry) => timeMs(entry) > 0) ? 1 : 0;

    for (let offset = 1; offset < 365; offset += 1) {
        const dayStats = history[dayKeyOffset(offset)] || {};
        if (!Object.values(dayStats).some((entry) => timeMs(entry) > 0)) break;
        streak += 1;
    }

    setAnimatedText("streakHeaderValue", String(streak));
}

function renderImmutableOverride() {
    const button = $("immutableAdminOverrideBtn");
    const copy = $("immutableOverrideCopy");
    const override = state.immutableOverride || {};
    const available = Boolean(override.available);
    const usedToday = Boolean(override.usedToday);
    const sourceLabel = override.source === "scheduled" ? "scheduled block" : "daily limit";

    if (copy) {
        copy.textContent = usedToday
            ? "Emergency override already used today."
            : available
            ? `Immutable ${sourceLabel} active for ${override.domain}.`
            : (override.message || "Available only while this tab is blocked by an immutable rule.");
    }

    if (button) {
        button.disabled = !available;
        button.classList.toggle("is-unavailable", !available);
        button.classList.toggle("is-used", usedToday);
        button.textContent = usedToday
            ? "Override Used Today"
            : available
            ? (override.source === "scheduled" ? "End Immutable Session" : "Use Emergency Override")
            : "No Active Immutable Block";
    }

}

function renderSettings() {
    const defaultLimit = $("defaultLimitMinutes");
    const use24Hour = $("use24HourTime");
    const limitNotifications = $("limitNotificationsEnabled");
    const personalInsights = $("personalInsightsEnabled");
    const insightNotifications = $("insightNotificationsEnabled");
    const maxNotifications = $("insightMaxNotificationsPerDay");
    const sensitivity = $("insightSensitivity");
    if (defaultLimit) defaultLimit.value = state.settings.defaultLimitMinutes;
    if (use24Hour) use24Hour.checked = Boolean(state.settings.use24HourTime);
    if (limitNotifications) limitNotifications.checked = state.settings.limitNotificationsEnabled !== false;
    if (personalInsights) personalInsights.checked = state.settings.personalInsightsEnabled !== false;
    if (insightNotifications) insightNotifications.checked = state.settings.insightNotificationsEnabled !== false;
    if (maxNotifications) maxNotifications.value = Math.max(0, Math.min(5, Number(state.settings.insightMaxNotificationsPerDay ?? 1)));
    if (sensitivity) sensitivity.value = ["low", "normal", "high"].includes(state.settings.insightSensitivity)
        ? state.settings.insightSensitivity
        : "normal";
    renderImmutableOverride();

    setText("premiumStatusMsg", state.premium.active
        ? `${state.premium.planName || "Premium"} active`
        : "Premium inactive");
}

function beginRankingMotionSuppression() {
    if (rankingMotionRestoreTimer) {
        window.clearTimeout(rankingMotionRestoreTimer);
        rankingMotionRestoreTimer = null;
    }
    LIVE_REFRESH_TARGET_IDS.forEach((id) => {
        const target = $(id);
        if (!target) return;
        target.classList.add("live-refresh-target", "is-live-refresh-render");
    });
}

function endRankingMotionSuppressionSoon() {
    void document.documentElement.offsetHeight;
    rankingMotionRestoreTimer = window.setTimeout(() => {
        document.querySelectorAll(".live-refresh-target.is-live-refresh-render").forEach((target) => {
            target.classList.remove("is-live-refresh-render");
        });
        rankingMotionRestoreTimer = null;
    }, LIVE_REFRESH_MOTION_SUPPRESSION_MS);
}

function renderAll(options = {}) {
    const suppressRankingMotion = options.suppressRankingMotion === true;
    const updateRankingInPlace = options.updateRankingInPlace === true;
    if (suppressRankingMotion) beginRankingMotionSuppression();

    try {
        renderStats();
        renderProfile();
        renderActive();
        if (updateRankingInPlace) updateRankingMetricsInPlace();
        else renderRankingStyled();
        renderPersonalInsights();
        renderHourlyStyled();
        renderPresets();
        renderLimitsStyled();
        renderScheduleDays();
        renderSchedulesStyled();
        renderStreak();
        renderSettings();
    } finally {
        if (suppressRankingMotion) endRankingMotionSuppressionSoon();
    }
}

function renderLiveUsageOnly() {
    beginRankingMotionSuppression();
    try {
        renderStats({ animateValues: false });
        updateRankingMetricsInPlace({ allowRerender: false });
        if ($("tab2")?.checked) {
            updateLimitUsageChipsInPlace();
        }
    } finally {
        endRankingMotionSuppressionSoon();
    }
}

async function loadAll(options = {}) {
    const shouldFlush = options.flush === true;
    if (shouldFlush) await send("flushActiveTimeNow", { source: "popup" });
    if (options.refreshInsights === true) {
        await send("generateInsights", { allowNotifications: false });
    }
    state.data = await chrome.storage.local.get([
        "blockedDomains",
        "statsToday",
        "allStatsToday",
        "statsHistory",
        "hourlyUsageHistory",
        PERSONAL_INSIGHTS_KEY,
        DISMISSED_INSIGHTS_KEY,
        "snoozeHistory",
        "snoozedDomains",
        "recentlyReset",
        "activeBlocks",
        "scheduledBlocks",
        SETTINGS_KEY,
        PREMIUM_KEY,
        REVIEW_PROMPT_STATE_KEY,
        ONBOARDING_KEY,
        BLOCK_RECLAIM_KEY,
        JOURNEY_DISPLAY_KEY,
        "immutableAdminOverrideEnabled"
    ]);

    state.settings = { ...DEFAULT_SETTINGS, ...(state.data[SETTINGS_KEY] || {}) };
    state.premium = { ...DEFAULT_PREMIUM, ...(state.data[PREMIUM_KEY] || {}) };
    state.onboarding = { ...state.onboarding, ...(state.data[ONBOARDING_KEY] || {}) };
    if (options.updateJourneyDisplay === true || !state.journeyVisual) {
        prepareJourneyVisual(reclaimForSelectedRange(), { persist: options.updateJourneyDisplay === true });
    }
    const overrideState = await send("getImmutableOverrideState");
    state.immutableOverride = overrideState?.success ? overrideState : { available: false };
    if (options.liveUsageOnly === true) {
        renderLiveUsageOnly();
        return;
    }
    renderAll({
        suppressRankingMotion: options.suppressRankingMotion === true,
        updateRankingInPlace: options.updateRankingInPlace === true
    });
}

function refreshLive() {
    if (liveRefreshPromise) return liveRefreshPromise;
    liveRefreshPromise = loadAll({ flush: true, liveUsageOnly: true }).finally(() => {
        liveRefreshPromise = null;
    });
    return liveRefreshPromise;
}

async function addDomain(event) {
    event.preventDefault();
    const domain = normalizeDomain($("domainInput")?.value);
    const minutes = Number($("limitInput")?.value || state.settings.defaultLimitMinutes);
    const tier = $("limitTier")?.value || "standard";

    const result = await saveLimitForDomain(domain, minutes, tier);
    if (!result.success) {
        setFeedback("addFormMsg", result.error, false);
        return;
    }
    $("addForm")?.reset();
    if ($("limitInput")) $("limitInput").value = state.settings.defaultLimitMinutes;
    setFeedback("addFormMsg", "Limit saved.");
    await send("refreshActionBadge");
    await loadAll();
}

async function saveLimitForDomain(domain, minutes, tier = "standard") {
    const normalized = normalizeDomain(domain);
    const numericMinutes = Number(minutes);
    if (!isValidDomain(normalized)) {
        return { success: false, error: "Enter a valid domain." };
    }
    if (!Number.isFinite(numericMinutes) || numericMinutes <= 0 || numericMinutes > MAX_DAILY_LIMIT_MINUTES) {
        return { success: false, error: `Enter a daily limit from 1 to ${MAX_DAILY_LIMIT_MINUTES} minutes.` };
    }

    const data = await chrome.storage.local.get(["blockedDomains", "alertsSent"]);
    const blockedDomains = data.blockedDomains || {};
    const created = !entryForDomain(blockedDomains, normalized);
    if (created && !premiumIsActive() && countBlockedDomains(blockedDomains) >= FREE_LIMITS.maxTrackedDomains) {
        return {
            success: false,
            error: `Free plan includes ${FREE_LIMITS.maxTrackedDomains} limits. Remove one or upgrade to add more.`
        };
    }

    deleteEntriesForDomain(blockedDomains, normalized);
    blockedDomains[normalized] = {
        enabled: true,
        limitSeconds: Math.round(numericMinutes * 60),
        tier
    };

    const alertsSent = data.alertsSent || {};
    deleteEntriesForDomain(alertsSent, normalized);
    await chrome.storage.local.set({ blockedDomains, alertsSent });
    if (created) {
        await trackBlockRuleAdded("limit", tier);
        await trackFunnelEventOnce("firstLimitCreatedAt", "first_limit_created", {
            block_source: "limit",
            block_tier: tier || "unknown"
        });
    }
    return { success: true, domain: normalized, created };
}

async function applyLimitPreset(preset) {
    const data = await chrome.storage.local.get(["blockedDomains", "alertsSent"]);
    const blockedDomains = data.blockedDomains || {};
    const alertsSent = data.alertsSent || {};
    const isPremium = premiumIsActive();
    let availableSlots = isPremium
        ? Number.POSITIVE_INFINITY
        : Math.max(0, FREE_LIMITS.maxTrackedDomains - countBlockedDomains(blockedDomains));
    let createdCount = 0;
    let cappedCount = 0;
    let conflictCount = 0;

    preset.sites.forEach((site) => {
        const domain = normalizeDomain(site);
        if (!isValidDomain(domain)) return;
        const existing = entryForDomain(blockedDomains, domain);
        if (existing) {
            conflictCount += 1;
            return;
        }

        if (!existing && availableSlots <= 0) {
            cappedCount += 1;
            return;
        }

        deleteEntriesForDomain(alertsSent, domain);
        blockedDomains[domain] = {
            enabled: true,
            limitSeconds: Math.round(Number(preset.limitMinutes || 30) * 60),
            tier: preset.tier || "standard",
            presetId: preset.id,
            presetName: preset.name,
            updatedAt: Date.now()
        };
        createdCount += 1;
        availableSlots -= 1;
    });

    if (createdCount > 0) {
        await chrome.storage.local.set({ blockedDomains, alertsSent });
    }
    if (createdCount > 0) {
        await trackBlockRuleAdded("limit", preset.tier);
        await trackFunnelEventOnce("firstLimitCreatedAt", "first_limit_created", {
            block_source: "limit",
            block_tier: preset.tier || "unknown",
            trigger: "preset"
        });
    }
    return {
        createdCount,
        conflictCount,
        cappedCount,
        skippedCount: conflictCount + cappedCount,
        capped: cappedCount > 0,
        conflicted: conflictCount > 0
    };
}

async function applyScheduledPreset(preset) {
    const data = await chrome.storage.local.get(["scheduledBlocks"]);
    const scheduled = data.scheduledBlocks || [];
    const isPremium = premiumIsActive();
    let availableSlots = isPremium
        ? Number.POSITIVE_INFINITY
        : Math.max(0, FREE_LIMITS.maxScheduledBlocks - countScheduledBlocks(scheduled));
    let createdCount = 0;
    let cappedCount = 0;
    let conflictCount = 0;

    for (const site of preset.sites) {
        const domain = normalizeDomain(site);
        if (!isValidDomain(domain)) continue;
        const exists = scheduled.some((item) => normalizeDomain(item.domain) === domain);
        if (exists) {
            conflictCount += 1;
            continue;
        }

        const block = {
            id: presetScheduleId(preset.id, domain),
            domain,
            startTime: preset.schedule.startTime,
            endTime: preset.schedule.endTime,
            days: preset.schedule.days,
            tier: preset.tier || "standard",
            enabled: true
        };
        if (availableSlots <= 0) {
            cappedCount += 1;
            continue;
        }

        const response = await send("addScheduledBlock", { block });
        if (!response?.success) {
            throw new Error(response?.error || `Could not apply ${preset.name}.`);
        }
        scheduled.push(block);
        createdCount += 1;
        availableSlots -= 1;
    }

    if (createdCount > 0) {
        await trackBlockRuleAdded("scheduled", preset.tier);
        await trackFunnelEventOnce("firstScheduleCreatedAt", "first_schedule_created", {
            block_source: "scheduled",
            block_tier: preset.tier || "unknown",
            trigger: "preset"
        });
    }
    return {
        createdCount,
        conflictCount,
        cappedCount,
        skippedCount: conflictCount + cappedCount,
        capped: cappedCount > 0,
        conflicted: conflictCount > 0
    };
}

async function applyPreset(presetId) {
    const preset = PRESET_TEMPLATES.find((item) => item.id === presetId);
    if (!preset || state.applyingPresetId) return;
    const { msgId } = presetListTarget(preset);

    state.applyingPresetId = preset.id;
    renderPresets();
    setFeedback(msgId, `Applying ${preset.name}...`);
    try {
        const result = preset.ruleType === "Scheduled blocks"
            ? await applyScheduledPreset(preset)
            : await applyLimitPreset(preset);
        await send("refreshActionBadge");
        await loadAll();
        setFeedback(
            msgId,
            presetApplyMessage(preset, result),
            result.createdCount > 0 && !result.capped && !result.conflicted
        );
        await trackFunnelEvent("preset_applied", {
            preset_id: preset.id,
            rule_type: preset.ruleType,
            created_count: result.createdCount,
            skipped_count: result.skippedCount,
            conflict_count: result.conflictCount,
            capped_count: result.cappedCount
        });
    } catch (error) {
        setFeedback(msgId, error instanceof Error ? error.message : "Could not apply preset.", false);
    } finally {
        state.applyingPresetId = null;
        renderPresets();
    }
}

async function removeDomain(domain) {
    const data = await chrome.storage.local.get(["blockedDomains", "alertsSent", "snoozedDomains"]);
    const blockedDomains = data.blockedDomains || {};
    const alertsSent = data.alertsSent || {};
    const snoozedDomains = data.snoozedDomains || {};
    const normalized = normalizeDomain(domain);
    deleteEntriesForDomain(blockedDomains, normalized);
    deleteEntriesForDomain(alertsSent, normalized);
    deleteSnoozeEntriesForDomain(snoozedDomains, normalized);
    await chrome.storage.local.set({ blockedDomains, alertsSent, snoozedDomains });
    await send("refreshActionBadge");
    await loadAll();
}

async function toggleDomain(domain, enabled) {
    const response = await send("toggleDomainLimitEnabled", { domain, enabled });
    if (!response?.success) {
        console.error("Toggle limit failed:", response?.error || "Unknown error");
        return;
    }
    await loadAll();
}

async function clearSnooze(domain) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return;

    const response = await send("clearDomainSnooze", {
        domain: normalized,
        reason: "popup_end_pause",
        enforceDelayMs: 1500
    });
    if (!response?.success) {
        console.error("End pause enforcement failed:", response?.error || "Unknown error");
        const data = await chrome.storage.local.get(["snoozedDomains"]);
        const snoozedDomains = data.snoozedDomains || {};
        deleteSnoozeEntriesForDomain(snoozedDomains, normalized);
        await chrome.storage.local.set({ snoozedDomains });
    }
    await loadAll();
}

async function quickAddLimit(domain) {
    const minutes = Number(state.settings.defaultLimitMinutes || DEFAULT_SETTINGS.defaultLimitMinutes);
    const tier = $("limitTier")?.value || "standard";
    const result = await saveLimitForDomain(domain, minutes, tier);

    if (!result.success) {
        setFeedback("addFormMsg", result.error, false);
        $("domainInput")?.focus();
        return;
    }

    $("addForm")?.reset();
    if ($("limitInput")) $("limitInput").value = state.settings.defaultLimitMinutes;
    setFeedback("addFormMsg", `Limit added for ${result.domain}.`);
    await send("refreshActionBadge");
    await loadAll();
}

function prefillLimitForm(domain) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return;

    trackFunnelEvent("insight_add_limit_clicked", { trigger: "personal_insight" });
    const tab = $("tab2");
    const input = $("domainInput");
    if (tab) tab.checked = true;
    if (input) input.value = normalized;
    if ($("limitInput") && !$("limitInput").value) $("limitInput").value = state.settings.defaultLimitMinutes;
    setFeedback("addFormMsg", `Ready to add a limit for ${normalized}.`);
    input?.focus();
}

function viewInsightUsage(domain) {
    const normalized = normalizeDomain(domain);
    if (!isValidDomain(normalized)) return;

    if ($("tab1")) $("tab1").checked = true;
    if ($("statRange")) $("statRange").value = "Today";
    state.selectedHourlyHour = null;
    renderAll();

    const row = Array.from(document.querySelectorAll("#ranking [data-domain], #rankingByVisits [data-domain]"))
        .find((candidate) => normalizeDomain(candidate.dataset.domain) === normalized);
    if (!row) return;
    row.classList.add("is-highlighted");
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    window.setTimeout(() => row.classList.remove("is-highlighted"), 1200);
}

async function dismissPersonalInsight(id) {
    const response = await send("dismissInsight", { id });
    if (!response?.success) {
        console.error("Dismiss insight failed:", response?.error || "Unknown error");
        return;
    }
    await loadAll();
}

async function stopActiveBlock(domain) {
    await send("endScheduledBlock", { domain });
    await loadAll();
}

function scheduleFromForm() {
    return {
        id: state.editingScheduleId || `${normalizeDomain($("scheduledDomain")?.value)}_${Date.now()}`,
        domain: normalizeDomain($("scheduledDomain")?.value),
        startTime: $("startTime")?.value.trim(),
        endTime: $("endTime")?.value.trim(),
        days: state.selectedDays,
        tier: $("scheduledTier")?.value || "standard",
        enabled: true
    };
}

async function saveSchedule(event) {
    event.preventDefault();
    const block = scheduleFromForm();
    const missingScheduleFields = !block.domain || !block.startTime || !block.endTime || !block.days.length;
    $("scheduledDays")?.classList.toggle("is-invalid", !block.days.length);

    if (missingScheduleFields) {
        setFeedback("scheduledFormMsg", "Complete the schedule fields.", false);
        return;
    }
    if (!isValidDomain(block.domain)) {
        setFeedback("scheduledFormMsg", "Enter a valid domain.", false);
        return;
    }
    if (!isValidScheduleTimeInput(block.startTime) || !isValidScheduleTimeInput(block.endTime)) {
        setFeedback("scheduledFormMsg", "Enter valid start and end times.", false);
        return;
    }

    const isNewSchedule = !state.editingScheduleId;
    if (isNewSchedule && !premiumIsActive() && countScheduledBlocks(state.data.scheduledBlocks || []) >= FREE_LIMITS.maxScheduledBlocks) {
        setFeedback("scheduledFormMsg", `Free plan includes ${FREE_LIMITS.maxScheduledBlocks} scheduled blocks. Remove one or upgrade to add more.`, false);
        return;
    }

    const action = isNewSchedule ? "addScheduledBlock" : "updateScheduledBlock";
    const response = await send(action, { block });
    if (response.success && isNewSchedule) {
        await trackBlockRuleAdded("scheduled", block.tier);
        await trackFunnelEventOnce("firstScheduleCreatedAt", "first_schedule_created", {
            block_source: "scheduled",
            block_tier: block.tier || "unknown"
        });
    }
    setFeedback("scheduledFormMsg", response.success ? "Schedule saved." : response.error, response.success);
    if (response.success) resetScheduleForm();
    await loadAll();
}

function editSchedule(id) {
    const block = (state.data.scheduledBlocks || []).find((item) => item.id === id);
    if (!block) return;

    state.editingScheduleId = block.id;
    const savedDays = block.days || block.daysOfWeek || [];
    state.selectedDays = Array.isArray(savedDays) && savedDays.length ? savedDays : [0, 1, 2, 3, 4, 5, 6];
    $("scheduledDomain").value = block.domain;
    $("startTime").value = block.startTime;
    $("endTime").value = block.endTime;
    $("scheduledTier").value = block.tier || "standard";
    $("cancelScheduledEditBtn").hidden = false;
    setText("scheduledSubmitBtn", "Update Schedule");
    setText("scheduledFormModeLabel", "Editing recurring block.");
    $("scheduledFormModeLabel").hidden = false;
    renderScheduleDays();
}

function resetScheduleForm() {
    state.editingScheduleId = null;
    state.selectedDays = [];
    $("scheduledForm")?.reset();
    $("cancelScheduledEditBtn").hidden = true;
    $("scheduledFormModeLabel").hidden = true;
    setText("scheduledSubmitBtn", "Deploy Schedule");
    $("scheduledDays")?.classList.remove("is-invalid");
    renderScheduleDays();
}

async function removeSchedule(id) {
    const data = await chrome.storage.local.get(["scheduledBlocks", "activeBlocks"]);
    await chrome.storage.local.set({
        scheduledBlocks: (data.scheduledBlocks || []).filter((block) => block.id !== id),
        activeBlocks: (data.activeBlocks || []).filter((block) => block.id !== id)
    });
    await chrome.alarms.clear(`startBlock_${id}`).catch(() => {});
    await chrome.alarms.clear(`endBlock_${id}`).catch(() => {});
    await loadAll();
}

async function toggleSchedule(id, enabled) {
    await send("toggleScheduledBlockEnabled", { id, enabled });
    await loadAll();
}

function settingsFromForm() {
    const limitNotifications = $("limitNotificationsEnabled");
    const insightMax = Number($("insightMaxNotificationsPerDay")?.value ?? DEFAULT_SETTINGS.insightMaxNotificationsPerDay);
    const sensitivity = String($("insightSensitivity")?.value || DEFAULT_SETTINGS.insightSensitivity).toLowerCase();
    return {
        defaultLimitMinutes: Math.max(1, Number($("defaultLimitMinutes")?.value || DEFAULT_SETTINGS.defaultLimitMinutes)),
        use24HourTime: Boolean($("use24HourTime")?.checked),
        limitNotificationsEnabled: limitNotifications
            ? Boolean(limitNotifications.checked)
            : state.settings.limitNotificationsEnabled !== false,
        personalInsightsEnabled: $("personalInsightsEnabled")
            ? Boolean($("personalInsightsEnabled").checked)
            : state.settings.personalInsightsEnabled !== false,
        insightNotificationsEnabled: $("insightNotificationsEnabled")
            ? Boolean($("insightNotificationsEnabled").checked)
            : state.settings.insightNotificationsEnabled !== false,
        insightMaxNotificationsPerDay: Number.isFinite(insightMax)
            ? Math.max(0, Math.min(5, Math.round(insightMax)))
            : DEFAULT_SETTINGS.insightMaxNotificationsPerDay,
        insightSensitivity: ["low", "normal", "high"].includes(sensitivity)
            ? sensitivity
            : DEFAULT_SETTINGS.insightSensitivity,
        journeyCollapsed: Boolean(state.settings.journeyCollapsed)
    };
}

async function recordDashboardOpenForPrompt() {
    const prompt = reviewPromptState();
    const today = getDayKey();
    const seenDays = Array.isArray(prompt.dashboardOpenDays) ? prompt.dashboardOpenDays : [];
    await persistReviewPromptState({
        createdAt: Number(prompt.createdAt || Date.now()),
        dashboardOpenCount: Number(prompt.dashboardOpenCount || 0) + 1,
        dashboardOpenDays: seenDays.includes(today) ? seenDays : [...seenDays, today].slice(-30)
    });
}

async function persistSettings() {
    state.settings = settingsFromForm();
    await chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
    if (state.settings.personalInsightsEnabled !== false) {
        await send("generateInsights", { allowNotifications: false });
    }
    renderStats();
    renderProfile();
    setFeedback("settingsSavedMsg", "Settings saved");
}

async function toggleJourneyCollapsed() {
    state.settings = {
        ...state.settings,
        journeyCollapsed: !state.settings.journeyCollapsed
    };
    await chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
    renderStats();
}

async function saveSettings(event) {
    event.preventDefault();
    await persistSettings();
}

async function useImmutableOverride() {
    const response = await send("useImmutableAdminOverride");
    if (response?.success) {
        setFeedback(
            "immutableOverrideMsg",
            response.source === "scheduled" ? "Immutable session ended." : "Emergency override used.",
            true
        );
        state.immutableOverride = { available: false, usedToday: true };
        renderImmutableOverride();
        return;
    }

    setFeedback("immutableOverrideMsg", response?.error || "No active immutable block found.", false);
    await loadAll();
}

async function syncPremium() {
    const response = await send("refreshPremiumStatus");
    if (response.success && response.premium) {
        state.premium = response.premium;
        renderSettings();
    }
    setFeedback("premiumStatusMsg", response.success ? "Premium status synced." : response.error, response.success);
}

async function linkWhopToken() {
    const token = $("manualWhopToken")?.value.trim();
    if (!token) {
        setFeedback("premiumStatusMsg", "Paste a token first.", false);
        return;
    }

    const response = await send("completeWhopCheckout", { token });
    setFeedback("premiumStatusMsg", response.success ? "Premium status synced." : response.error, response.success);
    await loadAll();
}

function whopCheckoutStartUrl() {
    try {
        const url = new URL(WHOP_CHECKOUT_START_URL);
        const extensionId = chrome.runtime?.id || "";
        if (extensionId) url.searchParams.set("ext", extensionId);
        return url.toString();
    } catch {
        return WHOP_CHECKOUT_URL;
    }
}

function openWhopCheckout(trigger = "unknown") {
    trackFunnelEvent("upgrade_clicked", { trigger });
    // TODO: Replace Whop URLs with final production purchase URLs before publishing.
    chrome.tabs.create({ url: whopCheckoutStartUrl() });
}

function reviewPromptState() {
    const value = state.data[REVIEW_PROMPT_STATE_KEY];
    return value && typeof value === "object" ? value : {};
}

async function persistReviewPromptState(patch = {}) {
    const now = Date.now();
    const next = {
        ...reviewPromptState(),
        ...patch,
        updatedAt: now
    };
    await chrome.storage.local.set({ [REVIEW_PROMPT_STATE_KEY]: next });
    state.data[REVIEW_PROMPT_STATE_KEY] = next;
    return next;
}

function showReviewPromptToast() {
    const toast = $("reviewPromptToast");
    if (!toast) return;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("is-visible"));
}

function hideReviewPromptToast() {
    const toast = $("reviewPromptToast");
    if (!toast) return;
    toast.classList.remove("is-visible");
    window.setTimeout(() => {
        toast.hidden = true;
    }, 180);
}

function hasFiveUsageDays() {
    const history = state.data.statsHistory || {};
    const today = state.data.allStatsToday || state.data.statsToday || {};
    const activeDays = new Set();
    if (Object.values(today).some((entry) => timeMs(entry) > 0 || visits(entry) > 0)) activeDays.add(getDayKey());
    Object.entries(history).forEach(([day, stats]) => {
        if (Object.values(stats || {}).some((entry) => timeMs(entry) > 0 || visits(entry) > 0)) activeDays.add(day);
    });
    return activeDays.size >= 5;
}

function reviewPromptEligible() {
    const prompt = reviewPromptState();
    const totalReclaim = reclaimStatsForHistory();
    return hasFiveUsageDays()
        || countBlockedDomains(state.data.blockedDomains || {}) >= 2
        || countScheduledBlocks(state.data.scheduledBlocks || []) >= 1
        || Number(prompt.dashboardOpenCount || 0) >= REVIEW_PROMPT_MIN_DASHBOARD_OPENS
        || totalReclaim.estimatedMs >= REVIEW_PROMPT_MIN_RECLAIM_MS;
}

async function maybeShowReviewPromptToast() {
    const prompt = reviewPromptState();
    const now = Date.now();
    if (prompt.reviewedAt || prompt.feedbackSubmittedAt || prompt.feedbackClickedAt) return;

    const nextPromptAt = Number(prompt.nextPromptAt || 0);
    if (!nextPromptAt) {
        await persistReviewPromptState({
            createdAt: Number(prompt.createdAt || now),
            nextPromptAt: now + REVIEW_PROMPT_FIRST_DELAY_MS,
            shownCount: Number(prompt.shownCount || 0)
        });
        return;
    }

    if (!reviewPromptEligible()) return;
    if (nextPromptAt > now) return;

    showReviewPromptToast();
    trackFunnelEvent("review_prompt_shown", {
        trigger: "popup",
        action: "shown"
    });
    await persistReviewPromptState({
        lastShownAt: now,
        nextPromptAt: now + REVIEW_PROMPT_INTERVAL_MS,
        shownCount: Number(prompt.shownCount || 0) + 1
    });
}

async function deferReviewPromptToast(action = "not_now") {
    const now = Date.now();
    trackFunnelEvent("review_prompt_action", { action });
    await persistReviewPromptState({
        dismissedAt: now,
        dismissedAction: action,
        nextPromptAt: now + REVIEW_PROMPT_INTERVAL_MS
    });
    hideReviewPromptToast();
}

async function openSurveyMonkeyFeedback() {
    await persistReviewPromptState({
        feedbackClickedAt: Date.now(),
        nextPromptAt: null
    });
    trackFunnelEvent("review_prompt_action", { action: "give_feedback" });
    chrome.tabs.create({ url: SURVEYMONKEY_FEEDBACK_URL });
    hideReviewPromptToast();
}

async function openChromeWebStoreReview() {
    trackFunnelEvent("review_prompt_action", { action: "leave_review" });
    // TODO: Confirm this Chrome Web Store review URL after the final listing ID is locked.
    chrome.tabs.create({ url: CHROME_WEBSTORE_REVIEW_URL });
    await persistReviewPromptState({
        reviewedAt: Date.now(),
        nextPromptAt: null
    });
    hideReviewPromptToast();
}

async function handleActivationNotice() {
    const data = await chrome.storage.local.get([WHOP_ACTIVATION_NOTICE_KEY]);
    if (!data[WHOP_ACTIVATION_NOTICE_KEY]) return;

    openSettingsOverlay({ focus: false });
    setFeedback("premiumStatusMsg", "Premium activated.", true);
    await chrome.storage.local.remove(WHOP_ACTIVATION_NOTICE_KEY);
}

function selectedOnboardingStep() {
    if (state.onboarding.version !== ONBOARDING_VERSION) return 0;
    const rawStep = Number(state.onboarding.step || 0);
    if (!Number.isFinite(rawStep)) return 0;
    return Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, rawStep));
}

function setActiveTab(tabId) {
    const tab = $(tabId);
    if (tab) tab.checked = true;
}

function openSettingsOverlay(options = {}) {
    const overlay = $("settingsOverlay");
    if (!overlay) return;
    if (settingsOverlayCloseTimer) {
        window.clearTimeout(settingsOverlayCloseTimer);
        settingsOverlayCloseTimer = null;
    }
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    $("settingsCogBtn")?.setAttribute("aria-expanded", "true");
    window.requestAnimationFrame(() => overlay.classList.add("is-visible"));

    if (options.focus !== false) {
        window.setTimeout(() => $("settingsCloseBtn")?.focus({ preventScroll: true }), 0);
    }
}

function closeSettingsOverlay(options = {}) {
    const overlay = $("settingsOverlay");
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove("is-visible");
    overlay.setAttribute("aria-hidden", "true");
    $("settingsCogBtn")?.setAttribute("aria-expanded", "false");
    if (settingsOverlayCloseTimer) window.clearTimeout(settingsOverlayCloseTimer);
    settingsOverlayCloseTimer = window.setTimeout(() => {
        overlay.hidden = true;
        settingsOverlayCloseTimer = null;
    }, 180);

    if (options.focus !== false) {
        $("settingsCogBtn")?.focus({ preventScroll: true });
    }
}

function onboardingShouldShow() {
    return !state.onboarding.completed || state.onboarding.version !== ONBOARDING_VERSION;
}

function renderOnboardingMarkers(stepIndex) {
    const container = $("onboardingStepMarkers");
    if (!container) return;

    container.innerHTML = ONBOARDING_STEPS.map((_, index) => `
        <button class="onboarding-step-marker ${index === stepIndex ? "is-active" : ""}" type="button" data-step="${index}" aria-label="Go to tour step ${index + 1}" ${index === stepIndex ? "aria-current=\"step\"" : ""}>${index + 1}</button>
    `).join("");
}

function positionOnboardingTour(target, placement = "auto") {
    const scene = document.querySelector(".scene");
    const spotlight = $("onboardingSpotlight");
    const tooltip = $("onboardingTooltip");
    if (!scene || !spotlight || !tooltip || !target) return;

    const panel = target.closest(".panel");
    if (panel) {
        const targetCenter = target.offsetTop + target.offsetHeight / 2;
        panel.scrollTop = Math.max(0, targetCenter - panel.clientHeight / 2);
    }
    window.scrollTo(0, 0);

    requestAnimationFrame(() => {
        const sceneRect = scene.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const pad = 8;
        const left = Math.max(8, targetRect.left - sceneRect.left - pad);
        const top = Math.max(8, targetRect.top - sceneRect.top - pad);
        const width = Math.min(sceneRect.width - 16, targetRect.width + pad * 2);
        const height = Math.min(sceneRect.height - 16, targetRect.height + pad * 2);

        spotlight.style.left = `${left}px`;
        spotlight.style.top = `${top}px`;
        spotlight.style.width = `${width}px`;
        spotlight.style.height = `${height}px`;
        spotlight.style.borderRadius = getComputedStyle(target).borderRadius || "14px";

        const tipRect = tooltip.getBoundingClientRect();
        const tipWidth = Math.min(330, sceneRect.width - 28);
        let tipLeft = Math.min(sceneRect.width - tipWidth - 14, Math.max(14, left + width / 2 - tipWidth / 2));
        let tipTop = top + height + 12;

        if (placement === "center") {
            tipLeft = Math.max(14, (sceneRect.width - tipWidth) / 2);
            tipTop = Math.max(14, (sceneRect.height - tipRect.height) / 2);
        } else if (tipTop + tipRect.height > sceneRect.height - 14) {
            tipTop = top - tipRect.height - 12;
        }

        if (tipTop < 14) {
            tipTop = 14;
        }

        tooltip.style.width = `${tipWidth}px`;
        tooltip.style.left = `${tipLeft}px`;
        tooltip.style.top = `${tipTop}px`;
    });
}

function showOnboardingStep(step) {
    const stepIndex = Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, Number(step) || 0));
    const config = ONBOARDING_STEPS[stepIndex];
    const overlay = $("onboardingOverlay");
    if (!overlay || !config) return;

    setActiveTab(config.tabId);
    state.onboarding = {
        ...state.onboarding,
        step: stepIndex,
        completed: false,
        version: ONBOARDING_VERSION
    };
    chrome.storage.local.set({ [ONBOARDING_KEY]: state.onboarding });

    setText("onboardingStepCount", `${stepIndex + 1} of ${ONBOARDING_STEPS.length}`);
    setText("onboardingTitle", config.title);
    setText("onboardingCopy", config.copy);
    renderOnboardingMarkers(stepIndex);

    const redirectPreview = $("onboardingRedirectPreview");
    if (redirectPreview) redirectPreview.hidden = !config.showRedirectPreview;

    const previousButton = $("onboardingPrevBtn");
    const nextButton = $("onboardingNextBtn");
    const doneButton = $("onboardingDoneBtn");
    if (previousButton) previousButton.disabled = stepIndex === 0;
    if (nextButton) nextButton.hidden = stepIndex === ONBOARDING_STEPS.length - 1;
    if (doneButton) doneButton.hidden = stepIndex !== ONBOARDING_STEPS.length - 1;

    overlay.style.display = "block";
    overlay.focus({ preventScroll: true });

    requestAnimationFrame(() => {
        const target = document.querySelector(config.target) || document.querySelector(".panels");
        positionOnboardingTour(target, config.placement);
    });
}

function showOnboardingIfNeeded() {
    const overlay = $("onboardingOverlay");
    if (!overlay || !onboardingShouldShow()) return false;
    overlay.style.display = "block";
    showOnboardingStep(selectedOnboardingStep());
    trackFunnelEventOnce("onboardingStartedAt", "onboarding_started", {
        onboarding_step: selectedOnboardingStep()
    });
    return true;
}

async function completeOnboarding(skipped = false) {
    state.onboarding = {
        step: skipped ? selectedOnboardingStep() : ONBOARDING_STEPS.length - 1,
        completed: true,
        completedAt: Date.now(),
        skipped,
        version: ONBOARDING_VERSION
    };
    await chrome.storage.local.set({ [ONBOARDING_KEY]: state.onboarding });
    const overlay = $("onboardingOverlay");
    if (overlay) overlay.style.display = "none";
    await trackFunnelEventOnce(
        skipped ? "onboardingSkippedAt" : "onboardingCompletedAt",
        skipped ? "onboarding_skipped" : "onboarding_completed",
        { onboarding_step: selectedOnboardingStep() }
    );
}

async function skipOnboarding() {
    await completeOnboarding(true);
}

function bindDelegatedActions() {
    document.addEventListener("change", async (event) => {
        const origin = event.target;
        if (!(origin instanceof Element)) return;

        const target = origin.closest(".switch-input[data-action]");
        if (!target) return;

        const action = target.dataset.action;
        if (action === "toggle-domain") await toggleDomain(target.dataset.domain, target.checked);
        if (action === "toggle-schedule") await toggleSchedule(target.dataset.id, target.checked);
    });

    document.addEventListener("click", async (event) => {
        const origin = event.target;
        if (!(origin instanceof Element)) return;

        const slot = origin.closest(".hourly-slot[data-hour]");
        if (slot) {
            selectHourlySlot(slot);
            return;
        }

        const target = origin.closest("[data-action]");
        if (!target) return;
        if (target.classList.contains("switch-input")) return;

        const action = target.dataset.action;
        const domain = target.dataset.domain;
        const id = target.dataset.id;

        if (action === "remove-domain") await removeDomain(domain);
        if (action === "clear-snooze") await clearSnooze(domain);
        if (action === "stop-active") await stopActiveBlock(domain);
        if (action === "apply-preset") await applyPreset(target.dataset.presetId);
        if (action === "edit-schedule") editSchedule(id);
        if (action === "remove-schedule") await removeSchedule(id);
        if (action === "quick-limit" || action === "hour-limit") await quickAddLimit(domain);
        if (action === "insight-add-limit") prefillLimitForm(domain);
        if (action === "insight-view-usage") viewInsightUsage(domain);
        if (action === "dismiss-insight") await dismissPersonalInsight(id);
        if (action === "insight-prev") moveInsightCarousel(-1);
        if (action === "insight-next") moveInsightCarousel(1);
        if (action === "hour-schedule") {
            const hour = Number(target.dataset.hour || 0);
            if (domain) {
                $("scheduledDomain").value = domain;
                $("startTime").value = `${String(hour).padStart(2, "0")}:00`;
                $("endTime").value = `${String((hour + 1) % 24).padStart(2, "0")}:00`;
                document.getElementById("tab3").checked = true;
                $("scheduledDomain").focus();
            }
        }
    });
}

function bindEvents() {
    $("statRange")?.addEventListener("change", () => {
        state.selectedHourlyHour = null;
        prepareJourneyVisual(reclaimForSelectedRange(), { persist: false });
        renderAll();
    });
    $("addForm")?.addEventListener("submit", addDomain);
    $("scheduledForm")?.addEventListener("submit", saveSchedule);
    $("cancelScheduledEditBtn")?.addEventListener("click", resetScheduleForm);
    $("settingsForm")?.addEventListener("submit", saveSettings);
    $("journeyToggleBtn")?.addEventListener("click", toggleJourneyCollapsed);
    $("settingsCogBtn")?.addEventListener("click", () => openSettingsOverlay());
    $("settingsCloseBtn")?.addEventListener("click", () => closeSettingsOverlay());
    $("use24HourTime")?.addEventListener("change", persistSettings);
    $("limitNotificationsEnabled")?.addEventListener("change", persistSettings);
    $("personalInsightsEnabled")?.addEventListener("change", persistSettings);
    $("insightNotificationsEnabled")?.addEventListener("change", persistSettings);
    $("insightMaxNotificationsPerDay")?.addEventListener("change", persistSettings);
    $("insightSensitivity")?.addEventListener("change", persistSettings);
    $("immutableAdminOverrideBtn")?.addEventListener("click", useImmutableOverride);
    $("verifyWhopBtn")?.addEventListener("click", syncPremium);
    $("manageWhopBtn")?.addEventListener("click", () => chrome.tabs.create({ url: WHOP_MANAGE_URL }));
    $("upgradeBtnHeader")?.addEventListener("click", () => openWhopCheckout("header_upgrade"));
    $("upgradeBtnFromLimits")?.addEventListener("click", () => openWhopCheckout("limits_paywall"));
    $("upgradeBtnFromSchedule")?.addEventListener("click", () => openWhopCheckout("schedule_paywall"));
    $("upgradeBtnFromProfile")?.addEventListener("click", () => openWhopCheckout("profile_upgrade"));
    $("upgradeBtnFromSettings")?.addEventListener("click", () => openWhopCheckout("settings_upgrade"));
    $("giveFeedbackToastBtn")?.addEventListener("click", openSurveyMonkeyFeedback);
    $("leaveReviewToastBtn")?.addEventListener("click", openChromeWebStoreReview);
    $("dismissReviewToastBtn")?.addEventListener("click", () => deferReviewPromptToast("dismiss"));
    $("notNowReviewToastBtn")?.addEventListener("click", () => deferReviewPromptToast("not_now"));
    $("planetUnlockCloseBtn")?.addEventListener("click", closePlanetUnlockModal);
    $("planetUnlockModal")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closePlanetUnlockModal();
    });
    $("linkWhopTokenBtn")?.addEventListener("click", linkWhopToken);
    $("manualWhopToken")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        linkWhopToken();
    });

    $("onboardingNextBtn")?.addEventListener("click", () => showOnboardingStep(selectedOnboardingStep() + 1));
    $("onboardingPrevBtn")?.addEventListener("click", () => showOnboardingStep(selectedOnboardingStep() - 1));
    $("onboardingDoneBtn")?.addEventListener("click", () => completeOnboarding(false));
    $("onboardingSkipBtn")?.addEventListener("click", skipOnboarding);
    $("onboardingStepMarkers")?.addEventListener("click", (event) => {
        const marker = event.target.closest("[data-step]");
        if (marker) showOnboardingStep(Number(marker.dataset.step));
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !$("settingsOverlay")?.hidden) {
            closeSettingsOverlay();
        }
        if (event.key === "Escape" && !$("planetUnlockModal")?.hidden) {
            closePlanetUnlockModal();
        }
    });

    chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== "local") return;
        const watched = [
            "blockedDomains",
            "statsToday",
            "allStatsToday",
            "statsHistory",
            "hourlyUsageHistory",
            PERSONAL_INSIGHTS_KEY,
            DISMISSED_INSIGHTS_KEY,
            "snoozedDomains",
            "recentlyReset",
            "activeBlocks",
            "scheduledBlocks",
            SETTINGS_KEY,
            PREMIUM_KEY,
            BLOCK_RECLAIM_KEY,
            REVIEW_PROMPT_STATE_KEY
        ];
        const changedWatchedKeys = watched.filter((key) => Object.prototype.hasOwnProperty.call(changes, key));
        if (changedWatchedKeys.length) {
            const liveUsageKeys = [
                "statsToday",
                "allStatsToday",
                "statsHistory",
                "hourlyUsageHistory",
                BLOCK_RECLAIM_KEY
            ];
            const isLiveUsageOnly = changedWatchedKeys.every((key) => liveUsageKeys.includes(key));
            loadAll({
                flush: false,
                liveUsageOnly: isLiveUsageOnly,
                suppressRankingMotion: isLiveUsageOnly,
                updateRankingInPlace: isLiveUsageOnly
            });
        }
    });

    bindDelegatedActions();
}

document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    renderScheduleDays();
    await loadAll({ flush: true, refreshInsights: true, updateJourneyDisplay: true });
    await recordDashboardOpenForPrompt();
    trackFunnelEvent("popup_opened", { trigger: "browser_action" });
    await handleActivationNotice();
    if ($("limitInput")) $("limitInput").value = state.settings.defaultLimitMinutes;
    const onboardingShown = showOnboardingIfNeeded();
    if (!onboardingShown) await maybeShowReviewPromptToast();
    setInterval(refreshLive, LIVE_REFRESH_INTERVAL_MS);
});

window.addEventListener("unload", () => {
    send("flushActiveTimeNow", { source: "popup" });
});
