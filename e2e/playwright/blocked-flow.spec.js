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

test('blocked page reset flow redirects back to the original URL', async ({ browser }) => {
    const extensionPath = await findExtensionPath();

    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 }
    });

    await context.addInitScript(() => {
        window.chrome = {
            runtime: {
                getURL: (p) => `chrome-extension://test-id/${p}`,
                sendMessage: async (message) => {
                    if (message?.action === 'resetDomainLimit') {
                        return { success: true, redirectUrl: message.original || 'https://example.com/' };
                    }
                    return { success: true };
                }
            },
            storage: {
                local: {
                    get: async () => ({ activeBlocks: [] })
                }
            }
        };
    });

    const html = `<!doctype html><html><body><h1>Extension test host</h1></body></html>`;
    const server = await startServer(html);

    const page = await context.newPage();
    await page.route('https://example.com/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: '<!doctype html><html><body><h1>Redirect target</h1></body></html>'
        });
    });
    await page.goto(server.url);
    await expect(page.locator('h1')).toHaveText('Extension test host');

    const blockedHtmlPath = path.join(extensionPath, 'blocked.html');
    const blockedUrl = `file:///${blockedHtmlPath.replace(/\\/g, '/')}`;
    const originalUrl = 'https://example.com/articles/focus?from=limit#section';
    await page.goto(`${blockedUrl}?d=example.com&source=limit&tier=lenient&u=${encodeURIComponent(originalUrl)}`);

    await expect(page.locator('#domain')).toHaveText('example.com');

    const undoButton = page.getByRole('button', { name: /undo block/i });
    await expect(undoButton).toBeVisible();
    await undoButton.click();

    await expect(page).toHaveURL(originalUrl);
    await expect(page.locator('h1')).toHaveText('Redirect target');

    await context.close();
    await new Promise((resolve) => server.server.close(resolve));
});
