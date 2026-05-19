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
const WHOP_CHECKOUT_URL = "https://whop.com/screen-time-manager/screen-time-manager-pro/";
const WHOP_CHECKOUT_START_URL = "https://screen-time-manager.jackster0627.workers.dev/whop/start";
const WHOP_MANAGE_URL = "https://whop.com/hub/memberships/";
const CHROME_WEBSTORE_REVIEW_URL = "https://chromewebstore.google.com/detail/screen-time-manager/pecaajdaecdmikcgfdgldcofdebhfbgo/reviews";
const REVIEW_PROMPT_STATE_KEY = "reviewPromptState";
const REVIEW_PROMPT_FIRST_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
const LIVE_REFRESH_INTERVAL_MS = 1000;
const LIVE_REFRESH_MOTION_SUPPRESSION_MS = 120;
const HOURLY_BAR_MIN_ACTIVE_HEIGHT_PCT = 6;
const HOURLY_BAR_DAILY_SHARE_SCALE = 0.25;

const DEFAULT_SETTINGS = Object.freeze({
    defaultLimitMinutes: 30,
    use24HourTime: false,
    limitNotificationsEnabled: true,
    personalInsightsEnabled: true,
    insightNotificationsEnabled: true,
    insightMaxNotificationsPerDay: 1,
    insightSensitivity: "normal"
});

const DEFAULT_PREMIUM = Object.freeze({
    active: false,
    planName: "Free"
});

const FREE_LIMITS = Object.freeze({
    maxTrackedDomains: 3,
    maxScheduledBlocks: 2
});

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
    selectedDays: [0, 1, 2, 3, 4, 5, 6],
    selectedHourlyHour: null,
    selectedInsightIndex: 0,
    editingScheduleId: null,
    rankingSignature: ""
};

let liveRefreshPromise = null;
let rankingMotionRestoreTimer = null;

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

function send(action, payload = {}) {
    return chrome.runtime.sendMessage({ action, ...payload }).catch((error) => ({
        success: false,
        error: error instanceof Error ? error.message : String(error)
    }));
}

function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
}

function setFeedback(id, text = "", ok = true) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("is-error", Boolean(text && !ok));
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
    const start = [34, 217, 255];
    const end = [255, 141, 83];
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

