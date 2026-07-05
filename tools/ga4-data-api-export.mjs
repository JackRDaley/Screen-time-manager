import { createSign } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const API_ROOT = "https://analyticsdata.googleapis.com/v1beta";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

const propertyId = getArg("--property", process.env.GA4_PROPERTY_ID || "530146524");
const startDate = getArg("--start", process.env.GA4_START_DATE || "2026-06-25");
const endDate = getArg("--end", process.env.GA4_END_DATE || "2026-07-01");
const outDir = resolve(getArg("--out", `ga4-data-api-export-${startDate}_to_${endDate}`));
let accessToken;

const eventGroups = {
  funnel: [
    "popup_opened",
    "onboarding_started",
    "onboarding_completed",
    "onboarding_skipped",
    "first_limit_created",
    "first_schedule_created",
    "first_block_reached",
    "insight_viewed",
    "insight_add_limit_clicked",
    "upgrade_clicked",
  ],
  review: ["review_prompt_shown", "review_prompt_action"],
  blockedPage: ["blocked_page_view", "blocked_page_action"],
};

const wantedCustomDimensionDisplayNames = [
  "Activity Day Key",
  "Activity Week Key",
  "Trigger",
  "Action",
  "Block Source",
  "Block Tier",
  "Error Name",
  "Extension Version",
  "Install Reason",
  "Stream name",
];

