const params = new URLSearchParams(location.search);
const { getOrCreateAnalyticsClientId, getDayKey } = globalThis.StmSharedUtils || {};

// Domain validation to prevent open redirect vulnerability
function validateDomainParam(raw) {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    
    // Reject URLs with protocols
    if (trimmed.includes("://") || trimmed.startsWith("javascript:") || trimmed.startsWith("data:")) {
        console.error("Blocked invalid domain format:", raw);
        return null;
    }
    
    // Basic domain character allowlist
    if (!/^[a-z0-9.-]+$/.test(trimmed)) {
        console.error("Blocked invalid domain format:", raw);
        return null;
    }

    // Reject empty labels (e.g. example..com) and edge hyphens (e.g. -a.com, a-.com)
    const labels = trimmed.split(".");
    if (labels.some((label) => !label || label.startsWith("-") || label.endsWith("-"))) {
        console.error("Blocked invalid domain format:", raw);
        return null;
    }
    
    // Max length check
    if (trimmed.length > 255) {
        console.error("Blocked domain exceeds max length");
        return null;
    }
    
    return trimmed;
}

const rawDomain = params.get("d");
const d = validateDomainParam(rawDomain) || "this site";
const source = params.get("source") || "limit";
const tier = (params.get("tier") || "lenient").toLowerCase();
const eventId = params.get("eid") || "";
const BLOCK_EVENT_TRACKER_KEY = "blockedAnalyticsEvent";
const BLOCK_RECLAIM_TRACKER_KEY = "saturnBlockReclaimEvent";
const BLOCK_RECLAIM_STATS_KEY = "saturnBlockReclaimStats";
const FIRST_BLOCK_REACHED_KEY = "activationFirstBlockReachedAt";
const BLOCK_ANALYTICS_URL = "https://screen-time-manager.jackster0627.workers.dev/analytics/block-event";
const ANALYTICS_PRODUCTION_EXTENSION_ID = "pecaajdaecdmikcgfdgldcofdebhfbgo";
const RECLAIM_MS_PER_BLOCK = 5 * 60 * 1000;
const TIER_LABELS = {
    lenient: "Lenient",
    standard: "Standard",
    strict: "Strict",
    immutable: "Immutable"
};
const DEFAULT_SNOOZE_MINUTES = 5;

let strictChallengeReadyAt = 0;
let strictChallengeWindowEndsAt = 0;

const STRICT_GAMES = {
    MATH_PROBLEM: 'mathProblem',
    GRID_MEMORY: 'gridMemory',
    MEMORY_SEQUENCE: 'memorySequence',
    TYPING_CHALLENGE: 'typingChallenge'
};

function selectRandomGame() {
    const games = Object.values(STRICT_GAMES);
    return games[Math.floor(Math.random() * games.length)];
}

function normalizedTierName() {
    return TIER_LABELS[tier] ? tier : "lenient";
}

function normalizedBlockSource() {
    return source === "scheduled" ? "scheduled" : "limit";
}

function blockAnalyticsParams() {
    return {
        block_source: normalizedBlockSource(),
        block_tier: normalizedTierName()
    };
}

function shouldSendAnalytics() {
    return chrome.runtime?.id === ANALYTICS_PRODUCTION_EXTENSION_ID;
}

function setBadgeText() {
    const tierName = normalizedTierName();
    const sourceLabel = source === "scheduled" ? "Scheduled block" : "Limit reached";
    const badge = document.getElementById("badge");

    if (badge) {
        badge.textContent = `${sourceLabel} - ${TIER_LABELS[tierName]}`;
    }
}

function setDomainText() {
    const domain = document.getElementById("domain");
    if (domain) domain.textContent = d;
}

function trackBlockedPageAction(action) {
    chrome.runtime.sendMessage({
        action: "trackAnalyticsEvent",
        eventName: "blocked_page_action",
        params: {
            action,
            ...blockAnalyticsParams()
        }
    }).catch(() => null);
}