function isLimitCurrentlyBlocking(domain, cfg, statsToday = {}, snoozedDomains = {}) {
    const limit = limitConfig(cfg);
    if (!limit.enabled || !limit.limitSeconds) return false;
    const snooze = entryForDomain(snoozedDomains, domain);
    const snoozeExpiresAt = Number(snooze?.expiresAt || snooze || 0);
    if (snoozeExpiresAt > Date.now()) return false;
    return timeMs(statsToday?.[domain]) >= limit.limitSeconds * 1000;
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

function snoozesForOffsets(offsets = []) {
    const history = state.data.snoozeHistory || {};
    return offsets.reduce((sum, offset) => sum + Number(history[dayKeyOffset(offset)] || 0), 0);
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
}

function renderStats() {
    const range = $("statRange")?.value || "Today";
    const currentOffsets = offsetsForRange(range);
    const previousPeriodOffsets = previousOffsets(currentOffsets);
    const current = statsForOffsets(currentOffsets);
    const previous = statsForOffsets(previousPeriodOffsets);
    const total = totals(current);
    const previousTotal = totals(previous);
    const snoozes = snoozesForOffsets(currentOffsets);
    const previousSnoozes = snoozesForOffsets(previousPeriodOffsets);

    setText("statScreenTime", formatShortTime(total.timeMs));
    setText("statVisits", String(total.visits));
    setText("statSnoozes", String(snoozes));
    setText("statScreenTimeDelta", formatPercentDelta(total.timeMs, previousTotal.timeMs));
    setText("statVisitsDelta", formatPercentDelta(total.visits, previousTotal.visits));
    setText("statSnoozesDelta", formatPercentDelta(snoozes, previousSnoozes));
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
        .filter(([domain, cfg]) => !activeDomains.has(normalizeDomain(domain)) && isLimitCurrentlyBlocking(domain, cfg, statsToday, state.data.snoozedDomains))
        .map(([domain, cfg]) => ({ domain, cfg }));

    const activeRows = activeBlocks.map((block) => {
        const endMs = Number(block.endTime || block.endsAt || 0);
        const remainingSec = endMs > Date.now() ? Math.floor((endMs - Date.now()) / 1000) : 0;
        const endsText = endMs ? new Date(endMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : formatTimeForDisplay(block.endTime);

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
    setText("activeCount", String(activeRows.length + pausedRows.length + reachedRows.length));
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
    if (timeTitle) timeTitle.textContent = `Time Spent · ${range}`;
    if (visitsTitle) visitsTitle.textContent = `Most Visited · ${range}`;
    state.rankingSignature = rankingSignature(range);
    renderList("ranking", makeRows(false), "No data yet.");
    renderList("rankingByVisits", makeRows(true), "No data yet.");
}

function updateRankingMetricsInPlace() {
    const range = $("statRange")?.value || "Today";
    const nextSignature = rankingSignature(range);
    if (nextSignature !== state.rankingSignature) {
        renderRankingStyled();
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

function personalInsightItems() {
    if (state.settings.personalInsightsEnabled === false) return [];

    const dismissed = state.data[DISMISSED_INSIGHTS_KEY] || {};
    return (state.data[PERSONAL_INSIGHTS_KEY] || [])
        .filter((insight) => insight?.id && !dismissed[insight.id])
        .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(b.timestamp || 0) - Number(a.timestamp || 0))
        .slice(0, 4);
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

function formatInsightIncreasePercent(value) {
    const ratio = Number(value || 0);
    if (!Number.isFinite(ratio) || ratio <= 0) return "";
    return `${Math.max(0, Math.round((ratio - 1) * 100))}%`;
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

function insightDomainLabel(domain) {
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
        "gmail.com": "Gmail"
    };

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

function insightPersonalHeadlineHtml(insight = {}, domain = "") {
    const context = insightContextWithFallback(insight, domain);
    const domainHtml = insightHeadlineEmphasis(insightDomainLabel(domain), "insight-domain-emphasis");

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
    const isLimited = Boolean(entryForDomain(blockedDomains, domain));
    const action = !isLimited
        ? actionChip("Add Limit", "insight-add-limit", "action-chip-primary insight-primary-action", `data-domain="${escapeHtml(domain)}"`)
        : "";
    const accent = insight.action === "addLimit" && !isLimited
        ? "row-accent-purple"
        : (index % 2 ? "row-accent-cyan" : "row-accent-muted");
    const subheading = insightPersonalSubheadingHtml(insight, domain);

    return `
        <div class="row insight-row ${accent}" data-insight-id="${escapeHtml(insight.id)}" data-domain="${escapeHtml(domain)}">
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
    if (card) {
        card.hidden = !insights.length;
        card.classList.toggle("dashboard-card-hidden", !insights.length);
    }
    if (nav) nav.innerHTML = "";
    if (!list) return;

    if (!insights.length) {
        list.innerHTML = "";
        return;
    }

    state.selectedInsightIndex = Math.max(0, Math.min(state.selectedInsightIndex, insights.length - 1));
    if (nav) nav.innerHTML = insightHeaderControls(insights.length);
    list.classList.remove("muted");
    list.innerHTML = `
        <div class="insight-carousel">
            ${insightSlideHtml(insights[state.selectedInsightIndex], state.selectedInsightIndex)}
        </div>
    `;
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
    if (title) title.textContent = `Usage Distribution · ${range}`;

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
            <div class="hourly-tip-time">${formatHourRangeTooltip(hour)}${isPeak ? ' · <span class="hourly-tip-inline-peak">Peak</span>' : ""}</div>
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
            const usedSec = Math.round(timeMs(stats[domain]) / 1000);
            const displaySec = config.limitSeconds ? Math.min(usedSec, config.limitSeconds) : usedSec;
            const pct = config.limitSeconds ? Math.min(100, Math.round((displaySec / config.limitSeconds) * 100)) : 0;
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
                                <span class="tag metric-chip metric-chip-glass">Today ${formatTimeSec(displaySec)}</span>
                                <span class="tag metric-chip metric-chip-glass">${visits(stats[domain])} visits</span>
                            </div>
                        </div>
                        <div class="row-right">
                            <label class="switch" title="Enable or disable this limit">
                                <input class="switch-input" type="checkbox" data-action="toggle-domain" data-domain="${escapeHtml(domain)}" ${config.enabled ? "checked" : ""} aria-label="Toggle ${escapeHtml(domain)} limit" />
                                <span class="switch-slider" aria-hidden="true"></span>
                            </label>
                            ${actionChip("Remove", "remove-domain", "action-chip-danger", `data-domain="${escapeHtml(domain)}"`)}
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
            renderScheduleDays();
        });
    });
}

function renderSchedulesStyled() {
    const activeIds = new Set((state.data.activeBlocks || []).map((block) => block.id));
    const rows = (state.data.scheduledBlocks || []).map((block) => {
        const days = block.days || block.daysOfWeek || [];
        const active = activeIds.has(block.id);
        const enabled = block.enabled !== false;
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
    const isPremium = Boolean(state.premium.active);
    const blockedCount = Object.keys(state.data.blockedDomains || {}).length;
    const scheduleCount = (state.data.scheduledBlocks || []).length;

    const limitsPaywall = $("limitsPaywallCard");
    if (limitsPaywall) {
        limitsPaywall.style.display = !isPremium && blockedCount >= FREE_LIMITS.maxTrackedDomains ? "block" : "none";
    }
    setText("limitsPaywallNotice", `Free plan includes ${FREE_LIMITS.maxTrackedDomains} limits.`);

    const schedulePaywall = $("schedulePaywallCard");
    if (schedulePaywall) {
        schedulePaywall.style.display = !isPremium && scheduleCount >= FREE_LIMITS.maxScheduledBlocks ? "block" : "none";
    }
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

    setText("streakHeaderValue", String(streak));
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
    if (!document.body) return;
    if (rankingMotionRestoreTimer) {
        window.clearTimeout(rankingMotionRestoreTimer);
        rankingMotionRestoreTimer = null;
    }
    document.body.classList.add("is-live-refresh-render");
}

function endRankingMotionSuppressionSoon() {
    if (!document.body) return;
    void document.body.offsetHeight;
    rankingMotionRestoreTimer = window.setTimeout(() => {
        document.body?.classList.remove("is-live-refresh-render");
        rankingMotionRestoreTimer = null;
    }, LIVE_REFRESH_MOTION_SUPPRESSION_MS);
}

function renderAll(options = {}) {
    const suppressRankingMotion = options.suppressRankingMotion === true;
    const updateRankingInPlace = options.updateRankingInPlace === true;
    if (suppressRankingMotion) beginRankingMotionSuppression();

    try {
        renderStats();
        renderActive();
        if (updateRankingInPlace) updateRankingMetricsInPlace();
        else renderRankingStyled();
        renderPersonalInsights();
        renderHourlyStyled();
        renderLimitsStyled();
        renderScheduleDays();
        renderSchedulesStyled();
        renderStreak();
        renderSettings();
    } finally {
        if (suppressRankingMotion) endRankingMotionSuppressionSoon();
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
        "activeBlocks",
        "scheduledBlocks",
        SETTINGS_KEY,
        PREMIUM_KEY,
        REVIEW_PROMPT_STATE_KEY,
        ONBOARDING_KEY,
        "immutableAdminOverrideEnabled"
    ]);

    state.settings = { ...DEFAULT_SETTINGS, ...(state.data[SETTINGS_KEY] || {}) };
    state.premium = { ...DEFAULT_PREMIUM, ...(state.data[PREMIUM_KEY] || {}) };
    state.onboarding = { ...state.onboarding, ...(state.data[ONBOARDING_KEY] || {}) };
    const overrideState = await send("getImmutableOverrideState");
    state.immutableOverride = overrideState?.success ? overrideState : { available: false };
    renderAll({
        suppressRankingMotion: options.suppressRankingMotion === true,
        updateRankingInPlace: options.updateRankingInPlace === true
    });
}

function refreshLive() {
    if (liveRefreshPromise) return liveRefreshPromise;
    liveRefreshPromise = loadAll({ flush: true, suppressRankingMotion: true, updateRankingInPlace: true }).finally(() => {
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
    if (!isValidDomain(normalized) || !Number.isFinite(numericMinutes) || numericMinutes <= 0) {
        return { success: false, error: "Enter a valid domain and limit." };
    }

    const data = await chrome.storage.local.get(["blockedDomains", "alertsSent"]);
    const blockedDomains = data.blockedDomains || {};
    deleteEntriesForDomain(blockedDomains, normalized);
    blockedDomains[normalized] = {
        enabled: true,
        limitSeconds: Math.round(numericMinutes * 60),
        tier
    };

    const alertsSent = data.alertsSent || {};
    deleteEntriesForDomain(alertsSent, normalized);
    await chrome.storage.local.set({ blockedDomains, alertsSent });
    return { success: true, domain: normalized };
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

    if (!isValidDomain(block.domain) || !block.startTime || !block.endTime || !block.days.length) {
        setFeedback("scheduledFormMsg", "Complete the schedule fields.", false);
        $("scheduledDays")?.classList.toggle("is-invalid", !block.days.length);
        return;
    }

    const action = state.editingScheduleId ? "updateScheduledBlock" : "addScheduledBlock";
    const response = await send(action, { block });
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
    state.selectedDays = [0, 1, 2, 3, 4, 5, 6];
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
            : DEFAULT_SETTINGS.insightSensitivity
    };
}

async function persistSettings() {
    state.settings = settingsFromForm();
    await chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
    if (state.settings.personalInsightsEnabled !== false) {
        await send("generateInsights", { allowNotifications: false });
    }
    setFeedback("settingsSavedMsg", "Settings saved");
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

function openWhopCheckout() {
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

async function maybeShowReviewPromptToast() {
    const prompt = reviewPromptState();
    const now = Date.now();
    if (prompt.reviewedAt) return;

    const nextPromptAt = Number(prompt.nextPromptAt || 0);
    if (!nextPromptAt) {
        await persistReviewPromptState({
            createdAt: Number(prompt.createdAt || now),
            nextPromptAt: now + REVIEW_PROMPT_FIRST_DELAY_MS,
            shownCount: Number(prompt.shownCount || 0)
        });
        return;
    }

    if (nextPromptAt > now) return;

    showReviewPromptToast();
    await persistReviewPromptState({
        lastShownAt: now,
        nextPromptAt: now + REVIEW_PROMPT_INTERVAL_MS,
        shownCount: Number(prompt.shownCount || 0) + 1
    });
}

async function deferReviewPromptToast() {
    const now = Date.now();
    await persistReviewPromptState({
        dismissedAt: now,
        nextPromptAt: now + REVIEW_PROMPT_INTERVAL_MS
    });
    hideReviewPromptToast();
}

async function openChromeWebStoreReview() {
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

    setActiveTab("tab4");
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
}

async function skipOnboarding() {
    await completeOnboarding(true);
}

function bindDelegatedActions() {
    document.addEventListener("change", async (event) => {
        const target = event.target.closest(".switch-input[data-action]");
        if (!target) return;

        const action = target.dataset.action;
        if (action === "toggle-domain") await toggleDomain(target.dataset.domain, target.checked);
        if (action === "toggle-schedule") await toggleSchedule(target.dataset.id, target.checked);
    });

    document.addEventListener("click", async (event) => {
        const slot = event.target.closest(".hourly-slot[data-hour]");
        if (slot) {
            selectHourlySlot(slot);
            return;
        }

        const target = event.target.closest("[data-action]");
        if (!target) return;
        if (target.classList.contains("switch-input")) return;

        const action = target.dataset.action;
        const domain = target.dataset.domain;
        const id = target.dataset.id;

        if (action === "remove-domain") await removeDomain(domain);
        if (action === "clear-snooze") await clearSnooze(domain);
        if (action === "stop-active") await stopActiveBlock(domain);
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
        renderAll();
    });
    $("addForm")?.addEventListener("submit", addDomain);
    $("scheduledForm")?.addEventListener("submit", saveSchedule);
    $("cancelScheduledEditBtn")?.addEventListener("click", resetScheduleForm);
    $("settingsForm")?.addEventListener("submit", saveSettings);
    $("use24HourTime")?.addEventListener("change", persistSettings);
    $("limitNotificationsEnabled")?.addEventListener("change", persistSettings);
    $("personalInsightsEnabled")?.addEventListener("change", persistSettings);
    $("insightNotificationsEnabled")?.addEventListener("change", persistSettings);
    $("insightMaxNotificationsPerDay")?.addEventListener("change", persistSettings);
    $("insightSensitivity")?.addEventListener("change", persistSettings);
    $("immutableAdminOverrideBtn")?.addEventListener("click", useImmutableOverride);
    $("verifyWhopBtn")?.addEventListener("click", syncPremium);
    $("manageWhopBtn")?.addEventListener("click", () => chrome.tabs.create({ url: WHOP_MANAGE_URL }));
    $("upgradeBtnFromLimits")?.addEventListener("click", openWhopCheckout);
    $("upgradeBtnFromSchedule")?.addEventListener("click", openWhopCheckout);
    $("leaveReviewToastBtn")?.addEventListener("click", openChromeWebStoreReview);
    $("dismissReviewToastBtn")?.addEventListener("click", deferReviewPromptToast);
    $("notNowReviewToastBtn")?.addEventListener("click", deferReviewPromptToast);
    $("linkWhopTokenBtn")?.addEventListener("click", linkWhopToken);
    $("manualWhopToken")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") linkWhopToken();
    });

    $("onboardingNextBtn")?.addEventListener("click", () => showOnboardingStep(selectedOnboardingStep() + 1));
    $("onboardingPrevBtn")?.addEventListener("click", () => showOnboardingStep(selectedOnboardingStep() - 1));
    $("onboardingDoneBtn")?.addEventListener("click", () => completeOnboarding(false));
    $("onboardingSkipBtn")?.addEventListener("click", skipOnboarding);
    $("onboardingStepMarkers")?.addEventListener("click", (event) => {
        const marker = event.target.closest("[data-step]");
        if (marker) showOnboardingStep(Number(marker.dataset.step));
    });

    chrome.storage.onChanged?.addListener((changes, area) => {
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
            "activeBlocks",
            "scheduledBlocks",
            SETTINGS_KEY,
            PREMIUM_KEY,
            REVIEW_PROMPT_STATE_KEY
        ];
        const changedWatchedKeys = watched.filter((key) => Object.prototype.hasOwnProperty.call(changes, key));
        if (changedWatchedKeys.length) {
            const liveUsageKeys = ["statsToday", "allStatsToday", "hourlyUsageHistory"];
            const isLiveUsageOnly = changedWatchedKeys.every((key) => liveUsageKeys.includes(key));
            loadAll({
                flush: false,
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
    await loadAll({ flush: true, refreshInsights: true });
    await handleActivationNotice();
    if ($("limitInput")) $("limitInput").value = state.settings.defaultLimitMinutes;
    const onboardingShown = showOnboardingIfNeeded();
    if (!onboardingShown) await maybeShowReviewPromptToast();
    setInterval(refreshLive, LIVE_REFRESH_INTERVAL_MS);
});

window.addEventListener("unload", () => {
    send("flushActiveTimeNow", { source: "popup" });
});
