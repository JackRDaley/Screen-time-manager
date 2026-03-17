const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = "uiSettings";
const PREMIUM_KEY = "premiumState";
const WHOP_SETTINGS_KEY = "whopSettings";
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
const DEFAULT_WHOP_SETTINGS = Object.freeze({
    checkoutUrl: "",
    verifyUrl: "",
    accessToken: ""
});
const FREE_PLAN_LIMITS = Object.freeze({
    maxTrackedDomains: 3,
    schedulingEnabled: false
});

let currentSettings = { ...DEFAULT_SETTINGS };
let saveMessageTimer = null;
let latestActiveBlocks = [];
let latestBlockedDomains = {};
let latestStatsToday = {};
let activeCountdownTimer = null;
let popupRefreshTimer = null;
let popupRefreshInFlight = false;
let loadAllInFlight = false;
let loadAllPending = false;
let rankingInteractionDepth = 0;
let currentPremium = { ...DEFAULT_PREMIUM };
let currentWhopSettings = { ...DEFAULT_WHOP_SETTINGS };

function isRankingInteractionActive() {
    return rankingInteractionDepth > 0;
}

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
        renderActive(latestActiveBlocks, latestBlockedDomains, latestStatsToday);
    }, 1000);
}

function stopActiveCountdownTicker() {
    if (activeCountdownTimer == null) return;
    clearInterval(activeCountdownTimer);
    activeCountdownTimer = null;
}

