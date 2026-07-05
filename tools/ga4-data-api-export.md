# GA4 Data API Export

This exports structured GA4 report data through the official GA4 Data API.

Default property and date range:

- Property: `530146524`
- Dates: `2026-06-25` to `2026-07-01`

## Auth Option A: Temporary OAuth Access Token

Set a token that has `https://www.googleapis.com/auth/analytics.readonly`, then run:

```powershell
$env:GA4_ACCESS_TOKEN = "ya29..."
npm run export:ga4 -- --property 530146524 --start 2026-06-25 --end 2026-07-01 --out ga4-data-api-export-20260625-20260701
```

## Auth Option B: Service Account

1. Create/download a service-account JSON key in Google Cloud.
2. Add the service-account email as a Viewer on the GA4 property.
3. Run:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
npm run export:ga4 -- --property 530146524 --start 2026-06-25 --end 2026-07-01 --out ga4-data-api-export-20260625-20260701
```

## Output

The exporter writes `.csv` and `.json` files for:

- Daily event counts by event name
- Funnel events by day
- Review prompt events by day
- Blocked-page events by day
- Top events
- Daily active users
- Event counts by resolved custom dimensions exposed by the property metadata

It also writes:

- `metadata.json`
- `resolved-custom-dimensions.json`
- `summary.json`
