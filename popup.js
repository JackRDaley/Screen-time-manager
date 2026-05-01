const $ = (id) => document.getElementById(id);
const { formatTimeSec, getDayKey, parseDayKey } = globalThis.StmSharedUtils || {};

const SETTINGS_KEY = "uiSettings";
const PREMIUM_KEY = "premiumState";
const WHOP_CHECKOUT_URL = "https://whop.com/screen-time-manager/screen-time-manager-pro/";
const WHOP_MANAGE_URL = "https://whop.com/hub/memberships/";
const ONBOARDING_KEY = "onboardingState";
const ONBOARDING_METRICS_KEY = "onboardingMetrics";
const SUGGESTED_DEFAULTS = Object.freeze([
    { domain: "youtube.com", limitMinutes: 30 },
    { domain: "facebook.com", limitMinutes: 30 },
    { domain: "x.com", limitMinutes: 30 }
]);
const WHOP_COMPLETE_URL = "https://screen-time-manager.jackster0627.workers.dev/whop/complete";
const WHOP_LINK_STATE_KEY = "whopLinkState";
const DEFAULT_SETTINGS = Object.freeze({
    defaultLimitMinutes: 60,
    use24HourTime: false
});

const DEFAULT_PREMIUM = Object.freeze({
    active: false,
    planName: "Free",
    source: "free",
    checkedAt: null,
    expiresAt: null
});
const FREE_PLAN_LIMITS = Object.freeze({
    maxTrackedDomains: 3,
    maxScheduledBlocks: 2
});
const ENFORCEMENT_TIERS = Object.freeze({
    LENIENT: "lenient",
    STANDARD: "standard",
    STRICT: "strict",
    IMMUTABLE: "immutable"
});
const DEFAULT_TIER_NEW_RULE = ENFORCEMENT_TIERS.STANDARD;
const DEFAULT_TIER_LEGACY = ENFORCEMENT_TIERS.LENIENT;
const IMMUTABLE_ADMIN_OVERRIDE_KEY = "immutableAdminOverrideEnabled";
const IMMUTABLE_ADMIN_OVERRIDE_LAST_USED_KEY = "immutableAdminOverrideLastUsedDay";
const SCHEDULE_DAY_OPTIONS = Object.freeze([
    { value: 0, label: "Sun", short: "S" },
    { value: 1, label: "Mon", short: "M" },
    { value: 2, label: "Tue", short: "T" },
    { value: 3, label: "Wed", short: "W" },
    { value: 4, label: "Thu", short: "T" },
    { value: 5, label: "Fri", short: "F" },
    { value: 6, label: "Sat", short: "S" }
]);
const ALL_SCHEDULE_DAYS = Object.freeze(SCHEDULE_DAY_OPTIONS.map((day) => day.value));

let currentSettings = { ...DEFAULT_SETTINGS };
let saveMessageTimer = null;
let latestActiveBlocks = [];
let latestBlockedDomains = {};
let latestStatsToday = {};
let latestSnoozedDomains = {};
let latestHourlyUsageHistory = {};
let latestSnoozeHistory = {};
let activeCountdownTimer = null;
let popupRefreshTimer = null;
let popupRefreshInFlight = false;
let loadAllInFlight = false;
let loadAllPending = false;
let rankingInteractionDepth = 0;
let currentPremium = { ...DEFAULT_PREMIUM };
let selectedScheduleDays = [];
let editingScheduledBlockId = null;
let currentOnboardingState = { step: 0, completed: false, completedAt: null };
let selectedSuggestedSites = new Set(SUGGESTED_DEFAULTS.slice(0, 3).map(s => s.domain));
let openRowMenuKey = null;
let lastActiveRenderSignature = null;
let lastRenderedHourlyStatsSignature = null;

const EMPTY_STATE_MESSAGES = Object.freeze({
    active: "No active sessions. Scheduled blocks and time-limited sites will appear here when they start.",
    scheduled: "No scheduled sessions yet. Add a block above and choose the days it should run.",
    blocked: "No blocked sites yet. Add a site above to start tracking and enforcing a daily limit."
});

function trackAnalyticsEvent(eventName, params = {}) {
    chrome.runtime.sendMessage({
        action: "trackAnalyticsEvent",
        eventName,
        params
    }).catch(() => null);
}

function getOnboardingStepName(step) {
    if (step === 0) return "welcome";
    if (step === 1) return "suggested_sites";
    if (step === 2) return "confirm";
    return "unknown";
}

function isRankingInteractionActive() {
    return rankingInteractionDepth > 0;
}

function getRowMenuKey(type, id) {
    return `${type}:${id}`;
}

function getFreeTierDomainCapSelection(blockedDomains = {}, statsToday = {}) {
    if (isPremiumActive()) {
        return {
            blockedDomains,
            statsToday,
            keptDomains: new Set(Object.keys(blockedDomains || {})),
            trimmedCount: 0
        };
    }

    const entries = Object.entries(blockedDomains || {});
    const maxAllowed = FREE_PLAN_LIMITS.maxTrackedDomains;
    if (entries.length <= maxAllowed) {
        return {
            blockedDomains,
            statsToday,
            keptDomains: new Set(entries.map(([domain]) => domain)),
            trimmedCount: 0
        };
    }

    const ranked = entries
        .map(([domain, cfg]) => ({
            domain,
            cfg,
            timeMs: statsToday?.[domain]?.timeMs || 0,
            visits: statsToday?.[domain]?.visits || 0
        }))
        .sort((a, b) => b.timeMs - a.timeMs || b.visits - a.visits || a.domain.localeCompare(b.domain));

    const keptDomains = new Set(ranked.slice(0, maxAllowed).map((entry) => entry.domain));
    const nextBlockedDomains = {};
    for (const [domain, cfg] of entries) {
        if (keptDomains.has(domain)) {
            nextBlockedDomains[domain] = cfg;
        }
    }

    const nextStatsToday = {};
    for (const [domain, stats] of Object.entries(statsToday || {})) {
        if (keptDomains.has(domain)) {
            nextStatsToday[domain] = stats;
        }
    }

    return {
        blockedDomains: nextBlockedDomains,
        statsToday: nextStatsToday,
        keptDomains,
        trimmedCount: entries.length - keptDomains.size
    };
}

function getActiveRenderSignature(activeBlocks = [], blockedDomains = {}, snoozedDomains = {}) {
    const activePart = (Array.isArray(activeBlocks) ? activeBlocks : [])
        .map((block) => `${block?.id || ""}:${block?.domain || ""}:${block?.endTime || ""}`)
        .join("|");
    const blockedPart = Object.entries(blockedDomains || {})
        .map(([domain, cfg]) => `${domain}:${cfg?.enabled === false ? 0 : 1}:${getLimitSecondsFromConfig(cfg) || 0}`)
        .sort()
        .join("|");
    const now = Date.now();
    const snoozePart = Object.entries(snoozedDomains || {})
        .map(([domain, entry]) => `${domain}:${Number(entry?.expiresAt || entry || 0)}`)
        .filter((entry) => {
            const expiresAt = Number(entry.split(":")[1] || 0);
            return Number.isFinite(expiresAt) && expiresAt > now;
        })
        .sort()
        .join("|");
    return `${activePart}::${blockedPart}::${snoozePart}`;
}

function closeRowMenus() {
    if (openRowMenuKey == null) return;
    openRowMenuKey = null;
    void loadAll().catch(() => null);
}

function toggleRowMenu(type, id) {
    const nextKey = getRowMenuKey(type, id);
    openRowMenuKey = openRowMenuKey === nextKey ? null : nextKey;
    void loadAll().catch(() => null);
}

document.addEventListener("click", (event) => {
    if (!event.target.closest(".row-action-menu") && !event.target.closest("[data-action='menu']")) {
        closeRowMenus();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeRowMenus();
    }
});

function beginRankingInteraction() {
    rankingInteractionDepth += 1;
}

function endRankingInteraction() {
    rankingInteractionDepth = Math.max(0, rankingInteractionDepth - 1);
    if (!isRankingInteractionActive()) {
        loadAll();
    }
}

function wireRankingInteractionGuards() {
    ["ranking", "rankingByVisits"].forEach((id) => {
        const container = $(id);
        if (!container) return;

        container.addEventListener("pointerenter", beginRankingInteraction);
        container.addEventListener("pointerleave", endRankingInteraction);
        container.addEventListener("focusin", beginRankingInteraction);
        container.addEventListener("focusout", (e) => {
            const nextFocused = e.relatedTarget;
            if (!nextFocused || !container.contains(nextFocused)) {
                endRankingInteraction();
            }
        });
    });
}

function startActiveCountdownTicker() {
    if (activeCountdownTimer != null) return;
    activeCountdownTimer = setInterval(() => {
        refreshActiveCountdowns(latestActiveBlocks, latestBlockedDomains, latestStatsToday, latestSnoozedDomains);
    }, 1000);
}

function refreshActiveCountdowns(activeBlocks = latestActiveBlocks, blockedDomains = latestBlockedDomains, statsToday = latestStatsToday, snoozedDomains = latestSnoozedDomains) {
    const list = $("activeList");
    if (!list) return;

    const active = Array.isArray(activeBlocks) ? activeBlocks.filter((entry) => Boolean(entry?.domain)) : [];
    const count = $("activeCount");
    const statusPill = document.querySelector(".status-pill");
    const now = Date.now();
    const activeDomains = new Set(active.map((entry) => entry.domain));

    const timeLimitedActive = Object.entries(blockedDomains || {}).filter(([domain, cfg]) => {
        if (activeDomains.has(domain)) return false;
        if (!isLimitEnabled(cfg)) return false;
        const limitSec = getLimitSecondsFromConfig(cfg);
        if (!Number.isFinite(limitSec) || limitSec <= 0) return false;
        const usedMs = statsToday?.[domain]?.timeMs || 0;
        return usedMs >= limitSec * 1000;
    }).length;

    const totalActive = activeDomains.size + timeLimitedActive;
    if (count) count.textContent = String(totalActive);
    statusPill?.classList.toggle("is-inactive", totalActive === 0);

    if (totalActive === 0) return;

    list.querySelectorAll(".timer[data-domain]").forEach((timerEl) => {
        const domain = timerEl.getAttribute("data-domain");
        const timerType = timerEl.getAttribute("data-timer-type") || "block";
        let nextText = "";

        if (timerType === "pause") {
            const entry = snoozedDomains?.[domain];
            const expiresAt = Number(entry?.expiresAt || entry || 0);
            const remainingSec = Math.max(0, Math.floor((expiresAt - now) / 1000));
            nextText = remainingSec > 0 ? formatCountdownMSS(remainingSec) : "";
        } else {
            const block = active.find((entry) => entry.domain === domain);
            if (block?.endTime) {
                const remainingSec = Math.max(0, Math.floor((block.endTime - now) / 1000));
                nextText = remainingSec > 0 ? `${formatTimeSec(remainingSec)} left` : "";
            }
        }

        if (timerEl.textContent !== nextText) {
            timerEl.textContent = nextText;
        }
    });
}

function stopActiveCountdownTicker() {
    if (activeCountdownTimer == null) return;
    clearInterval(activeCountdownTimer);
    activeCountdownTimer = null;
}

async function setOnboardingStep(step) {
    currentOnboardingState.step = Math.max(0, Math.min(2, step));
    await chrome.storage.local.set({ [ONBOARDING_KEY]: currentOnboardingState });
}

async function renderOnboardingSuggestedSites() {
    const container = $("suggestedSitesContainer");
    if (!container) return;

    container.innerHTML = SUGGESTED_DEFAULTS.map((site) => {
        const isSelected = selectedSuggestedSites.has(site.domain);
        return `
            <label class="suggested-site">
                <div class="suggested-site-info">
                    <div class="suggested-site-domain">${site.domain}</div>
                    <div class="suggested-site-default">${site.limitMinutes} min/day</div>
                </div>
                <input type="checkbox" data-domain="${site.domain}" ${isSelected ? 'checked' : ''} />
            </label>
        `;
    }).join('');
}

async function showOnboardingStep(step) {
    const overlay = $("onboardingOverlay");
    if (!overlay) return;

    $("onboardingStep0").style.display = "none";
    $("onboardingStep1").style.display = "none";
    $("onboardingStep2").style.display = "none";

    const stepEl = $(`onboardingStep${step}`);
    if (stepEl) {
        stepEl.style.display = "flex";
        trackAnalyticsEvent("onboarding_step_viewed", {
            step_name: getOnboardingStepName(step),
            step_index: step
        });
        if (step === 0) {
            await renderOnboardingSuggestedSites();
        }
    }
}

async function showOnboarding() {
    currentOnboardingState = { step: 0, completed: false, completedAt: null };
    selectedSuggestedSites = new Set(SUGGESTED_DEFAULTS.slice(0, 3).map(s => s.domain));
    const { [ONBOARDING_METRICS_KEY]: onboardingMetrics = {} } = await chrome.storage.local.get([ONBOARDING_METRICS_KEY]);
    if (!onboardingMetrics?.setupStarted) {
        await chrome.runtime.sendMessage({ action: "logOnboardingMetric", metric: "setupStarted", value: Date.now() }).catch(() => null);
    }
    trackAnalyticsEvent("onboarding_started", { entrypoint: "popup_open" });
    const overlay = $("onboardingOverlay");
    if (overlay) {
        overlay.style.display = "flex";
        overlay.classList.add("active");
    }
    await showOnboardingStep(0);
}