function formatClockTime(rawTime) {
    const match = String(rawTime || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return "";

    const date = new Date();
    date.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatScheduledEnd(block) {
    const raw = block?.endsAt || block?.endAt || block?.endTime;
    if (!raw) return "";

    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
        return new Date(numeric).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    const clock = formatClockTime(raw);
    if (clock) return clock;

    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    return "";
}

async function trackFirstBlockReached() {
    try {
        const data = await chrome.storage.local.get([FIRST_BLOCK_REACHED_KEY]);
        if (data[FIRST_BLOCK_REACHED_KEY]) return;

        await chrome.storage.local.set({ [FIRST_BLOCK_REACHED_KEY]: Date.now() });
        await chrome.runtime.sendMessage({
            action: "trackAnalyticsEvent",
            eventName: "first_block_reached",
            params: blockAnalyticsParams()
        });
    } catch {
        // Analytics should never interrupt the block page.
    }
}

async function trackBlockedPageView() {
    if (typeof getOrCreateAnalyticsClientId !== "function") return;
    if (!shouldSendAnalytics()) return;

    const trackerKey = `${BLOCK_EVENT_TRACKER_KEY}:${eventId || location.href}`;
    try {
        if (sessionStorage.getItem(trackerKey)) return;
        sessionStorage.setItem(trackerKey, "1");
    } catch {
        // Best effort only; analytics should never affect the block page.
    }

    try {
        const clientId = await getOrCreateAnalyticsClientId(chrome.storage.local);
        await fetch(BLOCK_ANALYTICS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                clientId,
                extensionId: chrome.runtime?.id || "",
                extensionVersion: chrome.runtime.getManifest?.().version || "unknown",
                source: normalizedBlockSource(),
                tier: normalizedTierName()
            })
        });
    } catch {
        // Analytics should never interrupt extension behavior.
    }
}

async function trackLocalBlockReclaim() {
    if (normalizedBlockSource() === "scheduled") return;

    const trackerKey = `${BLOCK_RECLAIM_TRACKER_KEY}:${eventId || location.href}`;
    try {
        if (sessionStorage.getItem(trackerKey)) return;
        sessionStorage.setItem(trackerKey, "1");
    } catch {
        // Best effort only; local metrics should never affect the block page.
    }

    try {
        const day = typeof getDayKey === "function"
            ? getDayKey()
            : new Date().toISOString().slice(0, 10);
        const data = await chrome.storage.local.get([BLOCK_RECLAIM_STATS_KEY]);
        const history = data[BLOCK_RECLAIM_STATS_KEY] || {};
        const current = history[day] || { count: 0, estimatedMs: 0, bySource: {}, byTier: {} };
        const sourceKey = normalizedBlockSource();
        const tierKey = normalizedTierName();

        await chrome.storage.local.set({
            [BLOCK_RECLAIM_STATS_KEY]: {
                ...history,
                [day]: {
                    ...current,
                    count: Number(current.count || 0) + 1,
                    estimatedMs: Number(current.estimatedMs || 0) + RECLAIM_MS_PER_BLOCK,
                    bySource: {
                        ...(current.bySource || {}),
                        [sourceKey]: Number(current.bySource?.[sourceKey] || 0) + 1
                    },
                    byTier: {
                        ...(current.byTier || {}),
                        [tierKey]: Number(current.byTier?.[tierKey] || 0) + 1
                    }
                }
            }
        });
    } catch {
        // Best effort only; local metrics should never affect the block page.
    }
}

function renderStandardSnoozeButtons(container, increments = [5, 15, 30]) {
    increments.forEach((minutes) => {
        const button = document.createElement("button");
        button.className = "btn snooze";
        button.type = "button";
        button.textContent = `Snooze ${minutes} min`;
        button.addEventListener("click", async () => {
            trackBlockedPageAction(`snooze_${minutes}m`);
            await sendSnooze(minutes);
        });
        container.appendChild(button);
    });
}

function hideAllStrictGameContainers() {
    const ids = [
        'gridMemoryContainer',
        'mathGameContainer',
        'memoryGameContainer',
        'typingGameContainer'
    ];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
    });
}

