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