async function hideOnboarding() {
    const overlay = $("onboardingOverlay");
    if (overlay) {
        overlay.style.display = "none";
        overlay.classList.remove("active");
    }
}

async function completeOnboardingAndSetupDefaults() {
    // Apply selected sites with their default limits
    for (const site of SUGGESTED_DEFAULTS) {
        if (selectedSuggestedSites.has(site.domain)) {
            await addDomain(site.domain, site.limitMinutes * 60, "onboarding_defaults");
        }
    }
    
    // Mark onboarding as complete in storage and background
    const now = Date.now();
    currentOnboardingState = { step: 2, completed: true, completedAt: now };
    await chrome.storage.local.set({ [ONBOARDING_KEY]: currentOnboardingState });
    await chrome.runtime.sendMessage({ action: "logOnboardingMetric", metric: "setupCompleted", value: now }).catch(() => null);

    const { [ONBOARDING_METRICS_KEY]: onboardingMetrics = {} } = await chrome.storage.local.get([ONBOARDING_METRICS_KEY]);
    const setupStarted = Number(onboardingMetrics?.setupStarted || 0);
    const totalDurationMs = setupStarted > 0 ? Math.max(0, now - setupStarted) : 0;
    trackAnalyticsEvent("onboarding_step_completed", {
        step_name: getOnboardingStepName(2),
        step_index: 2
    });
    trackAnalyticsEvent("onboarding_completed", {
        total_steps: 3,
        total_duration_ms: totalDurationMs,
        first_tool_configured: selectedSuggestedSites.size > 0 ? 1 : 0
    });
    
    // Hide onboarding and show dashboard
    await hideOnboarding();
    $("tab1").checked = true;
    await loadAll();
}

async function skipOnboarding() {
    const now = Date.now();
    trackAnalyticsEvent("onboarding_skipped", {
        step_name: getOnboardingStepName(currentOnboardingState.step)
    });
    currentOnboardingState = { step: 0, completed: true, completedAt: now };
    await chrome.storage.local.set({ [ONBOARDING_KEY]: currentOnboardingState });
    await chrome.runtime.sendMessage({ action: "logOnboardingMetric", metric: "setupSkipped", value: now }).catch(() => null);

    await hideOnboarding();
    $("tab1").checked = true;
    await loadAll();
}

function startPopupRefreshTicker() {
    if (popupRefreshTimer != null) return;
    popupRefreshTimer = setInterval(async () => {
        if (popupRefreshInFlight) return;
        popupRefreshInFlight = true;
        try {
            await chrome.runtime.sendMessage({ action: "flushActiveTimeNow" }).catch(() => null);
            const {
                activeBlocks = [],
                blockedDomains = {},
                statsToday = {},
                allStatsToday = {},
                statsHistory = {},
                hourlyUsageHistory = {},
                snoozeHistory = {},
                snoozedDomains = {}
            } = await chrome.storage.local.get(["activeBlocks", "blockedDomains", "statsToday", "allStatsToday", "statsHistory", "hourlyUsageHistory", "snoozeHistory", "snoozedDomains"]);

            const freeTierSelection = getFreeTierDomainCapSelection(blockedDomains, statsToday);
            latestActiveBlocks = Array.isArray(activeBlocks)
                ? activeBlocks.filter((block) => freeTierSelection.keptDomains.has(block.domain))
                : [];
            latestBlockedDomains = freeTierSelection.blockedDomains || {};
            latestStatsToday = freeTierSelection.statsToday || {};
            latestSnoozeHistory = snoozeHistory || {};
            latestSnoozedDomains = snoozedDomains || {};

            const range = $("statRange")?.value || "Today";
            const rangeContext = getRangeSelectionContext(range, allStatsToday || {}, statsHistory || {}, hourlyUsageHistory || {});

            updateStatStrip(rangeContext);
            updateDashboardSubhead(rangeContext.label);
            renderHourlyDistribution(rangeContext.hourlyStats, rangeContext.label);

            const nextSignature = getActiveRenderSignature(latestActiveBlocks, latestBlockedDomains, latestSnoozedDomains);
            const activeList = $("activeList");
            const activeListInteracting = Boolean(
                activeList &&
                (
                    activeList.matches(":hover") ||
                    (document.activeElement && activeList.contains(document.activeElement))
                )
            );

            if (nextSignature !== lastActiveRenderSignature && !activeListInteracting) {
                renderActive(latestActiveBlocks, latestBlockedDomains, latestStatsToday, latestSnoozedDomains);
            } else {
                refreshActiveCountdowns(latestActiveBlocks, latestBlockedDomains, latestStatsToday, latestSnoozedDomains);
            }
        } catch {
            // Ignore transient refresh errors in popup ticker.
        } finally {
            popupRefreshInFlight = false;
        }
    }, 1000);
}

function stopPopupRefreshTicker() {
    if (popupRefreshTimer == null) return;
    clearInterval(popupRefreshTimer);
    popupRefreshTimer = null;
}

function formatTimeStatSec(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;

    if (h > 0) return `${h}h${m}m`;
    if (m > 0) return `${m}m${s}s`;
    return `${s}s`;
}

function formatDayKey(dayKey) {
    const parsed = parseDayKey(dayKey);
    if (!parsed) return "Unknown";
    return parsed.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric"
    });
}

function getDayStats(dayKey, allStatsToday = {}, statsHistory = {}) {
    if (dayKey === getDayKey()) {
        return allStatsToday || {};
    }
    return statsHistory?.[dayKey] || {};
}

function buildDayKeysFromSpan(endDate, daysBack) {
    const keys = [];
    for (let i = daysBack; i >= 0; i -= 1) {
        const d = new Date(endDate);
        d.setDate(endDate.getDate() - i);
        keys.push(getDayKey(d));
    }
    return keys;
}

function buildDayKeysInRange(startDate, endDate) {
    const keys = [];
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
        keys.push(getDayKey(current));
        current.setDate(current.getDate() + 1);
    }
    return keys;
}

function aggregateStatsForDayKeys(dayKeys = [], allStatsToday = {}, statsHistory = {}) {
    const result = {};

    dayKeys.forEach((dayKey) => {
        const dayStats = getDayStats(dayKey, allStatsToday, statsHistory);
        Object.entries(dayStats || {}).forEach(([domain, stats]) => {
            if (!result[domain]) result[domain] = { timeMs: 0, visits: 0 };
            result[domain].timeMs += Number(stats?.timeMs || 0);
            result[domain].visits += Number(stats?.visits || 0);
        });
    });

    return result;
}

function normalizeHourlyBucket(bucket = {}) {
    const normalizedDomains = {};
    if (bucket?.domains && typeof bucket.domains === "object") {
        Object.entries(bucket.domains).forEach(([domain, timeMs]) => {
            const normalizedTimeMs = Number(timeMs || 0);
            if (!domain || normalizedTimeMs <= 0) return;
            normalizedDomains[domain] = normalizedTimeMs;
        });
    }

    return {
        timeMs: Number(bucket?.timeMs || 0),
        visits: Number(bucket?.visits || 0),
        domains: normalizedDomains,
        hasDomainBreakdown: Boolean(bucket?.domains && typeof bucket.domains === "object")
    };
}

function aggregateHourlyUsageForDayKeys(dayKeys = [], hourlyUsageHistory = {}) {
    const result = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        timeMs: 0,
        visits: 0,
        domains: {},
        hasDomainBreakdown: false
    }));

    (Array.isArray(dayKeys) ? dayKeys : []).forEach((dayKey) => {
        const dayStats = hourlyUsageHistory?.[dayKey] || {};
        Object.entries(dayStats || {}).forEach(([hourKey, bucket]) => {
            const hour = Number(hourKey);
            if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;

            const normalized = normalizeHourlyBucket(bucket);
            result[hour].timeMs += normalized.timeMs;
            result[hour].visits += normalized.visits;
            result[hour].hasDomainBreakdown = result[hour].hasDomainBreakdown || normalized.hasDomainBreakdown;

            Object.entries(normalized.domains).forEach(([domain, domainTimeMs]) => {
                if (!result[hour].domains[domain]) result[hour].domains[domain] = 0;
                result[hour].domains[domain] += domainTimeMs;
            });
        });
    });

    return result;
}

function formatHourLabel(hour) {
    const normalizedHour = ((Number(hour) || 0) % 24 + 24) % 24;
    const period = normalizedHour >= 12 ? "p" : "a";
    const displayHour = normalizedHour % 12 || 12;
    return `${displayHour}${period}`;
}

function formatHourRange(hour) {
    const startHour = ((Number(hour) || 0) % 24 + 24) % 24;
    const endHour = (startHour + 1) % 24;
    return `${formatHourLabel(startHour)}-${formatHourLabel(endHour)}`;
}

function formatHourRangeTooltip(hour) {
    const startHour = ((Number(hour) || 0) % 24 + 24) % 24;
    const endHour = (startHour + 1) % 24;

    const startDisplay = startHour % 12 || 12;
    const endDisplay = endHour % 12 || 12;
    const startPeriod = startHour >= 12 ? "PM" : "AM";
    const endPeriod = endHour >= 12 ? "PM" : "AM";

    if (startPeriod === endPeriod) {
        return `${startDisplay}-${endDisplay} ${endPeriod}`;
    }

    return `${startDisplay} ${startPeriod}-${endDisplay} ${endPeriod}`;
}

function formatCountdownMSS(seconds) {
    const totalSeconds = Math.max(0, Math.floor(seconds || 0));
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function buildPreviewHourlyStats() {
    const previewDomains = ["youtube.com", "twitter.com", "reddit.com", "facebook.com", "hacker-news.com"];
    return Array.from({ length: 24 }, (_, hour) => {
        const pattern = [2, 1, 1, 0, 0, 1, 3, 5, 6, 4, 3, 5, 7, 6, 4, 3, 4, 5, 8, 10, 9, 6, 4, 3];
        const units = pattern[hour] || 0;
        const totalTimeMs = units * 9 * 60 * 1000;
        
        // Distribute time among domains with some randomness
        const domains = {};
        const domainCount = Math.min(3, Math.max(1, Math.floor(units / 2)));
        const selectedDomains = previewDomains.slice(0, domainCount);
        const timePerDomain = totalTimeMs / selectedDomains.length;
        selectedDomains.forEach(domain => {
            domains[domain] = timePerDomain * (0.8 + Math.random() * 0.4);
        });
        
        return {
            hour,
            timeMs: totalTimeMs,
            visits: Math.max(0, Math.round(units * 1.6)),
            domains
        };
    });
}

function getPreviousPeriodDayKeys(dayKeys = []) {
    if (!Array.isArray(dayKeys) || dayKeys.length === 0) return [];
    const first = parseDayKey(dayKeys[0]);
    if (!first) return [];

    const periodLength = dayKeys.length;
    const previousEnd = new Date(first);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousEnd.getDate() - (periodLength - 1));

    return buildDayKeysInRange(previousStart, previousEnd);
}

function getRangeSelectionContext(range, allStatsToday = {}, statsHistory = {}, hourlyUsageHistory = {}) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dayKeys = [];
    let label = range;

    if (range === "Today") {
        dayKeys = [getDayKey(today)];
    } else if (range === "Yesterday") {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        dayKeys = [getDayKey(yesterday)];
    } else if (range === "This week") {
        dayKeys = buildDayKeysFromSpan(today, 6);
    } else if (range === "This month") {
        dayKeys = buildDayKeysFromSpan(today, 29);
    } else {
        dayKeys = [getDayKey(today)];
        label = "Today";
    }

    const stats = aggregateStatsForDayKeys(dayKeys, allStatsToday, statsHistory);
    const hourlyStats = aggregateHourlyUsageForDayKeys(dayKeys, hourlyUsageHistory);
    const previousKeys = getPreviousPeriodDayKeys(dayKeys);
    const previousStats = aggregateStatsForDayKeys(previousKeys, allStatsToday, statsHistory);
    const previousLabel = previousKeys.length
        ? `${formatDayKey(previousKeys[0])} - ${formatDayKey(previousKeys[previousKeys.length - 1])}`
        : "Previous period";

    return {
        label,
        dayKeys,
        stats,
        hourlyStats,
        previousStats,
        previousLabel
    };
}

