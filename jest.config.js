module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js', '**/?(*.)+(spec|test).js'],
    collectCoverageFrom: [
        'background.js',
        'popup.js',
        'blocked.js',
        'shared-extension-utils.js',
        '!node_modules/**'
    ],
    coverageThreshold: {
        global: {
            branches: 40,
            functions: 40,
            lines: 40,
            statements: 40
        }
    },
    moduleNameMapper: {
        '^chrome\\..*': '<rootDir>/test_fixtures/chrome.js',
        '^globalThis.*': '<rootDir>/test_fixtures/globalThis.js'
    },
    setupFiles: ['<rootDir>/tests/setup.js'],
    transform: {},
    testTimeout: 10000
};
