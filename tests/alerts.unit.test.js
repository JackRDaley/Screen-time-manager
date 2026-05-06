// Unit tests for alert deduplication behavior
require('./background.unit.test.js'); // ensures background helpers and importScripts mocks are loaded
const { checkAndSendAlerts } = global;

describe('Alerts: deduplication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // reset storage mock state
    global.chrome.storage.local.data = {
      alertsSent: {},
      statsToday: {}
    };
    // wire get/set to use the in-test data bag
    global.chrome.storage.local.get = async (keys) => {
      const out = {};
      for (const k of keys) out[k] = global.chrome.storage.local.data[k];
      return out;
    };
    global.chrome.storage.local.set = async (items) => {
      Object.assign(global.chrome.storage.local.data, items);
      return items;
    };
    global.chrome.notifications.create = jest.fn();
    // prevent analytics network delays during tests
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 }));
  });

  test('creates a single 75% alert and does not duplicate', async () => {
    const domain = 'example.com';
    const blockedDomains = { [domain]: { limitSeconds: 120 } };
    const statsToday = { [domain]: { timeMs: 120 * 1000 * 0.75, visits: 1 } };
    // ensure storage mock initial state
    global.chrome.storage.local.data.statsToday = statsToday;

    await checkAndSendAlerts(domain, blockedDomains, statsToday);
    expect(global.chrome.notifications.create).toHaveBeenCalledTimes(1);

    // calling again should not create another 75% notification
    await checkAndSendAlerts(domain, blockedDomains, statsToday);
    expect(global.chrome.notifications.create).toHaveBeenCalledTimes(1);
  });
});