async function sendSnooze(minutes, challengeToken = null) {
    const payload = {
        action: "snoozeBlock",
        domain: d,
        minutes: minutes || DEFAULT_SNOOZE_MINUTES,
        source: "strict_challenge"
    };
    if (challengeToken) {
        payload.challengeToken = challengeToken;
    }
    // Prefer an explicit original passed via the `u` query param (set by
    // background when it controls the redirect). Fall back to document.referrer.
    try {
        const explicit = String(params.get("u") || "").trim();
        const ref = explicit || String(document.referrer || "").trim();
        if (ref) payload.original = ref;
    } catch (e) {}
    
    const response = await chrome.runtime.sendMessage(payload).catch(() => ({ success: false }));
    if (response?.success) {
        const target = String(response.redirectUrl || '').trim() || `https://${d}`;
        try {
            window.location.href = target;
            return;
        } catch (e) {
            // fallback to top-level domain
        }
        window.location.href = `https://${d}`;
    } else {
        console.error("Snooze failed:", response?.error || "Unknown error");
    }
}

async function resetDomainLimitAndLeave() {
    const response = await chrome.runtime.sendMessage({
        action: "resetDomainLimit",
        domain: d,
        fromBlockedPage: true,
        original: String(params.get("u") || "").trim()
    }).catch(() => ({ success: false }));
    
    if (response?.success) {
        window.location.href = String(response.redirectUrl || "").trim() || `https://${d}`;
    } else {
        console.error("Reset limit failed:", response?.error || "Unknown error");
    }
}

async function requestStrictTokenFor(gameType) {
    return await chrome.runtime.sendMessage({
        action: "requestStrictChallengeToken",
        domain: d,
        gameType
    });
}

async function runMathChallenge() {
    hideAllStrictGameContainers();
    const container = document.getElementById('mathGameContainer');
    container.hidden = false;
    const problemEl = document.getElementById('mathProblem');
    const answerEl = document.getElementById('mathAnswer');
    const submitBtn = document.getElementById('mathSubmitBtn');
    const feedback = document.getElementById('mathFeedback');

    const a = 2 + Math.floor(Math.random() * 8);
    const b = 2 + Math.floor(Math.random() * 8);
    const expected = a + b;
    problemEl.textContent = `${a} + ${b} = ?`;
    answerEl.value = '';
    feedback.textContent = '';

    submitBtn.onclick = async () => {
        const val = Number(answerEl.value);
        if (!Number.isFinite(val)) {
            feedback.textContent = 'Please enter a number.';
            return;
        }
        if (val !== expected) {
            feedback.textContent = 'Incorrect — try again.';
            return;
        }

        const tokenResponse = await requestStrictTokenFor(STRICT_GAMES.MATH_PROBLEM);
        if (!tokenResponse?.success || !tokenResponse.challengeToken) {
            feedback.textContent = 'Challenge token failed. Try again.';
            console.error('requestStrictTokenFor failed', tokenResponse);
            return;
        }
        // Debug: log token response (masked)
        try {
            const t = String(tokenResponse.challengeToken || '');
            const masked = `${t.slice(0,6)}...${t.slice(-4)}`;
            console.debug('strict token received', masked, tokenResponse);
        } catch (e) {}
        trackBlockedPageAction('strict_challenge_passed');
        await sendSnooze(DEFAULT_SNOOZE_MINUTES, tokenResponse.challengeToken);
    };
}

