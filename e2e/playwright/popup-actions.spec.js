const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const WHOP_CHECKOUT_START_URL = 'https://api.saturnfocus.com/whop/start';
const WHOP_MANAGE_URL = 'https://whop.com/hub/memberships/';
const CHROME_WEBSTORE_REVIEW_URL = 'https://chromewebstore.google.com/detail/screen-time-manager/pecaajdaecdmikcgfdgldcofdebhfbgo/reviews';
const SURVEYMONKEY_FEEDBACK_URL = 'https://www.surveymonkey.com/r/QF2RJ58';

function popupUrl() {
    return `file:///${path.join(process.cwd(), 'popup.html').replace(/\\/g, '/')}`;
}

function dayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function dayKeyOffset(offset) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return dayKey(date);
}

function insightMockUsageData() {
    const today = dayKey();
    const yesterday = dayKeyOffset(1);
    const twoDaysAgo = dayKeyOffset(2);
    const threeDaysAgo = dayKeyOffset(3);
    const hour = new Date().getHours();
    const hourKey = String(hour).padStart(2, '0');

    return {
        uiSettings: {
            defaultLimitMinutes: 30,
            use24HourTime: false,
            limitNotificationsEnabled: true,
            personalInsightsEnabled: true,
            insightNotificationsEnabled: true,
            insightMaxNotificationsPerDay: 1,
            insightSensitivity: 'normal'
        },
        activeSession: {
            domain: 'youtube.com',
            startedAt: Date.now() - 40 * 60 * 1000,
            lastHeartbeatAt: Date.now()
        },
        statsToday: {
            'youtube.com': { timeMs: 50 * 60 * 1000, visits: 4 },
            'reddit.com': { timeMs: 22 * 60 * 1000, visits: 9 },
            'linkedin.com': { timeMs: 12 * 60 * 1000, visits: 1 }
        },
        allStatsToday: {
            'youtube.com': { timeMs: 50 * 60 * 1000, visits: 4 },
            'reddit.com': { timeMs: 22 * 60 * 1000, visits: 9 },
            'linkedin.com': { timeMs: 12 * 60 * 1000, visits: 1 }
        },
        statsHistory: {
            [yesterday]: {
                'youtube.com': { timeMs: 10 * 60 * 1000, visits: 1 },
                'linkedin.com': { timeMs: 12 * 60 * 1000, visits: 1 }
            },
            [twoDaysAgo]: {
                'youtube.com': { timeMs: 11 * 60 * 1000, visits: 1 },
                'linkedin.com': { timeMs: 12 * 60 * 1000, visits: 1 }
            },
            [threeDaysAgo]: {
                'youtube.com': { timeMs: 12 * 60 * 1000, visits: 1 }
            }
        },
        hourlyUsageHistory: {
            [today]: {
                '09': {
                    timeMs: 8 * 60 * 1000,
                    visits: 1,
                    domains: { 'linkedin.com': 8 * 60 * 1000 },
                    domainVisits: { 'linkedin.com': 1 }
                },
                [hourKey]: {
                    timeMs: 32 * 60 * 1000,
                    visits: 12,
                    domains: {
                        'youtube.com': 22 * 60 * 1000,
                        'reddit.com': 10 * 60 * 1000
                    },
                    domainVisits: {
                        'youtube.com': 3,
                        'reddit.com': 9
                    }
                }
            },
            [yesterday]: {
                '09': {
                    timeMs: 8 * 60 * 1000,
                    visits: 1,
                    domains: { 'linkedin.com': 8 * 60 * 1000 },
                    domainVisits: { 'linkedin.com': 1 }
                }
            },
            [twoDaysAgo]: {
                '09': {
                    timeMs: 8 * 60 * 1000,
                    visits: 1,
                    domains: { 'linkedin.com': 8 * 60 * 1000 },
                    domainVisits: { 'linkedin.com': 1 }
                }
            }
        },
        personalInsights: [],
        dismissedInsights: {},
        blockedDomains: {},
        snoozedDomains: {}
    };
}

