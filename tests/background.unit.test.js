const path = require('path');

// Provide a minimal importScripts implementation so background.js can load helper scripts in Node tests
global.importScripts = (scriptPath) => {
  try {
    // resolve relative to project root
    const full = path.join(process.cwd(), scriptPath);
    require(full);
  } catch (e) {
    // ignore if file doesn't load in test env
  }
};

// Require the background script so it registers test helpers on global
require('../background.js');
const {
  createResetToken,
  verifyResetToken,
  resetDomainUsage,
  clearDomainSnooze,
  enforceIfNeeded,
  flushActiveTimeNow,
  flushTime,
  setActiveDomain,
  syncActionBadge,
  redirectUrlForDomain,
  isScheduleActive,
  nextScheduleTime
} = global;

describe('Background helper functions (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createResetToken and verifyResetToken behave as one-time tokens', async () => {
    const token = await createResetToken('example.com');
    expect(typeof token).toBe('string');

    const ok = await verifyResetToken(token, 'example.com');
    expect(ok).toBe(true);

    const again = await verifyResetToken(token, 'example.com');
    expect(again).toBe(false);
  });

  test('resetDomainUsage clears stats and sets recentlyReset timestamp', async () => {
    // Prepare a simple in-memory storage mock
    const storage = {
      data: {
        statsToday: { 'example.com': { timeMs: 60000, visits: 1 } },
        allStatsToday: { 'example.com': { timeMs: 60000, visits: 1 } },
        alertsSent: { 'example.com': { '75': true } }
      },
      async get(keys) {
        const out = {};
        for (const k of keys) {
          out[k] = this.data[k];
        }
        return out;
      },
      async set(items) {
        Object.assign(this.data, items);
        return items;
      }
    };

    // Patch global chrome.storage.local used by background.js
    const origStorage = global.chrome.storage.local;
    global.chrome.storage.local = storage;

    // Call resetDomainUsage (exposed on global)
    const res = await resetDomainUsage('example.com');
    expect(res).toBe(true);

    // After reset, stats should no longer have example.com
    expect(storage.data.statsToday['example.com']).toBeUndefined();

    // recentlyReset should be set to a timestamp (>0)
    expect(typeof storage.data.recentlyReset).toBe('object');
    expect(typeof storage.data.recentlyReset['example.com']).toBe('number');
    expect(storage.data.recentlyReset['example.com']).toBeGreaterThan(0);

    // restore original storage mock
    global.chrome.storage.local = origStorage;
  });

  test('clearDomainSnooze removes snooze and immediately redirects over-limit tabs', async () => {
    const storage = {
      data: {
        snoozedDomains: { 'www.example.com': { expiresAt: Date.now() + 300000, minutes: 5 } },
        activeBlocks: [],
        blockedDomains: { 'example.com': { enabled: true, limitSeconds: 60, tier: 'standard' } },
        statsToday: { 'example.com': { timeMs: 60000, visits: 1 } },
        recentlyReset: {}
      },
      async get(keys) {
        const out = {};
        for (const k of keys) out[k] = this.data[k];
        return out;
      },
      async set(items) {
        Object.assign(this.data, items);
        return items;
      }
    };

    const origStorage = global.chrome.storage.local;
    const origQuery = global.chrome.tabs.query;
    const origUpdate = global.chrome.tabs.update;
    const origClear = global.chrome.alarms.clear;

    global.chrome.storage.local = storage;
    global.chrome.tabs.query = jest.fn(async () => [{ id: 7, url: 'https://example.com/watch' }]);
    global.chrome.tabs.update = jest.fn(async () => ({}));
    global.chrome.alarms.clear = jest.fn(async () => true);

    const enforced = await clearDomainSnooze('example.com');

    expect(enforced).toBe(true);
    expect(storage.data.snoozedDomains['www.example.com']).toBeUndefined();
    expect(global.chrome.tabs.update).toHaveBeenCalledWith(7, expect.objectContaining({
      url: expect.stringContaining('blocked.html?')
    }));
    expect(global.chrome.tabs.update.mock.calls[0][1].url).toContain('source=limit');

    global.chrome.storage.local = origStorage;
    global.chrome.tabs.query = origQuery;
    global.chrome.tabs.update = origUpdate;
    global.chrome.alarms.clear = origClear;
  });

  test('enforceIfNeeded honors www-prefixed snooze entries', async () => {
    const storage = {
      data: {
        snoozedDomains: { 'www.example.com': { expiresAt: Date.now() + 300000, minutes: 5 } },
        activeBlocks: [],
        blockedDomains: { 'example.com': { enabled: true, limitSeconds: 60, tier: 'standard' } },
        statsToday: { 'example.com': { timeMs: 60000, visits: 1 } },
        recentlyReset: {}
      },
      async get(keys) {
        const out = {};
        for (const k of keys) out[k] = this.data[k];
        return out;
      },
      async set(items) {
        Object.assign(this.data, items);
        return items;
      }
    };

    const origStorage = global.chrome.storage.local;
    const origGet = global.chrome.tabs.get;
    const origUpdate = global.chrome.tabs.update;

    global.chrome.storage.local = storage;
    global.chrome.tabs.get = jest.fn(async () => ({ id: 7, url: 'https://example.com/watch' }));
    global.chrome.tabs.update = jest.fn(async () => ({}));

    const enforced = await enforceIfNeeded(7);

    expect(enforced).toBe(false);
    expect(global.chrome.tabs.update).not.toHaveBeenCalled();

    global.chrome.storage.local = origStorage;
    global.chrome.tabs.get = origGet;
    global.chrome.tabs.update = origUpdate;
  });

  test('syncActionBadge shows pause indicator for snoozed active domains', async () => {
    const storage = {
      data: {
        snoozedDomains: { 'www.example.com': { expiresAt: Date.now() + 300000, minutes: 5 } },
        activeBlocks: [],
        blockedDomains: { 'example.com': { enabled: true, limitSeconds: 60, tier: 'standard' } },
        statsToday: { 'example.com': { timeMs: 60000, visits: 1 } },
        recentlyReset: {}
      },
      async get(keys) {
        const out = {};
        for (const k of keys) out[k] = this.data[k];
        return out;
      },
      async set(items) {
        Object.assign(this.data, items);
        return items;
      }
    };

    const origStorage = global.chrome.storage.local;
    const origGet = global.chrome.tabs.get;
    const origUpdate = global.chrome.tabs.update;
    const origSetBadgeText = global.chrome.action.setBadgeText;
    const origSetBadgeBackgroundColor = global.chrome.action.setBadgeBackgroundColor;

    global.chrome.storage.local = storage;
    global.chrome.tabs.get = jest.fn(async () => ({ id: 7, url: 'https://example.com/watch' }));
    global.chrome.tabs.update = jest.fn(async () => ({}));
    global.chrome.action.setBadgeText = jest.fn(async () => {});
    global.chrome.action.setBadgeBackgroundColor = jest.fn(async () => {});

    await setActiveDomain(7, false);
    await syncActionBadge();

    expect(global.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: 'II' });
    expect(global.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#6b7280' });
    expect(global.chrome.tabs.update).not.toHaveBeenCalled();

    global.chrome.storage.local = origStorage;
    global.chrome.tabs.get = origGet;
    global.chrome.tabs.update = origUpdate;
    global.chrome.action.setBadgeText = origSetBadgeText;
    global.chrome.action.setBadgeBackgroundColor = origSetBadgeBackgroundColor;
  });

  test('syncActionBadge rehydrates the active tab after service worker sleep', async () => {
    const storage = {
      data: {
        snoozedDomains: {},
        blockedDomains: { 'example.com': { enabled: true, limitSeconds: 120, tier: 'standard' } },
        statsToday: { 'example.com': { timeMs: 60000, visits: 1 } },
        recentlyReset: {}
      },
      async get(keys) {
        const out = {};
        for (const k of keys) out[k] = this.data[k];
        return out;
      },
      async set(items) {
        Object.assign(this.data, items);
        return items;
      }
    };

    const origStorage = global.chrome.storage.local;
    const origQuery = global.chrome.tabs.query;
    const origGet = global.chrome.tabs.get;
    const origUpdate = global.chrome.tabs.update;
    const origSetBadgeText = global.chrome.action.setBadgeText;
    const origSetBadgeBackgroundColor = global.chrome.action.setBadgeBackgroundColor;

    global.chrome.storage.local = storage;
    global.chrome.tabs.query = jest.fn(async () => [{ id: 11, url: 'https://example.com/dashboard' }]);
    global.chrome.tabs.get = jest.fn(async () => ({ id: 11, url: 'https://example.com/dashboard' }));
    global.chrome.tabs.update = jest.fn(async () => ({}));
    global.chrome.action.setBadgeText = jest.fn(async () => {});
    global.chrome.action.setBadgeBackgroundColor = jest.fn(async () => {});

    await setActiveDomain(null, false);
    global.chrome.action.setBadgeText.mockClear();
    global.chrome.action.setBadgeBackgroundColor.mockClear();

    await syncActionBadge();

    expect(global.chrome.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(global.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '50%' });
    expect(global.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#2563eb' });
    expect(global.chrome.tabs.update).not.toHaveBeenCalled();

    global.chrome.storage.local = origStorage;
    global.chrome.tabs.query = origQuery;
    global.chrome.tabs.get = origGet;
    global.chrome.tabs.update = origUpdate;
    global.chrome.action.setBadgeText = origSetBadgeText;
    global.chrome.action.setBadgeBackgroundColor = origSetBadgeBackgroundColor;
  });

  test('flushTime restores a persisted active session after service worker sleep', async () => {
    const startedAt = Date.now() - 60000;
    const storage = {
      data: {
        activeSession: { tabId: 13, domain: 'example.com', startedAt },
        statsToday: {},
        allStatsToday: {},
        hourlyUsageHistory: {},
        blockedDomains: {},
        alertsSent: {},
        uiSettings: { limitNotificationsEnabled: true }
      },
      async get(keys) {
        const out = {};
        for (const k of keys) out[k] = this.data[k];
        return out;
      },
      async set(items) {
        Object.assign(this.data, items);
        return items;
      }
    };

    const origStorage = global.chrome.storage.local;
    global.chrome.storage.local = storage;

    await setActiveDomain(null, false);
    storage.data.activeSession = { tabId: 13, domain: 'example.com', startedAt };

    await flushTime();

    expect(storage.data.statsToday['example.com'].timeMs).toBeGreaterThanOrEqual(59000);
    expect(storage.data.allStatsToday['example.com'].timeMs).toBeGreaterThanOrEqual(59000);
    expect(storage.data.activeSession.domain).toBe('example.com');
    expect(storage.data.activeSession.startedAt).toBeGreaterThan(startedAt);

    global.chrome.storage.local = origStorage;
  });

  test('flushActiveTimeNow refreshes the current tab before updating stats and badge', async () => {
    await setActiveDomain(null, false);

    const startedAt = 1700000000000;
    const storage = {
      data: {
        statsToday: {},
        allStatsToday: {},
        hourlyUsageHistory: {},
        blockedDomains: {
          'example.com': { enabled: true, limitSeconds: 60, tier: 'standard' },
          'news.com': { enabled: true, limitSeconds: 60, tier: 'standard' }
        },
        snoozedDomains: {},
        alertsSent: {},
        uiSettings: { limitNotificationsEnabled: true }
      },
      async get(keys) {
        const out = {};
        for (const k of keys) out[k] = this.data[k];
        return out;
      },
      async set(items) {
        Object.assign(this.data, items);
        return items;
      }
    };

    const origStorage = global.chrome.storage.local;
    const origQuery = global.chrome.tabs.query;
    const origGet = global.chrome.tabs.get;
    const origUpdate = global.chrome.tabs.update;
    const origSetBadgeText = global.chrome.action.setBadgeText;
    const origSetBadgeBackgroundColor = global.chrome.action.setBadgeBackgroundColor;
    const dateNowSpy = jest.spyOn(Date, 'now');

    global.chrome.storage.local = storage;
    global.chrome.tabs.query = jest.fn(async () => [{ id: 14, url: 'https://news.com/home' }]);
    global.chrome.tabs.get = jest.fn(async (tabId) => ({
      id: tabId,
      url: tabId === 13 ? 'https://example.com/start' : 'https://news.com/home'
    }));
    global.chrome.tabs.update = jest.fn(async () => ({}));
    global.chrome.action.setBadgeText = jest.fn(async () => {});
    global.chrome.action.setBadgeBackgroundColor = jest.fn(async () => {});

    dateNowSpy.mockReturnValue(startedAt);
    await setActiveDomain(13, false);

    dateNowSpy.mockReturnValue(startedAt + 30000);
    await flushActiveTimeNow();

    expect(storage.data.statsToday['example.com'].timeMs).toBeGreaterThanOrEqual(30000);
    expect(storage.data.activeSession.domain).toBe('news.com');
    expect(global.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '0%' });

    dateNowSpy.mockRestore();
    global.chrome.storage.local = origStorage;
    global.chrome.tabs.query = origQuery;
    global.chrome.tabs.get = origGet;
    global.chrome.tabs.update = origUpdate;
    global.chrome.action.setBadgeText = origSetBadgeText;
    global.chrome.action.setBadgeBackgroundColor = origSetBadgeBackgroundColor;
  });

  test('redirectUrlForDomain preserves safe same-domain request originals', () => {
    expect(redirectUrlForDomain('example.com', {
      original: 'https://www.example.com/watch?v=1#focus'
    })).toBe('https://www.example.com/watch?v=1#focus');
  });

  test('redirectUrlForDomain reads safe originals from blocked page URLs', () => {
    const original = 'https://example.com/deep/path?x=1#section';
    const sender = {
      tab: {
        url: global.chrome.runtime.getURL(`blocked.html?d=example.com&u=${encodeURIComponent(original)}`)
      }
    };

    expect(redirectUrlForDomain('example.com', {}, sender)).toBe(original);
  });

  test('redirectUrlForDomain rejects cross-domain originals', () => {
    expect(redirectUrlForDomain('example.com', {
      original: 'https://evil.example.net/phish'
    })).toBe('https://example.com/');
  });

  test('redirectUrlForDomain rejects non-web and malformed originals', () => {
    const unsafeOriginals = [
      'javascript:alert(1)',
      'data:text/html,<h1>oops</h1>',
      'file:///C:/Users/Jack/secret.txt',
      '/local/path',
      'not a url'
    ];

    for (const original of unsafeOriginals) {
      expect(redirectUrlForDomain('example.com', { original })).toBe('https://example.com/');
    }
  });

  test('redirectUrlForDomain prefers safe request original over sender blocked URL', () => {
    const senderOriginal = 'https://example.com/from-sender';
    const requestOriginal = 'https://example.com/from-request?x=1';
    const sender = {
      tab: {
        url: global.chrome.runtime.getURL(`blocked.html?d=example.com&u=${encodeURIComponent(senderOriginal)}`)
      }
    };

    expect(redirectUrlForDomain('example.com', { original: requestOriginal }, sender)).toBe(requestOriginal);
  });

  test('overnight scheduled blocks stay active after midnight', () => {
    const block = {
      domain: 'example.com',
      startTime: '22:00',
      endTime: '02:00',
      days: [1],
      enabled: true
    };

    expect(isScheduleActive(block, new Date(2024, 0, 1, 23, 0).getTime())).toBe(true);
    expect(isScheduleActive(block, new Date(2024, 0, 2, 1, 0).getTime())).toBe(true);
    expect(isScheduleActive(block, new Date(2024, 0, 2, 3, 0).getTime())).toBe(false);
  });

  test('nextScheduleTime returns the current overnight end after restart', () => {
    const block = {
      domain: 'example.com',
      startTime: '22:00',
      endTime: '02:00',
      days: [1],
      enabled: true
    };
    const from = new Date(2024, 0, 2, 1, 0).getTime();
    const nextEnd = new Date(nextScheduleTime(block, 'end', from));

    expect(nextEnd.getFullYear()).toBe(2024);
    expect(nextEnd.getMonth()).toBe(0);
    expect(nextEnd.getDate()).toBe(2);
    expect(nextEnd.getHours()).toBe(2);
    expect(nextEnd.getMinutes()).toBe(0);
  });
});