async function runMemorySequenceChallenge() {
    hideAllStrictGameContainers();
    const container = document.getElementById('memoryGameContainer');
    container.hidden = false;
    const display = document.getElementById('sequenceDisplay');
    const startBtn = document.getElementById('memoryStartBtn');
    const feedback = document.getElementById('memoryFeedback');

    display.innerHTML = '';
    feedback.textContent = '';

    const colors = ['#FF7A7A', '#7AC8FF', '#FFD57A', '#B7FF7A'];
    const seq = Array.from({ length: 3 }, () => Math.floor(Math.random() * colors.length));
    let userIdx = 0;
    let accepting = false;

    // build buttons
    colors.forEach((col, i) => {
        const btn = document.createElement('button');
        btn.className = 'sequence-button';
        btn.style.background = col;
        btn.dataset.idx = String(i);
        btn.disabled = true;
        btn.onclick = () => {
            if (!accepting) return;
            const expected = seq[userIdx];
            const chosen = Number(btn.dataset.idx);
            if (chosen !== expected) {
                accepting = false;
                feedback.textContent = 'Wrong sequence — try again.';
                return;
            }
            userIdx += 1;
            if (userIdx >= seq.length) {
                // success
                (async () => {
                    const tokenResponse = await requestStrictTokenFor(STRICT_GAMES.MEMORY_SEQUENCE);
                    if (!tokenResponse?.success || !tokenResponse.challengeToken) {
                        feedback.textContent = 'Challenge token failed. Try again.';
                        return;
                    }
                    trackBlockedPageAction('strict_challenge_passed');
                    await sendSnooze(DEFAULT_SNOOZE_MINUTES, tokenResponse.challengeToken);
                })();
            }
        };
        display.appendChild(btn);
    });

    // show sequence then enable input
    startBtn.onclick = async () => {
        feedback.textContent = 'Watch the sequence...';
        const buttons = Array.from(display.children);
        // flash sequence
        for (let i = 0; i < seq.length; i++) {
            const idx = seq[i];
            const btn = buttons[idx];
            btn.disabled = false;
            const prev = btn.style.opacity;
            btn.style.transform = 'scale(1.08)';
            await new Promise((r) => setTimeout(r, 500));
            btn.style.transform = '';
            await new Promise((r) => setTimeout(r, 150));
            btn.disabled = true;
        }
        feedback.textContent = 'Your turn: repeat the sequence.';
        userIdx = 0;
        accepting = true;
        // Enable all buttons for user interaction
        buttons.forEach((btn) => {
            btn.disabled = false;
        });
    };
}