async function installPopupChromeMock(page, overrides = {}) {
    const insightsSource = fs.readFileSync(path.join(process.cwd(), 'insights.js'), 'utf8');
    await page.addInitScript(({ today, overrides, insightsSource }) => {
        window.eval(insightsSource);
        const listeners = [];
        const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
        const data = {
            uiSettings: {
                defaultLimitMinutes: 30,
                use24HourTime: false,
                limitNotificationsEnabled: true,
                personalInsightsEnabled: true,
                insightNotificationsEnabled: true,
                insightMaxNotificationsPerDay: 1,
                insightSensitivity: 'normal'
            },
            onboardingState: { step: 0, completed: true, completedAt: Date.now(), version: 2 },
            blockedDomains: {},
            statsToday: {
                'alpha.com': { timeMs: 20 * 60 * 1000, visits: 4 },
                'beta.com': { timeMs: 10 * 60 * 1000, visits: 2 }
            },
            allStatsToday: {
                'alpha.com': { timeMs: 20 * 60 * 1000, visits: 4 },
                'beta.com': { timeMs: 10 * 60 * 1000, visits: 2 }
            },
            statsHistory: {},
            hourlyUsageHistory: {
                [today]: {
                    '09': {
                        timeMs: 10 * 60 * 1000,
                        visits: 1,
                        domains: { 'alpha.com': 10 * 60 * 1000 }
                    },
                    '10': {
                        timeMs: 20 * 60 * 1000,
                        visits: 1,
                        domains: { 'beta.com': 20 * 60 * 1000 }
                    }
                }
            },
            snoozeHistory: {},
            recentlyReset: {},
            snoozedDomains: {
                'www.alpha.com': { expiresAt: Date.now() + 10 * 60 * 1000, minutes: 5 }
            },
            personalInsights: [],
            dismissedInsights: {},
            activeBlocks: [],
            scheduledBlocks: [],
            premiumState: { active: false, planName: 'Free' },
            immutableAdminOverrideEnabled: false
        };
        Object.assign(data, clone(overrides));

        const normalizeDomain = (input) => {
            const raw = String(input || '').trim().toLowerCase();
            try {
                return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
            } catch {
                return raw.replace(/^www\./, '').split('/')[0];
            }
        };
        const emitStorageChanges = (items) => {
            const clonedItems = clone(items) || {};
            const changes = {};
            for (const [key, newValue] of Object.entries(clonedItems)) {
                changes[key] = { oldValue: clone(data[key]), newValue: clone(newValue) };
                data[key] = newValue;
            }
            listeners.forEach((listener) => listener(changes, 'local'));
        };
        window.__popupData = data;
        window.__popupMessages = [];
        window.__popupOpenedTabs = [];
        window.__popupFlushCount = 0;
        window.chrome = {
            runtime: {
                id: 'mock-extension-id',
                getURL: (value) => value,
                sendMessage: async (message) => {
                    window.__popupMessages.push(message);
                    if (message?.action === 'flushActiveTimeNow') {
                        window.__popupFlushCount += 1;
                        if (data.flushMutatesStats) {
                            const statsToday = clone(data.statsToday || {});
                            const allStatsToday = clone(data.allStatsToday || {});
                            statsToday['alpha.com'] = {
                                ...(statsToday['alpha.com'] || {}),
                                timeMs: Number(statsToday['alpha.com']?.timeMs || 0) + 1000,
                                visits: Number(statsToday['alpha.com']?.visits || 0)
                            };
                            allStatsToday['alpha.com'] = {
                                ...(allStatsToday['alpha.com'] || {}),
                                timeMs: Number(allStatsToday['alpha.com']?.timeMs || 0) + 1000,
                                visits: Number(allStatsToday['alpha.com']?.visits || 0)
                            };
                            emitStorageChanges({ statsToday, allStatsToday });
                        }
                    }
                    if (message?.action === 'clearDomainSnooze') {
                        const normalized = normalizeDomain(message.domain);
                        if (data.failClearSnoozeMessage) {
                            return { success: false, error: 'clear failed' };
                        }
                        for (const key of Object.keys(data.snoozedDomains)) {
                            if (normalizeDomain(key) === normalized) delete data.snoozedDomains[key];
                        }
                    }
                    if (message?.action === 'toggleDomainLimitEnabled') {
                        const normalized = normalizeDomain(message.domain);
                        const keys = Object.keys(data.blockedDomains).filter((key) => normalizeDomain(key) === normalized);
                        for (const key of keys) data.blockedDomains[key].enabled = message.enabled !== false;
                        if (!keys.length) return { success: false, error: 'Domain not found.' };
                    }
                    if (message?.action === 'toggleScheduledBlockEnabled') {
                        const id = String(message.id || '');
                        const enabled = message.enabled !== false;
                        const index = (data.scheduledBlocks || []).findIndex((block) => block.id === id);
                        if (index < 0) return { success: false, error: 'Schedule not found.' };
                        data.scheduledBlocks[index] = { ...data.scheduledBlocks[index], enabled };
                        if (!enabled) {
                            data.activeBlocks = (data.activeBlocks || []).filter((block) => block.id !== id);
                        }
                    }
                    if (message?.action === 'generateInsights') {
                        const now = Number(message.now || Date.now());
                        const insights = window.StmInsights.analyzeUsagePatterns({
                            statsToday: data.statsToday || {},
                            allStatsToday: data.allStatsToday || data.statsToday || {},
                            statsHistory: data.statsHistory || {},
                            hourlyUsageHistory: data.hourlyUsageHistory || {},
                            blockedDomains: data.blockedDomains || {},
                            activeSession: data.activeSession || null,
                            settings: data.uiSettings || {},
                            now
                        });
                        emitStorageChanges({
                            personalInsights: insights,
                            dismissedInsights: data.dismissedInsights || {},
                            lastInsightAnalysisAt: now
                        });
                        return { success: true, insights: clone(insights) };
                    }
                    if (message?.action === 'dismissInsight') {
                        const id = String(message.id || '');
                        const dismissedInsights = { ...(data.dismissedInsights || {}), [id]: Date.now() };
                        const personalInsights = (data.personalInsights || []).filter((insight) => insight?.id !== id);
                        emitStorageChanges({ dismissedInsights, personalInsights });
                        return { success: true, id };
                    }
                    return { success: true };
                }
            },
            storage: {
                local: {
                    get: async (keys) => {
                        const result = {};
                        for (const key of keys) result[key] = clone(data[key]);
                        return result;
                    },
                    set: async (items) => emitStorageChanges(items),
                    remove: async (keys) => {
                        const list = Array.isArray(keys) ? keys : [keys];
                        const changes = {};
                        for (const key of list) {
                            changes[key] = { oldValue: clone(data[key]), newValue: undefined };
                            delete data[key];
                        }
                        listeners.forEach((listener) => listener(changes, 'local'));
                    }
                },
                onChanged: { addListener: (listener) => listeners.push(listener) }
            },
            tabs: {
                create: async (details) => {
                    window.__popupOpenedTabs.push(clone(details));
                    return { id: window.__popupOpenedTabs.length, ...details };
                }
            },
            alarms: { clear: async () => true }
        };
    }, { today: dayKey(), overrides, insightsSource });
}