main().catch((error) => {
  console.error(`GA4 export failed: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  await mkdir(outDir, { recursive: true });
  accessToken = await getAccessToken();

  const metadata = await gaFetch(`/properties/${propertyId}/metadata`, { method: "GET" });
  await writeJson("metadata.json", metadata);

  const dimensions = new Map((metadata.dimensions || []).map((dimension) => [dimension.apiName, dimension]));
  const metrics = new Map((metadata.metrics || []).map((metric) => [metric.apiName, metric]));

  const customDimensions = wantedCustomDimensionDisplayNames
    .map((displayName) => findDimensionByDisplayName(metadata.dimensions || [], displayName))
    .filter(Boolean);

  const customByDisplayName = Object.fromEntries(
    customDimensions.map((dimension) => [dimension.uiName || dimension.customDefinition || dimension.apiName, dimension.apiName]),
  );
  await writeJson("resolved-custom-dimensions.json", customByDisplayName);

  const reports = [
    {
      name: "daily-event-count-by-event",
      dimensions: ["date", "eventName"],
      metrics: ["eventCount", "activeUsers", "sessions", "keyEvents"],
      orderBys: [{ dimension: { dimensionName: "date" } }, { metric: { metricName: "eventCount" }, desc: true }],
    },
    {
      name: "funnel-events-by-day",
      dimensions: ["date", "eventName"],
      metrics: ["eventCount", "activeUsers", "sessions", "keyEvents"],
      dimensionFilter: inListFilter("eventName", eventGroups.funnel),
      orderBys: [{ dimension: { dimensionName: "date" } }, { metric: { metricName: "eventCount" }, desc: true }],
    },
    {
      name: "review-events-by-day",
      dimensions: ["date", "eventName"],
      metrics: ["eventCount", "activeUsers"],
      dimensionFilter: inListFilter("eventName", eventGroups.review),
      orderBys: [{ dimension: { dimensionName: "date" } }],
    },
    {
      name: "blocked-page-events-by-day",
      dimensions: ["date", "eventName"],
      metrics: ["eventCount", "activeUsers"],
      dimensionFilter: inListFilter("eventName", eventGroups.blockedPage),
      orderBys: [{ dimension: { dimensionName: "date" } }, { metric: { metricName: "eventCount" }, desc: true }],
    },
    {
      name: "top-events",
      dimensions: ["eventName"],
      metrics: ["eventCount", "activeUsers"],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    },
    {
      name: "daily-active-users",
      dimensions: ["date"],
      metrics: ["activeUsers", "sessions", "eventCount", "keyEvents"],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    },
  ];

  for (const dimension of customDimensions) {
    reports.push({
      name: safeName(`event-count-by-${dimension.uiName || dimension.customDefinition || dimension.apiName}`),
      dimensions: [dimension.apiName, "eventName"],
      metrics: ["eventCount", "activeUsers"],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    });
  }

  const summaries = [];
  for (const report of reports) {
    const runnableReport = filterUnavailable(report, dimensions, metrics);
    if (runnableReport.dimensions.length === 0 || runnableReport.metrics.length === 0) {
      summaries.push({ name: report.name, skipped: true, reason: "No available dimensions or metrics after metadata filtering." });
      continue;
    }

    const response = await runReport(runnableReport);
    const rows = normalizeRows(response);
    await writeJson(`${report.name}.json`, { request: runnableReport, response });
    await writeFile(join(outDir, `${report.name}.csv`), toCsv(rows));
    summaries.push({
      name: report.name,
      rowCount: rows.length,
      dimensions: runnableReport.dimensions,
      metrics: runnableReport.metrics,
    });
  }

  await writeJson("summary.json", {
    propertyId,
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    outDir,
    reports: summaries,
  });

  await writeFile(
    join(outDir, "README.md"),
    [
      "# GA4 Data API Export",
      "",
      `Property: ${propertyId}`,
      `Date range: ${startDate} to ${endDate}`,
      "",
      "Each report is exported as both `.json` and `.csv`.",
      "`metadata.json` contains the GA4 Data API dimensions/metrics exposed by this property.",
      "`resolved-custom-dimensions.json` maps the custom dimension display names from the GA UI to API names.",
      "",
      "Suggested ChatGPT prompt:",
      "",
      "Analyze these GA4 Data API exports for product usage trends, activation/funnel health, blocked-page engagement, review prompt behavior, and instrumentation gaps. Cite the CSV/JSON files used for each finding.",
      "",
    ].join("\n"),
  );

  console.log(`Wrote GA4 Data API export to ${outDir}`);
}

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

async function getAccessToken() {
  if (process.env.GA4_ACCESS_TOKEN) return process.env.GA4_ACCESS_TOKEN;

  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || defaultAdcPath();
  if (!adcPath) {
    throw new Error("Set GA4_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS before running this exporter.");
  }
  if (!(await fileExists(adcPath))) {
    throw new Error(
      `No Google credential found at ${adcPath}. Set GA4_ACCESS_TOKEN, or set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON file with GA4 Viewer access.`,
    );
  }

  const credentials = JSON.parse(await readFile(adcPath, "utf8"));
  if (credentials.type === "service_account") return serviceAccountAccessToken(credentials);
  if (credentials.type === "authorized_user") return refreshTokenAccessToken(credentials);

  throw new Error(`Unsupported credential type in ${basename(adcPath)}: ${credentials.type || "unknown"}`);
}

function defaultAdcPath() {
  const appData = process.env.APPDATA;
  return appData ? join(appData, "gcloud", "application_default_credentials.json") : null;
}

async function serviceAccountAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(credentials.private_key, "base64url");
  const assertion = `${unsigned}.${signature}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const token = await postToken(body);
  return token.access_token;
}

async function refreshTokenAccessToken(credentials) {
  const body = new URLSearchParams({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    refresh_token: credentials.refresh_token,
    grant_type: "refresh_token",
  });
  const token = await postToken(body);
  return token.access_token;
}

async function postToken(body) {
  const response = await fetch(TOKEN_URL, { method: "POST", body });
  const payload = await response.json();
  if (!response.ok) throw new Error(`OAuth token request failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

async function gaFetch(pathname, options = {}) {
  const response = await fetch(`${API_ROOT}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`GA4 API request failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

async function runReport(report) {
  return gaFetch(`/properties/${propertyId}:runReport`, {
    method: "POST",
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: report.dimensions.map((name) => ({ name })),
      metrics: report.metrics.map((name) => ({ name })),
      dimensionFilter: report.dimensionFilter,
      orderBys: report.orderBys,
      limit: "100000",
      keepEmptyRows: false,
      returnPropertyQuota: true,
    }),
  });
}

function normalizeRows(response) {
  const dimensionHeaders = (response.dimensionHeaders || []).map((header) => header.name);
  const metricHeaders = (response.metricHeaders || []).map((header) => header.name);
  return (response.rows || []).map((row) => {
    const record = {};
    dimensionHeaders.forEach((name, index) => {
      record[name] = row.dimensionValues?.[index]?.value ?? "";
    });
    metricHeaders.forEach((name, index) => {
      record[name] = row.metricValues?.[index]?.value ?? "";
    });
    return record;
  });
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvValue(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeJson(filename, value) {
  return writeFile(join(outDir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

function findDimensionByDisplayName(allDimensions, displayName) {
  const normalized = normalize(displayName);
  return allDimensions.find((dimension) => {
    return [dimension.uiName, dimension.customDefinition, dimension.description, dimension.apiName]
      .filter(Boolean)
      .some((value) => normalize(value).includes(normalized));
  });
}

function filterUnavailable(report, dimensionMap, metricMap) {
  return {
    ...report,
    dimensions: report.dimensions.filter((name) => dimensionMap.has(name)),
    metrics: report.metrics.filter((name) => metricMap.has(name)),
  };
}

function inListFilter(fieldName, values) {
  return {
    filter: {
      fieldName,
      inListFilter: {
        values,
        caseSensitive: true,
      },
    },
  };
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function fileExists(pathname) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}
