# Seminar-Project
Screen time management chrome extension

## Monetization (Whop + Paywall)

This extension now supports a built-in paywall flow:

- Free tier:
	- Up to 3 limited domains
	- Up to 2 scheduled blocks
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
- `GET /whop/complete`
- `POST /whop/issue-token`
- `POST /whop/verify`

#### 1) Install and log in

```bash
cd worker
npm install
npx wrangler login
```

#### 2) Set secrets/vars

Set your Whop secret in Cloudflare:

```bash
npx wrangler secret put WHOP_API_KEY
```

Set your JWT signing secret in Cloudflare:

```bash
npx wrangler secret put JWT_SECRET
```

Set your Whop memberships config and token lifetime in `wrangler.toml` or deploy vars:

- `WHOP_VERIFY_URL`
- `WHOP_COMPANY_ID`
- `WHOP_ACTIVE_STATUSES = "active,trialing"`
- `TOKEN_TTL_DAYS = "7"`
- `WHOP_EXTENSION_ID` (optional fallback extension id for checkout callback)

For memberships mode, use:

- `WHOP_VERIFY_URL = "https://api.whop.com/api/v1/memberships"`
- `WHOP_COMPANY_ID = "biz_xxxxxxxxxxxxx"`

For local/dev fallback token, keep:

- `DEV_PREMIUM_TOKEN = "local-premium-token"`

#### 3) Deploy

```bash
npm run deploy
```

Wrangler prints your Worker URL, for example:

- `https://screen-time-manager-verify.<your-subdomain>.workers.dev`

#### 4) Issue a premium token

Call the Worker with a Whop user ID (`user_...`) or membership ID (`mem_...`):

```bash
curl -X POST https://your-worker.workers.dev/whop/issue-token \
  -H "Content-Type: application/json" \
	-d '{"token":"user_xxxxxxxxxxxxx"}'
```

Successful response:

```json
{
  "active": true,
  "planName": "Premium",
  "expiresAt": "2026-03-24T12:00:00.000Z",
  "token": "signed_jwt_here"
}
```

#### 5) Configure extension

In the extension popup, paste the returned signed `token` into **Access token / receipt** and click **Verify Premium Access**.

The extension already posts to your Worker `/whop/verify` endpoint.

### Optional: fully automatic checkout activation (no token paste)

To avoid manual token input, configure Whop to redirect after checkout to your Worker callback:

- `https://screen-time-manager.jackster0627.workers.dev/whop/complete`

Flow:

1. User starts checkout from the extension.
2. Extension appends `ext=<chrome.runtime.id>` to the checkout URL.
3. Whop redirects to `/whop/complete?token=...&ext=...`.
4. Worker callback page sends `{ action: "whopCheckoutComplete", token }` to the extension.
5. Background verifies token against `/whop/verify` and stores premium state automatically.

Notes:

- Keep `manifest.json` `externally_connectable.matches` aligned with your Worker domain.
- If your checkout provider can’t pass `ext`, set `WHOP_EXTENSION_ID` in Worker vars for your production extension ID.

#### 6) Test endpoints

- Health: `https://...workers.dev/health`
- Issue token: `POST https://...workers.dev/whop/issue-token`
- Verify token: `POST https://...workers.dev/whop/verify`

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
