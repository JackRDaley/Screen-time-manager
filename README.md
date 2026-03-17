# Seminar-Project
Screen time management chrome extension

## Monetization (Whop + Paywall)

This extension now supports a built-in paywall flow:

- Free tier:
	- Up to 3 limited domains
	- Scheduling locked
- Premium tier:
	- Unlimited limits
	- Scheduling enabled

### How it works

1. In **Settings → Whop Billing**, set:
	 - **Checkout URL**: your Whop checkout link
	 - **Verify API URL**: your backend endpoint that verifies Whop entitlement
	 - **Access token / receipt**: token returned by your purchase/login flow
2. User clicks **Open Whop Checkout** to purchase.
3. User clicks **Verify Premium Access**.
4. Extension calls your verify endpoint and stores premium status in local storage.

### Important security note

Do **not** call Whop secret APIs directly from the extension.
Put Whop SDK/API secret usage on your own server, then return a minimal response to the extension.

Expected verify endpoint response:

```json
{
	"active": true,
	"planName": "Pro",
	"expiresAt": "2026-12-31T23:59:59.000Z"
}
```

Expected request body from extension:

```json
{
	"token": "user_token_or_receipt",
	"extension": "screen-time-manager"
}
```

If `active` is `true`, premium unlocks immediately in the popup.

### Cloudflare Worker backend setup (recommended)

This repo now includes a Worker backend in `worker/` with:

- `GET /health`
- `POST /whop/verify`

#### 1) Install and log in

```bash
cd worker
npm install
npx wrangler login
```

#### 2) Set secrets/vars

Set your Whop secret in Cloudflare (secret):

```bash
npx wrangler secret put WHOP_API_KEY
```

Set your Whop verify URL (plain var):

```bash
npx wrangler deploy --var WHOP_VERIFY_URL:https://your-whop-verify-endpoint
```

For local/dev fallback token, edit `worker/wrangler.toml`:

- `DEV_PREMIUM_TOKEN = "local-premium-token"`

#### 3) Deploy

```bash
npm run deploy
```

Wrangler prints your Worker URL, for example:

- `https://screen-time-manager-verify.<your-subdomain>.workers.dev`

#### 4) Configure extension

In **Settings → Whop Billing**:

- Verify API URL: `https://...workers.dev/whop/verify`
- Access token / receipt: `local-premium-token` (dev fallback) or your real token

#### 5) Test endpoints

- Health: `https://...workers.dev/health`
- Verify: POST to `https://...workers.dev/whop/verify`

### What to commit (important)

Commit these:

- `worker/package.json`
- `worker/wrangler.toml`
- `worker/src/index.js`
- `.gitignore`

Do **not** commit:

- `node_modules/`
- `server/node_modules/`
- `worker/node_modules/`
- `server/.env`
- `worker/.dev.vars`

If you fully migrate to Workers, you can keep `server/` for local fallback or remove it later.

## UI Overhaul Smoke Checklist

- Open popup and verify all tabs render: Dashboard, Limits, Schedule, Settings.
- Add limit with explicit minutes and with blank minutes (should use default from Settings).
- Toggle 24-hour mode, save settings, close/reopen popup, and confirm preference persists.
- Create scheduled blocks in both formats:
	- 12-hour mode: 9:00 AM to 5:00 PM
	- 24-hour mode: 09:00 to 17:00
- Verify ranking cards show 3 rows with no clipping and dedicated progress line under each row.
- Verify block-list rows show progress only when a valid limit exists; rows without limit show no progress bar.
- Keep popup open for 30+ seconds while an active block runs and confirm countdown updates each second.
- Make a change in another popup tab action (add/remove/reset) and confirm UI updates without manual refresh.