function startPopupRefreshTicker() {
    if (popupRefreshTimer != null) return;
    popupRefreshTimer = setInterval(async () => {
        if (popupRefreshInFlight) return;
        popupRefreshInFlight = true;
        try {
            await chrome.runtime.sendMessage({ action: "flushActiveTimeNow" }).catch(() => null);
            await loadAll();
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

function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function getDayKey(d = new Date()) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
}

function getAggregatedStats(range, allStatsToday, statsHistory) {
    if (range === "Today") return allStatsToday;
    const today = new Date();
    const result = {};

    function mergeDayStats(dayStats) {
        for (const [domain, stats] of Object.entries(dayStats || {})) {
            if (!result[domain]) result[domain] = { timeMs: 0, visits: 0 };
            result[domain].timeMs += stats.timeMs || 0;
            result[domain].visits += stats.visits || 0;
        }
    }

    if (range === "Yesterday") {
        const d = new Date(today);
        d.setDate(d.getDate() - 1);
        mergeDayStats(statsHistory[getDayKey(d)]);
    } else {
        // "This week" = today + 6 prior days; "This month" = today + 29 prior days
        const days = range === "This week" ? 6 : 29;
        mergeDayStats(allStatsToday);
        for (let i = 1; i <= days; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            mergeDayStats(statsHistory[getDayKey(d)]);
        }
    }
    return result;
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

function normalizeWhopSettings(raw) {
    return {
        checkoutUrl: typeof raw?.checkoutUrl === "string" ? raw.checkoutUrl.trim() : "",
        verifyUrl: typeof raw?.verifyUrl === "string" ? raw.verifyUrl.trim() : "",
        accessToken: typeof raw?.accessToken === "string" ? raw.accessToken.trim() : ""
    };
}

function isPremiumActive() {
    return Boolean(currentPremium?.active);
}

function canUseScheduling() {
    return isPremiumActive() || FREE_PLAN_LIMITS.schedulingEnabled;
}

function canAddMoreDomains(blockedDomains) {
    if (isPremiumActive()) return true;
    return Object.keys(blockedDomains || {}).length < FREE_PLAN_LIMITS.maxTrackedDomains;
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
    const atDomainCap = !isPremiumActive() && domainCount >= FREE_PLAN_LIMITS.maxTrackedDomains;
    const scheduleLocked = !canUseScheduling();

    if (limitsPaywallCard) {
        limitsPaywallCard.style.display = atDomainCap ? "block" : "none";
    }
    if (limitsNotice) {
        limitsNotice.textContent = `Free plan allows up to ${FREE_PLAN_LIMITS.maxTrackedDomains} limited domains.`;
    }
    if (schedulePaywallCard) {
        schedulePaywallCard.style.display = scheduleLocked ? "block" : "none";
    }

    addForm?.classList.toggle("is-locked", atDomainCap);
    scheduledForm?.classList.toggle("is-locked", scheduleLocked);

    if (isPremiumActive()) {
        const label = currentPremium.planName || "Premium";
        setPremiumStatusMessage(`Premium active (${label})`, "success");
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
    const { [PREMIUM_KEY]: premiumStored, [WHOP_SETTINGS_KEY]: whopStored } =
        await chrome.storage.local.get([PREMIUM_KEY, WHOP_SETTINGS_KEY]);
    currentPremium = normalizePremium(premiumStored || DEFAULT_PREMIUM);
    currentWhopSettings = normalizeWhopSettings(whopStored || DEFAULT_WHOP_SETTINGS);
}

async function saveSettingsToStorage(partialSettings) {
    const merged = normalizeSettings({ ...currentSettings, ...partialSettings });
    currentSettings = merged;
    await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
    return merged;
}

async function saveWhopSettingsToStorage(partial) {
    const merged = normalizeWhopSettings({ ...currentWhopSettings, ...partial });
    currentWhopSettings = merged;
    await chrome.storage.local.set({ [WHOP_SETTINGS_KEY]: merged });
    return merged;
}

async function verifyWhopAccess() {
    const verifyUrl = currentWhopSettings.verifyUrl;
    const accessToken = currentWhopSettings.accessToken;

    if (!verifyUrl) {
        setPremiumStatusMessage("Set a Verify API URL first.", "error");
        return;
    }
    if (!accessToken) {
        setPremiumStatusMessage("Paste an access token/receipt first.", "error");
        return;
    }

    setPremiumStatusMessage("Verifying access...");

    try {
        const response = await fetch(verifyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: accessToken, extension: "screen-time-manager" })
        });

        if (!response.ok) {
            throw new Error(`Verification failed (${response.status})`);
        }

        const payload = await response.json();
        const nextPremium = normalizePremium({
            active: Boolean(payload?.active),
            planName: payload?.planName || (payload?.active ? "Premium" : "Free"),
            source: "whop",
            checkedAt: new Date().toISOString(),
            expiresAt: payload?.expiresAt || null
        });

        currentPremium = nextPremium;
        await chrome.storage.local.set({ [PREMIUM_KEY]: nextPremium });

        if (nextPremium.active) {
            setPremiumStatusMessage(`Premium active (${nextPremium.planName})`, "success");
        } else {
            setPremiumStatusMessage("No active Whop entitlement found.", "error");
        }

        await loadAll();
    } catch (error) {
        setPremiumStatusMessage(error?.message || "Verification failed.", "error");
    }
}

function openWhopCheckout() {
    const checkoutUrl = currentWhopSettings.checkoutUrl;
    if (!checkoutUrl) {
        setPremiumStatusMessage("Set a Checkout URL first.", "error");
        return;
    }
    chrome.tabs.create({ url: checkoutUrl });
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

function updateStatStrip(allStatsToday, blockedDomains) {
    const domains = Object.keys(allStatsToday || {});
    const totalMs = domains.reduce((s, d) => s + (allStatsToday[d]?.timeMs || 0), 0);
    const totalVisits = domains.reduce((s, d) => s + (allStatsToday[d]?.visits || 0), 0);
    const blockedCount = Object.keys(blockedDomains || {}).length;
    if ($("statScreenTime")) $("statScreenTime").textContent = formatTime(Math.round(totalMs / 1000));
    if ($("statVisits"))     $("statVisits").textContent     = String(totalVisits);
    if ($("statBlocked"))    $("statBlocked").textContent    = String(blockedCount);
}

async function enforceFreeTierDomainCap(blockedDomains = {}, statsToday = {}) {
    if (isPremiumActive()) {
        return { blockedDomains, statsToday, trimmedCount: 0 };
    }

    const entries = Object.entries(blockedDomains || {});
    const maxAllowed = FREE_PLAN_LIMITS.maxTrackedDomains;
    if (entries.length <= maxAllowed) {
        return { blockedDomains, statsToday, trimmedCount: 0 };
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

    const { alertsSent = {}, activeBlocks = [] } = await chrome.storage.local.get(["alertsSent", "activeBlocks"]);
    const nextAlerts = {};
    for (const [domain, sent] of Object.entries(alertsSent || {})) {
        if (keptDomains.has(domain)) {
            nextAlerts[domain] = sent;
        }
    }

    const nextActiveBlocks = (activeBlocks || []).filter((block) => keptDomains.has(block.domain));

    await chrome.storage.local.set({
        blockedDomains: nextBlockedDomains,
        statsToday: nextStatsToday,
        alertsSent: nextAlerts,
        activeBlocks: nextActiveBlocks
    });

    const trimmedCount = entries.length - keptDomains.size;
    setPremiumStatusMessage(`Premium inactive: removed ${trimmedCount} domain(s) to match free tier.`, "error");

    return {
        blockedDomains: nextBlockedDomains,
        statsToday: nextStatsToday,
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

            const {
                blockedDomains = {},
                statsToday = {},
                allStatsToday = {},
                statsHistory = {},
                activeBlocks = [],
                scheduledBlocks = [],
                [SETTINGS_KEY]: storedSettings = DEFAULT_SETTINGS,
                [PREMIUM_KEY]: premiumStored = DEFAULT_PREMIUM,
                [WHOP_SETTINGS_KEY]: whopStored = DEFAULT_WHOP_SETTINGS
            } = await chrome.storage.local.get(["blockedDomains", "statsToday", "allStatsToday", "statsHistory", "activeBlocks", "scheduledBlocks", SETTINGS_KEY, PREMIUM_KEY, WHOP_SETTINGS_KEY]);

            currentSettings = normalizeSettings(storedSettings);
            currentPremium = normalizePremium(premiumStored);
            currentWhopSettings = normalizeWhopSettings(whopStored);

            const enforced = await enforceFreeTierDomainCap(blockedDomains, statsToday);
            const effectiveBlockedDomains = enforced.blockedDomains;
            const effectiveStatsToday = enforced.statsToday;

            latestActiveBlocks = Array.isArray(activeBlocks) ? activeBlocks : [];
            latestBlockedDomains = effectiveBlockedDomains || {};
            latestStatsToday = effectiveStatsToday || {};

            const range = $("statRange")?.value || "Today";
            const rangeStats = getAggregatedStats(range, allStatsToday, statsHistory);

            updateStatStrip(rangeStats, effectiveBlockedDomains);
            renderActive(latestActiveBlocks, latestBlockedDomains, latestStatsToday);
            renderScheduled(scheduledBlocks, latestActiveBlocks);
            if (!isRankingInteractionActive()) {
                renderRanking(effectiveBlockedDomains, effectiveStatsToday, rangeStats, "ranking", "timeSec", "Top by Time", range);
                renderRanking(effectiveBlockedDomains, effectiveStatsToday, rangeStats, "rankingByVisits", "visits", "Top by Visits", range);
            }
            renderBlockList(effectiveBlockedDomains, effectiveStatsToday);
            applyPaywallUI(effectiveBlockedDomains, scheduledBlocks);
        } while (loadAllPending);
    } finally {
        loadAllInFlight = false;
    }
}

function renderActive(activeBlocks, blockedDomains = {}, statsToday = {}) {
    const list = $("activeList");
    const count = $("activeCount");
    const statusPill = document.querySelector(".status-pill");

    const active = Array.isArray(activeBlocks) ? activeBlocks : [];

    // Count time-limited domains that have no remaining time today
    const timeLimitedActive = Object.entries(blockedDomains).filter(([domain, cfg]) => {
        const limitSec = getLimitSecondsFromConfig(cfg);
        if (!Number.isFinite(limitSec) || limitSec <= 0) return false;
        const usedMs = statsToday?.[domain]?.timeMs || 0;
        return usedMs >= limitSec * 1000;
    }).length;

    const totalActive = active.length + timeLimitedActive;
    count.textContent = String(totalActive);
    statusPill?.classList.toggle("is-inactive", totalActive === 0);

    if (active.length === 0) {
        list.classList.add("muted");
        list.textContent = "No active sessions.";
        return;
    }

    list.classList.remove("muted");
    list.innerHTML = "";

    active.forEach((s) => {
        const now = Date.now();
        const endsAt = s.endTime ? new Date(s.endTime) : null;
        const endsText = endsAt ? endsAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";
        const remainingSec = Math.max(0, Math.floor((s.endTime - now) / 1000));

        const div = document.createElement("div");
        div.className = "row";
        div.innerHTML = `
        <div class="row-main">
            <div class="row-title">${s.domain}</div>
            <div class="row-meta">Ends: ${endsText}</div>
        </div>
        <div class="row-right">
            ${remainingSec > 0 ? `<span class="timer">${formatTime(remainingSec)} left</span>` : ""}
            <button class="btn-ghost" data-domain="${s.domain}">Stop</button>
        </div>
        `;
        div.querySelector("button").addEventListener("click", async (e) => {
            const domain = e.currentTarget.getAttribute("data-domain");
            await stopActiveBlock(domain);
            await loadAll();
        });
        list.appendChild(div);
    });
}

async function stopActiveBlock(domain) {
    const { activeBlocks = [] } = await chrome.storage.local.get(["activeBlocks"]);
    const next = (activeBlocks || []).filter((s) => s.domain !== domain);
    await chrome.storage.local.set({ activeBlocks: next });
}

async function removeScheduledBlock(id) {
    const { scheduledBlocks = [] } = await chrome.storage.local.get(["scheduledBlocks"]);
    const next = scheduledBlocks.filter((b) => b.id !== id);
    await chrome.storage.local.set({ scheduledBlocks: next });
    chrome.alarms.clear(`startBlock_${id}`);
    chrome.alarms.clear(`endBlock_${id}`);
}

function renderScheduled(scheduledBlocks, activeBlocks = []) {
    const list = $("scheduledList");
    const count = $("scheduledCount");

    const scheduled = Array.isArray(scheduledBlocks) ? scheduledBlocks : [];
    const active = Array.isArray(activeBlocks) ? activeBlocks : [];

    if (scheduled.length === 0) {
        list.classList.add("muted");
        list.textContent = "No scheduled sessions.";
        return;
    }

    list.classList.remove("muted");
    list.innerHTML = "";

    scheduled.forEach((s) => {
        const isActive = active.some((b) => b.domain === s.domain);
        const div = document.createElement("div");
        div.className = "row";
        div.innerHTML = `
        <div class="row-main">
            <div class="row-title">${s.domain}</div>
            <div class="row-meta">Daily: ${formatTimeForDisplay(s.startTime)} – ${formatTimeForDisplay(s.endTime)}</div>
        </div>
        <div class="row-right">
            ${isActive ? '<span class="tag tag-red">Live</span>' : ''}
            <button class="btn-danger" data-domain="${s.domain}" ${isActive ? "disabled title=\"Stop the active session before removing\"" : ""}>Cancel</button>
        </div>
        `;
        if (!isActive) {
            div.querySelector("button").addEventListener("click", async () => {
                await removeScheduledBlock(s.id);
                await loadAll();
            });
        }
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
        const metricValue = byVisits ? String(r.visits) : formatTime(r.timeSec);
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze';
        const isBlocked = !!blockedDomains[r.domain];
        const limitSec = getLimitSecondsFromConfig(blockedDomains[r.domain]);
        const hasProgressBar = isBlocked && Number.isFinite(limitSec) && limitSec > 0 && range === "Today";
        const blockedStats = statsToday?.[r.domain] || { timeMs: 0, visits: 0 };
        const usedLimitSec = Math.round((blockedStats.timeMs || 0) / 1000);
        const limitUsageText = `Limit used: ${formatTime(usedLimitSec)} / ${formatTime(limitSec || 0)}`;
        const pct = hasProgressBar ? Math.min(100, Math.round((usedLimitSec / limitSec) * 100)) : 0;
        const div = document.createElement("div");
        if (hasProgressBar) {
            div.className = "row row-ranking row-with-bar";
            div.innerHTML = `
            <div class="row-top">
                <div class="row-main-inline">
                    <span class="rank-num ${rankClass}">${i + 1}</span>
                    <div class="row-title">${r.domain}</div>
                </div>
                <div class="row-right">
                    <span class="tag tag-cyan">${metricValue}</span>
                </div>
            </div>
            <div class="row-meta">${limitUsageText}</div>
            <div class="prog-wrap row-progress"><div class="prog-fill" style="width:${pct}%"></div></div>
            `;
        } else {
            div.className = "row row-ranking";
            div.innerHTML = `
            <span class="rank-num ${rankClass}">${i + 1}</span>
            <div class="row-main">
                <div class="row-title">${r.domain}</div>
            </div>
            <div class="row-right">
                <span class="tag tag-cyan">${metricValue}</span>
            </div>
            `;
        }
        if (!isBlocked) {
            const addBtn = document.createElement("button");
            addBtn.className = "btn-ghost";
            addBtn.textContent = "+ Limit";
            addBtn.addEventListener("click", async () => {
                if (!canAddMoreDomains(latestBlockedDomains)) {
                    setPremiumStatusMessage(`Free plan allows up to ${FREE_PLAN_LIMITS.maxTrackedDomains} limited domains.`, "error");
                    return;
                }
                rankingInteractionDepth = 0;
                await addDomain(r.domain, currentSettings.defaultLimitMinutes * 60);
                await loadAll();
            });
            div.querySelector(".row-right").appendChild(addBtn);
        } else {
            const blockedSpan = document.createElement("span");
            blockedSpan.className = "tag tag-muted";
            blockedSpan.textContent = "Limited";
            div.querySelector(".row-right").appendChild(blockedSpan);
        }
        rank.appendChild(div);
    });
}

function renderBlockList(blockedDomains, statsToday) {
    const list = $("blockList");
    const entries = Object.entries(blockedDomains || {});

    if (entries.length === 0) {
        list.classList.add("muted");
        list.textContent = "No blocked sites yet.";
        return;
    }

    list.classList.remove("muted");
    list.innerHTML = "";

    entries
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([domain, cfg]) => {
        const st = statsToday?.[domain] || { timeMs: 0, visits: 0 };
        const timeSec = Math.round((st.timeMs || 0) / 1000);

        const limitSec = getLimitSecondsFromConfig(cfg);
        const limitMin = limitSec ? Math.round(limitSec / 60) : null;
        const limitText = limitMin == null ? "—" : `${limitMin} min`;

        const displayTimeSec = (limitSec != null && timeSec >= limitSec) ? limitSec : timeSec;
        const pct = limitSec ? Math.min(100, Math.round((displayTimeSec / limitSec) * 100)) : 0;

        const div = document.createElement("div");
        div.className = "row row-limit row-with-bar";
        div.innerHTML = `
            <div class="row-top">
                <div class="row-main">
                    <div class="row-title">${domain}</div>
                    <div class="row-meta">Limit: ${limitText} · Today: ${formatTime(displayTimeSec)} · ${st.visits || 0} visits</div>
                </div>
                <div class="row-right">
                    <button class="btn-ghost" data-domain="${domain}" data-action="reset">Reset</button>
                    <button class="btn-danger" data-domain="${domain}" data-action="remove">Remove</button>
                </div>
            </div>
            ${limitSec ? `<div class="prog-wrap row-progress"><div class="prog-fill" style="width:${pct}%"></div></div>` : ""}
        `;
        div.querySelectorAll("button").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                const d = e.currentTarget.getAttribute("data-domain");
                const action = e.currentTarget.getAttribute("data-action");
                if (action === "reset") {
                    await resetDomainStats(d);
                } else if (action === "remove") {
                    await removeDomain(d);
                }
                await loadAll();
            });
        });
        list.appendChild(div);
    });
}

