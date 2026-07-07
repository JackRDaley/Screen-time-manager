# Saturn Chrome Extension

A lightweight Chrome extension that helps users stay focused by tracking time spent on specific websites and automatically blocking them once a limit is reached.

---

## Features

- Time Tracking  
  Tracks how long users spend on selected websites in real time.

- Automatic Blocking  
  Redirects the user to a custom block page when a time limit is exceeded.

- Domain-Based Control  
  Allows setting limits for individual websites (e.g., youtube.com, twitter.com).

- Usage Statistics  
  Stores daily usage data including time spent and visit counts per domain.

- Notifications  
  Alerts users when they are close to or have reached their limit.

- Custom UI  
  Includes a clean popup interface and a styled block page.

---

## Tech Stack

- JavaScript (Vanilla)
- Chrome Extensions API (Manifest V3)
- React and Vite for the public website
- Cloudflare Worker for analytics and premium handoff endpoints
- Jest and Playwright for automated checks

---

## Repository Layout

The repository is split by runtime so generated files and website code do not crowd the extension source:

```text
.
|-- manifest.json              # Chrome extension manifest
|-- background.js              # Extension service worker
|-- popup.html/css/js          # Extension popup UI
|-- blocked.html/css/js        # Extension blocked-page UI
|-- welcome.html/css/js        # Extension onboarding page
|-- assets/                    # Extension assets and icons
|-- tests/                     # Jest unit and packaging tests
|-- e2e/playwright/            # Playwright browser flows
|-- tools/                     # Local export/media utilities
|-- worker/                    # Cloudflare Worker project
`-- website/                   # React/Vite marketing website
```

Generated folders such as `test-results/`, `website/dist/`, `dashboard-exports-*`, and `ga4-data-api-export-*` are intentionally ignored. The `output/` folder is kept because it contains curated store media.

Production release zips use a rolling backlog: keep the latest three `production-*.zip` files in the repo root and scrap anything older. Run `npm run prune:production-builds` after creating a new production archive.

---

## Website

The public Saturn website lives in `website/`.

```bash
npm run website:dev
npm run website:build
npm run website:preview
```

Vercel is configured from the repository root in `vercel.json`:

- Install Command: `cd website && npm ci`
- Build Command: `cd website && npm run build`
- Output Directory: `website/dist`

Speed Insights is installed with the Vercel script tag in `website/index.html`:

```html
<script defer src="/_vercel/speed-insights/script.js"></script>
```

After importing the project, enable Speed Insights from the project dashboard so
Vercel provisions the `/_vercel/speed-insights/*` routes on the next deployment.

---

## Installation

### Option 1: Load Locally (Recommended for Development)

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/your-repo-name.git
   cd your-repo-name
   ```

2. Open Chrome and navigate to:
   ```
   chrome://extensions/
   ```

3. Enable Developer Mode:
   - Toggle the switch in the top-right corner

4. Load the extension:
   - Click "Load unpacked"
   - Select the project folder

5. The extension should now appear in your Chrome toolbar.

---

### Option 2: Install from Chrome Web Store

1. Visit the Chrome Web Store listing
2. Click "Add to Chrome"
3. Confirm installation

---

## How It Works

1. The user adds a domain and sets a time limit.
2. The extension detects the active tab and tracks time spent on that domain.
3. Once the time limit is exceeded:
   - The tab is redirected to a blocked page.
   - The blocked page can emit an anonymous analytics event for active-usage tracking.
4. Usage data resets daily.

---

## Google Analytics Tracking

Blocked-page redirects and blocked-page actions can be tracked with GA4 through the Cloudflare Worker.

- The extension sends one anonymous event per redirect to `/analytics/block-event`.
- The extension sends low-cardinality blocked-page actions to `/analytics/event`.
- The Worker forwards those events to GA4 using the Measurement Protocol.
- Analytics are sent only from the production Chrome Web Store extension ID; unpacked/internal extension IDs are skipped before they reach GA4.
- No GA secret is stored in the extension.

To enable it:

1. Create a GA4 Measurement Protocol API secret in your GA property.
2. Set the Worker measurement id as an environment variable:
  ```bash
  wrangler vars set GA4_MEASUREMENT_ID
  ```
3. Set the API secret as a Worker secret:
  ```bash
  wrangler secret put GA4_API_SECRET
  ```
4. Configure analytics extension ID gates if they differ from the defaults:
  ```bash
  wrangler vars set ANALYTICS_PRODUCTION_EXTENSION_IDS
  wrangler vars set ANALYTICS_INTERNAL_EXTENSION_IDS
  ```
5. Deploy the Worker again.

The main emitted GA4 events are:

- `blocked_page_view`
- `blocked_page_action`
- `domain_added`
- `popup_opened`
- `onboarding_started`
- `onboarding_completed`
- `onboarding_skipped`
- `first_limit_created`
- `first_schedule_created`
- `first_block_reached`
- `insight_viewed`
- `insight_add_limit_clicked`
- `upgrade_clicked`
- `post_install_redirect_shown`
- `post_install_redirect_failed`

Recommended event-scoped custom dimensions:

- `extension_version`
- `block_source` (`limit` or `scheduled`)
- `block_tier` (`lenient`, `standard`, `strict`, or `immutable`)
- `action`
- `install_reason`
- `trigger`
- `onboarding_step`
- `funnel_version`
- `error_name`

Avoid registering unique or high-cardinality values such as redirect IDs, domains, raw URLs, or client IDs as custom dimensions.

Use GA4's Active Users metric against `blocked_page_view` if you want a rough measure of how many installs are still hitting real blocks.

---

## Whop Premium Handoff

The popup opens `/whop/start` on the Cloudflare Worker instead of linking directly to Whop. The Worker receives the current `chrome.runtime.id`, creates a Whop checkout configuration when `WHOP_PLAN_ID` is set, and uses a return URL that lets the post-payment page message this exact extension install.

Required Worker values:

- `WHOP_API_KEY`
- `WHOP_COMPANY_ID`
- `WHOP_PRODUCT_ID` (`prod_...`) or `WHOP_PLAN_ID` (`plan_...`)
- `WHOP_CHECKOUT_URL` as a fallback direct checkout link
- `WHOP_EXTENSION_ID` as a production fallback for Chrome Web Store installs

If only `WHOP_PRODUCT_ID` is configured, the Worker looks up the first non-archived buy-now plan for that product before creating checkout. The Whop API key needs checkout configuration create/read permissions, plan read permission, plus the membership/payment read permissions already used by verification.


## Permissions Explained

- tabs  
  Used to detect the active tab and redirect it when necessary.

- storage  
  Stores user settings and usage data locally.

- alarms  
  Triggers periodic checks to enforce time limits.

- host_permissions  
  Allows access to URLs to determine the current domain.

- notifications  
  Notifies users when limits are reached.

---

## Key Concepts

### Domain Extraction
Extracts the hostname from a URL and normalizes it:
```
example.com
```

### Time Tracking
- Uses timestamps to calculate time spent on each domain
- Updates via tab events and background alarms

### Blocking Logic
```
if (timeSpent >= limit) {
    redirect to blocked page
}
```

---

## Known Issues / Future Improvements

- Add scheduling (daily or weekly limits)
- Improve domain management UI
- Add cross-device sync support
- Enhance notification system

---

## Contributing

Contributions are welcome. Feel free to fork the repository and submit pull requests.

---

## License

This project is licensed under the MIT License.

---

## Contact

For questions or feedback, refer to the Chrome Web Store listing or repository issues section.
