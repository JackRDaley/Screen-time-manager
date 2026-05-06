const { test, expect } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');

function startServer(html) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(html);
        });

        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, url: `http://127.0.0.1:${port}/` });
        });
    });
}

async function findExtensionPath() {
    const manifestPath = path.join(process.cwd(), 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.manifest_version) {
        throw new Error('manifest.json is missing manifest_version');
    }
    return process.cwd();
}

test('snooze button redirects to original URL when clicked (standard tier)', async ({ browser }) => {
    const extensionPath = await findExtensionPath();
    const context = await browser.newContext();

    await context.addInitScript(() => {
        window.chrome = {
            runtime: {
                sendMessage: async (message) => {
                    if (message?.action === 'snoozeBlock') {
                        return { success: true, redirectUrl: message.original || 'https://example.com/' };
                    }
                    return { success: true };
                }
            },
            storage: {
                local: { get: async () => ({ activeBlocks: [] }) }
            }
        };
    });

    const html = `<!doctype html><html><body><h1>Host</h1></body></html>`;
    const server = await startServer(html);

    const page = await context.newPage();
    await page.route('https://example.com/**', async (route) => {
        await route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: '<!doctype html><html><body><h1>Original page</h1></body></html>'
        });
    });
    await page.goto(server.url);

    const blockedHtmlPath = path.join(extensionPath, 'blocked.html');
    const blockedUrl = `file:///${blockedHtmlPath.replace(/\\/g, '/')}`;
    const originalUrl = 'https://example.com/deep/watch?v=abc#focus';
    await page.goto(`${blockedUrl}?d=example.com&source=limit&tier=standard&u=${encodeURIComponent(originalUrl)}`);

    // Find Snooze 5 min button
    const snoozeBtn = page.getByRole('button', { name: /snooze 5 min/i });
    await expect(snoozeBtn).toBeVisible();
    await snoozeBtn.click();

    await expect(page).toHaveURL(originalUrl);

    await context.close();
    await new Promise((resolve) => server.server.close(resolve));
});
