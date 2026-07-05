function createElementStub() {
  return {
    children: [],
    className: '',
    dataset: {},
    disabled: false,
    hidden: false,
    innerHTML: '',
    style: {},
    textContent: '',
    type: '',
    value: '',
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener: jest.fn(),
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      toggle: jest.fn()
    }
  };
}

function installBlockedPageEnvironment(search) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElementStub());
    return elements.get(id);
  };

  const storage = {
    data: {},
    async get(keys, callback) {
      const out = {};
      for (const key of keys) out[key] = this.data[key];
      if (typeof callback === 'function') callback(out);
      return out;
    },
    async set(items) {
      Object.assign(this.data, items);
      return items;
    }
  };

  global.document = {
    referrer: '',
    createElement: jest.fn(() => createElementStub()),
    getElementById: jest.fn(getElement)
  };
  global.location = { search, href: `chrome-extension://test-id/blocked.html${search}` };
  global.window = { location: global.location };
  global.sessionStorage = {
    values: new Map(),
    getItem(key) {
      return this.values.get(key) || null;
    },
    setItem(key, value) {
      this.values.set(key, String(value));
    }
  };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
  global.StmSharedUtils = {
    getDayKey: jest.fn(() => '2026-06-16'),
    getOrCreateAnalyticsClientId: jest.fn(async () => 'client-1')
  };
  global.chrome.storage.local = storage;
  global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));
  global.chrome.tabs.query = jest.fn(async () => []);
  global.chrome.tabs.remove = jest.fn(async () => {});

  return { storage };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

describe('blocked page reclaim stats', () => {
  afterEach(() => {
    jest.resetModules();
  });

  test('scheduled block page views do not add the legacy per-view reclaimed time', async () => {
    const { storage } = installBlockedPageEnvironment('?d=focus.com&source=scheduled&tier=standard&eid=scheduled-1');

    require('../blocked.js');
    await flushAsyncWork();

    expect(storage.data.saturnBlockReclaimStats).toBeUndefined();
  });
});
