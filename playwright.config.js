const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './e2e/playwright',
    timeout: 30 * 1000,
    expect: {
        timeout: 5000
    },
    use: {
        trace: 'off',
        screenshot: 'off',
        video: 'off'
    },
    fullyParallel: false,
    workers: 1
});