async function removeDomain(domain) {
    const { blockedDomains = {}, statsToday = {}, activeBlocks = [], alertsSent = {} }
        = await chrome.storage.local.get(["blockedDomains", "statsToday", "activeBlocks", "alertsSent"]);
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
}

async function resetDomainStats(domain) {
    const { statsToday = {}, alertsSent = {} } = await chrome.storage.local.get(["statsToday", "alertsSent"]);
    const nextStats = { ...statsToday };
    delete nextStats[domain];
    
    const nextAlerts = { ...alertsSent };
    delete nextAlerts[domain];
    
    await chrome.storage.local.set({ statsToday: nextStats, alertsSent: nextAlerts });
    
    // redirect the active tab to the domain if it's currently blocked on it
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab?.id != null) {
        const isBlockedPage = activeTab.url?.includes("blocked.html") && activeTab.url?.includes(encodeURIComponent(domain));
        if (isBlockedPage) {
            await chrome.tabs.update(activeTab.id, { url: `https://${domain}` });
        }
    }
}

async function addDomain(domain, limitSeconds) {
    const { blockedDomains = {}, alertsSent = {}, statsToday = {}, allStatsToday = {} }
        = await chrome.storage.local.get(["blockedDomains", "alertsSent", "statsToday", "allStatsToday"]);
    const next = { ...blockedDomains };
    next[domain] = { limitSeconds };

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
}

