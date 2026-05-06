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

// This test simulates the math challenge path by mocking runtime messages
// that request a strict challenge token and respond to snooze requests.
test('strict math challenge can be solved and redirects back', async ({ browser }) => {
    const extensionPath = await findExtensionPath();
    const context = await browser.newContext();

    await context.addInitScript(() => {
        window.__requestedChallenge = false;
        window.chrome = {
            runtime: {
                sendMessage: async (message) => {
                    if (message?.action === 'requestStrictChallengeToken') {
                        window.__requestedChallenge = true;
                        return { success: true, challengeToken: 'token-abc' };
                    }
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
        // Force math challenge selection by making Math.random return 0 here
        Math.random = () => 0;
    });

    const html = `<!doctype html><html><body><h1>Host</h1></body></html>`;
    const server = await startServer(html);

    const page = await context.newPage();
    await page.route('https://example.com/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Redirect target</h1>' });
    });

    await page.goto(server.url);

    const blockedHtmlPath = path.join(extensionPath, 'blocked.html');
    const blockedUrl = `file:///${blockedHtmlPath.replace(/\\/g, '/')}`;
    const originalUrl = 'https://example.com/strict/path?step=challenge#done';
    await page.goto(`${blockedUrl}?d=example.com&source=limit&tier=strict&u=${encodeURIComponent(originalUrl)}`);

    // Wait for math problem to appear
    const problem = await page.locator('#mathProblem').innerText({ timeout: 5000 });
    const match = problem.match(/(\d+) \+ (\d+) = \?/);
    if (!match) throw new Error('Math problem not found');
    const a = Number(match[1]);
    const b = Number(match[2]);
    const expected = a + b;

    await page.fill('#mathAnswer', String(expected));
    await page.click('#mathSubmitBtn');

    await expect(page).toHaveURL(originalUrl);
    await expect(page.locator('h1')).toHaveText('Redirect target');

    await context.close();
    await new Promise((resolve) => server.server.close(resolve));
});
