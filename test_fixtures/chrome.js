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
        }
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
            })
        }
    },
    tabs: {
        query: jest.fn(async () => []),
        get: jest.fn(async () => null),
        update: jest.fn(async () => ({}))
    },
    alarms: {
        create: jest.fn(),
        clear: jest.fn()
    },
    action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setBadgeTextColor: jest.fn()
    },
    notifications: {
        create: jest.fn()
    }
};

global.chrome = chromeMock;
module.exports = chromeMock;