test('storage updates from active website flush do not trap popup in a refresh loop', async ({ page }) => {
    await installPopupChromeMock(page, { flushMutatesStats: true });

    await page.goto(popupUrl());
    await expect(page.locator('#ranking')).toContainText('alpha.com');
    await page.waitForTimeout(250);

    await expect.poll(() => page.evaluate(() => window.__popupFlushCount)).toBe(1);
    await page.locator('label[for="tab2"]').click();
    await expect(page.locator('#tab2')).toBeChecked();
});

test('popup live refresh keeps flushing and repainting visible stats', async ({ page }) => {
    await installPopupChromeMock(page, { flushMutatesStats: true });

    await page.goto(popupUrl());
    await expect(page.locator('#ranking')).toContainText('alpha.com');
    await expect(page.locator('#statScreenTimeDelta')).toHaveText('+100%');

    await expect.poll(() => page.evaluate(() => window.__popupFlushCount), { timeout: 3500 }).toBeGreaterThanOrEqual(3);
    await expect.poll(() => page.evaluate(() => window.__popupData.statsToday['alpha.com']?.timeMs), { timeout: 3500 })
        .toBeGreaterThanOrEqual((20 * 60 * 1000) + 3000);
    await expect(page.locator('#statScreenTime')).toContainText('30m');
    await expect(page.locator('#statScreenTimeDelta')).not.toHaveText('Today');
});

test('popup live refresh updates total screen time chip across minute boundaries', async ({ page }) => {
    await installPopupChromeMock(page, {
        flushMutatesStats: true,
        statsToday: {
            'alpha.com': { timeMs: (29 * 60 * 1000) + 58000, visits: 4 },
            'beta.com': { timeMs: 0, visits: 0 }
        },
        allStatsToday: {
            'alpha.com': { timeMs: (29 * 60 * 1000) + 58000, visits: 4 },
            'beta.com': { timeMs: 0, visits: 0 }
        }
    });

    await page.goto(popupUrl());
    await expect(page.locator('#statScreenTime')).toContainText('29m');

    await expect.poll(() => page.evaluate(() => window.__popupData.statsToday['alpha.com']?.timeMs), { timeout: 3500 })
        .toBeGreaterThanOrEqual(30 * 60 * 1000);
    await expect(page.locator('#statScreenTime')).toContainText('30m');
});

test('popup snooze stat handles legacy per-domain history without NaN', async ({ page }) => {
    await installPopupChromeMock(page, {
        snoozeHistory: {
            [dayKey()]: {
                'alpha.com': 2,
                'beta.com': 1
            }
        }
    });

    await page.goto(popupUrl());
    await expect(page.locator('#statSnoozes')).toHaveText('3');
    await expect(page.locator('#statSnoozes')).not.toHaveText('NaN');
});

test('selected hourly bar survives live refresh repaint', async ({ page }) => {
    await installPopupChromeMock(page, { flushMutatesStats: true });

    await page.goto(popupUrl());
    await expect(page.locator('#ranking')).toContainText('alpha.com');
    await expect(page.locator('.hourly-slot.is-selected')).toHaveAttribute('data-hour', '10');

    await page.locator('.hourly-slot[data-hour="9"]').click();
    await expect(page.locator('.hourly-slot.is-selected')).toHaveAttribute('data-hour', '9');
    await expect(page.locator('#usageInsight')).toContainText('alpha.com');

    const flushCountAfterSelection = await page.evaluate(() => window.__popupFlushCount);
    await expect.poll(() => page.evaluate(() => window.__popupFlushCount), { timeout: 2500 })
        .toBeGreaterThan(flushCountAfterSelection);

    await expect(page.locator('.hourly-slot.is-selected')).toHaveAttribute('data-hour', '9');
    await expect(page.locator('#usageInsight')).toContainText('alpha.com');
});