async function runGridMemoryChallenge() {
    hideAllStrictGameContainers();
    const container = document.getElementById('gridMemoryContainer');
    container.hidden = false;
    const display = document.getElementById('gridDisplay');
    const startBtn = document.getElementById('gridStartBtn');
    const feedback = document.getElementById('gridFeedback');

    display.innerHTML = '';
    feedback.textContent = '';

    const GRID_SIZE = 4; // 4x4 grid
    const GRID_COUNT = GRID_SIZE * GRID_SIZE;
    const TARGET_COUNT = 5;
    const MAX_MISCLICKS = 3;
    const targetIndexes = new Set();
    const selectedIndexes = new Set();
    const cells = [];
    let revealActive = false;
    let accepting = false;
    let revealTimer = null;
    let misclicks = 0;

    function generateNewPattern() {
        targetIndexes.clear();
        while (targetIndexes.size < TARGET_COUNT) {
            targetIndexes.add(Math.floor(Math.random() * GRID_COUNT));
        }
    }

    generateNewPattern();

    function renderBoard() {
        cells.forEach((cell, index) => {
            const isTarget = targetIndexes.has(index);
            const isSelected = selectedIndexes.has(index);
            cell.classList.toggle('grid-button--target', revealActive && isTarget);
            cell.classList.toggle('grid-button--selected', !revealActive && isSelected);
            cell.classList.toggle('grid-button--dimmed', !revealActive && !isSelected);
        });
    }

    function resetSelection() {
        selectedIndexes.clear();
        renderBoard();
    }

    function finishChallenge() {
        const isMatch = selectedIndexes.size === targetIndexes.size
            && Array.from(selectedIndexes).every((index) => targetIndexes.has(index));

        if (!isMatch) {
            feedback.textContent = 'Not quite. Try again.';
            resetSelection();
            return;
        }

        // Detector fired: all squares selected correctly
        accepting = false;
        feedback.textContent = 'Perfect! Submitting...';
        (async () => {
            const tokenResponse = await requestStrictTokenFor(STRICT_GAMES.GRID_MEMORY);
            if (!tokenResponse?.success || !tokenResponse.challengeToken) {
                feedback.textContent = 'Challenge token failed. Try again.';
                accepting = true;
                return;
            }
            trackBlockedPageAction('strict_challenge_passed');
            await sendSnooze(DEFAULT_SNOOZE_MINUTES, tokenResponse.challengeToken);
        })();
    }

    for (let i = 0; i < GRID_COUNT; i++) {
        const btn = document.createElement('button');
        btn.className = 'grid-button';
        btn.type = 'button';
        btn.dataset.idx = String(i);
        btn.addEventListener('click', () => {
            if (!accepting) return;

            const index = Number(btn.dataset.idx);
            if (!targetIndexes.has(index)) {
                misclicks++;
                const remaining = MAX_MISCLICKS - misclicks;
                
                if (remaining > 0) {
                    feedback.textContent = `Wrong square! ${remaining} mistake${remaining === 1 ? '' : 's'} left.`;
                    selectedIndexes.delete(index);
                    renderBoard();
                } else {
                    // Pattern reset on 3rd misclick
                    accepting = false;
                    feedback.textContent = 'Too many mistakes. New pattern loading...';
                    misclicks = 0;
                    generateNewPattern();
                    resetSelection();
                    
                    setTimeout(() => {
                        feedback.textContent = 'Press Start to begin again.';
                        startBtn.disabled = false;
                    }, 1500);
                }
                return;
            }

            if (selectedIndexes.has(index)) {
                selectedIndexes.delete(index);
            } else {
                selectedIndexes.add(index);
            }

            renderBoard();
            const selectedCount = selectedIndexes.size;
            const targetCount = targetIndexes.size;
            feedback.textContent = `Selected ${selectedCount} of ${targetCount} squares.`;

            // Detector: fire when all correct squares are selected
            if (selectedCount === targetCount) {
                finishChallenge();
            }
        });

        cells.push(btn);
        display.appendChild(btn);
    }

    display.style.display = 'grid';
    display.style.gridTemplateColumns = `repeat(${GRID_SIZE}, 1fr)`;
    display.style.gap = '8px';
    display.style.marginBottom = '8px';

    renderBoard();

    startBtn.onclick = async () => {
        startBtn.disabled = true;
        accepting = false;
        selectedIndexes.clear();
        misclicks = 0;
        revealActive = true;
        feedback.textContent = 'Watch the highlighted squares.';
        renderBoard();

        if (revealTimer) {
            clearTimeout(revealTimer);
        }

        revealTimer = setTimeout(() => {
            revealActive = false;
            accepting = true;
            feedback.textContent = 'Your turn: reselect the highlighted squares.';
            renderBoard();
            startBtn.disabled = false;
        }, 2500);
    };
}

async function runTypingChallenge() {
    hideAllStrictGameContainers();
    const container = document.getElementById('typingGameContainer');
    container.hidden = false;
    const wordEl = document.getElementById('typingWord');
    const input = document.getElementById('typingInput');
    const submit = document.getElementById('typingSubmitBtn');
    const feedback = document.getElementById('typingFeedback');

    const words = ['focus', 'breathe', 'garden', 'orange', 'puzzle'];
    const word = words[Math.floor(Math.random() * words.length)];
    wordEl.textContent = word;
    input.value = '';
    feedback.textContent = '';

    submit.onclick = async () => {
        if ((input.value || '').trim() !== word) {
            feedback.textContent = 'Text does not match exactly.';
            return;
        }
        const tokenResponse = await requestStrictTokenFor(STRICT_GAMES.TYPING_CHALLENGE);
        if (!tokenResponse?.success || !tokenResponse.challengeToken) {
            feedback.textContent = 'Challenge token failed. Try again.';
            return;
        }
        trackBlockedPageAction('strict_challenge_passed');
        await sendSnooze(DEFAULT_SNOOZE_MINUTES, tokenResponse.challengeToken);
    };
}

