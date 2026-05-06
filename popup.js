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
const PREMIUM_KEY = "premiumState";
const ONBOARDING_KEY = "onboardingState";
const ONBOARDING_VERSION = 2;
const WHOP_CHECKOUT_URL = "https://whop.com/screen-time-manager/screen-time-manager-pro/";
const WHOP_MANAGE_URL = "https://whop.com/hub/memberships/";

const DEFAULT_SETTINGS = Object.freeze({
    defaultLimitMinutes: 30,
    use24HourTime: false
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
    selectedDays: [0, 1, 2, 3, 4, 5, 6],
    editingScheduleId: null
};

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

function storageGet(keys) {
    return chrome.storage.local.get(keys);
}

function storageSet(items) {
    return chrome.storage.local.set(items);
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

function formatLimit(seconds) {
    return seconds ? formatTimeSec(seconds) : "No daily limit";
}

function formatShortTime(ms) {
    return formatTimeSec(Math.round(timeMs({ timeMs: ms }) / 1000));
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
    if (hour === 0) return "12a";
    if (hour === 12) return "12p";
    return hour < 12 ? `${hour}a` : `${hour - 12}p`;
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

function getTopDomainsForHour(bucket = {}, limit = 3) {
    const domains = bucket.domains || {};
    return Object.entries(domains)
        .map(([domain, ms]) => ({ domain, timeMs: Number(ms || 0) }))
        .filter((entry) => entry.timeMs > 0)
        .sort((a, b) => b.timeMs - a.timeMs)
        .slice(0, limit);
}

function isLimitCurrentlyBlocking(domain, cfg, statsToday = {}, snoozedDomains = {}) {
    const limit = limitConfig(cfg);
    if (!limit.enabled || !limit.limitSeconds) return false;
    const snooze = snoozedDomains?.[domain];
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

function rowTemplate({ title, meta = "", metrics = [], actions = "", accent = "cyan", rank = "" }) {
    const rankHtml = rank ? `<div class="rank-num ${rank.className || ""}">${rank.label}</div>` : "";
    const metricHtml = metrics.map((metric) => `<span class="tag ${metric.className || "tag-muted"}">${escapeHtml(metric.label)}</span>`).join("");

    return `
        <div class="row row-accent-${accent}">
            ${rankHtml}
            <div class="row-main">
                <div class="row-title">${escapeHtml(title)}</div>
                ${meta ? `<div class="row-meta">${escapeHtml(meta)}</div>` : ""}
                ${metricHtml ? `<div class="row-metrics">${metricHtml}</div>` : ""}
            </div>
            ${actions ? `<div class="row-right">${actions}</div>` : ""}
        </div>
    `;
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
    const current = statsForRange(range);
    const total = totals(current);
    const todaySnoozes = Number((state.data.snoozeHistory || {})[getDayKey()] || 0);

    setText("statScreenTime", formatShortTime(total.timeMs));
    setText("statVisits", String(total.visits));
    setText("statSnoozes", String(todaySnoozes));
    setText("statScreenTimeDelta", range);
    setText("statVisitsDelta", "");
    setText("statSnoozesDelta", "");
}

function renderActive() {
    const activeBlocks = state.data.activeBlocks || [];
    const blockedDomains = state.data.blockedDomains || {};
    const statsToday = state.data.statsToday || {};
    const snoozed = Object.entries(state.data.snoozedDomains || {})
        .filter(([, entry]) => Number(entry?.expiresAt || entry || 0) > Date.now())
        .map(([domain, entry]) => ({
            domain,
            until: Number(entry?.expiresAt || entry)
        }));

    const activeDomains = new Set(activeBlocks.map((block) => block.domain));
    const limitRows = Object.entries(blockedDomains)
        .filter(([domain, cfg]) => !activeDomains.has(domain) && isLimitCurrentlyBlocking(domain, cfg, statsToday, state.data.snoozedDomains))
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
        const tierLabel = formatTierLabel(blockedDomains?.[domain]?.tier);
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

function renderRanking() {
    return renderRankingStyled();
    const stats = Object.entries(statsForRange($("statRange")?.value || "Today"));
    const byTime = [...stats]
        .filter(([, entry]) => timeMs(entry) > 0)
        .sort((a, b) => timeMs(b[1]) - timeMs(a[1]))
        .slice(0, 5)
        .map(([domain, entry], index) => rowTemplate({
            title: domain,
            meta: `${formatShortTime(timeMs(entry))} tracked`,
            accent: "cyan",
            rank: { label: index + 1, className: rankClass(index) },
            metrics: [{ label: `${visits(entry)} visits`, className: "tag-muted" }]
        }))
        .join("");

    const byVisits = [...stats]
        .filter(([, entry]) => visits(entry) > 0)
        .sort((a, b) => visits(b[1]) - visits(a[1]))
        .slice(0, 5)
        .map(([domain, entry], index) => rowTemplate({
            title: domain,
            meta: `${visits(entry)} visits`,
            accent: "purple",
            rank: { label: index + 1, className: rankClass(index) },
            metrics: [{ label: formatShortTime(timeMs(entry)), className: "tag-cyan" }]
        }))
        .join("");

    renderList("ranking", byTime, "No data yet.");
    renderList("rankingByVisits", byVisits, "No data yet.");
}

function renderRankingStyled() {
    const range = $("statRange")?.value || "Today";
    const stats = Object.entries(statsForRange(range));
    const blockedDomains = state.data.blockedDomains || {};
    const todayStats = state.data.statsToday || {};

    const makeRows = (sortByVisits) => [...stats]
        .filter(([, entry]) => sortByVisits ? visits(entry) > 0 : timeMs(entry) > 0)
        .sort((a, b) => sortByVisits ? visits(b[1]) - visits(a[1]) : timeMs(b[1]) - timeMs(a[1]))
        .slice(0, 3)
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
                <div class="row-right">
                    <span class="tag metric-chip metric-chip-glass">${escapeHtml(metricValue)}</span>
                    ${cfg
                        ? `<span class="tag metric-chip metric-chip-glass metric-chip-muted">Limited</span>`
                        : actionChip("+ Limit", "quick-limit", "action-chip-primary", `data-domain="${escapeHtml(domain)}"`)}
                </div>
            `;

            if (hasProgress) {
                return `
                    <div class="row row-ranking row-with-bar ${accentClass}">
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
                <div class="row row-ranking ${accentClass}">
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
    renderList("ranking", makeRows(false), "No data yet.");
    renderList("rankingByVisits", makeRows(true), "No data yet.");
}

function renderHourly() {
    return renderHourlyStyled();
    const container = $("hourlyDistribution");
    if (!container) return;

    const buckets = state.data.hourlyUsageHistory?.[getDayKey()] || {};
    const hours = Array.from({ length: 24 }, (_, hour) => {
        const key = String(hour).padStart(2, "0");
        return { hour, timeMs: Number(buckets[key]?.timeMs || 0), domains: buckets[key]?.domains || {} };
    });
    const max = Math.max(1, ...hours.map((hour) => hour.timeMs));
    const peak = hours.reduce((best, hour) => hour.timeMs > best.timeMs ? hour : best, hours[0]);

    if (!hours.some((hour) => hour.timeMs > 0)) {
        container.className = "hourly-distribution muted";
        container.textContent = "No data yet.";
        setText("usageInsight", "Click a bar to view details.");
        $("usageInsight")?.classList.add("muted");
        return;
    }

    container.className = "hourly-distribution";
    container.innerHTML = `
        <div class="hourly-chart-wrap">
            <div class="hourly-chart">
                ${hours.map((hour) => `
                    <button type="button"
                        class="hourly-slot ${hour.hour === peak.hour ? "is-peak" : ""}"
                        data-hour="${hour.hour}"
                        title="${hour.hour}:00 - ${formatShortTime(hour.timeMs)}">
                        <span class="hourly-peak-badge">Peak</span>
                        <span class="hourly-slot-bar">
                            <span class="hourly-slot-fill" style="height:${Math.max(4, Math.round((hour.timeMs / max) * 100))}%"></span>
                        </span>
                        <span class="hourly-slot-label">${hour.hour % 6 === 0 ? hour.hour : ""}</span>
                    </button>
                `).join("")}
            </div>
        </div>
    `;

    container.querySelectorAll(".hourly-slot").forEach((slot) => {
        slot.addEventListener("click", () => renderHourInsight(hours[Number(slot.dataset.hour)]));
    });

    renderHourInsight(peak);
}

function renderHourInsight(hour) {
    const insight = $("usageInsight");
    if (!insight || !hour) return;

    const topDomains = Object.entries(hour.domains || {})
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 3);

    insight.classList.remove("muted");
    insight.innerHTML = `
        <div class="hourly-tip-header">
            <div class="hourly-tip-time">${hour.hour}:00</div>
            <div class="hourly-tip-time-spent">${formatShortTime(hour.timeMs)}</div>
        </div>
        <div class="hourly-tip-sites">
            ${topDomains.length ? topDomains.map(([domain, ms]) => `
                <div class="hourly-tip-site-row">
                    <div class="hourly-tip-site-domain">${escapeHtml(domain)}</div>
                    <div class="hourly-tip-site-time">${formatShortTime(ms)}</div>
                </div>
            `).join("") : `<div class="hourly-tip-empty">No domains recorded for this hour.</div>`}
        </div>
    `;
}

function renderHourlyStyled() {
    const list = $("hourlyDistribution");
    const insight = $("usageInsight");
    const title = $("usageCardTitle");
    if (!list) return;
    if (title) title.textContent = `Daily Usage Distribution · ${$("statRange")?.value || "Today"}`;

    const bucketsByHour = state.data.hourlyUsageHistory?.[getDayKey()] || {};
    const buckets = Array.from({ length: 24 }, (_, hour) => {
        const key = String(hour).padStart(2, "0");
        const bucket = bucketsByHour[key] || {};
        return {
            hour,
            timeMs: Number(bucket.timeMs || 0),
            domains: bucket.domains || {},
            hasDomainBreakdown: Boolean(bucket.domains)
        };
    });
    const maxMs = buckets.reduce((max, bucket) => Math.max(max, bucket.timeMs), 0);
    const peakHour = buckets.reduce((peak, bucket) => bucket.timeMs > peak.timeMs ? bucket : peak, buckets[0]);

    if (maxMs <= 0) {
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
                    const heightPct = Math.max(6, Math.round((bucket.timeMs / maxMs) * 100));
                    const normalized = bucket.timeMs / maxMs;
                    const isPeak = bucket.hour === peakHour.hour && peakHour.timeMs > 0;
                    return `
                        <div class="hourly-slot${isPeak ? " is-peak" : ""}"
                             data-hour="${bucket.hour}"
                             data-time-ms="${bucket.timeMs}"
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
    const showSlot = (slot) => {
        slots.forEach((item) => {
            item.classList.remove("is-selected");
            item.setAttribute("aria-pressed", "false");
        });
        slot.classList.add("is-selected");
        slot.setAttribute("aria-pressed", "true");
        renderHourInsightStyled(slot);
    };

    slots.forEach((slot) => {
        slot.addEventListener("click", () => showSlot(slot));
        slot.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                showSlot(slot);
            }
        });
    });

    const defaultSlot = Array.from(slots).find((slot) => Number(slot.dataset.hour) === peakHour.hour) || slots[0];
    if (defaultSlot) showSlot(defaultSlot);
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

function renderLimits() {
    return renderLimitsStyled();
    const blockedDomains = state.data.blockedDomains || {};
    const stats = state.data.statsToday || {};
    const rows = Object.entries(blockedDomains)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([domain, raw]) => {
            const config = limitConfig(raw);
            const usedMs = timeMs(stats[domain]);
            const pct = config.limitSeconds ? Math.min(100, Math.round((usedMs / (config.limitSeconds * 1000)) * 100)) : 0;
            const status = config.enabled ? `${pct}% used` : "disabled";
            return `
                <div class="row row-with-bar row-accent-${config.enabled ? "cyan" : "muted"} ${config.enabled ? "" : "is-disabled"}">
                    <div class="row-top">
                        <div class="row-main-inline">
                            <div class="row-title">${escapeHtml(domain)}</div>
                            <span class="tag limit-chip">${formatLimit(config.limitSeconds)}</span>
                        </div>
                        <div class="row-right">
                            ${actionChip(config.enabled ? "Off" : "On", "toggle-domain", "action-chip-primary", `data-domain="${escapeHtml(domain)}" data-enabled="${config.enabled ? "false" : "true"}"`)}
                            ${actionChip("Remove", "remove-domain", "action-chip-danger", `data-domain="${escapeHtml(domain)}"`)}
                        </div>
                    </div>
                    <div class="row-meta">${escapeHtml(config.tier)} - ${status}</div>
                    <div class="prog-wrap row-progress"><div class="prog-fill" style="width:${pct}%"></div></div>
                </div>
            `;
        })
        .join("");

    renderList("limitList", rows, "No limits set yet.");
    renderPaywalls();
}

function renderLimitsStyled() {
    const blockedDomains = state.data.blockedDomains || {};
    const stats = state.data.statsToday || {};
    const activeBlocks = state.data.activeBlocks || [];
    const snoozedDomains = state.data.snoozedDomains || {};
    const rows = Object.entries(blockedDomains)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([domain, raw]) => {
            const config = limitConfig(raw);
            const usedSec = Math.round(timeMs(stats[domain]) / 1000);
            const displaySec = config.limitSeconds ? Math.min(usedSec, config.limitSeconds) : usedSec;
            const pct = config.limitSeconds ? Math.min(100, Math.round((displaySec / config.limitSeconds) * 100)) : 0;
            const isBlocking = activeBlocks.some((block) => block.domain === domain)
                || isLimitCurrentlyBlocking(domain, raw, stats, snoozedDomains);
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
                            <label class="switch" title="${isBlocking ? "Stop the active session before changing this limit" : "Enable or pause this limit"}">
                                <input class="switch-input" type="checkbox" data-action="toggle-domain" data-domain="${escapeHtml(domain)}" data-enabled="${config.enabled ? "false" : "true"}" ${config.enabled ? "checked" : ""} ${isBlocking ? "disabled" : ""} aria-label="Toggle ${escapeHtml(domain)} limit" />
                                <span class="switch-slider" aria-hidden="true"></span>
                            </label>
                            <div class="row-action-menu-wrap">
                                ${actionChip("Remove", "remove-domain", "action-chip-danger", `data-domain="${escapeHtml(domain)}" ${isBlocking ? "disabled" : ""}`)}
                            </div>
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

function renderSchedules() {
    return renderSchedulesStyled();
    const activeIds = new Set((state.data.activeBlocks || []).map((block) => block.id));
    const rows = (state.data.scheduledBlocks || [])
        .map((block) => {
            const days = (block.days || []).map((day) => DAY_OPTIONS.find(([, value]) => value === day)?.[0]).join("");
            const active = activeIds.has(block.id);
            return rowTemplate({
                title: block.domain,
                meta: `${block.startTime} to ${block.endTime} - ${days || "daily"}`,
                accent: active ? "red" : "purple",
                metrics: [
                    { label: block.tier || "standard", className: "tag-cyan" },
                    { label: block.enabled === false ? "off" : active ? "active" : "ready", className: active ? "tag-red" : "tag-muted" }
                ],
                actions: [
                    actionChip("Edit", "edit-schedule", "action-chip-primary", `data-id="${escapeHtml(block.id)}"`),
                    actionChip(block.enabled === false ? "On" : "Off", "toggle-schedule", "action-chip-primary", `data-id="${escapeHtml(block.id)}" data-enabled="${block.enabled === false ? "true" : "false"}"`),
                    actionChip("Remove", "remove-schedule", "action-chip-danger", `data-id="${escapeHtml(block.id)}" ${active ? "disabled" : ""}`)
                ].join("")
            });
        })
        .join("");

    renderList("scheduledList", rows, "No scheduled sessions.");
    renderPaywalls();
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

function renderSettings() {
    const defaultLimit = $("defaultLimitMinutes");
    const use24Hour = $("use24HourTime");
    if (defaultLimit) defaultLimit.value = state.settings.defaultLimitMinutes;
    if (use24Hour) use24Hour.checked = Boolean(state.settings.use24HourTime);

    setText("premiumStatusMsg", state.premium.active
        ? `${state.premium.planName || "Premium"} active`
        : "Premium inactive");
}

function renderAll() {
    renderStats();
    renderActive();
    renderRankingStyled();
    renderHourlyStyled();
    renderLimitsStyled();
    renderScheduleDays();
    renderSchedulesStyled();
    renderStreak();
    renderSettings();
}

async function loadAll() {
    await send("flushActiveTimeNow");
    state.data = await storageGet([
        "blockedDomains",
        "statsToday",
        "allStatsToday",
        "statsHistory",
        "hourlyUsageHistory",
        "snoozeHistory",
        "snoozedDomains",
        "activeBlocks",
        "scheduledBlocks",
        SETTINGS_KEY,
        PREMIUM_KEY,
        ONBOARDING_KEY,
        "immutableAdminOverrideEnabled"
    ]);

    state.settings = { ...DEFAULT_SETTINGS, ...(state.data[SETTINGS_KEY] || {}) };
    state.premium = { ...DEFAULT_PREMIUM, ...(state.data[PREMIUM_KEY] || {}) };
    state.onboarding = { ...state.onboarding, ...(state.data[ONBOARDING_KEY] || {}) };
    renderAll();
}

async function addDomain(event) {
    event.preventDefault();
    const domain = normalizeDomain($("domainInput")?.value);
    const minutes = Number($("limitInput")?.value || state.settings.defaultLimitMinutes);
    const tier = $("limitTier")?.value || "standard";

    if (!isValidDomain(domain) || !Number.isFinite(minutes) || minutes <= 0) {
        setFeedback("addFormMsg", "Enter a valid domain and limit.", false);
        return;
    }

    const data = await storageGet(["blockedDomains", "alertsSent"]);
    const blockedDomains = data.blockedDomains || {};
    blockedDomains[domain] = {
        enabled: true,
        limitSeconds: Math.round(minutes * 60),
        tier
    };

    const alertsSent = data.alertsSent || {};
    delete alertsSent[domain];
    await storageSet({ blockedDomains, alertsSent });
    $("addForm")?.reset();
    if ($("limitInput")) $("limitInput").value = state.settings.defaultLimitMinutes;
    setFeedback("addFormMsg", "Limit saved.");
    await send("refreshActionBadge");
    await loadAll();
}

async function removeDomain(domain) {
    const data = await storageGet(["blockedDomains", "alertsSent", "snoozedDomains"]);
    const blockedDomains = data.blockedDomains || {};
    const alertsSent = data.alertsSent || {};
    const snoozedDomains = data.snoozedDomains || {};
    delete blockedDomains[domain];
    delete alertsSent[domain];
    delete snoozedDomains[domain];
    await storageSet({ blockedDomains, alertsSent, snoozedDomains });
    await loadAll();
}

async function toggleDomain(domain, enabled) {
    await send("toggleDomainLimitEnabled", { domain, enabled });
    await loadAll();
}

async function clearSnooze(domain) {
    await send("clearDomainSnooze", { domain });
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
    const data = await storageGet(["scheduledBlocks", "activeBlocks"]);
    await storageSet({
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

async function saveSettings(event) {
    event.preventDefault();
    state.settings = {
        defaultLimitMinutes: Math.max(1, Number($("defaultLimitMinutes")?.value || DEFAULT_SETTINGS.defaultLimitMinutes)),
        use24HourTime: Boolean($("use24HourTime")?.checked)
    };
    await storageSet({ [SETTINGS_KEY]: state.settings });
    setFeedback("settingsSavedMsg", "Settings saved");
}

async function toggleImmutableOverride() {
    const enabled = !Boolean(state.data.immutableAdminOverrideEnabled);
    const response = await send("setImmutableAdminOverride", { enabled });
    setFeedback("immutableOverrideMsg", response.success ? `Override ${enabled ? "enabled" : "disabled"}.` : response.error, response.success);
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
    storageSet({ [ONBOARDING_KEY]: state.onboarding });

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
    if (!overlay || !onboardingShouldShow()) return;
    overlay.style.display = "block";
    showOnboardingStep(selectedOnboardingStep());
}

async function completeOnboarding(skipped = false) {
    state.onboarding = {
        step: skipped ? selectedOnboardingStep() : ONBOARDING_STEPS.length - 1,
        completed: true,
        completedAt: Date.now(),
        skipped,
        version: ONBOARDING_VERSION
    };
    await storageSet({ [ONBOARDING_KEY]: state.onboarding });
    const overlay = $("onboardingOverlay");
    if (overlay) overlay.style.display = "none";
}

async function skipOnboarding() {
    await completeOnboarding(true);
}

function bindDelegatedActions() {
    document.addEventListener("click", async (event) => {
        const target = event.target.closest("[data-action]");
        if (!target) return;

        const action = target.dataset.action;
        const domain = target.dataset.domain;
        const id = target.dataset.id;

        if (action === "remove-domain") await removeDomain(domain);
        if (action === "toggle-domain") await toggleDomain(domain, target.dataset.enabled === "true");
        if (action === "clear-snooze") await clearSnooze(domain);
        if (action === "stop-active") await stopActiveBlock(domain);
        if (action === "edit-schedule") editSchedule(id);
        if (action === "remove-schedule") await removeSchedule(id);
        if (action === "toggle-schedule") await toggleSchedule(id, target.dataset.enabled === "true");
        if (action === "quick-limit" || action === "hour-limit") {
            if (domain) {
                $("domainInput").value = domain;
                $("limitInput").value = state.settings.defaultLimitMinutes;
                document.getElementById("tab2").checked = true;
                $("domainInput").focus();
            }
        }
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
    $("statRange")?.addEventListener("change", renderAll);
    $("addForm")?.addEventListener("submit", addDomain);
    $("scheduledForm")?.addEventListener("submit", saveSchedule);
    $("cancelScheduledEditBtn")?.addEventListener("click", resetScheduleForm);
    $("settingsForm")?.addEventListener("submit", saveSettings);
    $("immutableAdminOverrideBtn")?.addEventListener("click", toggleImmutableOverride);
    $("verifyWhopBtn")?.addEventListener("click", syncPremium);
    $("manageWhopBtn")?.addEventListener("click", () => chrome.tabs.create({ url: WHOP_MANAGE_URL }));
    $("upgradeBtnFromLimits")?.addEventListener("click", () => chrome.tabs.create({ url: WHOP_CHECKOUT_URL }));
    $("upgradeBtnFromSchedule")?.addEventListener("click", () => chrome.tabs.create({ url: WHOP_CHECKOUT_URL }));
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
            "snoozedDomains",
            "activeBlocks",
            "scheduledBlocks",
            SETTINGS_KEY,
            PREMIUM_KEY
        ];
        if (watched.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) loadAll();
    });

    bindDelegatedActions();
}

document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    renderScheduleDays();
    await loadAll();
    if ($("limitInput")) $("limitInput").value = state.settings.defaultLimitMinutes;
    showOnboardingIfNeeded();
    setInterval(loadAll, 30000);
});

window.addEventListener("unload", () => {
    send("flushActiveTimeNow");
});