test('hourly usage bars scale against the full daily distribution', async ({ page }) => {
    const today = dayKey();
    const hourlyUsage = Object.fromEntries(
        Array.from({ length: 13 }, (_, hour) => [
            String(hour).padStart(2, '0'),
            {
                timeMs: 60 * 60 * 1000,
                visits: 1,
                domains: { 'focus.example': 60 * 60 * 1000 }
            }
        ])
    );
    hourlyUsage['21'] = {
        timeMs: 5 * 60 * 1000,
        visits: 1,
        domains: { 'focus.example': 5 * 60 * 1000 }
    };

    await installPopupChromeMock(page, {
        statsToday: { 'focus.example': { timeMs: (13 * 60 + 5) * 60 * 1000, visits: 14 } },
        allStatsToday: { 'focus.example': { timeMs: (13 * 60 + 5) * 60 * 1000, visits: 14 } },
        hourlyUsageHistory: { [today]: hourlyUsage }
    });

    await page.goto(popupUrl());

    await expect(page.locator('.hourly-slot[data-hour="0"]')).toHaveAttribute('data-height-pct', '31');
    await expect(page.locator('.hourly-slot[data-hour="21"]')).toHaveAttribute('data-height-pct', '6');
    await expect(page.locator('.hourly-slot[data-hour="15"]')).toHaveAttribute('data-height-pct', '0');
});

test('usage graph updates when the stats date range changes', async ({ page }) => {
    const today = dayKey();
    const yesterday = dayKeyOffset(1);

    await installPopupChromeMock(page, {
        statsHistory: {
            [yesterday]: { 'old.example': { timeMs: 45 * 60 * 1000, visits: 3 } }
        },
        hourlyUsageHistory: {
            [today]: {
                '10': {
                    timeMs: 20 * 60 * 1000,
                    visits: 1,
                    domains: { 'today.example': 20 * 60 * 1000 }
                }
            },
            [yesterday]: {
                '14': {
                    timeMs: 45 * 60 * 1000,
                    visits: 3,
                    domains: { 'old.example': 45 * 60 * 1000 }
                }
            }
        }
    });

    await page.goto(popupUrl());
    await expect(page.locator('.hourly-slot.is-selected')).toHaveAttribute('data-hour', '10');
    await expect(page.locator('#usageInsight')).toContainText('today.example');

    await page.locator('#statRange').selectOption('Yesterday');
    await expect(page.locator('.hourly-slot.is-selected')).toHaveAttribute('data-hour', '14');
    await expect(page.locator('#usageInsight')).toContainText('old.example');
});

test('popup dashboard actions add limits, end pauses, and switch hourly bars', async ({ page }) => {
    await installPopupChromeMock(page);
    await page.goto(popupUrl());
    await expect(page.locator('#ranking')).toContainText('alpha.com');

    await expect(page.locator('.hourly-slot.is-selected')).toHaveAttribute('data-hour', '10');
    await page.locator('.hourly-slot[data-hour="9"]').click();
    await expect(page.locator('.hourly-slot.is-selected')).toHaveAttribute('data-hour', '9');
    await expect(page.locator('#usageInsight')).toContainText('alpha.com');

    await page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.snoozedDomains['www.alpha.com'])).toBeUndefined();
    await expect.poll(() => page.evaluate(() => (
        window.__popupMessages.some((message) => message.action === 'clearDomainSnooze' && message.domain === 'alpha.com')
    ))).toBe(true);
    await expect(page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]')).toHaveCount(0);

    const alphaRankingRow = page.locator('#ranking .row', { hasText: 'alpha.com' }).first();
    await alphaRankingRow.hover();
    await alphaRankingRow.locator('[data-action="quick-limit"][data-domain="alpha.com"]').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.blockedDomains['alpha.com']?.limitSeconds)).toBe(1800);
    await expect(page.locator('#tab1')).toBeChecked();
    await expect(page.locator('#limitList')).toContainText('alpha.com');
});

test('fresh install with no usage history does not show insights', async ({ page }) => {
    await installPopupChromeMock(page, {
        uiSettings: {
            defaultLimitMinutes: 30,
            use24HourTime: false,
            limitNotificationsEnabled: true,
            personalInsightsEnabled: true,
            insightNotificationsEnabled: true,
            insightMaxNotificationsPerDay: 1,
            insightSensitivity: 'normal'
        },
        blockedDomains: {},
        statsToday: {},
        allStatsToday: {},
        statsHistory: {},
        hourlyUsageHistory: {},
        snoozeHistory: {},
        snoozedDomains: {},
        personalInsights: [],
        dismissedInsights: {},
        activeSession: null,
        activeBlocks: [],
        scheduledBlocks: []
    });

    await page.goto(popupUrl());

    await expect.poll(() => page.evaluate(() => (
        window.__popupMessages.some((message) => message.action === 'generateInsights')
    ))).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__popupData.personalInsights?.length || 0)).toBe(0);
    await expect(page.locator('#personalInsightsCard')).toBeVisible();
    await expect(page.locator('#personalInsightsList')).toContainText("Insights aren't ready yet, check back later.");
});

