const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = "uiSettings";
const PREMIUM_KEY = "premiumState";
const WHOP_TOKEN_KEY = "whopAccessToken";
const WHOP_VERIFY_URL = "https://screen-time-manager.jackster0627.workers.dev/whop/verify";
const WHOP_CHECKOUT_URL = "https://whop.com/screen-time-manager/screen-time-manager-pro/";
const WHOP_MANAGE_URL = "https://whop.com/hub/memberships/";
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
const SCHEDULE_DAY_OPTIONS = Object.freeze([
    { value: 0, label: "Sun" },
    { value: 1, label: "Mon" },
    { value: 2, label: "Tue" },
    { value: 3, label: "Wed" },
    { value: 4, label: "Thu" },
    { value: 5, label: "Fri" },
    { value: 6, label: "Sat" }
]);
const ALL_SCHEDULE_DAYS = Object.freeze(SCHEDULE_DAY_OPTIONS.map((day) => day.value));

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
let selectedScheduleDays = [];
let editingScheduledBlockId = null;

const EMPTY_STATE_MESSAGES = Object.freeze({
    active: "No active sessions. Scheduled blocks and time-limited sites will appear here when they start.",
    scheduled: "No scheduled sessions yet. Add a block above and choose the days it should run.",
    blocked: "No blocked sites yet. Add a site above to start tracking and enforcing a daily limit."
});

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

function formatTimeSec(sec) {
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

    try {
        const response = await chrome.runtime.sendMessage({ action: "refreshPremiumStatus" });
        if (!response?.success) {
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
        } else {
            setPremiumStatusMessage("No active Whop entitlement found.", "error");
        }

        await loadAll();
    } catch (error) {
        setPremiumStatusMessage(error?.message || "Verification failed.", "error");
    }
}

function openWhopCheckout() {
    if (!WHOP_CHECKOUT_URL) {
        setPremiumStatusMessage("Checkout URL not configured.", "error");
        return;
    }
    try {
        const checkoutUrl = new URL(WHOP_CHECKOUT_URL);
        checkoutUrl.searchParams.set("ext", chrome.runtime.id);
        chrome.tabs.create({ url: checkoutUrl.toString() });
    } catch {
        chrome.tabs.create({ url: WHOP_CHECKOUT_URL });
    }
}

function openWhopManage() {
    if (!WHOP_MANAGE_URL) {
        setPremiumStatusMessage("Manage membership URL not configured.", "error");
        return;
    }
    chrome.tabs.create({ url: WHOP_MANAGE_URL });
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
        submitBtn.textContent = isEditing ? "Save Changes" : "Schedule";
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
        button.textContent = day.label;
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
    if ($("statScreenTime")) $("statScreenTime").textContent = formatTimeSec(Math.round(totalMs / 1000));
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

            const {
                blockedDomains = {},
                statsToday = {},
                allStatsToday = {},
                statsHistory = {},
                activeBlocks = [],
                scheduledBlocks = [],
                [SETTINGS_KEY]: storedSettings = DEFAULT_SETTINGS,
                [PREMIUM_KEY]: premiumStored = DEFAULT_PREMIUM
            } = await chrome.storage.local.get(["blockedDomains", "statsToday", "allStatsToday", "statsHistory", "activeBlocks", "scheduledBlocks", SETTINGS_KEY, PREMIUM_KEY]);

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

            const range = $("statRange")?.value || "Today";
            const rangeStats = getAggregatedStats(range, allStatsToday, statsHistory);

            updateStatStrip(rangeStats, effectiveBlockedDomains);
            renderActive(latestActiveBlocks, latestBlockedDomains, latestStatsToday);
            renderScheduled(effectiveScheduledBlocks, latestActiveBlocks);
            if (!isRankingInteractionActive()) {
                renderRanking(effectiveBlockedDomains, effectiveStatsToday, rangeStats, "ranking", "timeSec", "Top by Time", range);
                renderRanking(effectiveBlockedDomains, effectiveStatsToday, rangeStats, "rankingByVisits", "visits", "Top by Visits", range);
            }
            renderBlockList(effectiveBlockedDomains, effectiveStatsToday);
            applyPaywallUI(effectiveBlockedDomains, effectiveScheduledBlocks);
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
        list.textContent = EMPTY_STATE_MESSAGES.active;
        list.classList.add("empty-state");
        return;
    }

    list.classList.remove("muted");
    list.classList.remove("empty-state");
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
            ${remainingSec > 0 ? `<span class="timer">${formatTimeSec(remainingSec)} left</span>` : ""}
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
        const daySummary = formatScheduleDays(s.daysOfWeek);
        const div = document.createElement("div");
        div.className = "row";
        div.innerHTML = `
        <div class="row-main">
            <div class="row-title">${s.domain}</div>
            <div class="row-meta schedule-row-meta">${daySummary} · ${formatTimeForDisplay(s.startTime)} - ${formatTimeForDisplay(s.endTime)}</div>
        </div>
        <div class="row-right">
            ${isActive ? '<span class="tag tag-red">Live</span>' : ''}
            <button class="btn-ghost" data-action="edit">Edit</button>
            <button class="btn-danger" data-action="remove" data-domain="${s.domain}" ${isActive ? "disabled title=\"Stop the active session before removing\"" : ""}>Cancel</button>
        </div>
        `;
        div.querySelector('[data-action="edit"]')?.addEventListener("click", () => {
            beginScheduledBlockEdit(s);
        });
        if (!isActive) {
            div.querySelector('[data-action="remove"]')?.addEventListener("click", async () => {
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
                    setPremiumStatusMessage(`Free plan allows up to ${FREE_PLAN_LIMITS.maxTrackedDomains} limited domains and ${FREE_PLAN_LIMITS.maxScheduledBlocks} scheduled blocks.`, "error");
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
                    <div class="row-meta">Limit: ${limitText} · Today: ${formatTimeSec(displayTimeSec)} · ${st.visits || 0} visits</div>
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
    initializeScheduleDayPicker();

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

    $("verifyWhopBtn")?.addEventListener("click", async () => {
        await verifyWhopAccess();
    });

    await chrome.runtime.sendMessage({ action: "refreshPremiumStatus" }).catch(() => null);

    $("upgradeBtnFromLimits")?.addEventListener("click", openWhopCheckout);
    $("upgradeBtnFromSchedule")?.addEventListener("click", openWhopCheckout);
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
        clearFormFeedback("addFormMsg", ["domainInput", "limitInput"]);

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
            showFormError("addFormMsg", "Enter a valid domain like google.com.", ["domainInput"]);
            return;
        }
        if (!Number.isFinite(limitSeconds) || limitSeconds <= 0) {
            showFormError("addFormMsg", "Enter a daily limit greater than 0 minutes.", ["limitInput"]);
            return;
        }

        $("domainInput").value = "";
        $("limitInput").value = "";

        await addDomain(domain, limitSeconds);
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
            daysOfWeek
        });
        if (!response?.success) {
            showFormError("scheduledFormMsg", response?.error || "Unable to save the scheduled block.");
            return;
        }

        resetScheduledForm();
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

    if (changes[SETTINGS_KEY] || changes[PREMIUM_KEY] || changes.statsToday || changes.allStatsToday || changes.blockedDomains || changes.activeBlocks || changes.scheduledBlocks) {
        loadAll();
    }
});