async function completeStrictChallenge() {
    const copy = document.getElementById("challengeCopy");
    const tapBtn = document.getElementById("challengeTapBtn");
    const now = Date.now();

    if (now < strictChallengeReadyAt || now > strictChallengeWindowEndsAt) {
        copy.textContent = "Too early or too late. Try again.";
        tapBtn.disabled = true;
        return;
    }

    const tokenResponse = await chrome.runtime.sendMessage({
        action: "requestStrictChallengeToken",
        domain: d
    });

    if (!tokenResponse?.success || !tokenResponse.challengeToken) {
        copy.textContent = "Challenge token failed. Try again.";
        tapBtn.disabled = true;
        return;
    }

    trackBlockedPageAction("strict_challenge_passed");
    await sendSnooze(DEFAULT_SNOOZE_MINUTES, tokenResponse.challengeToken);
}

async function renderTierActions() {
    const tierName = normalizedTierName();
    const primary = document.getElementById("primaryActions");
    const strictChallenge = document.getElementById("strictChallenge");
    const immutableNotice = document.getElementById("immutableNotice");

    primary.innerHTML = "";
    strictChallenge.hidden = true;
    immutableNotice.hidden = true;

    if (tierName === "lenient") {
        const undoButton = document.createElement("button");
        undoButton.className = "btn";
        undoButton.type = "button";
        undoButton.textContent = source === "scheduled" ? "End Session" : "Undo Block";
        undoButton.addEventListener("click", async () => {
            // Check if this domain is currently being blocked (active block)
            const { activeBlocks = [] } = await chrome.storage.local.get(["activeBlocks"]);
            const isCurrentlyBlocking = (activeBlocks || []).some((b) => b.domain === d);
            
            if (source === "scheduled") {
                if (isCurrentlyBlocking) {
                    console.error("Cannot end session: this site is currently being blocked");
                    return;
                }
                trackBlockedPageAction("end_session_lenient");
                const response = await chrome.runtime.sendMessage({
                    action: "endScheduledBlock",
                    domain: d,
                    fromBlockedPage: true,
                    original: String(params.get("u") || "").trim()
                });
                if (response?.success) {
                    window.location.href = String(response.redirectUrl || "").trim() || `https://${d}`;
                }
            } else {
                if (isCurrentlyBlocking) {
                    console.error("Cannot undo block: this site is currently being blocked by a scheduled block");
                    return;
                }
                trackBlockedPageAction("undo_block_lenient");
                await resetDomainLimitAndLeave();
            }
        });
        primary.appendChild(undoButton);
        return;
    }

    if (tierName === "standard") {
        renderStandardSnoozeButtons(primary, [5, 15, 30]);
        return;
    }

    if (tierName === "strict") {
        strictChallenge.hidden = false;
        // Pick a game (random). Could be extended to user preference.
        const selectedGame = selectRandomGame();
        trackBlockedPageAction(`strict_challenge_game_${selectedGame}`);

        // show appropriate UI and attach handlers
        hideAllStrictGameContainers();
        if (selectedGame === STRICT_GAMES.GRID_MEMORY) {
            await runGridMemoryChallenge();
        } else if (selectedGame === STRICT_GAMES.MATH_PROBLEM) {
            await runMathChallenge();
        } else if (selectedGame === STRICT_GAMES.MEMORY_SEQUENCE) {
            await runMemorySequenceChallenge();
        } else if (selectedGame === STRICT_GAMES.TYPING_CHALLENGE) {
            await runTypingChallenge();
        }
        return;
    }

    immutableNotice.hidden = false;
    immutableNotice.textContent = "Immutable mode is active. Open the extension popup and use Emergency Override from Settings while this block is active.";
}

if (source === "scheduled") {
    // Show when the block ends
    chrome.storage.local.get(["activeBlocks"], (data) => {
        const block = (data.activeBlocks || []).find((b) => b.domain === d);
        const el = document.getElementById("blockedUntil");
        if (!el) return;

        const endTime = formatScheduledEnd(block);
        el.textContent = endTime ? `Session active until ${endTime}` : "";
    });
}

document.getElementById("closeTabBtn").addEventListener("click", async () => {
    trackBlockedPageAction("close_tab");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) chrome.tabs.remove(tab.id);
});

setDomainText();
setBadgeText();
renderTierActions();
trackBlockedPageView();
trackLocalBlockReclaim();
trackFirstBlockReached();