test('stored insights are hidden and untracked until enough usage history exists', async ({ page }) => {
    const today = dayKey();
    await installPopupChromeMock(page, {
        statsToday: {
            'youtube.com': { timeMs: 40 * 60 * 1000, visits: 2 }
        },
        allStatsToday: {
            'youtube.com': { timeMs: 40 * 60 * 1000, visits: 2 }
        },
        statsHistory: {},
        hourlyUsageHistory: {},
        personalInsights: [
            {
                id: `long_session:youtube.com:${today}`,
                type: 'long_session',
                domain: 'youtube.com',
                title: 'YouTube is holding your attention right now',
                message: 'Active for 40 minutes straight',
                action: 'viewUsage',
                priority: 100,
                timestamp: Date.now(),
                dateKey: today,
                context: { durationMs: 40 * 60 * 1000 }
            }
        ],
        dismissedInsights: {}
    });

    await page.goto(popupUrl());

    await expect.poll(() => page.evaluate(() => window.__popupData.personalInsights?.length || 0)).toBe(0);
    await expect(page.locator('#personalInsightsCard')).toBeVisible();
    await expect(page.locator('#personalInsightsList')).toContainText("Insights aren't ready yet, check back later.");
    await expect.poll(() => page.evaluate(() => (
        window.__popupMessages.filter((message) => (
            message.action === 'trackAnalyticsEvent'
            && ['insight_presented', 'insight_viewed'].includes(message.eventName)
        )).length
    ))).toBe(0);
});

test('external upgrade and billing buttons open intended destinations', async ({ page }) => {
    await installPopupChromeMock(page, {
        blockedDomains: {
            'alpha.com': { enabled: true, limitSeconds: 60, tier: 'standard' },
            'beta.com': { enabled: true, limitSeconds: 60, tier: 'standard' },
            'gamma.com': { enabled: true, limitSeconds: 60, tier: 'standard' }
        },
        scheduledBlocks: [{
            id: 'schedule-alpha',
            domain: 'alpha.com',
            startTime: '09:00',
            endTime: '17:00',
            days: [1],
            enabled: true,
            tier: 'standard'
        }]
    });

    await page.goto(popupUrl());
    const expectedCheckoutUrl = `${WHOP_CHECKOUT_START_URL}?ext=mock-extension-id`;

    await page.locator('#upgradeBtnHeader').click();
    await page.locator('label[for="tab2"]').click();
    await expect(page.locator('#limitsPaywallCard')).toBeVisible();
    await page.locator('#upgradeBtnFromLimits').click();
    await page.locator('label[for="tab3"]').click();
    await expect(page.locator('#schedulePaywallCard')).toBeVisible();
    await page.locator('#upgradeBtnFromSchedule').click();
    await page.locator('label[for="tab4"]').click();
    await page.locator('#upgradeBtnFromProfile').click();
    await page.locator('#settingsCogBtn').click();
    await expect(page.locator('#settingsOverlay')).toHaveClass(/is-visible/);
    await page.locator('#upgradeBtnFromSettings').click();
    await page.locator('#manageWhopBtn').click();

    await expect.poll(() => page.evaluate(() => window.__popupOpenedTabs.map((tab) => tab.url))).toEqual([
        expectedCheckoutUrl,
        expectedCheckoutUrl,
        expectedCheckoutUrl,
        expectedCheckoutUrl,
        expectedCheckoutUrl,
        WHOP_MANAGE_URL
    ]);
});

test('feedback and Chrome review buttons open intended destinations', async ({ page }) => {
    await installPopupChromeMock(page);

    await page.goto(popupUrl());
    await page.evaluate(() => {
        const toast = document.getElementById('reviewPromptToast');
        toast.hidden = false;
        toast.classList.add('is-visible');
    });
    await page.locator('#giveFeedbackToastBtn').click();

    await page.evaluate(() => {
        const toast = document.getElementById('reviewPromptToast');
        toast.hidden = false;
        toast.classList.add('is-visible');
    });
    await page.locator('#leaveReviewToastBtn').click();

    await expect.poll(() => page.evaluate(() => window.__popupOpenedTabs.map((tab) => tab.url))).toEqual([
        SURVEYMONKEY_FEEDBACK_URL,
        CHROME_WEBSTORE_REVIEW_URL
    ]);
    await expect.poll(() => page.evaluate(() => Boolean(window.__popupData.reviewPromptState?.feedbackClickedAt))).toBe(true);
    await expect.poll(() => page.evaluate(() => Boolean(window.__popupData.reviewPromptState?.reviewedAt))).toBe(true);
});

