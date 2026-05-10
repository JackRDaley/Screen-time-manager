const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

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

async function installPopupChromeMock(page, overrides = {}) {
    await page.addInitScript(({ today, overrides }) => {
        const listeners = [];
        const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
        const data = {
            uiSettings: {
                defaultLimitMinutes: 30,
                use24HourTime: false,
                limitNotificationsEnabled: true
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
            snoozedDomains: {
                'www.alpha.com': { expiresAt: Date.now() + 10 * 60 * 1000, minutes: 5 }
            },
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
        window.__popupFlushCount = 0;
        window.chrome = {
            runtime: {
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
                    set: async (items) => emitStorageChanges(items)
                },
                onChanged: { addListener: (listener) => listeners.push(listener) }
            },
            tabs: { create: async () => ({}) }
        };
    }, { today: dayKey(), overrides });
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
    await expect(alphaRow.locator('[data-action="remove-domain"]')).not.toBeDisabled();

    await alphaRow.locator('.switch-slider').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.blockedDomains['alpha.com']?.enabled)).toBe(false);

    const betaRow = page.locator('#limitList .row-limit').filter({ hasText: 'beta.com' });
    await betaRow.locator('[data-action="remove-domain"]').click();
    await expect.poll(() => page.evaluate(() => window.__popupData.blockedDomains['beta.com'])).toBeUndefined();
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