document.addEventListener("DOMContentLoaded", async () => {
    startActiveCountdownTicker();
    startPopupRefreshTicker();
    wireRankingInteractionGuards();

    await loadSettingsFromStorage();
    await loadMonetizationFromStorage();

    const defaultLimitEl = $("defaultLimitMinutes");
    const use24HourEl = $("use24HourTime");
    const whopCheckoutUrlEl = $("whopCheckoutUrl");
    const whopVerifyUrlEl = $("whopVerifyUrl");
    const whopAccessTokenEl = $("whopAccessToken");
    if (defaultLimitEl) defaultLimitEl.value = String(currentSettings.defaultLimitMinutes);
    if (use24HourEl) use24HourEl.checked = currentSettings.use24HourTime;
    if (whopCheckoutUrlEl) whopCheckoutUrlEl.value = currentWhopSettings.checkoutUrl;
    if (whopVerifyUrlEl) whopVerifyUrlEl.value = currentWhopSettings.verifyUrl;
    if (whopAccessTokenEl) whopAccessTokenEl.value = currentWhopSettings.accessToken;
    applyScheduleInputMode();

    $("verifyWhopBtn")?.addEventListener("click", async () => {
        await saveWhopSettingsToStorage({
            checkoutUrl: whopCheckoutUrlEl?.value,
            verifyUrl: whopVerifyUrlEl?.value,
            accessToken: whopAccessTokenEl?.value
        });
        await verifyWhopAccess();
    });

    $("openWhopCheckoutBtn")?.addEventListener("click", async () => {
        await saveWhopSettingsToStorage({
            checkoutUrl: whopCheckoutUrlEl?.value,
            verifyUrl: whopVerifyUrlEl?.value,
            accessToken: whopAccessTokenEl?.value
        });
        openWhopCheckout();
    });

    $("upgradeBtnFromLimits")?.addEventListener("click", openWhopCheckout);
    $("upgradeBtnFromSchedule")?.addEventListener("click", openWhopCheckout);

    const statRangeSelect = document.getElementById("statRange");
    if (statRangeSelect) {
        statRangeSelect.addEventListener("change", async () => {
            requestAnimationFrame(() => statRangeSelect.blur());
            await loadAll();
        });
    }

    $("settingsForm")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await saveSettingsToStorage({
            defaultLimitMinutes: Number(defaultLimitEl?.value),
            use24HourTime: Boolean(use24HourEl?.checked)
        });

        if (defaultLimitEl) defaultLimitEl.value = String(currentSettings.defaultLimitMinutes);
        if (use24HourEl) use24HourEl.checked = currentSettings.use24HourTime;
        applyScheduleInputMode();
        showSettingsSavedMessage();
        await loadAll();
    });

    $("addForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!canAddMoreDomains(latestBlockedDomains)) {
            setPremiumStatusMessage(`Free plan allows up to ${FREE_PLAN_LIMITS.maxTrackedDomains} limited domains.`, "error");
            return;
        }

        const domain = normalizeDomain($("domainInput").value);
        const rawLimitValue = $("limitInput").value.trim();
        const parsedMinutes = Number(rawLimitValue);
        const limitMinutes = rawLimitValue === "" ? currentSettings.defaultLimitMinutes : parsedMinutes;
        const limitSeconds = Math.floor(limitMinutes * 60);

        if (!isValidDomain(domain)) {
            alert("Please enter a valid domain (e.g., google.com).");
            return;
        }
        if (!Number.isFinite(limitSeconds) || limitSeconds <= 0) return;

        $("domainInput").value = "";
        $("limitInput").value = "";

        await addDomain(domain, limitSeconds);
        await loadAll();
    });

    // Scheduled form event listener
    $("scheduledForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!canUseScheduling()) {
            setPremiumStatusMessage("Scheduling is a premium feature.", "error");
            return;
        }

        const domain = normalizeDomain($("scheduledDomain").value);
        const startTimeInput = $("startTime").value.trim();
        const endTimeInput = $("endTime").value.trim();

        const startTime = parseTimeInput(startTimeInput, currentSettings.use24HourTime);
        const endTime = parseTimeInput(endTimeInput, currentSettings.use24HourTime);

        if (!isValidDomain(domain)) {
            alert("Please enter a valid domain (e.g., google.com).");
            return;
        }

        if (!startTime || !endTime) {
            if (currentSettings.use24HourTime) {
                alert("Please enter valid times in 24-hour format (e.g., 9:00, 09:00, 17:30)");
            } else {
                alert("Please enter valid times in H:MM AM/PM format (e.g., 9:00 AM, 2:30 PM)");
            }
            return;
        }

        await chrome.runtime.sendMessage({ action: 'addScheduledBlock', domain, startTime, endTime });
        $("scheduledDomain").value = "";
        $("startTime").value = "";
        $("endTime").value = "";
        await loadAll();
    });

    await loadAll();
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

    if (changes[WHOP_SETTINGS_KEY]) {
        currentWhopSettings = normalizeWhopSettings(changes[WHOP_SETTINGS_KEY].newValue || DEFAULT_WHOP_SETTINGS);
        const whopCheckoutUrlEl = $("whopCheckoutUrl");
        const whopVerifyUrlEl = $("whopVerifyUrl");
        const whopAccessTokenEl = $("whopAccessToken");
        if (whopCheckoutUrlEl) whopCheckoutUrlEl.value = currentWhopSettings.checkoutUrl;
        if (whopVerifyUrlEl) whopVerifyUrlEl.value = currentWhopSettings.verifyUrl;
        if (whopAccessTokenEl) whopAccessTokenEl.value = currentWhopSettings.accessToken;
    }

    if (changes[SETTINGS_KEY] || changes[PREMIUM_KEY] || changes[WHOP_SETTINGS_KEY] || changes.statsToday || changes.allStatsToday || changes.blockedDomains || changes.activeBlocks || changes.scheduledBlocks) {
        loadAll();
    }
});