test('journey card can be collapsed without using experience mode settings', async ({ page }) => {
    await installPopupChromeMock(page);

    await page.goto(popupUrl());
    await expect(page.locator('#experienceMode')).toHaveCount(0);
    await expect(page.locator('#journeyCard')).not.toHaveClass(/is-collapsed/);
    const expandedToggleBox = await page.locator('#journeyToggleBtn').boundingBox();

    await page.locator('#journeyToggleBtn').click();

    await expect(page.locator('#journeyCard')).toHaveClass(/is-collapsed/);
    await expect(page.locator('#journeyToggleBtn')).toHaveText('');
    await expect(page.locator('#journeyToggleBtn')).toHaveAttribute('aria-label', 'Show journey');
    await expect(page.locator('#journeyCollapsedTitle')).toBeVisible();
    await expect(page.locator('#journeyCollapsedTitle')).toHaveText('Journey');
    const collapsedToggleBox = await page.locator('#journeyToggleBtn').boundingBox();
    expect(collapsedToggleBox?.width).toBe(expandedToggleBox?.width);
    expect(collapsedToggleBox?.height).toBe(expandedToggleBox?.height);
    await expect.poll(() => page.evaluate(() => window.__popupData.uiSettings?.journeyCollapsed)).toBe(true);
});

test('journey percentage does not scroll when the displayed value is unchanged', async ({ page }) => {
    await installPopupChromeMock(page);

    await page.goto(popupUrl());
    await expect(page.locator('#journeyProgressPct')).toHaveAttribute('aria-label', '0%');

    await page.evaluate(() => {
        window.animateJourneyPercent(12, true);
    });
    await expect(page.locator('#journeyProgressPct')).toHaveClass(/is-scrolling/);

    await page.evaluate(() => {
        window.animateJourneyPercent(12, true);
    });
    await expect(page.locator('#journeyProgressPct')).not.toHaveClass(/is-scrolling/);
    await expect(page.locator('#journeyProgressPct')).toHaveAttribute('aria-label', '12%');
});

test('mock insight data populates real insights and insight Add Limit saves a limit', async ({ page }) => {
    await installPopupChromeMock(page, insightMockUsageData());

    await page.goto(popupUrl());

    await expect(page.locator('#personalInsightsCard')).toBeVisible();
    await expect(page.locator('#personalInsightsNav')).toContainText('1 / 3');
    await expect(page.locator('#personalInsightsList')).not.toContainText('Preview insight');

    const insightRow = page.locator('#personalInsightsList .insight-row').first();
    await expect(insightRow).toBeVisible();
    await expect(insightRow.locator('.insight-stat-headline')).toContainText(/YouTube|Reddit|LinkedIn/);
    await expect(insightRow.locator('.insight-stat-subheading')).not.toHaveText('');

    const insightDomain = await insightRow.getAttribute('data-domain');
    await insightRow.locator('[data-action="insight-add-limit"]').click();

    await expect(page.locator('#tab2')).toBeChecked();
    await expect(page.locator('#domainInput')).toHaveValue(insightDomain);
    await expect(page.locator('#limitInput')).toHaveValue('30');

    await page.locator('#limitTier').selectOption('strict');
    await page.locator('#addForm button[type="submit"]').click();

    await expect.poll(() => page.evaluate((domain) => window.__popupData.blockedDomains[domain], insightDomain))
        .toMatchObject({ enabled: true, limitSeconds: 1800, tier: 'strict' });
    await expect(page.locator('#addFormMsg')).toContainText('Limit saved.');
    await expect(page.locator('#limitList')).toContainText(insightDomain);
});

test('limit list switches and remove buttons work from visible controls', async ({ page }) => {
    await installPopupChromeMock(page, {
        blockedDomains: {
            'alpha.com': { enabled: true, limitSeconds: 60, tier: 'standard' },
            'beta.com': { enabled: true, limitSeconds: 60, tier: 'standard' }
        },
        statsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 },
            'beta.com': { timeMs: 10 * 1000, visits: 1 }
        },
        allStatsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 },
            'beta.com': { timeMs: 10 * 1000, visits: 1 }
        },
        snoozedDomains: {}
    });

    await page.goto(popupUrl());
    await page.locator('label[for="tab2"]').click();

    const alphaRow = page.locator('#limitList .row-limit').filter({ hasText: 'alpha.com' });
    await expect(alphaRow.locator('[data-action="toggle-domain"]')).not.toBeDisabled();
    await expect(alphaRow.locator('[data-action="remove-domain"]')).toBeDisabled();

    await alphaRow.locator('.switch-slider').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.blockedDomains['alpha.com']?.enabled)).toBe(false);
    await expect(alphaRow.locator('[data-action="remove-domain"]')).not.toBeDisabled();

    const betaRow = page.locator('#limitList .row-limit').filter({ hasText: 'beta.com' });
    await betaRow.locator('[data-action="remove-domain"]').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.blockedDomains['beta.com'])).toBeUndefined();
});

