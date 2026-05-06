// Mock Chrome API for testing
const chromeMock = {
    runtime: {
        getManifest: jest.fn(() => ({
            version: '2.1.5'
        })),
        getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
        sendMessage: jest.fn(async (message) => ({ success: true })),
        onMessage: {
            addListener: jest.fn()
        },
        onStartup: { addListener: jest.fn() },
        onInstalled: { addListener: jest.fn() },
        onMessageExternal: { addListener: jest.fn() }
    },
    storage: {
        local: {
            get: jest.fn(async (keys) => {
                const result = {};
                if (Array.isArray(keys)) {
                    keys.forEach(key => {
                        result[key] = undefined;
                    });
                }
                return result;
            }),
            set: jest.fn(async (items) => {
                return items;
            }),
            remove: jest.fn(async () => true)
        }
        ,
        onChanged: { addListener: jest.fn() }
    },
    tabs: {
        query: jest.fn(async () => []),
        get: jest.fn(async () => null),
        update: jest.fn(async () => ({}))
        ,
        onActivated: { addListener: jest.fn() },
        onUpdated: { addListener: jest.fn() },
        onRemoved: { addListener: jest.fn() }
    },
    alarms: {
        create: jest.fn(),
        clear: jest.fn(),
        onAlarm: { addListener: jest.fn() }
    },
    action: {
        setBadgeText: jest.fn(async () => {}),
        setBadgeBackgroundColor: jest.fn(async () => {}),
        setBadgeTextColor: jest.fn(async () => {})
    },
    windows: {
        onFocusChanged: { addListener: jest.fn() },
        WINDOW_ID_NONE: -1
    },
    notifications: {
        create: jest.fn()
    }
};

global.chrome = chromeMock;
module.exports = chromeMock;