function normalizeSettings(raw) {
    const defaultLimitMinutes = Number(raw?.defaultLimitMinutes);
    return {
        defaultLimitMinutes: Number.isFinite(defaultLimitMinutes) && defaultLimitMinutes > 0
            ? Math.min(1440, Math.floor(defaultLimitMinutes))
            : DEFAULT_SETTINGS.defaultLimitMinutes,
        use24HourTime: Boolean(raw?.use24HourTime)
    };
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

function isPremiumActive() {
    return Boolean(currentPremium?.active);
}

function canAddMoreDomains(blockedDomains) {
    if (isPremiumActive()) return true;
    return Object.keys(blockedDomains || {}).length < FREE_PLAN_LIMITS.maxTrackedDomains;
}

function canAddMoreScheduledBlocks(scheduledBlocks) {
    if (isPremiumActive()) return true;
    return (Array.isArray(scheduledBlocks) ? scheduledBlocks.length : 0) < FREE_PLAN_LIMITS.maxScheduledBlocks;
}

function setPremiumStatusMessage(message, kind = "neutral") {
    const statusEl = $("premiumStatusMsg");
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.remove("is-error", "is-success");
    if (kind === "error") statusEl.classList.add("is-error");
    if (kind === "success") statusEl.classList.add("is-success");
    statusEl.classList.add("is-visible");
}

function applyPaywallUI(blockedDomains = {}, scheduledBlocks = []) {
    const limitsPaywallCard = $("limitsPaywallCard");
    const schedulePaywallCard = $("schedulePaywallCard");
    const limitsNotice = $("limitsPaywallNotice");
    const addForm = $("addForm");
    const scheduledForm = $("scheduledForm");

    const domainCount = Object.keys(blockedDomains || {}).length;
    const scheduledCount = Array.isArray(scheduledBlocks) ? scheduledBlocks.length : 0;
    const atDomainCap = !isPremiumActive() && domainCount >= FREE_PLAN_LIMITS.maxTrackedDomains;
    const atScheduleCap = !isPremiumActive() && scheduledCount >= FREE_PLAN_LIMITS.maxScheduledBlocks;

    if (limitsPaywallCard) {
        limitsPaywallCard.style.display = atDomainCap ? "block" : "none";
    }
    if (limitsNotice) {
        limitsNotice.textContent = `Free plan allows up to ${FREE_PLAN_LIMITS.maxTrackedDomains} limited domains.`;
    }
    if (schedulePaywallCard) {
        schedulePaywallCard.style.display = atScheduleCap ? "block" : "none";
    }

    addForm?.classList.toggle("is-locked", atDomainCap);
    scheduledForm?.classList.toggle("is-locked", atScheduleCap);

    if (isPremiumActive()) {
        const label = currentPremium.planName || "Premium";
        setPremiumStatusMessage(`Premium active (${label})`, "success");
    } else if (atScheduleCap) {
        setPremiumStatusMessage(`Free plan allows up to ${FREE_PLAN_LIMITS.maxScheduledBlocks} scheduled blocks.`, "error");
    } else {
        setPremiumStatusMessage("Premium inactive");
    }
}

async function loadSettingsFromStorage() {
    const { [SETTINGS_KEY]: stored } = await chrome.storage.local.get([SETTINGS_KEY]);
    currentSettings = normalizeSettings(stored);
    return currentSettings;
}

async function loadMonetizationFromStorage() {
    const { [PREMIUM_KEY]: premiumStored } = await chrome.storage.local.get([PREMIUM_KEY]);
    currentPremium = normalizePremium(premiumStored || DEFAULT_PREMIUM);
}

async function saveSettingsToStorage(partialSettings) {
    const merged = normalizeSettings({ ...currentSettings, ...partialSettings });
    currentSettings = merged;
    await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
    return merged;
}

async function verifyWhopAccess() {
    setPremiumStatusMessage("Refreshing premium status...");
    trackAnalyticsEvent("premium_sync_clicked");

    try {
        const response = await chrome.runtime.sendMessage({ action: "refreshPremiumStatus" });
        if (!response?.success) {
            if (response?.pendingActivation) {
                setPremiumStatusMessage("Checkout detected. Activation is still syncing; retrying shortly...", "error");
                trackAnalyticsEvent("premium_sync_result", { status: "pending" });
                setTimeout(() => {
                    chrome.runtime.sendMessage({ action: "refreshPremiumStatus" }).catch(() => null);
                }, 3500);
                return;
            }
            throw new Error(response?.error || "No linked billing identity found.");
        }

        const nextPremium = normalizePremium({
            active: Boolean(response?.premiumState?.active),
            planName: response?.premiumState?.planName || (response?.premiumState?.active ? "Premium" : "Free"),
            source: response?.premiumState?.source || "whop",
            checkedAt: response?.premiumState?.checkedAt || new Date().toISOString(),
            expiresAt: response?.premiumState?.expiresAt || null
        });

        currentPremium = nextPremium;
        await chrome.storage.local.set({ [PREMIUM_KEY]: nextPremium });

        if (nextPremium.active) {
            setPremiumStatusMessage(`Premium active (${nextPremium.planName})`, "success");
            trackAnalyticsEvent("premium_sync_result", { status: "active", source: nextPremium.source || "whop" });
        } else if (response?.pendingActivation || response?.hasLinkedIdentity) {
            setPremiumStatusMessage("Billing identity linked. Premium is pending activation; retry shortly.", "error");
            trackAnalyticsEvent("premium_sync_result", { status: "pending", source: nextPremium.source || "whop" });
        } else {
            setPremiumStatusMessage("No active Whop entitlement found.", "error");
            trackAnalyticsEvent("premium_sync_result", { status: "inactive", source: nextPremium.source || "whop" });
        }

        await loadAll();
    } catch (error) {
        setPremiumStatusMessage(error?.message || "Verification failed.", "error");
        trackAnalyticsEvent("premium_sync_result", { status: "error" });
    }
}

function openWhopCheckout(entrypoint = "unknown") {
    if (!WHOP_CHECKOUT_URL) {
        setPremiumStatusMessage("Checkout URL not configured.", "error");
        return;
    }

    trackAnalyticsEvent("premium_checkout_opened", { entrypoint });

    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const clientState = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

    const callbackUrl = new URL(WHOP_COMPLETE_URL);
    callbackUrl.searchParams.set("token", "{user_id}");
    callbackUrl.searchParams.set("membership_id", "{membership_id}");
    callbackUrl.searchParams.set("member_id", "{member_id}");
    callbackUrl.searchParams.set("ext", chrome.runtime.id);
    callbackUrl.searchParams.set("client_state", clientState);

    (async () => {
        try {
            await chrome.storage.local.set({
                [WHOP_LINK_STATE_KEY]: {
                    id: clientState,
                    createdAt: new Date().toISOString(),
                    source: "checkout"
                }
            });

            const checkoutUrl = new URL(WHOP_CHECKOUT_URL);
            checkoutUrl.searchParams.set("ext", chrome.runtime.id);
            // Some Whop routes preserve callback/return parameters; include all common variants.
            checkoutUrl.searchParams.set("callback", callbackUrl.toString());
            checkoutUrl.searchParams.set("return_url", callbackUrl.toString());
            checkoutUrl.searchParams.set("redirect_uri", callbackUrl.toString());
            chrome.tabs.create({ url: checkoutUrl.toString() });
        } catch {
            chrome.tabs.create({ url: WHOP_CHECKOUT_URL });
        }
    })();
}

function openWhopManage() {
    if (!WHOP_MANAGE_URL) {
        setPremiumStatusMessage("Manage membership URL not configured.", "error");
        return;
    }
    trackAnalyticsEvent("premium_manage_opened");
    chrome.tabs.create({ url: WHOP_MANAGE_URL });
}

function readWhopCheckoutParams() {
    const params = new URLSearchParams(window.location.search || "");
    const hasCheckoutFlag = params.get("whopComplete") === "1";
    const token = (params.get("whopToken") || "").trim();
    return { hasCheckoutFlag, token };
}

function clearWhopCheckoutParams() {
    if (!window.history || typeof window.history.replaceState !== "function") return;
    const cleanUrl = chrome.runtime.getURL("popup.html");
    window.history.replaceState({}, document.title, cleanUrl);
}

async function completeWhopCheckoutFromUrl() {
    const { hasCheckoutFlag, token } = readWhopCheckoutParams();
    if (!hasCheckoutFlag || !token) {
        return false;
    }

    trackAnalyticsEvent("premium_checkout_complete_attempt", { source: "popup_url_params" });
    setPremiumStatusMessage("Finishing premium activation...");
    try {
        const response = await chrome.runtime.sendMessage({
            action: "completeWhopCheckout",
            token
        });

        if (!response?.success) {
            throw new Error(response?.error || "Activation failed");
        }

        currentPremium = normalizePremium(response?.premiumState || {
            active: true,
            planName: "Premium",
            source: "whop"
        });

        setPremiumStatusMessage(`Premium active (${currentPremium.planName})`, "success");
        trackAnalyticsEvent("premium_checkout_complete_result", {
            status: currentPremium.active ? "active" : "pending",
            source: currentPremium.source || "whop"
        });
    } catch (error) {
        setPremiumStatusMessage(error?.message || "Activation failed.", "error");
        trackAnalyticsEvent("premium_checkout_complete_result", { status: "error", source: "popup_url_params" });
    } finally {
        clearWhopCheckoutParams();
        await loadAll();
    }

    return true;
}

async function linkWhopTokenManually() {
    const tokenInput = $("manualWhopToken");
    const raw = (tokenInput?.value || "").trim();

    if (!raw) {
        setPremiumStatusMessage("Paste a Whop token first.", "error");
        return false;
    }

    if (!/^(user_|mem_|mber_|pay_)/.test(raw)) {
        setPremiumStatusMessage("Token must start with user_, mem_, mber_, or pay_.", "error");
        return false;
    }

    trackAnalyticsEvent("premium_manual_link_attempt");
    setPremiumStatusMessage("Linking billing identity...");
    try {
        const response = await chrome.runtime.sendMessage({
            action: "completeWhopCheckout",
            token: raw
        });

        if (!response?.success) {
            throw new Error(response?.error || "Linking failed");
        }

        const nextPremium = normalizePremium(response?.premiumState || {
            active: false,
            planName: "Free",
            source: "whop-manual"
        });

        currentPremium = nextPremium;
        if (tokenInput) tokenInput.value = "";

        if (nextPremium.active) {
            setPremiumStatusMessage(`Premium active (${nextPremium.planName})`, "success");
            trackAnalyticsEvent("premium_manual_link_result", { status: "active", source: nextPremium.source || "whop-manual" });
        } else {
            setPremiumStatusMessage("Billing identity linked. Premium is pending activation; retry shortly.", "error");
            trackAnalyticsEvent("premium_manual_link_result", { status: "pending", source: nextPremium.source || "whop-manual" });
        }

        await loadAll();
        return true;
    } catch (error) {
        setPremiumStatusMessage(error?.message || "Linking failed.", "error");
        trackAnalyticsEvent("premium_manual_link_result", { status: "error" });
        return false;
    }
}

function formatTimeForDisplay(timeStr, use24Hour = currentSettings.use24HourTime) {
    const [hour, minute] = timeStr.split(':').map(Number);
    if (use24Hour) {
        return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${displayHour}:${minute.toString().padStart(2, '0')} ${ampm}`;
}

function parseTimeInput(timeStr, use24Hour = currentSettings.use24HourTime) {
    const trimmed = timeStr.trim();

    if (use24Hour) {
        const match24 = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (!match24) return null;
        const hour = String(Number(match24[1])).padStart(2, "0");
        return `${hour}:${match24[2]}`;
    }
    
    // Check for AM/PM format: H:MM AM/PM or HH:MM AM/PM (space optional)
    const ampmRegex = /^(1[0-2]|0?[1-9]):([0-5][0-9]) ?(AM|PM)$/i;
    const match = trimmed.match(ampmRegex);
    if (match) {
        let hour = parseInt(match[1]);
        const minute = match[2];
        const ampm = match[3].toUpperCase();
        
        if (ampm === 'PM' && hour !== 12) {
            hour += 12;
        } else if (ampm === 'AM' && hour === 12) {
            hour = 0;
        }
        
        return `${hour.toString().padStart(2, '0')}:${minute}`;
    }
    
    return null; // Invalid format
}

function normalizeDomain(input) {
    let d = (input || "").trim().toLowerCase();
    d = d.replace(/^https?:\/\//, "");
    d = d.replace(/^www\./, "");
    d = d.split(/[\/#?]/)[0];
    d = d.replace(/:\d+$/, "");
    return d;
}

function normalizeScheduleDays(days, fallbackDays = ALL_SCHEDULE_DAYS) {
    const source = Array.isArray(days) ? days : fallbackDays;
    const normalized = [...new Set(source
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
        .sort((a, b) => a - b);

    return normalized.length > 0 ? normalized : [...fallbackDays];
}

function formatScheduleDays(days) {
    const normalized = normalizeScheduleDays(days);
    if (normalized.length === ALL_SCHEDULE_DAYS.length) return "Every day";
    if (normalized.join(",") === "1,2,3,4,5") return "Weekdays";
    if (normalized.join(",") === "0,6") return "Weekends";
    return normalized
        .map((day) => SCHEDULE_DAY_OPTIONS.find((option) => option.value === day)?.label)
        .filter(Boolean)
        .join(", ");
}

function normalizeTier(rawTier, fallbackTier = DEFAULT_TIER_LEGACY) {
    const value = String(rawTier || "").trim().toLowerCase();
    if (Object.values(ENFORCEMENT_TIERS).includes(value)) {
        return value;
    }
    return fallbackTier;
}

function formatTierLabel(tier) {
    const normalized = normalizeTier(tier);
    if (normalized === ENFORCEMENT_TIERS.LENIENT) return "Lenient";
    if (normalized === ENFORCEMENT_TIERS.STANDARD) return "Standard";
    if (normalized === ENFORCEMENT_TIERS.STRICT) return "Strict";
    if (normalized === ENFORCEMENT_TIERS.IMMUTABLE) return "Immutable";
    return "Lenient";
}

function hasActiveImmutableLimit(activeBlocks = [], blockedDomains = {}, statsToday = {}, snoozedDomains = {}) {
    const now = Date.now();

    const immutableScheduledActive = (Array.isArray(activeBlocks) ? activeBlocks : []).some((block) => {
        const tier = normalizeTier(block?.tier, DEFAULT_TIER_LEGACY);
        const endTime = Number(block?.endTime || 0);
        return tier === ENFORCEMENT_TIERS.IMMUTABLE && Number.isFinite(endTime) && endTime > now;
    });

    if (immutableScheduledActive) return true;

    return Object.entries(blockedDomains || {}).some(([domain, cfg]) => {
        if (!isLimitEnabled(cfg)) return false;
        if (normalizeTier(cfg?.tier, DEFAULT_TIER_LEGACY) !== ENFORCEMENT_TIERS.IMMUTABLE) return false;

        const limitSec = getLimitSecondsFromConfig(cfg);
        if (!Number.isFinite(limitSec) || limitSec <= 0) return false;

        const usedMs = Number(statsToday?.[domain]?.timeMs || 0);
        if (usedMs < limitSec * 1000) return false;

        const snoozeEntry = snoozedDomains?.[domain];
        const snoozeExpiresAt = Number(snoozeEntry?.expiresAt || snoozeEntry || 0);
        return !Number.isFinite(snoozeExpiresAt) || snoozeExpiresAt <= now;
    });
}

function updateImmutableOverrideButton(hasImmutableActive, lastUsedDay = "") {
    const button = $("immutableAdminOverrideBtn");
    const messageEl = $("immutableOverrideMsg");
    if (!button) return;

    const todayKey = getDayKey();
    const usedToday = String(lastUsedDay || "") === todayKey;

    button.textContent = "Use Override";
    button.classList.remove("is-used", "is-unavailable");
    button.disabled = false;
    if (messageEl) {
        messageEl.textContent = "";
        messageEl.classList.remove("is-error");
    }

    if (usedToday) {
        button.textContent = "Override Used";
        button.disabled = true;
        button.classList.add("is-used");
        return;
    }

    if (!hasImmutableActive) {
        button.disabled = true;
        button.classList.add("is-unavailable");
        if (messageEl) {
            messageEl.textContent = "No immutable limits active";
        }
        return;
    }
}

function syncScheduleDayPicker() {
    const container = $("scheduledDays");
    if (!container) return;

    const selectedSet = new Set(selectedScheduleDays);
    container.querySelectorAll(".day-bubble").forEach((button) => {
        const dayValue = Number(button.getAttribute("data-day"));
        const isSelected = selectedSet.has(dayValue);
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-pressed", String(isSelected));
    });
}

function setSelectedScheduleDays(days) {
    selectedScheduleDays = normalizeScheduleDays(days, []);
    syncScheduleDayPicker();
}

function updateScheduledFormMode() {
    const modeLabel = $("scheduledFormModeLabel");
    const submitBtn = $("scheduledSubmitBtn");
    const cancelBtn = $("cancelScheduledEditBtn");
    const isEditing = editingScheduledBlockId != null;

    if (modeLabel) {
        modeLabel.textContent = isEditing
            ? "Editing this scheduled block. Save changes to keep the same rule."
            : "Create a new recurring block.";
    }
    if (submitBtn) {
        submitBtn.textContent = isEditing ? "Save Changes" : "Deploy Schedule";
    }
    if (cancelBtn) {
        cancelBtn.hidden = !isEditing;
    }
}

function resetScheduledForm() {
    editingScheduledBlockId = null;
    $("scheduledDomain").value = "";
    $("startTime").value = "";
    $("endTime").value = "";
    if ($("scheduledTier")) {
        $("scheduledTier").value = DEFAULT_TIER_NEW_RULE;
    }
    setSelectedScheduleDays([]);
    clearFormFeedback("scheduledFormMsg", ["scheduledDomain", "startTime", "endTime"], true);
    updateScheduledFormMode();
}

function beginScheduledBlockEdit(block) {
    if (!block) return;

    editingScheduledBlockId = block.id;
    $("scheduledDomain").value = block.domain || "";
    $("startTime").value = block.startTime ? formatTimeForDisplay(block.startTime) : "";
    $("endTime").value = block.endTime ? formatTimeForDisplay(block.endTime) : "";
    if ($("scheduledTier")) {
        $("scheduledTier").value = normalizeTier(block.tier, DEFAULT_TIER_NEW_RULE);
    }
    setSelectedScheduleDays(block.daysOfWeek);
    clearFormFeedback("scheduledFormMsg", ["scheduledDomain", "startTime", "endTime"], true);
    updateScheduledFormMode();
    $("scheduledDomain")?.focus();
}

function toggleScheduleDay(dayValue) {
    const next = new Set(selectedScheduleDays);
    if (next.has(dayValue)) {
        next.delete(dayValue);
    } else {
        next.add(dayValue);
    }

    selectedScheduleDays = [...next].sort((a, b) => a - b);
    syncScheduleDayPicker();
}

function initializeScheduleDayPicker() {
    const container = $("scheduledDays");
    if (!container) return;

    container.innerHTML = "";
    SCHEDULE_DAY_OPTIONS.forEach((day) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "day-bubble";
        button.textContent = day.short || day.label;
        button.setAttribute("data-day", String(day.value));
        button.setAttribute("aria-label", day.label);
        button.addEventListener("click", () => toggleScheduleDay(day.value));
        container.appendChild(button);
    });

    setSelectedScheduleDays([]);
}

function clearFormFeedback(messageId, fieldIds = [], clearDays = false) {
    const messageEl = $(messageId);
    if (messageEl) {
        messageEl.textContent = "";
        messageEl.classList.remove("is-error");
    }

    fieldIds.forEach((fieldId) => $(fieldId)?.classList.remove("is-invalid"));
    if (clearDays) {
        $("scheduledDays")?.classList.remove("is-invalid");
    }
}

function showFormError(messageId, message, fieldIds = [], markDays = false) {
    clearFormFeedback(messageId, fieldIds, markDays);

    const messageEl = $(messageId);
    if (messageEl) {
        messageEl.textContent = message;
        messageEl.classList.add("is-error");
    }

    fieldIds.forEach((fieldId) => $(fieldId)?.classList.add("is-invalid"));
    if (markDays) {
        $("scheduledDays")?.classList.add("is-invalid");
    }
}

function isValidDomain(domain) {
    if (!domain || domain.length > 253) return false;
    if (!domain.includes(".")) return false;

    const labels = domain.split(".");
    if (labels.some((label) => !label || label.length > 63)) return false;

    return labels.every((label) => /^[a-z0-9-]+$/.test(label) && !label.startsWith("-") && !label.endsWith("-"));
}

function getLimitSecondsFromConfig(cfg) {
    const fromSeconds = Number(cfg?.limitSeconds);
    if (Number.isFinite(fromSeconds) && fromSeconds > 0) {
        return Math.floor(fromSeconds);
    }

    const fromMinutes = Number(cfg?.limitMinutes);
    if (Number.isFinite(fromMinutes) && fromMinutes > 0) {
        return Math.floor(fromMinutes * 60);
    }

    return null;
}

function isLimitEnabled(cfg) {
    return cfg?.enabled !== false;
}

function isLimitCurrentlyBlocking(domain, cfg, statsToday = {}, snoozedDomains = {}) {
    if (!isLimitEnabled(cfg)) return false;

    const limitSec = getLimitSecondsFromConfig(cfg);
    if (!Number.isFinite(limitSec) || limitSec <= 0) return false;

    const usedMs = Number(statsToday?.[domain]?.timeMs || 0);
    if (usedMs < limitSec * 1000) return false;

    const snoozeEntry = snoozedDomains?.[domain];
    const snoozeExpiresAt = Number(snoozeEntry?.expiresAt || snoozeEntry || 0);
    return !Number.isFinite(snoozeExpiresAt) || snoozeExpiresAt <= Date.now();
}

function applyScheduleInputMode() {
    const use24 = currentSettings.use24HourTime;
    const startEl = $("startTime");
    const endEl = $("endTime");
    if (!startEl || !endEl) return;

    startEl.value = "";
    endEl.value = "";

    startEl.type = "text";
    endEl.type = "text";

    if (use24) {
        startEl.placeholder = "Start (9:00 or 09:00)";
        endEl.placeholder = "End (17:00)";
        startEl.title = "Use HH:MM (24-hour)";
        endEl.title = "Use HH:MM (24-hour)";
    } else {
        startEl.placeholder = "Start (9:00 AM)";
        endEl.placeholder = "End (5:00 PM)";
        startEl.title = "Use H:MM AM/PM";
        endEl.title = "Use H:MM AM/PM";
    }
}

function showSettingsSavedMessage() {
    const messageEl = $("settingsSavedMsg");
    if (!messageEl) return;

    messageEl.classList.add("is-visible");
    if (saveMessageTimer) clearTimeout(saveMessageTimer);
    saveMessageTimer = setTimeout(() => {
        messageEl.classList.remove("is-visible");
        saveMessageTimer = null;
    }, 1800);
}

function getSnoozeCountForDayKeys(dayKeys = [], snoozeHistory = {}) {
    return (Array.isArray(dayKeys) ? dayKeys : []).reduce((sum, dayKey) => {
        return sum + Number(snoozeHistory?.[dayKey] || 0);
    }, 0);
}

function updateStatStrip(rangeContext) {
    const currentStats = rangeContext?.stats || {};
    const previousStats = rangeContext?.previousStats || {};

    const currentTotals = getTotals(currentStats);
    const previousTotals = getTotals(previousStats);
    const currentSnoozes = getSnoozeCountForDayKeys(rangeContext?.dayKeys || [], latestSnoozeHistory);
    const previousDayKeys = getPreviousPeriodDayKeys(rangeContext?.dayKeys || []);
    const previousSnoozes = getSnoozeCountForDayKeys(previousDayKeys, latestSnoozeHistory);

    if ($("statScreenTime")) {
        $("statScreenTime").textContent = formatTimeStatSec(Math.round(currentTotals.totalMs / 1000));
    }
    if ($("statVisits")) {
        $("statVisits").textContent = String(currentTotals.totalVisits);
    }
    if ($("statSnoozes")) {
        $("statSnoozes").textContent = String(currentSnoozes);
    }

    if ($("statScreenTimeDelta")) {
        $("statScreenTimeDelta").textContent = `${formatPercentDelta(currentTotals.totalMs, previousTotals.totalMs)}`;
    }
    if ($("statVisitsDelta")) {
        $("statVisitsDelta").textContent = `${formatPercentDelta(currentTotals.totalVisits, previousTotals.totalVisits)}`;
    }
    if ($("statSnoozesDelta")) {
        $("statSnoozesDelta").textContent = `${formatPercentDelta(currentSnoozes, previousSnoozes)}`;
    }
}

function getTotals(stats = {}) {
    const entries = Object.values(stats || {});
    const totalMs = entries.reduce((sum, entry) => sum + Number(entry?.timeMs || 0), 0);
    const totalVisits = entries.reduce((sum, entry) => sum + Number(entry?.visits || 0), 0);
    return { totalMs, totalVisits };
}

function formatPercentDelta(current, previous) {
    if (previous <= 0 && current <= 0) return "0%";
    if (previous <= 0) return "+100%";
    const pct = Math.round(((current - previous) / previous) * 100);
    return `${pct > 0 ? "+" : ""}${pct}%`;
}

function updateDashboardSubhead(label) {
    const subhead = $("dashboardSubhead");
    if (!subhead) return;
    subhead.textContent = `Showing ${label}`;
}

function getTopDomainsForHour(hourData = {}, maxResults = 3) {
    if (!hourData?.domains || typeof hourData.domains !== 'object') {
        return [];
    }
    
    const entries = Object.entries(hourData.domains)
        .map(([domain, timeMs]) => ({ domain, timeMs: Number(timeMs || 0) }))
        .filter(e => e.timeMs > 0)
        .sort((a, b) => b.timeMs - a.timeMs)
        .slice(0, maxResults);
    
    return entries;
}

function getColorGradientForIntensity(normalizedValue) {
    // normalizedValue: 0 (low/cool) to 1 (high/warm)
    // Returns a linear gradient from cool cyan/blue to warm orange/red
    const t = Math.max(0, Math.min(1, normalizedValue)); // Clamp 0-1
    
    if (t < 0.5) {
        // Cool side: cyan to purple (0 to 0.5)
        const ratio = t * 2; // 0 to 1
        const startR = 34,   startG = 217,  startB = 255;  // Cyan
        const endR = 139,    endG = 111,    endB = 255;    // Purple
        const r = Math.round(startR + (endR - startR) * ratio);
        const g = Math.round(startG + (endG - startG) * ratio);
        const b = Math.round(startB + (endB - startB) * ratio);
        return `linear-gradient(180deg, rgba(${r},${g},${b},.95), rgba(${Math.round(r*0.8)},${Math.round(g*0.8)},${Math.round(b*0.8)},.82))`;
    } else {
        // Warm side: purple to orange/red (0.5 to 1)
        const ratio = (t - 0.5) * 2; // 0 to 1
        const startR = 139,  startG = 111,  startB = 255;  // Purple
        const endR = 255,    endG = 77,     endB = 109;    // Red
        const r = Math.round(startR + (endR - startR) * ratio);
        const g = Math.round(startG + (endG - startG) * ratio);
        const b = Math.round(startB + (endB - startB) * ratio);
        return `linear-gradient(180deg, rgba(${r},${g},${b},.95), rgba(${Math.round(r*0.85)},${Math.round(g*0.85)},${Math.round(b*0.85)},.82))`;
    }
}

function renderHourlyDistribution(hourlyStats = [], rangeLabel = "Today") {
    const list = $("hourlyDistribution");
    const insight = $("usageInsight");
    const title = $("usageCardTitle");
    if (!list) return;

    // Create signature to detect if data changed
    const currentSignature = JSON.stringify([hourlyStats, rangeLabel]);
    if (currentSignature === lastRenderedHourlyStatsSignature) {
        return; // Skip re-render if data hasn't changed
    }
    lastRenderedHourlyStatsSignature = currentSignature;

    if (title) title.textContent = `Daily Usage Distribution · ${rangeLabel}`;

    const buckets = Array.isArray(hourlyStats) ? hourlyStats : [];
    const hasUsage = buckets.some((bucket) => Number(bucket?.timeMs || 0) > 0);
    const previewBuckets = hasUsage ? buckets : buildPreviewHourlyStats();
    const isPreview = !hasUsage;

    const maxMs = previewBuckets.reduce((max, bucket) => Math.max(max, Number(bucket?.timeMs || 0)), 0);
    
    // Find peak hour
    let peakHour = -1;
    let peakTimeMs = 0;
    previewBuckets.forEach((bucket, hour) => {
        const timeMs = Number(bucket?.timeMs || 0);
        if (timeMs > peakTimeMs) {
            peakTimeMs = timeMs;
            peakHour = hour;
        }
    });

    const topBuckets = previewBuckets
        .filter((bucket) => Number(bucket?.timeMs || 0) > 0)
        .map((bucket) => ({
            hour: Number(bucket?.hour || 0),
            timeMs: Number(bucket?.timeMs || 0)
        }))
        .sort((a, b) => b.timeMs - a.timeMs)
        .slice(0, 3);

    list.classList.remove("muted");
    list.innerHTML = `
        <div class="hourly-chart-wrap">
        <div class="hourly-chart" aria-label="Hourly usage distribution">
            ${previewBuckets.map((bucket, hour) => {
                const timeMs = Number(bucket?.timeMs || 0);
                const heightPct = maxMs > 0 ? Math.max(6, Math.round((timeMs / maxMs) * 100)) : 6;
                const label = hour % 3 === 0 ? formatHourLabel(hour) : "";
                const domainData = JSON.stringify(getTopDomainsForHour(bucket, 3));
                const hasDomainBreakdown = bucket?.hasDomainBreakdown === true;
                const isPeak = hour === peakHour && peakTimeMs > 0;
                
                // Calculate normalized value and color gradient
                const normalizedValue = maxMs > 0 ? timeMs / maxMs : 0;
                const colorGradient = getColorGradientForIntensity(normalizedValue);
                
                return `
                    <div class="hourly-slot${isPeak ? " is-peak" : ""}" 
                         data-hour="${hour}"
                         data-time-ms="${timeMs}"
                         data-domains='${domainData}'
                         data-has-domain-breakdown="${hasDomainBreakdown}"
                         data-is-peak="${isPeak}"
                         role="button"
                         tabindex="0"
                         aria-pressed="false"
                         title="${formatHourRange(hour)}: ${formatTimeSec(Math.round(timeMs / 1000))}">
                        <div class="hourly-slot-bar">
                            <div class="hourly-slot-fill" style="height:${heightPct}%; background: ${colorGradient};"></div>
                        </div>
                        <div class="hourly-slot-label">${label || "&nbsp;"}</div>
                    </div>
                `;
            }).join("")}
        </div>
        </div>
    `;

    if (!insight) return;

    if (isPreview) {
        insight.classList.add("muted");
        insight.textContent = "Click a bar to view details.";
    } else {
        insight.classList.remove("muted");
        insight.textContent = "Select a bar to inspect this hour.";
    }

    // Attach click event listeners for persistent detail pane updates.
    // This runs after the placeholder text so selected-bar details are not overwritten.
    attachHourlySlotClickHandlers(list, insight, isPreview, topBuckets, peakHour);

    if (isPreview) {
        return;
    }
}

function attachHourlySlotClickHandlers(chartContainer, insightElement, isPreview, topBuckets, peakHour) {
    if (!chartContainer) return;

    const slots = chartContainer.querySelectorAll('.hourly-slot');

    const toScheduleTime = (hour) => {
        const normalizedHour = Number.isInteger(hour) ? ((hour % 24) + 24) % 24 : 0;
        return `${String(normalizedHour).padStart(2, "0")}:00`;
    };

    const addScheduledBlockForHour = async (domain, hour) => {
        const selectedHour = Number.isInteger(hour) ? hour : 0;
        const startHour = ((selectedHour % 24) + 24) % 24;
        const endHour = (startHour + 1) % 24;
        const startTime = toScheduleTime(startHour);
        const endTime = toScheduleTime(endHour);

        const { scheduledBlocks = [] } = await chrome.storage.local.get(["scheduledBlocks"]);
        if (!canAddMoreScheduledBlocks(scheduledBlocks)) {
            setPremiumStatusMessage(`Free plan allows up to ${FREE_PLAN_LIMITS.maxScheduledBlocks} scheduled blocks.`, "error");
            return false;
        }

        const response = await chrome.runtime.sendMessage({
            action: "addScheduledBlock",
            domain,
            startTime,
            endTime,
            daysOfWeek: [...ALL_SCHEDULE_DAYS]
        }).catch(() => ({ success: false, error: "Unable to save the scheduled block." }));

        if (!response?.success) {
            setPremiumStatusMessage(response?.error || "Unable to save the scheduled block.", "error");
            return false;
        }

        return true;
    };

    const renderDetailsForSlot = (slot) => {
        if (!insightElement) return;

        const hour = parseInt(slot.getAttribute('data-hour'), 10);
        const timeMs = parseInt(slot.getAttribute('data-time-ms'), 10);
        const hasDomainBreakdown = slot.getAttribute('data-has-domain-breakdown') === 'true';
        const isPeak = slot.getAttribute('data-is-peak') === 'true';
        let domainsData = [];

        try {
            domainsData = JSON.parse(slot.getAttribute('data-domains') || '[]');
        } catch {
            domainsData = [];
        }

        slots.forEach((s) => {
            s.classList.remove('is-selected');
            s.setAttribute('aria-pressed', 'false');
        });

        slot.classList.add('is-selected');
        slot.setAttribute('aria-pressed', 'true');

        if (timeMs <= 0) {
            insightElement.classList.add('muted');
            insightElement.textContent = `${formatHourRangeTooltip(hour)} has no tracked usage.`;
            return;
        }

        const detailedRange = formatHourRangeTooltip(hour);
        const siteRows = domainsData
            .map((d) => {
                return `<div class="hourly-tip-site-row"><div class="hourly-tip-site-main"><div class="hourly-tip-site-domain">${d.domain}</div></div><div class="hourly-tip-site-time">${formatTimeSec(Math.round(d.timeMs / 1000))}</div></div>`;
            })
            .join('');

        const totalSeconds = Math.round(timeMs / 1000);
        const timeSpentText = `${formatTimeSec(totalSeconds)} spent`;

        insightElement.classList.remove('muted');
        insightElement.innerHTML = `
            <div class="hourly-tip-header">
                <div class="hourly-tip-time">${detailedRange}${isPeak ? ' · <span class="hourly-tip-inline-peak">Peak</span>' : ''}</div>
                <div class="hourly-tip-time-spent">${timeSpentText}</div>
            </div>

            ${domainsData.length > 0
                ? `<div class="hourly-tip-sites">${siteRows}</div>`
                : `<div class="hourly-tip-sites"><div class="hourly-tip-empty">${hasDomainBreakdown ? "No tracked sites this hour" : "Site breakdown unavailable for this hour"}</div></div>`}

            <div class="hourly-tip-footer">
                <div class="hourly-tip-actions">
                    <button class="hourly-action-btn primary is-compact" data-action="set-limit" data-hour="${hour}">Limit</button>
                    <button class="hourly-action-btn secondary is-compact" data-action="schedule-hour" data-hour="${hour}">Schedule</button>
                </div>
            </div>
        `;

        insightElement.querySelectorAll('.hourly-action-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const action = btn.getAttribute('data-action');
                if (domainsData.length === 0) return;

                const topDomain = domainsData[0].domain;
                if (action === 'set-limit') {
                    if (!canAddMoreDomains(latestBlockedDomains) && !latestBlockedDomains?.[topDomain]) {
                        setPremiumStatusMessage(`Free plan allows up to ${FREE_PLAN_LIMITS.maxTrackedDomains} limited domains.`, "error");
                        return;
                    }
                    await addDomain(topDomain, currentSettings.defaultLimitMinutes * 60, "hourly_chart_set_limit");
                    await loadAll();
                } else if (action === 'schedule-hour') {
                    const created = await addScheduledBlockForHour(topDomain, hour);
                    if (!created) return;
                    await loadAll();
                }
            });
        });
    };

    slots.forEach((slot) => {
        slot.addEventListener('click', () => {
            renderDetailsForSlot(slot);
        });

        slot.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                renderDetailsForSlot(slot);
            }
        });
    });

    if (isPreview) return;

    const defaultSlot = Array.from(slots).find((slot) => Number(slot.getAttribute('data-hour')) === peakHour)
        || Array.from(slots).find((slot) => Number(slot.getAttribute('data-time-ms') || 0) > 0)
        || slots[0];

    if (defaultSlot) {
        renderDetailsForSlot(defaultSlot);
    } else if (insightElement) {
        insightElement.classList.add('muted');
        insightElement.textContent = topBuckets.length > 0
            ? `Click a bar to inspect usage.`
            : "No peak period yet";
    }
}

function updateStreakChip(statsHistory = {}, allStatsToday = {}) {
    const streakHeaderValue = $("streakHeaderValue");

    const hasUsage = (dayStats = {}) => Object.values(dayStats || {}).some((entry) => {
        const timeMs = Number(entry?.timeMs || 0);
        const visits = Number(entry?.visits || 0);
        return timeMs > 0 || visits > 0;
    });

    let streakDays = 0;
    const today = new Date();

    for (let offset = 0; offset <= 31; offset += 1) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() - offset);
        const dayKey = getDayKey(checkDate);
        const dayStats = offset === 0 ? allStatsToday : statsHistory?.[dayKey];

        if (!hasUsage(dayStats)) break;
        streakDays += 1;
    }

    const displayText = streakDays <= 0 ? "—" : String(streakDays);
    if (streakHeaderValue) streakHeaderValue.textContent = displayText;
}

async function enforceFreeTierDomainCap(blockedDomains = {}, statsToday = {}) {
    const selection = getFreeTierDomainCapSelection(blockedDomains, statsToday);
    if (selection.trimmedCount === 0) {
        return {
            blockedDomains: selection.blockedDomains,
            statsToday: selection.statsToday,
            trimmedCount: 0
        };
    }

    const { alertsSent = {}, activeBlocks = [] } = await chrome.storage.local.get(["alertsSent", "activeBlocks"]);
    const nextAlerts = {};
    for (const [domain, sent] of Object.entries(alertsSent || {})) {
        if (selection.keptDomains.has(domain)) {
            nextAlerts[domain] = sent;
        }
    }

    const nextActiveBlocks = (activeBlocks || []).filter((block) => selection.keptDomains.has(block.domain));

    await chrome.storage.local.set({
        blockedDomains: selection.blockedDomains,
        statsToday: selection.statsToday,
        alertsSent: nextAlerts,
        activeBlocks: nextActiveBlocks
    });

    const trimmedCount = selection.trimmedCount;
    setPremiumStatusMessage(`Premium inactive: removed ${trimmedCount} domain(s) to match free tier.`, "error");

    return {
        blockedDomains: selection.blockedDomains,
        statsToday: selection.statsToday,
        trimmedCount
    };
}

async function enforceFreeTierScheduledCap(scheduledBlocks = []) {
    if (isPremiumActive()) {
        return { scheduledBlocks, trimmedCount: 0 };
    }

    const scheduled = Array.isArray(scheduledBlocks) ? scheduledBlocks : [];
    const maxAllowed = FREE_PLAN_LIMITS.maxScheduledBlocks;
    if (scheduled.length <= maxAllowed) {
        return { scheduledBlocks: scheduled, trimmedCount: 0 };
    }

    const nextScheduledBlocks = scheduled.slice(0, maxAllowed);
    const keptIds = new Set(nextScheduledBlocks.map((block) => block.id));
    const { activeBlocks = [] } = await chrome.storage.local.get(["activeBlocks"]);
    const nextActiveBlocks = (activeBlocks || []).filter((block) => keptIds.has(block.id));

    await chrome.storage.local.set({
        scheduledBlocks: nextScheduledBlocks,
        activeBlocks: nextActiveBlocks
    });

    const trimmedCount = scheduled.length - nextScheduledBlocks.length;
    setPremiumStatusMessage(`Premium inactive: removed ${trimmedCount} scheduled block(s) to match free tier.`, "error");

    return {
        scheduledBlocks: nextScheduledBlocks,
        trimmedCount
    };
}

async function loadAll() {
    if (loadAllInFlight) {
        loadAllPending = true;
        return;
    }

    loadAllInFlight = true;
    try {
        do {
            loadAllPending = false;
            lastRenderedHourlyStatsSignature = null; // Reset to force re-render on range change

            const {
                blockedDomains = {},
                statsToday = {},
                allStatsToday = {},
                statsHistory = {},
                hourlyUsageHistory = {},
                snoozeHistory = {},
                snoozedDomains = {},
                [IMMUTABLE_ADMIN_OVERRIDE_LAST_USED_KEY]: immutableAdminOverrideLastUsedDay = "",
                activeBlocks = [],
                scheduledBlocks = [],
                [SETTINGS_KEY]: storedSettings = DEFAULT_SETTINGS,
                [PREMIUM_KEY]: premiumStored = DEFAULT_PREMIUM
                    } = await chrome.storage.local.get(["blockedDomains", "statsToday", "allStatsToday", "statsHistory", "hourlyUsageHistory", "snoozeHistory", "snoozedDomains", IMMUTABLE_ADMIN_OVERRIDE_LAST_USED_KEY, "activeBlocks", "scheduledBlocks", SETTINGS_KEY, PREMIUM_KEY]);

            currentSettings = normalizeSettings(storedSettings);
            currentPremium = normalizePremium(premiumStored);

            const enforced = await enforceFreeTierDomainCap(blockedDomains, statsToday);
            const enforcedScheduled = await enforceFreeTierScheduledCap(scheduledBlocks);
            const effectiveBlockedDomains = enforced.blockedDomains;
            const effectiveStatsToday = enforced.statsToday;
            const effectiveScheduledBlocks = enforcedScheduled.scheduledBlocks;

            latestActiveBlocks = Array.isArray(activeBlocks) ? activeBlocks : [];
            latestBlockedDomains = effectiveBlockedDomains || {};
            latestStatsToday = effectiveStatsToday || {};
            latestSnoozeHistory = snoozeHistory || {};
            latestSnoozedDomains = snoozedDomains || {};
            lastActiveRenderSignature = getActiveRenderSignature(latestActiveBlocks, latestBlockedDomains, latestSnoozedDomains);
            const hasImmutableActive = hasActiveImmutableLimit(latestActiveBlocks, latestBlockedDomains, latestStatsToday, latestSnoozedDomains);
            updateImmutableOverrideButton(hasImmutableActive, String(immutableAdminOverrideLastUsedDay || ""));

            const range = $("statRange")?.value || "Today";
            const rangeContext = getRangeSelectionContext(range, allStatsToday, statsHistory, hourlyUsageHistory);
            const rangeStats = rangeContext.stats;

            updateStatStrip(rangeContext);
            updateDashboardSubhead(rangeContext.label);
            renderHourlyDistribution(rangeContext.hourlyStats, rangeContext.label);
            updateStreakChip(statsHistory, allStatsToday);
            renderActive(latestActiveBlocks, latestBlockedDomains, latestStatsToday, latestSnoozedDomains);
            renderScheduled(effectiveScheduledBlocks, latestActiveBlocks);
            if (!isRankingInteractionActive()) {
                renderRanking(effectiveBlockedDomains, effectiveStatsToday, rangeStats, "ranking", "timeSec", "Top by Time", rangeContext.label);
                renderRanking(effectiveBlockedDomains, effectiveStatsToday, rangeStats, "rankingByVisits", "visits", "Top by Visits", rangeContext.label);
            }
            renderBlockList(effectiveBlockedDomains, effectiveStatsToday, latestActiveBlocks, latestSnoozedDomains);
            applyPaywallUI(effectiveBlockedDomains, effectiveScheduledBlocks);
            await chrome.runtime.sendMessage({ action: "refreshActionBadge" }).catch(() => null);
        } while (loadAllPending);
    } finally {
        loadAllInFlight = false;
    }
}

function renderActive(activeBlocks, blockedDomains = {}, statsToday = {}, snoozedDomains = {}) {
    const list = $("activeList");
    const card = $("activeCard");
    const count = $("activeCount");
    const statusPill = document.querySelector(".status-pill");

    const active = Array.isArray(activeBlocks) ? activeBlocks : [];
    const now = Date.now();
    lastActiveRenderSignature = getActiveRenderSignature(active, blockedDomains, snoozedDomains);
    const activeDomains = new Set(active.map((entry) => entry.domain).filter(Boolean));

    // Count time-limited domains that have no remaining time today
    const timeLimitedActiveDomains = Object.entries(blockedDomains).filter(([domain, cfg]) => {
        if (activeDomains.has(domain)) return false;
        if (!isLimitEnabled(cfg)) return false;
        const limitSec = getLimitSecondsFromConfig(cfg);
        if (!Number.isFinite(limitSec) || limitSec <= 0) return false;
        const usedMs = statsToday?.[domain]?.timeMs || 0;
        if (usedMs < limitSec * 1000) return false;
        return true;
    }).map(([domain, cfg]) => ({
        type: "limit",
        domain,
        tierLabel: formatTierLabel(cfg?.tier || DEFAULT_TIER_LEGACY),
        limitSec: getLimitSecondsFromConfig(cfg) || 0,
        usedSec: Math.round((statsToday?.[domain]?.timeMs || 0) / 1000)
    }));

    const limitReachedDomains = new Set(timeLimitedActiveDomains.map((entry) => entry.domain));

    // Show paused rows only when pause and limit reached are both active for the same domain.
    const activeSnoozes = Object.entries(snoozedDomains || {})
        .map(([domain, entry]) => {
            if (activeDomains.has(domain)) return null;
            if (!limitReachedDomains.has(domain)) return null;
            const expiresAt = Number(entry?.expiresAt || entry || 0);
            const cfg = blockedDomains?.[domain];
            if (!Number.isFinite(expiresAt) || expiresAt <= now || !isLimitEnabled(cfg)) return null;
            return {
                type: "pause",
                domain,
                expiresAt,
                tierLabel: formatTierLabel(entry?.tier || cfg?.tier || DEFAULT_TIER_LEGACY)
            };
        })
        .filter(Boolean);

    const pausedDomains = new Set(activeSnoozes.map((entry) => entry.domain));
    const visibleLimitRows = timeLimitedActiveDomains.filter((entry) => !pausedDomains.has(entry.domain));

    const totalActive = active.length + activeSnoozes.length + visibleLimitRows.length;
    count.textContent = String(totalActive);
    statusPill?.classList.toggle("is-inactive", totalActive === 0);

    if (totalActive === 0) {
        // Hide card if empty
        if (card) card.style.display = "none";
        return;
    }

    // Show card
    if (card) card.style.display = "";

    list.classList.remove("muted");
    list.classList.remove("empty-state");
    list.innerHTML = "";

    active.forEach((s) => {
        const endsAt = s.endTime ? new Date(s.endTime) : null;
        const endsText = endsAt ? endsAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";
        const remainingSec = Math.max(0, Math.floor((s.endTime - now) / 1000));

        const div = document.createElement("div");
        div.className = "row row-accent-cyan";
        div.setAttribute("data-domain", s.domain);
        const tierLabel = formatTierLabel(s.tier || DEFAULT_TIER_NEW_RULE);
        div.innerHTML = `
        <div class="row-main">
            <div class="row-title">${s.domain}</div>
            <div class="row-meta">Ends: ${endsText}</div>
            <div class="row-metrics"><span class="tag metric-chip metric-chip-glass">${tierLabel}</span></div>
        </div>
        <div class="row-right">
            ${remainingSec > 0 ? `<span class="timer" data-domain="${s.domain}" data-timer-type="block">${formatTimeSec(remainingSec)} left</span>` : ""}
            <button type="button" class="tag action-chip action-chip-primary" data-domain="${s.domain}">Stop</button>
        </div>
        `;
        div.querySelector("button").addEventListener("click", async (e) => {
            const domain = e.currentTarget.getAttribute("data-domain");
            await stopActiveBlock(domain);
            await loadAll();
        });
        list.appendChild(div);
    });

    activeSnoozes.forEach((session) => {
        const remainingSec = Math.max(0, Math.floor((session.expiresAt - now) / 1000));
        const div = document.createElement("div");
        div.className = "row row-accent-purple is-paused";
        div.setAttribute("data-domain", session.domain);
        div.innerHTML = `
        <div class="row-main">
            <div class="row-title">${session.domain}</div>
        </div>
        <div class="row-right">
            <span class="tag metric-chip metric-chip-glass">${session.tierLabel}</span>
            ${remainingSec > 0 ? `<span class="timer" data-domain="${session.domain}" data-timer-type="pause">${formatCountdownMSS(remainingSec)}</span>` : ""}
            <button type="button" class="tag action-chip action-chip-primary" data-domain="${session.domain}" data-action="end-pause">End Pause</button>
        </div>
        `;
        div.querySelector('button[data-action="end-pause"]')?.addEventListener("click", async (e) => {
            const domain = e.currentTarget.getAttribute("data-domain");
            const response = await chrome.runtime.sendMessage({
                action: "clearDomainSnooze",
                domain,
                reason: "popup_end_pause"
            }).catch(() => ({ success: false }));

            if (!response?.success) {
                setPremiumStatusMessage(response?.error || "Unable to end pause.", "error");
                return;
            }

            await loadAll();
        });
        list.appendChild(div);
    });

    visibleLimitRows.forEach((session) => {
        const div = document.createElement("div");
        div.className = "row row-with-bar row-accent-red";
        div.setAttribute("data-domain", session.domain);
        div.innerHTML = `
        <div class="row-top">
            <div class="row-main">
                <div class="row-title">${session.domain}</div>
            </div>
            <div class="row-right">
                <div class="row-metrics"><span class="tag metric-chip metric-chip-glass">${session.tierLabel}</span></div>
                <span class="tag metric-chip metric-chip-glass">Daily limit reached</span>
            </div>
        </div>
        `;
        list.appendChild(div);
    });
}

async function stopActiveBlock(domain) {
    const { activeBlocks = [] } = await chrome.storage.local.get(["activeBlocks"]);
    const next = (activeBlocks || []).filter((s) => s.domain !== domain);
    await chrome.storage.local.set({ activeBlocks: next });
    if (activeBlocks.length !== next.length) {
        trackAnalyticsEvent("schedule_block_deactivated", {
            domain_host: domain,
            deactivation_source: "popup_stop"
        });
    }
}

async function removeScheduledBlock(id) {
    const { scheduledBlocks = [], activeBlocks = [] } = await chrome.storage.local.get(["scheduledBlocks", "activeBlocks"]);
    
    // Check if this scheduled block is currently active
    const isCurrentlyActive = (activeBlocks || []).some((b) => b.id === id);
    if (isCurrentlyActive) {
        setPremiumStatusMessage("Cannot remove scheduled block: it is currently active and blocking websites. Stop the block first.", "error");
        return;
    }
    
    const removed = (scheduledBlocks || []).find((b) => b.id === id) || null;
    const next = scheduledBlocks.filter((b) => b.id !== id);
    await chrome.storage.local.set({ scheduledBlocks: next });
    chrome.alarms.clear(`startBlock_${id}`);
    chrome.alarms.clear(`endBlock_${id}`);

    if (removed) {
        trackAnalyticsEvent("schedule_deleted", {
            schedule_id: id,
            domain_host: removed.domain,
            delete_source: "popup_remove"
        });
    }

    if (editingScheduledBlockId === id) {
        resetScheduledForm();
    }
}

function renderScheduled(scheduledBlocks, activeBlocks = []) {
    const list = $("scheduledList");
    const count = $("scheduledCount");

    const scheduled = Array.isArray(scheduledBlocks) ? scheduledBlocks : [];
    const active = Array.isArray(activeBlocks) ? activeBlocks : [];

    if (editingScheduledBlockId != null && !scheduled.some((block) => block.id === editingScheduledBlockId)) {
        resetScheduledForm();
    }

    if (scheduled.length === 0) {
        list.classList.add("muted");
        list.textContent = EMPTY_STATE_MESSAGES.scheduled;
        list.classList.add("empty-state");
        return;
    }

    list.classList.remove("muted");
    list.classList.remove("empty-state");
    list.innerHTML = "";
    if (count) count.textContent = String(scheduled.length);

    scheduled.forEach((s) => {
        const isActive = active.some((b) => b.id === s.id);
        const isEnabled = s.enabled !== false;
        const daySummary = formatScheduleDays(s.daysOfWeek);
        const rowMenuKey = getRowMenuKey("scheduled", s.id);
        const isMenuOpen = openRowMenuKey === rowMenuKey;
        const tierLabel = formatTierLabel(s.tier || DEFAULT_TIER_NEW_RULE);
        const div = document.createElement("div");
        div.className = `row ${!isEnabled ? "row-accent-muted is-disabled" : (isActive ? "row-accent-purple" : "row-accent-cyan")}`;
        div.innerHTML = `
        <div class="row-main">
            <div class="row-title">${s.domain}</div>
            <div class="row-metrics schedule-row-metrics">
                <span class="tag metric-chip metric-chip-glass">${tierLabel}</span>
                <span class="tag metric-chip metric-chip-glass">${daySummary}</span>
                <span class="tag metric-chip metric-chip-glass">${formatTimeForDisplay(s.startTime)} - ${formatTimeForDisplay(s.endTime)}</span>
            </div>
        </div>
        <div class="row-right">
            <label class="switch" title="Enable or pause this scheduled block">
                <input class="switch-input" type="checkbox" data-action="toggle-enabled" ${isEnabled ? "checked" : ""} aria-label="Toggle ${s.domain} scheduled block" />
                <span class="switch-slider" aria-hidden="true"></span>
            </label>
            <div class="row-action-menu-wrap">
                <button class="tag action-chip action-chip-menu" data-action="menu" aria-expanded="${isMenuOpen ? "true" : "false"}" aria-label="Open actions for ${s.domain}">⋮</button>
                <div class="row-action-menu ${isMenuOpen ? "is-open" : ""}" role="menu" aria-label="Scheduled block actions">
                    <button class="tag action-chip action-chip-primary" data-action="edit" role="menuitem">Edit</button>
                    <button class="tag action-chip action-chip-danger" data-action="remove" data-domain="${s.domain}" role="menuitem" ${isActive ? "disabled title=\"Stop the active session before removing\"" : ""}>Cancel</button>
                </div>
            </div>
        </div>
        `;
        div.querySelector('[data-action="menu"]')?.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleRowMenu("scheduled", s.id);
        });
        div.querySelector('[data-action="toggle-enabled"]')?.addEventListener("change", async (e) => {
            const enabled = Boolean(e.currentTarget.checked);
            const response = await chrome.runtime.sendMessage({
                action: "toggleScheduledBlockEnabled",
                id: s.id,
                enabled
            }).catch(() => ({ success: false }));

            if (!response?.success) {
                e.currentTarget.checked = !enabled;
                showFormError("scheduledFormMsg", response?.error || "Unable to update scheduled block state.");
                return;
            }

            clearFormFeedback("scheduledFormMsg", ["scheduledDomain", "startTime", "endTime"], true);
            await loadAll();
        });
        div.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
            closeRowMenus();
            beginScheduledBlockEdit(s);
        });
        div.querySelector('[data-action="remove"]')?.addEventListener("click", async () => {
            if (isActive) return;
            closeRowMenus();
            await removeScheduledBlock(s.id);
            await loadAll();
        });
        list.appendChild(div);
    });
}

function renderRanking(blockedDomains, statsToday, allStatsToday, elementId, sortBy, title, range = "Today") {
    const rank = $(elementId);
    const titleEl = rank?.parentElement?.querySelector(".card-title");
    if (titleEl) titleEl.textContent = `${title} · ${range}`;
    const byVisits = sortBy === "visits";

    const allDomains = Object.keys(allStatsToday || {});
    if (allDomains.length === 0) {
        rank.classList.add("muted");
        rank.textContent = "No data yet.";
        return;
    }

    const rows = allDomains
        .map((domain) => {
            const st = allStatsToday?.[domain] || { timeMs: 0, visits: 0 };
            const timeSec = Math.round((st.timeMs || 0) / 1000);
            return { domain, timeSec, visits: st.visits || 0 };
        })
        .sort((a, b) => byVisits ? b.visits - a.visits : b.timeSec - a.timeSec)
        .slice(0, 3); // top 3

    rank.classList.remove("muted");
    rank.innerHTML = "";

    rows.forEach((r, i) => {
        const metricValue = byVisits ? String(r.visits) : formatTimeSec(r.timeSec);
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze';
        const isBlocked = !!blockedDomains[r.domain];
        const limitSec = getLimitSecondsFromConfig(blockedDomains[r.domain]);
        const hasProgressBar = isBlocked && Number.isFinite(limitSec) && limitSec > 0 && range === "Today";
        const blockedStats = statsToday?.[r.domain] || { timeMs: 0, visits: 0 };
        const usedLimitSec = Math.round((blockedStats.timeMs || 0) / 1000);
        const limitUsageText = `Limit used: ${formatTimeSec(usedLimitSec)} / ${formatTimeSec(limitSec || 0)}`;
        const pct = hasProgressBar ? Math.min(100, Math.round((usedLimitSec / limitSec) * 100)) : 0;
        const div = document.createElement("div");
        const accentClass = hasProgressBar
            ? (pct >= 100 ? "row-accent-red" : "row-accent-purple")
            : (isBlocked ? "row-accent-cyan" : "row-accent-muted");
        if (hasProgressBar) {
            div.className = `row row-ranking row-with-bar ${accentClass}`;
            div.innerHTML = `
            <div class="row-top">
                <div class="row-main-inline">
                    <span class="rank-num ${rankClass}">${i + 1}</span>
                    <div class="row-title">${r.domain}</div>
                </div>
                <div class="row-right">
                    <span class="tag metric-chip metric-chip-glass">${metricValue}</span>
                </div>
            </div>
            <div class="row-meta">${limitUsageText}</div>
            <div class="prog-wrap row-progress"><div class="prog-fill" style="width:${pct}%"></div></div>
            `;
        } else {
            div.className = `row row-ranking ${accentClass}`;
            div.innerHTML = `
            <span class="rank-num ${rankClass}">${i + 1}</span>
            <div class="row-main">
                <div class="row-title">${r.domain}</div>
            </div>
            <div class="row-right">
                <span class="tag metric-chip metric-chip-glass">${metricValue}</span>
            </div>
            `;
        }
        if (!isBlocked) {
            const addBtn = document.createElement("button");
            addBtn.className = "tag action-chip action-chip-primary";
            addBtn.textContent = "+ Limit";
            addBtn.addEventListener("click", async () => {
                if (!canAddMoreDomains(latestBlockedDomains)) {
                    setPremiumStatusMessage(`Free plan allows up to ${FREE_PLAN_LIMITS.maxTrackedDomains} limited domains and ${FREE_PLAN_LIMITS.maxScheduledBlocks} scheduled blocks.`, "error");
                    return;
                }
                rankingInteractionDepth = 0;
                await addDomain(r.domain, currentSettings.defaultLimitMinutes * 60, "ranking_add_limit");
                await loadAll();
            });
            div.querySelector(".row-right").appendChild(addBtn);
        } else {
            const blockedSpan = document.createElement("span");
            blockedSpan.className = "tag metric-chip metric-chip-glass metric-chip-muted";
            blockedSpan.textContent = "Limited";
            div.querySelector(".row-right").appendChild(blockedSpan);
        }
        rank.appendChild(div);
    });

}

function renderBlockList(blockedDomains, statsToday, activeBlocks = [], snoozedDomains = {}) {
    const list = $("limitList") || $("blockList");
    if (!list) return;
    const entries = Object.entries(blockedDomains || {});

    if (entries.length === 0) {
        list.classList.add("muted");
        list.textContent = EMPTY_STATE_MESSAGES.blocked;
        list.classList.add("empty-state");
        return;
    }

    list.classList.remove("muted");
    list.classList.remove("empty-state");
    list.innerHTML = "";

    entries
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([domain, cfg]) => {
        const isEnabled = isLimitEnabled(cfg);
        const st = statsToday?.[domain] || { timeMs: 0, visits: 0 };
        const timeSec = Math.round((st.timeMs || 0) / 1000);

        const limitSec = getLimitSecondsFromConfig(cfg);
        const limitMin = limitSec ? Math.round(limitSec / 60) : null;
        const limitText = limitMin == null ? "—" : `${limitMin} min`;

        const displayTimeSec = (limitSec != null && timeSec >= limitSec) ? limitSec : timeSec;
        const pct = limitSec ? Math.min(100, Math.round((displayTimeSec / limitSec) * 100)) : 0;

        const isCurrentlyBlocking = (activeBlocks || []).some((b) => b.domain === domain)
            || isLimitCurrentlyBlocking(domain, cfg, statsToday, snoozedDomains);
        const div = document.createElement("div");
        const rowMenuKey = getRowMenuKey("limit", domain);
        const isMenuOpen = openRowMenuKey === rowMenuKey;
        const tierLabel = formatTierLabel(cfg?.tier || DEFAULT_TIER_LEGACY);
        const accentClass = !isEnabled
            ? "row-accent-muted"
            : (pct >= 100 ? "row-accent-red" : (pct >= 85 ? "row-accent-purple" : "row-accent-cyan"));
        const disabledClass = isEnabled ? "" : " is-disabled";
        div.className = `row row-limit row-with-bar ${accentClass}${disabledClass}`;
        div.innerHTML = `
            <div class="row-top">
                <div class="row-main">
                    <div class="row-title">${domain}</div>
                    <div class="row-metrics">
                        <span class="tag metric-chip metric-chip-glass">${tierLabel}</span>
                        <span class="tag metric-chip metric-chip-glass">Limit ${limitText}</span>
                        <span class="tag metric-chip metric-chip-glass">Today ${formatTimeSec(displayTimeSec)}</span>
                        <span class="tag metric-chip metric-chip-glass">${st.visits || 0} visits</span>
                    </div>
                </div>
                <div class="row-right">
                    <label class="switch" title="${isCurrentlyBlocking ? "Stop the active session before changing this limit" : "Enable or pause this limit"}">
                        <input class="switch-input" type="checkbox" data-domain="${domain}" data-action="toggle-enabled" ${isEnabled ? "checked" : ""} ${isCurrentlyBlocking ? "disabled" : ""} aria-label="Toggle ${domain} limit" />
                        <span class="switch-slider" aria-hidden="true"></span>
                    </label>
                    <div class="row-action-menu-wrap">
                        <button class="tag action-chip action-chip-menu" data-action="menu" aria-expanded="${isMenuOpen ? "true" : "false"}" aria-label="Open actions for ${domain}">⋮</button>
                        <div class="row-action-menu ${isMenuOpen ? "is-open" : ""}" role="menu" aria-label="Limit actions">
                            <button class="tag action-chip action-chip-danger" data-domain="${domain}" data-action="remove" role="menuitem" ${isCurrentlyBlocking ? "disabled title=\"Stop the active session before removing\"" : ""}>Remove</button>
                        </div>
                    </div>
                </div>
            </div>
            ${limitSec ? `<div class="prog-wrap row-progress"><div class="prog-fill" style="width:${pct}%"></div></div>` : ""}
        `;
        div.querySelector('[data-action="menu"]')?.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleRowMenu("limit", domain);
        });
        div.querySelector('[data-action="toggle-enabled"]')?.addEventListener("change", async (e) => {
            if (isCurrentlyBlocking) {
                e.currentTarget.checked = isEnabled;
                return;
            }

            const enabled = Boolean(e.currentTarget.checked);
            const response = await chrome.runtime.sendMessage({
                action: "toggleDomainLimitEnabled",
                domain,
                enabled
            }).catch(() => ({ success: false }));

            if (!response?.success) {
                e.currentTarget.checked = !enabled;
                setPremiumStatusMessage(response?.error || "Unable to update limit state.", "error");
                return;
            }

            await loadAll();
        });
        div.querySelector("button[data-action='remove']")?.addEventListener("click", async (e) => {
            const d = e.currentTarget.getAttribute("data-domain");
            closeRowMenus();
            await removeDomain(d);
            await loadAll();
        });
        list.appendChild(div);
    });
}

async function removeDomain(domain) {
    const { blockedDomains = {}, statsToday = {}, activeBlocks = [], snoozedDomains = {}, alertsSent = {} }
        = await chrome.storage.local.get(["blockedDomains", "statsToday", "activeBlocks", "snoozedDomains", "alertsSent"]);
    
    // Prevent removal if the limit is actively blocking a website or a scheduled session is live
    const isCurrentlyBlocking = (activeBlocks || []).some((b) => b.domain === domain)
        || isLimitCurrentlyBlocking(domain, blockedDomains?.[domain], statsToday, snoozedDomains);
    if (isCurrentlyBlocking) {
        setPremiumStatusMessage(`Cannot remove ${domain}: it is currently blocking websites. Stop the block first.`, "error");
        return;
    }
    
    const nextBlocked = { ...blockedDomains };
    delete nextBlocked[domain];

    const nextStats = { ...statsToday };
    delete nextStats[domain];

    const nextActive = (activeBlocks || []).filter((s) => s.domain !== domain);

    const nextAlerts = { ...alertsSent };
    delete nextAlerts[domain];

    await chrome.storage.local.set({
        blockedDomains: nextBlocked,
        statsToday: nextStats,
        activeBlocks: nextActive,
        alertsSent: nextAlerts
    });

    const clearResponse = await chrome.runtime.sendMessage({
        action: "clearDomainSnooze",
        domain,
        reason: "limit_removed"
    }).catch(() => ({ success: false }));

    if (!clearResponse?.success) {
        const { snoozedDomains = {} } = await chrome.storage.local.get(["snoozedDomains"]);
        if (Object.prototype.hasOwnProperty.call(snoozedDomains, domain)) {
            const nextSnoozed = { ...snoozedDomains };
            delete nextSnoozed[domain];
            await chrome.storage.local.set({ snoozedDomains: nextSnoozed });
        }
    }

    trackAnalyticsEvent("domain_removed", {
        domain_host: domain,
        remove_reason: "user_remove"
    });
}

async function addDomain(domain, limitSeconds, entrypoint = "manual_form", tier = DEFAULT_TIER_NEW_RULE) {
    const { blockedDomains = {}, alertsSent = {}, statsToday = {}, allStatsToday = {} }
        = await chrome.storage.local.get(["blockedDomains", "alertsSent", "statsToday", "allStatsToday"]);
    const next = { ...blockedDomains };
    const hadDomain = Boolean(blockedDomains[domain]);
    const previousLimitSeconds = Number(blockedDomains?.[domain]?.limitSeconds || 0);
    next[domain] = {
        ...blockedDomains?.[domain],
        limitSeconds,
        tier: normalizeTier(tier, blockedDomains?.[domain]?.tier || DEFAULT_TIER_NEW_RULE),
        enabled: blockedDomains?.[domain]?.enabled !== false
    };

    const passiveStats = allStatsToday?.[domain] || { timeMs: 0, visits: 0 };
    const existingStats = statsToday?.[domain] || { timeMs: 0, visits: 0 };
    const mergedStats = {
        timeMs: Math.max(existingStats.timeMs || 0, passiveStats.timeMs || 0),
        visits: Math.max(existingStats.visits || 0, passiveStats.visits || 0)
    };
    const nextStats = { ...statsToday, [domain]: mergedStats };
    
    // Reset alerts when limit is changed
    const nextAlerts = { ...alertsSent };
    delete nextAlerts[domain];
    
    await chrome.storage.local.set({ blockedDomains: next, statsToday: nextStats, alertsSent: nextAlerts });

    if (hadDomain) {
        trackAnalyticsEvent("domain_limit_changed", {
            domain_host: domain,
            old_limit_ms: previousLimitSeconds * 1000,
            new_limit_ms: limitSeconds * 1000,
            change_source: entrypoint
        });
    } else {
        trackAnalyticsEvent("domain_added", {
            domain_host: domain,
            limit_ms: limitSeconds * 1000,
            entrypoint
        });
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    startActiveCountdownTicker();
    startPopupRefreshTicker();
    wireRankingInteractionGuards();
    initializeScheduleDayPicker();

    // Load onboarding state
    const { [ONBOARDING_KEY]: onboardingStored } = await chrome.storage.local.get([ONBOARDING_KEY]);
    if (onboardingStored) {
        currentOnboardingState = onboardingStored;
    }

    // Wire up onboarding button handlers and show overlay if onboarding is not yet completed
    if (!currentOnboardingState.completed) {
        $("onboardingNextBtn0")?.addEventListener("click", async () => {
            trackAnalyticsEvent("onboarding_step_completed", {
                step_name: getOnboardingStepName(0),
                step_index: 0
            });
            await setOnboardingStep(1);
            await showOnboardingStep(1);
        });

        $("onboardingNextBtn1")?.addEventListener("click", async () => {
            trackAnalyticsEvent("onboarding_step_completed", {
                step_name: getOnboardingStepName(1),
                step_index: 1
            });
            await setOnboardingStep(2);
            await showOnboardingStep(2);
        });

        $("onboardingPrevBtn1")?.addEventListener("click", async () => {
            await showOnboardingStep(0);
        });

        $("onboardingPrevBtn2")?.addEventListener("click", async () => {
            await showOnboardingStep(1);
        });

        $("onboardingSkipBtn0")?.addEventListener("click", async () => {
            await skipOnboarding();
        });

        $("onboardingSkipBtn1")?.addEventListener("click", async () => {
            await skipOnboarding();
        });

        $("onboardingSkipBtn2")?.addEventListener("click", async () => {
            await skipOnboarding();
        });

        $("onboardingCompleteBtn")?.addEventListener("click", async () => {
            await completeOnboardingAndSetupDefaults();
        });

        await showOnboarding();
    }

    await loadSettingsFromStorage();
    await loadMonetizationFromStorage();

    const defaultLimitEl = $("defaultLimitMinutes");
    const use24HourEl = $("use24HourTime");
    if (defaultLimitEl) defaultLimitEl.value = String(currentSettings.defaultLimitMinutes);
    if (use24HourEl) use24HourEl.checked = currentSettings.use24HourTime;
    applyScheduleInputMode();

    ["domainInput", "limitInput"].forEach((id) => {
        $(id)?.addEventListener("input", () => clearFormFeedback("addFormMsg", ["domainInput", "limitInput"]));
    });
    ["scheduledDomain", "startTime", "endTime"].forEach((id) => {
        $(id)?.addEventListener("input", () => clearFormFeedback("scheduledFormMsg", ["scheduledDomain", "startTime", "endTime"], true));
    });
    $("scheduledDays")?.addEventListener("click", () => clearFormFeedback("scheduledFormMsg", ["scheduledDomain", "startTime", "endTime"], true));
    $("cancelScheduledEditBtn")?.addEventListener("click", () => resetScheduledForm());
    updateScheduledFormMode();

    try {
        const overrideStorage = await chrome.storage.local.get([
            IMMUTABLE_ADMIN_OVERRIDE_LAST_USED_KEY
        ]);
        const hasImmutableActive = hasActiveImmutableLimit(latestActiveBlocks, latestBlockedDomains, latestStatsToday, latestSnoozedDomains);
        updateImmutableOverrideButton(
            hasImmutableActive,
            String(overrideStorage?.[IMMUTABLE_ADMIN_OVERRIDE_LAST_USED_KEY] || "")
        );

        $("immutableAdminOverrideBtn")?.addEventListener("click", async () => {
            const storage = await chrome.storage.local.get([
                IMMUTABLE_ADMIN_OVERRIDE_KEY,
                IMMUTABLE_ADMIN_OVERRIDE_LAST_USED_KEY,
                "activeBlocks",
                "blockedDomains",
                "statsToday",
                "snoozedDomains"
            ]);
            const immutableAdminOverrideEnabled = Boolean(storage?.[IMMUTABLE_ADMIN_OVERRIDE_KEY]);
            const immutableAdminOverrideLastUsedDay = String(storage?.[IMMUTABLE_ADMIN_OVERRIDE_LAST_USED_KEY] || "");
            const hasImmutableActive = hasActiveImmutableLimit(
                storage?.activeBlocks || [],
                storage?.blockedDomains || {},
                storage?.statsToday || {},
                storage?.snoozedDomains || {}
            );
            const todayKey = getDayKey();
            const isUsedToday = String(immutableAdminOverrideLastUsedDay || "") === todayKey;
            const currentlyEnabled = Boolean(immutableAdminOverrideEnabled);

            if (isUsedToday) {
                updateImmutableOverrideButton(hasImmutableActive, immutableAdminOverrideLastUsedDay);
                return;
            }

            if (!hasImmutableActive) {
                return { blockedDomains, statsToday, trimmedCount: 0, keptDomains: new Set(Object.keys(blockedDomains || {})) };
                return;
            }

            if (currentlyEnabled) {
                updateImmutableOverrideButton(hasImmutableActive, immutableAdminOverrideLastUsedDay);
                return { blockedDomains, statsToday, trimmedCount: 0, keptDomains: new Set(entries.map(([domain]) => domain)) };
            }

            const confirmed = window.confirm("This will bypass immutable blocks for this session. You only get one per day.");
            if (!confirmed) {
                return;
            }

            const nextEnabled = true;
            const response = await chrome.runtime.sendMessage({
                action: "setImmutableAdminOverride",
                enabled: nextEnabled
            }).catch(() => ({ success: false }));

            if (!response?.success) {
                setPremiumStatusMessage(response?.error || "Unable to update immutable override.", "error");
                updateImmutableOverrideButton(hasImmutableActive, immutableAdminOverrideLastUsedDay);
                return;
            }

            updateImmutableOverrideButton(hasImmutableActive, immutableAdminOverrideLastUsedDay);
            await loadAll();
        });
    } catch (error) {
        console.error("Immutable override controls failed to initialize", error);
    }

    $("verifyWhopBtn")?.addEventListener("click", async () => {
        await verifyWhopAccess();
    });
    $("linkWhopTokenBtn")?.addEventListener("click", async () => {
        await linkWhopTokenManually();
    });
    $("manualWhopToken")?.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        await linkWhopTokenManually();
    });

    await completeWhopCheckoutFromUrl();

    const startupRefresh = await chrome.runtime.sendMessage({ action: "refreshPremiumStatus" }).catch(() => null);
    if (startupRefresh?.pendingActivation) {
        setPremiumStatusMessage("Checkout detected. Activation may take a few seconds. Click Sync Premium Status soon.", "error");
    }
    $("manageWhopBtn")?.addEventListener("click", openWhopManage);

    const statRangeSelect = document.getElementById("statRange");
    if (statRangeSelect) {
        statRangeSelect.addEventListener("change", async () => {
            requestAnimationFrame(() => statRangeSelect.blur());
            await loadAll();
        });
    }

    $("settingsForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const previousSettings = { ...currentSettings };
        await saveSettingsToStorage({
            defaultLimitMinutes: Number(defaultLimitEl?.value),
            use24HourTime: Boolean(use24HourEl?.checked)
        });

        if (previousSettings.defaultLimitMinutes !== currentSettings.defaultLimitMinutes) {
            trackAnalyticsEvent("setting_toggled", {
                setting_name: "default_limit_minutes",
                new_value: currentSettings.defaultLimitMinutes,
                surface: "settings"
            });
        }
        if (previousSettings.use24HourTime !== currentSettings.use24HourTime) {
            trackAnalyticsEvent("setting_toggled", {
                setting_name: "use_24_hour_time",
                new_value: currentSettings.use24HourTime ? 1 : 0,
                surface: "settings"
            });
        }

        if (defaultLimitEl) defaultLimitEl.value = String(currentSettings.defaultLimitMinutes);
        if (use24HourEl) use24HourEl.checked = currentSettings.use24HourTime;
        applyScheduleInputMode();
        showSettingsSavedMessage();
        await loadAll();
    });

    $("addForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        clearFormFeedback("addFormMsg", ["domainInput", "limitInput"]);

        if (!canAddMoreDomains(latestBlockedDomains)) {
            setPremiumStatusMessage(`Free plan allows up to ${FREE_PLAN_LIMITS.maxTrackedDomains} limited domains.`, "error");
            return;
        }

        const domain = normalizeDomain($("domainInput").value);
        const rawLimitValue = $("limitInput").value.trim();
        const tier = normalizeTier($("limitTier")?.value || DEFAULT_TIER_NEW_RULE, DEFAULT_TIER_NEW_RULE);
        const parsedMinutes = Number(rawLimitValue);
        const limitMinutes = rawLimitValue === "" ? currentSettings.defaultLimitMinutes : parsedMinutes;
        const limitSeconds = Math.floor(limitMinutes * 60);

        if (!isValidDomain(domain)) {
            showFormError("addFormMsg", "Enter a valid domain like google.com.", ["domainInput"]);
            return;
        }
        if (!Number.isFinite(limitSeconds) || limitSeconds <= 0) {
            showFormError("addFormMsg", "Enter a daily limit greater than 0 minutes.", ["limitInput"]);
            return;
        }

        $("domainInput").value = "";
        $("limitInput").value = "";

        await addDomain(domain, limitSeconds, "manual_form", tier);
        await loadAll();
    });

    // Scheduled form event listener
    $("scheduledForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        clearFormFeedback("scheduledFormMsg", ["scheduledDomain", "startTime", "endTime"], true);

        const isEditing = editingScheduledBlockId != null;
        const { scheduledBlocks = [] } = await chrome.storage.local.get(["scheduledBlocks"]);
        if (!isEditing && !canAddMoreScheduledBlocks(scheduledBlocks)) {
            setPremiumStatusMessage(`Free plan allows up to ${FREE_PLAN_LIMITS.maxScheduledBlocks} scheduled blocks.`, "error");
            return;
        }

        const domain = normalizeDomain($("scheduledDomain").value);
        const startTimeInput = $("startTime").value.trim();
        const endTimeInput = $("endTime").value.trim();
        const tier = normalizeTier($("scheduledTier")?.value || DEFAULT_TIER_NEW_RULE, DEFAULT_TIER_NEW_RULE);
        const daysOfWeek = [...selectedScheduleDays].sort((a, b) => a - b);

        const startTime = parseTimeInput(startTimeInput, currentSettings.use24HourTime);
        const endTime = parseTimeInput(endTimeInput, currentSettings.use24HourTime);

        if (!isValidDomain(domain)) {
            showFormError("scheduledFormMsg", "Enter a valid domain like google.com.", ["scheduledDomain"]);
            return;
        }

        if (!startTime || !endTime) {
            if (currentSettings.use24HourTime) {
                showFormError("scheduledFormMsg", "Enter valid start and end times in 24-hour format.", ["startTime", "endTime"]);
            } else {
                showFormError("scheduledFormMsg", "Enter valid start and end times in H:MM AM/PM format.", ["startTime", "endTime"]);
            }
            return;
        }

        if (daysOfWeek.length === 0) {
            showFormError("scheduledFormMsg", "Select at least one active day.", [], true);
            return;
        }

        const response = await chrome.runtime.sendMessage({
            action: isEditing ? "updateScheduledBlock" : "addScheduledBlock",
            id: editingScheduledBlockId,
            domain,
            startTime,
            endTime,
            daysOfWeek,
            tier
        });
        if (!response?.success) {
            showFormError("scheduledFormMsg", response?.error || "Unable to save the scheduled block.");
            return;
        }

        resetScheduledForm();
        await loadAll();
    });

    // Only render data immediately if onboarding is already complete;
    // otherwise loadAll() is called by skipOnboarding/completeOnboardingAndSetupDefaults.
    if (currentOnboardingState.completed) {
        await loadAll();
    }
});

window.addEventListener("unload", () => {
    stopActiveCountdownTicker();
    stopPopupRefreshTicker();
    if (saveMessageTimer) {
        clearTimeout(saveMessageTimer);
        saveMessageTimer = null;
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes[SETTINGS_KEY]) {
        currentSettings = normalizeSettings(changes[SETTINGS_KEY].newValue || DEFAULT_SETTINGS);
        const defaultLimitEl = $("defaultLimitMinutes");
        const use24HourEl = $("use24HourTime");
        if (defaultLimitEl) defaultLimitEl.value = String(currentSettings.defaultLimitMinutes);
        if (use24HourEl) use24HourEl.checked = currentSettings.use24HourTime;
        applyScheduleInputMode();
    }

    if (changes[PREMIUM_KEY]) {
        currentPremium = normalizePremium(changes[PREMIUM_KEY].newValue || DEFAULT_PREMIUM);
    }

    if (changes.snoozeHistory) {
        latestSnoozeHistory = changes.snoozeHistory.newValue || {};
    }

    if (changes.hourlyUsageHistory) {
        latestHourlyUsageHistory = changes.hourlyUsageHistory.newValue || {};
    }

    if (changes[SETTINGS_KEY] || changes[PREMIUM_KEY] || changes.statsToday || changes.allStatsToday || changes.blockedDomains || changes.activeBlocks || changes.scheduledBlocks || changes.statsHistory || changes.snoozeHistory || changes.hourlyUsageHistory) {
        loadAll();
    }
});