test('visible Limits tab usage keeps ticking for the active limited site', async ({ page }) => {
    await installPopupChromeMock(page, {
        flushMutatesStats: true,
        blockedDomains: {
            'alpha.com': { enabled: true, limitSeconds: 3600, tier: 'standard' }
        },
        statsToday: {
            'alpha.com': { timeMs: 59 * 1000, visits: 1 }
        },
        allStatsToday: {
            'alpha.com': { timeMs: 59 * 1000, visits: 1 }
        },
        snoozedDomains: {}
    });

    await page.goto(popupUrl());
    await page.locator('label[for="tab2"]').click();
    const alphaRow = page.locator('#limitList .row-limit').filter({ hasText: 'alpha.com' });
    await alphaRow.evaluate((row) => {
        row.dataset.renderIdentity = 'alpha-row';
    });
    const chip = alphaRow.locator('.limit-used-chip');
    const initialChipText = await chip.textContent();
    expect(initialChipText).toContain('Today');

    await expect.poll(() => page.evaluate(() => window.__popupData.statsToday['alpha.com']?.timeMs), { timeout: 3500 })
        .toBeGreaterThanOrEqual(62 * 1000);
    await expect.poll(async () => chip.textContent(), { timeout: 3500 }).not.toBe(initialChipText);
    await expect(chip).toContainText('Today 1m');
    await expect(alphaRow).toHaveAttribute('data-render-identity', 'alpha-row');
});

test('reset limit usage clears dashboard reached state and Limits today usage', async ({ page }) => {
    await installPopupChromeMock(page, {
        blockedDomains: {
            'alpha.com': { enabled: true, limitSeconds: 60, tier: 'standard' }
        },
        statsToday: {
            'www.alpha.com': { timeMs: 90 * 1000, visits: 3 }
        },
        allStatsToday: {
            'www.alpha.com': { timeMs: 90 * 1000, visits: 3 }
        },
        snoozedDomains: {},
        recentlyReset: {}
    });

    await page.goto(popupUrl());
    await expect(page.locator('#activeList')).toContainText('Daily limit reached');
    await page.locator('label[for="tab2"]').click();

    const alphaRow = page.locator('#limitList .row-limit').filter({ hasText: 'alpha.com' });
    await expect(alphaRow).toContainText('Today 1m 30s');
    await expect(alphaRow.locator('[data-action="remove-domain"]')).toBeDisabled();

    await page.evaluate(() => {
        chrome.storage.local.set({
            statsToday: {},
            allStatsToday: {},
            recentlyReset: { 'alpha.com': Date.now() }
        });
    });

    await expect(alphaRow).toContainText('Today 0s');
    await expect(alphaRow.locator('[data-action="remove-domain"]')).not.toBeDisabled();
    await page.locator('label[for="tab1"]').click();
    await expect(page.locator('#activeList')).not.toContainText('Daily limit reached');
});

test('limit form rejects daily limits above one day', async ({ page }) => {
    await installPopupChromeMock(page);

    await page.goto(popupUrl());
    await page.locator('label[for="tab2"]').click();
    await page.locator('#domainInput').fill('https://www.example.com/watch?v=1');
    await page.locator('#limitInput').fill('1441');
    await page.locator('#addForm button[type="submit"]').click();

    await expect(page.locator('#addFormMsg')).toContainText('Enter a daily limit from 1 to 1440 minutes.');
    await expect.poll(() => page.evaluate(() => window.__popupData.blockedDomains['example.com'])).toBeUndefined();
    await expect(page.locator('#limitList')).not.toContainText('example.com');
});

test('schedule form rejects invalid time input before saving', async ({ page }) => {
    await installPopupChromeMock(page);

    await page.goto(popupUrl());
    await page.locator('label[for="tab3"]').click();
    await page.locator('#scheduledDomain').fill('reddit.com');
    await page.locator('#startTime').fill('tomorrow');
    await page.locator('#endTime').fill('banana');
    await page.locator('#scheduledDays .day-bubble').first().click();
    await page.locator('#scheduledSubmitBtn').click();

    await expect(page.locator('#scheduledFormMsg')).toContainText('Enter valid start and end times.');
    await expect.poll(() => page.evaluate(() => (
        window.__popupMessages.some((message) => message.action === 'addScheduledBlock')
    ))).toBe(false);
});

test('active scheduled sessions become cancellable after pausing', async ({ page }) => {
    const schedule = {
        id: 'schedule-youtube',
        domain: 'youtube.com',
        startTime: '00:00',
        endTime: '23:59',
        days: [0, 1, 2, 3, 4, 5, 6],
        enabled: true,
        tier: 'standard'
    };

    await installPopupChromeMock(page, {
        scheduledBlocks: [schedule],
        activeBlocks: [{ ...schedule, startedAt: Date.now(), breakMs: 0 }]
    });

    await page.goto(popupUrl());
    await page.locator('label[for="tab3"]').click();

    const scheduleRow = page.locator('#scheduledList .row').filter({ hasText: 'youtube.com' });
    await expect(scheduleRow.locator('[data-action="remove-schedule"]')).toBeDisabled();

    await scheduleRow.locator('.switch-slider').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.scheduledBlocks[0]?.enabled)).toBe(false);
    await expect.poll(() => page.evaluate(() => window.__popupData.activeBlocks.length)).toBe(0);
    await expect(scheduleRow.locator('[data-action="remove-schedule"]')).not.toBeDisabled();

    await scheduleRow.locator('[data-action="remove-schedule"]').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.scheduledBlocks.length)).toBe(0);
});

