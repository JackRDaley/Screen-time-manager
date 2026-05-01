// Test setup - runs before all tests
require('../test_fixtures/chrome.js');
require('../test_fixtures/globalThis.js');

// Mock console methods for cleaner test output
global.console = {
    ...console,
    error: jest.fn((...args) => {}),
    warn: jest.fn((...args) => {}),
    info: jest.fn((...args) => {}),
    debug: jest.fn((...args) => {}),
    log: jest.fn((...args) => {})
};

// Set up default environment
process.env.NODE_ENV = 'test';