test('schedule form starts with no days selected', async ({ page }) => {
    await installPopupChromeMock(page);

    await page.goto(popupUrl());
    await page.locator('label[for="tab3"]').click();

    await expect(page.locator('#scheduledDays .day-bubble.is-selected')).toHaveCount(0);
    await page.locator('#scheduledDays .day-bubble').first().click();
    await expect(page.locator('#scheduledDays .day-bubble.is-selected')).toHaveCount(1);
});

test('paused legacy www limit keys still allow end pause, toggle, and remove', async ({ page }) => {
    await installPopupChromeMock(page, {
        blockedDomains: {
            'www.alpha.com': { enabled: true, limitSeconds: 60, tier: 'standard' }
        },
        statsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 }
        },
        allStatsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 }
        },
        snoozedDomains: {
            'www.alpha.com': { expiresAt: Date.now() + 10 * 60 * 1000, minutes: 5 }
        }
    });

    await page.goto(popupUrl());

    await page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.snoozedDomains['www.alpha.com'])).toBeUndefined();

    await page.locator('label[for="tab2"]').click();
    const alphaRow = page.locator('#limitList .row-limit').filter({ hasText: 'www.alpha.com' });

    await alphaRow.locator('.switch-slider').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.blockedDomains['www.alpha.com']?.enabled)).toBe(false);

    await alphaRow.locator('[data-action="remove-domain"]').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.blockedDomains['www.alpha.com'])).toBeUndefined();
});

test('end pause works when the pause appears while popup is already open', async ({ page }) => {
    await installPopupChromeMock(page, {
        blockedDomains: {
            'alpha.com': { enabled: true, limitSeconds: 60, tier: 'standard' }
        },
        statsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 }
        },
        allStatsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 }
        },
        snoozedDomains: {}
    });

    await page.goto(popupUrl());
    await expect(page.locator('#activeList')).toContainText('Daily limit reached');

    await page.evaluate(() => window.chrome.storage.local.set({
        snoozedDomains: {
            'www.alpha.com': { expiresAt: Date.now() + 10 * 60 * 1000, minutes: 5 }
        }
    }));

    await expect(page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]')).toHaveCount(1);
    await page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]').click();

    await expect.poll(() => page.evaluate(() => window.__popupData.snoozedDomains['www.alpha.com'])).toBeUndefined();
    await expect(page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]')).toHaveCount(0);
    await expect(page.locator('#activeList')).toContainText('Daily limit reached');
});

test('popup normalizes www-prefixed pause entries before rendering active blocks', async ({ page }) => {
    await installPopupChromeMock(page, {
        blockedDomains: {
            'alpha.com': { enabled: true, limitSeconds: 60, tier: 'standard' }
        },
        statsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 }
        },
        allStatsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 }
        },
        snoozedDomains: {
            'www.alpha.com': { expiresAt: Date.now() + 10 * 60 * 1000, minutes: 5 }
        }
    });

    await page.goto(popupUrl());
    await expect(page.locator('#activeList')).toContainText('alpha.com');
    await expect(page.locator('#activeList')).not.toContainText('Daily limit reached');
    await expect(page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]')).toHaveCount(1);

    await page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]').click();

    await expect.poll(() => page.evaluate(() => window.__popupData.snoozedDomains['www.alpha.com'])).toBeUndefined();
    await expect(page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]')).toHaveCount(0);
    await expect(page.locator('#activeList')).toContainText('Daily limit reached');
});

test('end pause updates the popup even when background response fails', async ({ page }) => {
    await installPopupChromeMock(page, {
        failClearSnoozeMessage: true,
        blockedDomains: {
            'alpha.com': { enabled: true, limitSeconds: 60, tier: 'standard' }
        },
        statsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 }
        },
        allStatsToday: {
            'alpha.com': { timeMs: 60 * 1000, visits: 1 }
        },
        snoozedDomains: {
            'www.alpha.com': { expiresAt: Date.now() + 10 * 60 * 1000, minutes: 5 }
        }
    });

    await page.goto(popupUrl());
    await page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]').click();

    await expect.poll(() => page.evaluate(() => window.__popupData.snoozedDomains['www.alpha.com'])).toBeUndefined();
    await expect(page.locator('[data-action="clear-snooze"][data-domain="alpha.com"]')).toHaveCount(0);
});

test('popup data-action controls are represented in the delegated handler', () => {
    const popupJs = fs.readFileSync(path.join(process.cwd(), 'popup.js'), 'utf8');
    const popupHtml = fs.readFileSync(path.join(process.cwd(), 'popup.html'), 'utf8');
    const source = `${popupJs}\n${popupHtml}`;

    const actions = new Set();
    for (const match of source.matchAll(/data-action="([^"$]+)"/g)) {
        actions.add(match[1]);
    }
    for (const match of popupJs.matchAll(/actionChip\([^,]+,\s*"([^"]+)"/g)) {
        actions.add(match[1]);
    }

    const handled = new Set(Array.from(popupJs.matchAll(/action === "([^"]+)"/g), (match) => match[1]));
    const missing = Array.from(actions).filter((action) => !handled.has(action)).sort();
    expect(missing).toEqual([]);
});
