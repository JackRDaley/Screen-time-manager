import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { chromium } from "@playwright/test";

const root = process.cwd();
const outRoot = path.join(root, "output", "store-media");
const captureOut = path.join(outRoot, "captures");
const chromeOut = path.join(outRoot, "chrome-web-store");
const whopOut = path.join(outRoot, "whop");

const brand = {
  bg: "#120a08",
  bg2: "#1b0f0d",
  ember: "#2a1712",
  burn: "#d46a44",
  orange: "#ff8a61",
  gold: "#ffb18a",
  cream: "#fff8ee",
  text: "#f7e7d6",
  muted: "#cbb7a6",
  cyan: "#8fd2d8",
  green: "#9db35c",
  slogan: "Your time. Your universe.",
};

const assets = {
  icon: path.join(root, "assets", "planets", "saturn-app-icon-128.png"),
  saturn: path.join(root, "assets", "planets", "saturn.png"),
  rocket: path.join(root, "assets", "planets", "rocket-cutout.png"),
};

const captures = {
  dashboard: path.join(captureOut, "saturn-live-dashboard.png"),
  limits: path.join(captureOut, "saturn-live-limits.png"),
  schedule: path.join(captureOut, "saturn-live-schedule.png"),
  profile: path.join(captureOut, "saturn-live-profile.png"),
  blocked: path.join(captureOut, "saturn-live-blocked.png"),
};

function dayKey(date = new Date("2026-07-03T12:00:00-04:00")) {
  return date.toISOString().slice(0, 10);
}

function dayKeyOffset(offset) {
  const date = new Date("2026-07-03T12:00:00-04:00");
  date.setDate(date.getDate() - offset);
  return dayKey(date);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function svgBuffer(svg) {
  return Buffer.from(svg);
}

async function dataUri(file) {
  const ext = path.extname(file).slice(1).replace("jpg", "jpeg");
  const data = await fs.readFile(file);
  return `data:image/${ext};base64,${data.toString("base64")}`;
}

function wrapText(text, maxChars) {
  const words = String(text).split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textLines(lines, x, y, lineHeight) {
  return lines.map((line, index) => (
    `<tspan x="${x}" y="${y + index * lineHeight}">${escapeText(line)}</tspan>`
  )).join("");
}

function backgroundSvg(width, height, { quiet = false } = {}) {
  const ringOpacity = quiet ? 0.08 : 0.13;
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${brand.bg}"/>
          <stop offset="58%" stop-color="${brand.bg2}"/>
          <stop offset="100%" stop-color="#3a1b12"/>
        </linearGradient>
        <radialGradient id="ember" cx="12%" cy="18%" r="58%">
          <stop offset="0%" stop-color="${brand.burn}" stop-opacity="${quiet ? 0.26 : 0.42}"/>
          <stop offset="100%" stop-color="${brand.burn}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="gold" cx="82%" cy="12%" r="60%">
          <stop offset="0%" stop-color="${brand.gold}" stop-opacity="${quiet ? 0.16 : 0.24}"/>
          <stop offset="100%" stop-color="${brand.gold}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="orbit" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${brand.burn}" stop-opacity="0"/>
          <stop offset="48%" stop-color="${brand.orange}" stop-opacity="0.75"/>
          <stop offset="100%" stop-color="${brand.gold}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect width="100%" height="100%" fill="url(#ember)"/>
      <rect width="100%" height="100%" fill="url(#gold)"/>
      <ellipse cx="${width * 0.5}" cy="${height * 1.03}" rx="${width * 0.65}" ry="${height * 0.28}" fill="none" stroke="${brand.gold}" stroke-opacity="${ringOpacity}" stroke-width="${Math.max(2, width * 0.004)}"/>
      <path d="M${-width * 0.04} ${height * 0.78} C ${width * 0.22} ${height * 0.62}, ${width * 0.68} ${height * 0.96}, ${width * 1.04} ${height * 0.69}" fill="none" stroke="url(#orbit)" stroke-width="${Math.max(5, width * 0.008)}"/>
    </svg>`;
}

function brandLockupSvg(width, height, { x, y, icon = 58, nameSize = 27, taglineSize = 17 }) {
  return `
    <image href="__ICON__" x="${x}" y="${y}" width="${icon}" height="${icon}"/>
    <text class="brandName" x="${x + icon + 18}" y="${y + Math.round(icon * 0.43)}" font-size="${nameSize}">Saturn</text>
    <text class="tagline" x="${x + icon + 18}" y="${y + Math.round(icon * 0.75)}" font-size="${taglineSize}">${brand.slogan}</text>`;
}

function shellSvg(width, height, { title, body, eyebrow, iconUri }) {
  const titleLines = wrapText(title, 18);
  const bodyLines = wrapText(body, 44);
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
        .brandName { font-weight: 900; fill: ${brand.cream}; }
        .tagline { font-weight: 650; fill: ${brand.gold}; }
        .eyebrow { font-size: 20px; font-weight: 800; fill: ${brand.gold}; }
        .title { font-size: 62px; font-weight: 950; fill: ${brand.cream}; }
        .body { font-size: 25px; font-weight: 550; fill: ${brand.text}; }
      </style>
      ${brandLockupSvg(width, height, { x: 76, y: 68 }).replace("__ICON__", iconUri)}
      <text class="eyebrow" x="78" y="204">${escapeText(eyebrow)}</text>
      <text class="title">${textLines(titleLines, 76, 284, 70)}</text>
      <text class="body">${textLines(bodyLines, 80, 548, 36)}</text>
    </svg>`;
}

function browserFrameSvg(width, height, radius = 30) {
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-18%" y="-18%" width="136%" height="150%">
          <feDropShadow dx="0" dy="24" stdDeviation="20" flood-color="#050201" flood-opacity="0.56"/>
        </filter>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="${brand.ember}" filter="url(#shadow)"/>
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${radius - 1}" fill="none" stroke="${brand.gold}" stroke-opacity="0.26"/>
      <rect x="0" y="0" width="${width}" height="50" rx="${radius}" fill="#170d0a"/>
      <circle cx="32" cy="25" r="6" fill="${brand.gold}" opacity="0.48"/>
      <circle cx="55" cy="25" r="6" fill="${brand.gold}" opacity="0.34"/>
      <circle cx="78" cy="25" r="6" fill="${brand.gold}" opacity="0.24"/>
      <rect x="104" y="14" width="${width - 140}" height="22" rx="11" fill="${brand.bg}" stroke="${brand.gold}" stroke-opacity="0.10"/>
    </svg>`;
}

function popupCardSvg(width, height, radius = 34) {
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="24" stdDeviation="20" flood-color="#050201" flood-opacity="0.58"/>
        </filter>
      </defs>
      <rect width="${width}" height="${height}" rx="${radius}" fill="${brand.bg}" filter="url(#shadow)"/>
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${radius - 1}" fill="none" stroke="${brand.gold}" stroke-opacity="0.26"/>
    </svg>`;
}

function fixtureData() {
  const today = dayKey();
  const yesterday = dayKeyOffset(1);
  const twoDaysAgo = dayKeyOffset(2);
  const now = new Date("2026-07-03T12:00:00-04:00").getTime();
  const schedule = {
    id: "schedule-deep-work",
    domain: "youtube.com",
    startTime: "09:00",
    endTime: "12:00",
    days: [1, 2, 3, 4, 5],
    enabled: true,
    tier: "strict",
  };

  return {
    uiSettings: {
      defaultLimitMinutes: 30,
      use24HourTime: false,
      limitNotificationsEnabled: true,
      personalInsightsEnabled: true,
      insightNotificationsEnabled: true,
      insightMaxNotificationsPerDay: 1,
      insightSensitivity: "normal",
      journeyCollapsed: false,
    },
    onboardingState: { step: 0, completed: true, completedAt: now, version: 2 },
    premiumState: { active: true, planName: "Premium", checkedAt: now },
    blockedDomains: {
      "youtube.com": { enabled: true, limitSeconds: 2700, tier: "strict" },
      "reddit.com": { enabled: true, limitSeconds: 1500, tier: "standard" },
      "x.com": { enabled: true, limitSeconds: 900, tier: "standard" },
      "instagram.com": { enabled: true, limitSeconds: 1200, tier: "lenient" },
      "tiktok.com": { enabled: true, limitSeconds: 600, tier: "strict" },
    },
    statsToday: {
      "youtube.com": { timeMs: 48 * 60 * 1000, visits: 7 },
      "reddit.com": { timeMs: 31 * 60 * 1000, visits: 12 },
      "x.com": { timeMs: 17 * 60 * 1000, visits: 8 },
      "instagram.com": { timeMs: 12 * 60 * 1000, visits: 3 },
      "notion.so": { timeMs: 8 * 60 * 1000, visits: 2 },
    },
    allStatsToday: {
      "youtube.com": { timeMs: 48 * 60 * 1000, visits: 7 },
      "reddit.com": { timeMs: 31 * 60 * 1000, visits: 12 },
      "x.com": { timeMs: 17 * 60 * 1000, visits: 8 },
      "instagram.com": { timeMs: 12 * 60 * 1000, visits: 3 },
      "notion.so": { timeMs: 8 * 60 * 1000, visits: 2 },
    },
    statsHistory: {
      [yesterday]: {
        "youtube.com": { timeMs: 62 * 60 * 1000, visits: 9 },
        "reddit.com": { timeMs: 44 * 60 * 1000, visits: 15 },
      },
      [twoDaysAgo]: {
        "youtube.com": { timeMs: 71 * 60 * 1000, visits: 10 },
        "reddit.com": { timeMs: 38 * 60 * 1000, visits: 11 },
      },
    },
    hourlyUsageHistory: {
      [today]: {
        "08": { timeMs: 7 * 60 * 1000, visits: 2, domains: { "notion.so": 7 * 60 * 1000 }, domainVisits: { "notion.so": 2 } },
        "09": { timeMs: 18 * 60 * 1000, visits: 4, domains: { "youtube.com": 12 * 60 * 1000, "reddit.com": 6 * 60 * 1000 }, domainVisits: { "youtube.com": 2, "reddit.com": 2 } },
        "10": { timeMs: 32 * 60 * 1000, visits: 10, domains: { "youtube.com": 18 * 60 * 1000, "reddit.com": 14 * 60 * 1000 }, domainVisits: { "youtube.com": 3, "reddit.com": 7 } },
        "11": { timeMs: 27 * 60 * 1000, visits: 9, domains: { "x.com": 17 * 60 * 1000, "instagram.com": 10 * 60 * 1000 }, domainVisits: { "x.com": 8, "instagram.com": 1 } },
        "12": { timeMs: 12 * 60 * 1000, visits: 5, domains: { "youtube.com": 8 * 60 * 1000, "instagram.com": 4 * 60 * 1000 }, domainVisits: { "youtube.com": 2, "instagram.com": 2 } },
      },
    },
    snoozeHistory: {
      [today]: { "youtube.com": 1, "reddit.com": 1 },
    },
    snoozedDomains: {
      "reddit.com": { expiresAt: now + 8 * 60 * 1000, minutes: 10 },
    },
    recentlyReset: {},
    activeBlocks: [
      { domain: "youtube.com", source: "limit", tier: "strict", startedAt: now - 4 * 60 * 1000 },
      { ...schedule, source: "scheduled", startedAt: now - 45 * 60 * 1000 },
    ],
    scheduledBlocks: [
      schedule,
      {
        id: "schedule-evening",
        domain: "reddit.com",
        startTime: "20:30",
        endTime: "22:00",
        days: [0, 1, 2, 3, 4, 5, 6],
        enabled: true,
        tier: "standard",
      },
      {
        id: "schedule-morning",
        domain: "x.com",
        startTime: "07:00",
        endTime: "09:00",
        days: [1, 2, 3, 4, 5],
        enabled: false,
        tier: "lenient",
      },
    ],
    personalInsights: [
      {
        id: "youtube-spike",
        type: "spike",
        domain: "youtube.com",
        severity: "high",
        headline: "YouTube is up 38% today",
        subheading: "Most of the spike happened between 10 AM and noon.",
        recommendation: "Set a focused morning window.",
        createdAt: now,
      },
    ],
    dismissedInsights: {},
    saturnBlockReclaimStats: {
      [today]: {
        count: 18,
        totalMs: 90 * 60 * 1000,
        byDomain: { "youtube.com": 9, "reddit.com": 6, "x.com": 3 },
        byTier: { strict: 9, standard: 8, lenient: 1 },
        bySource: { limit: 12, scheduled: 6 },
      },
    },
    saturnJourneyDisplayState: null,
    reviewPromptState: { installedAt: now - 10 * 24 * 60 * 60 * 1000, dashboardOpenCount: 8 },
    immutableAdminOverrideEnabled: false,
  };
}

async function installChromeMock(page, data) {
  const insightsSource = await fs.readFile(path.join(root, "insights.js"), "utf8");
  await page.addInitScript(({ source, initialData }) => {
    window.eval(source);
    const listeners = [];
    const data = initialData;
    const normalizeDomain = (input) => String(input || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const getKeys = (keys) => {
      if (keys == null) return clone(data);
      if (typeof keys === "string") return { [keys]: clone(data[keys]) };
      if (Array.isArray(keys)) {
        const result = {};
        for (const key of keys) result[key] = clone(data[key]);
        return result;
      }
      const result = {};
      for (const [key, fallback] of Object.entries(keys)) result[key] = clone(data[key] ?? fallback);
      return result;
    };
    const setItems = (items) => {
      const changes = {};
      for (const [key, value] of Object.entries(items || {})) {
        changes[key] = { oldValue: clone(data[key]), newValue: clone(value) };
        data[key] = clone(value);
      }
      for (const listener of listeners) listener(changes, "local");
    };
    window.__storeMediaData = data;
    window.chrome = {
      runtime: {
        id: "pecaajdaecdmikcgfdgldcofdebhfbgo",
        getURL: (value) => value,
        getManifest: () => ({ version: "2.2.11" }),
        sendMessage: async (message) => {
          if (message?.action === "flushActiveTimeNow") return { success: true };
          if (message?.action === "getImmutableOverrideState") return { success: true, available: false, enabled: false };
          if (message?.action === "generateInsights") return { success: true, insights: clone(data.personalInsights || []) };
          if (message?.action === "toggleDomainLimitEnabled") {
            const domain = normalizeDomain(message.domain);
            for (const key of Object.keys(data.blockedDomains || {})) {
              if (normalizeDomain(key) === domain) data.blockedDomains[key].enabled = message.enabled !== false;
            }
            return { success: true };
          }
          if (message?.action === "snoozeBlock") return { success: true };
          if (message?.action === "resetLimitUsage") return { success: true };
          if (message?.action === "closeCurrentTab") return { success: true };
          return { success: true };
        },
      },
      storage: {
        local: {
          get: (keys, callback) => {
            const result = getKeys(keys);
            if (typeof callback === "function") {
              setTimeout(() => callback(result), 0);
              return undefined;
            }
            return Promise.resolve(result);
          },
          set: (items, callback) => {
            setItems(items);
            if (typeof callback === "function") setTimeout(callback, 0);
            return Promise.resolve();
          },
          remove: (keys, callback) => {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const key of list) delete data[key];
            if (typeof callback === "function") setTimeout(callback, 0);
            return Promise.resolve();
          },
        },
        onChanged: { addListener: (listener) => listeners.push(listener) },
      },
      tabs: {
        create: async () => ({ id: 1 }),
        getCurrent: async () => ({ id: 1 }),
        remove: async () => true,
      },
      alarms: { clear: async () => true },
    };

    function clone(value) {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }
  }, { source: insightsSource, initialData: data });
}

async function capturePopup(page, tabId, output) {
  await page.goto(pathToFileURL(path.join(root, "popup.html")).href);
  await page.waitForSelector(".scene");
  if (tabId !== "tab1") {
    await page.locator(`label[for="${tabId}"]`).click();
    await page.waitForTimeout(250);
  }
  await page.locator(".scene").screenshot({ path: output });
}

async function captureBlocked(page, output) {
  const url = `${pathToFileURL(path.join(root, "blocked.html")).href}?d=youtube.com&source=limit&tier=strict&eid=store-media`;
  await page.goto(url);
  await page.waitForSelector(".card");
  await page.screenshot({ path: output, fullPage: false });
}

async function captureLiveRenders() {
  await fs.mkdir(captureOut, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const popupContext = await browser.newContext({ viewport: { width: 560, height: 570 }, deviceScaleFactor: 2 });
    const popupPage = await popupContext.newPage();
    await installChromeMock(popupPage, fixtureData());
    await capturePopup(popupPage, "tab1", captures.dashboard);
    await capturePopup(popupPage, "tab2", captures.limits);
    await capturePopup(popupPage, "tab3", captures.schedule);
    await capturePopup(popupPage, "tab4", captures.profile);
    await popupContext.close();

    const blockedContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const blockedPage = await blockedContext.newPage();
    await installChromeMock(blockedPage, fixtureData());
    await captureBlocked(blockedPage, captures.blocked);
    await blockedContext.close();
  } finally {
    await browser.close();
  }
}

async function resizePng(input, output, width, height, fit = "contain") {
  await sharp(input)
    .resize({ width, height, fit, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(output);
}

async function storeScreenshot({ output, capture, title, body, eyebrow }) {
  const width = 1280;
  const height = 800;
  const iconUri = await dataUri(assets.icon);
  const bg = svgBuffer(backgroundSvg(width, height));
  const copy = svgBuffer(shellSvg(width, height, { title, body, eyebrow, iconUri }));
  const card = svgBuffer(popupCardSvg(520, 530));
  const render = await sharp(capture).resize({ width: 460, height: 468, fit: "contain" }).png().toBuffer();

  await sharp({ create: { width, height, channels: 4, background: brand.bg } })
    .composite([
      { input: bg, left: 0, top: 0 },
      { input: copy, left: 0, top: 0 },
      { input: card, left: 686, top: 132 },
      { input: render, left: 716, top: 164 },
    ])
    .png()
    .toFile(output);
}

async function blockedStoreScreenshot(output) {
  const width = 1280;
  const height = 800;
  const iconUri = await dataUri(assets.icon);
  const bg = svgBuffer(backgroundSvg(width, height, { quiet: true }));
  const frame = svgBuffer(browserFrameSvg(970, 616, 28));
  const render = await sharp(captures.blocked).resize({ width: 930, height: 546, fit: "cover", position: "center" }).png().toBuffer();
  const header = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
        .brandName { font-weight: 900; fill: ${brand.cream}; }
        .tagline { font-weight: 650; fill: ${brand.gold}; }
        .headline { font-size: 44px; font-weight: 950; fill: ${brand.cream}; }
      </style>
      ${brandLockupSvg(width, height, { x: 74, y: 48, icon: 54, nameSize: 26, taglineSize: 17 }).replace("__ICON__", iconUri)}
      <text class="headline" x="1210" y="96" text-anchor="end">Catch the habit before it catches you.</text>
    </svg>`;

  await sharp({ create: { width, height, channels: 4, background: brand.bg } })
    .composite([
      { input: bg, left: 0, top: 0 },
      { input: svgBuffer(header), left: 0, top: 0 },
      { input: frame, left: 155, top: 136 },
      { input: render, left: 175, top: 186 },
    ])
    .png()
    .toFile(output);
}

async function smallPromo(output) {
  const width = 440;
  const height = 280;
  const iconUri = await dataUri(assets.icon);
  const bg = svgBuffer(backgroundSvg(width, height));
  const card = svgBuffer(popupCardSvg(142, 190, 18));
  const render = await sharp(captures.dashboard).resize({ width: 122, height: 124, fit: "contain" }).png().toBuffer();
  const copy = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
        .brand { font-size: 31px; font-weight: 950; fill: ${brand.cream}; }
        .tag { font-size: 16px; font-weight: 750; fill: ${brand.gold}; }
      </style>
      <image href="${iconUri}" x="34" y="44" width="52" height="52"/>
      <text class="brand" x="34" y="139">Saturn</text>
      <text class="tag" x="35" y="166">${brand.slogan}</text>
    </svg>`;

  await sharp({ create: { width, height, channels: 4, background: brand.bg } })
    .composite([
      { input: bg, left: 0, top: 0 },
      { input: svgBuffer(copy), left: 0, top: 0 },
      { input: card, left: 270, top: 45 },
      { input: render, left: 280, top: 78 },
    ])
    .png()
    .toFile(output);
}

async function marqueePromo(output) {
  const width = 1400;
  const height = 560;
  const iconUri = await dataUri(assets.icon);
  const bg = svgBuffer(backgroundSvg(width, height));
  const dashboard = await sharp(captures.dashboard).resize({ width: 270, height: 275, fit: "cover", position: "top" }).png().toBuffer();
  const limits = await sharp(captures.limits).resize({ width: 250, height: 255, fit: "cover", position: "top" }).png().toBuffer();
  const copy = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
        .brand { font-size: 76px; font-weight: 950; fill: ${brand.cream}; }
        .tag { font-size: 31px; font-weight: 750; fill: ${brand.gold}; }
        .body { font-size: 29px; font-weight: 600; fill: ${brand.text}; }
      </style>
      <image href="${iconUri}" x="102" y="122" width="94" height="94"/>
      <text class="brand" x="222" y="187">Saturn</text>
      <text class="tag" x="108" y="276">${brand.slogan}</text>
      <text class="body" x="110" y="333">Limit distracting sites, schedule focus blocks,</text>
      <text class="body" x="110" y="370">and see where your time actually goes.</text>
    </svg>`;

  await sharp({ create: { width, height, channels: 4, background: brand.bg } })
    .composite([
      { input: bg, left: 0, top: 0 },
      { input: svgBuffer(copy), left: 0, top: 0 },
      { input: svgBuffer(popupCardSvg(330, 345, 28)), left: 816, top: 86 },
      { input: dashboard, left: 846, top: 122 },
      { input: svgBuffer(popupCardSvg(305, 325, 28)), left: 1050, top: 156 },
      { input: limits, left: 1078, top: 194 },
    ])
    .png()
    .toFile(output);
}

async function whopAvatar(output) {
  const width = 400;
  const height = 400;
  const icon = await sharp(assets.icon).resize({ width: 214, height: 214, fit: "contain" }).png().toBuffer();
  await sharp({ create: { width, height, channels: 4, background: brand.bg } })
    .composite([
      { input: svgBuffer(backgroundSvg(width, height)), left: 0, top: 0 },
      { input: icon, left: 93, top: 72 },
      { input: svgBuffer(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><text x="200" y="330" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="47" font-weight="950" fill="${brand.cream}" letter-spacing="0">Saturn</text></svg>`), left: 0, top: 0 },
    ])
    .png()
    .toFile(output);
}

async function whopBanner(output) {
  const width = 2000;
  const height = 1000;
  const iconUri = await dataUri(assets.icon);
  const dashboard = await sharp(captures.dashboard).resize({ width: 420, height: 430, fit: "contain" }).png().toBuffer();
  const schedule = await sharp(captures.schedule).resize({ width: 382, height: 392, fit: "contain" }).png().toBuffer();
  const copy = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
        .brand { font-size: 124px; font-weight: 950; fill: ${brand.cream}; }
        .tag { font-size: 50px; font-weight: 800; fill: ${brand.gold}; }
        .body { font-size: 42px; font-weight: 620; fill: ${brand.text}; }
      </style>
      <image href="${iconUri}" x="142" y="168" width="132" height="132"/>
      <text class="brand" x="310" y="268">Saturn</text>
      <text class="tag" x="150" y="410">${brand.slogan}</text>
      <text class="body" x="154" y="498">A Chrome extension for calmer browsing:</text>
      <text class="body" x="154" y="558">limits, schedules, blocks, and clear feedback.</text>
    </svg>`;

  await sharp({ create: { width, height, channels: 4, background: brand.bg } })
    .composite([
      { input: svgBuffer(backgroundSvg(width, height)), left: 0, top: 0 },
      { input: svgBuffer(copy), left: 0, top: 0 },
      { input: svgBuffer(popupCardSvg(500, 520, 40)), left: 1124, top: 220 },
      { input: dashboard, left: 1164, top: 270 },
      { input: svgBuffer(popupCardSvg(454, 474, 40)), left: 1462, top: 314 },
      { input: schedule, left: 1498, top: 358 },
    ])
    .png()
    .toFile(output);
}

async function whopProduct(output) {
  const width = 1280;
  const height = 720;
  const iconUri = await dataUri(assets.icon);
  const dashboard = await sharp(captures.dashboard).resize({ width: 382, height: 390, fit: "contain" }).png().toBuffer();
  const limits = await sharp(captures.limits).resize({ width: 314, height: 322, fit: "contain" }).png().toBuffer();
  const copy = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        text { font-family: "Segoe UI", Arial, sans-serif; letter-spacing: 0; }
        .brand { font-size: 68px; font-weight: 950; fill: ${brand.cream}; }
        .tag { font-size: 28px; font-weight: 800; fill: ${brand.gold}; }
        .title { font-size: 52px; font-weight: 950; fill: ${brand.cream}; }
        .body { font-size: 25px; font-weight: 620; fill: ${brand.text}; }
      </style>
      <image href="${iconUri}" x="76" y="70" width="78" height="78"/>
      <text class="brand" x="176" y="131">Saturn</text>
      <text class="tag" x="78" y="202">${brand.slogan}</text>
      <text class="title" x="78" y="306">See your browsing</text>
      <text class="title" x="78" y="366">before it steers you.</text>
      <text class="body" x="82" y="454">Track time, cap distracting sites,</text>
      <text class="body" x="82" y="488">and schedule focus blocks from Chrome.</text>
    </svg>`;

  await sharp({ create: { width, height, channels: 4, background: brand.bg } })
    .composite([
      { input: svgBuffer(backgroundSvg(width, height)), left: 0, top: 0 },
      { input: svgBuffer(copy), left: 0, top: 0 },
      { input: svgBuffer(popupCardSvg(460, 478, 32)), left: 678, top: 104 },
      { input: dashboard, left: 717, top: 148 },
      { input: svgBuffer(popupCardSvg(378, 394, 30)), left: 884, top: 244 },
      { input: limits, left: 916, top: 280 },
    ])
    .png()
    .toFile(output);
}

async function verifyDimensions(files) {
  const rows = [];
  for (const [file, expected] of files) {
    const meta = await sharp(file).metadata();
    const actual = `${meta.width}x${meta.height}`;
    if (actual !== expected) throw new Error(`${file} expected ${expected}, got ${actual}`);
    rows.push(`${path.relative(root, file)} ${actual}`);
  }
  await fs.writeFile(path.join(outRoot, "dimension-check.txt"), `${rows.join("\n")}\n`, "utf8");
}

async function writeReadme(files) {
  const lines = [
    "# Saturn Store Media",
    "",
    "Generated from live Playwright renders of the Saturn extension UI with populated listing data.",
    "",
    "Brand: Saturn",
    `Slogan: ${brand.slogan}`,
    "Palette: burnt orange, orbit gold, cream, deep brown, cyan support accent.",
    "",
    "Chrome Web Store:",
    "- 128x128 icon",
    "- 440x280 small promotional image",
    "- 1400x560 marquee promotional image",
    "- 1280x800 screenshots",
    "",
    "Whop:",
    "- 400x400 company avatar",
    "- 2000x1000 company banner",
    "- 1280x720 product/gallery image",
    "",
    "Files:",
    ...files.map(([file, size]) => `- ${path.relative(outRoot, file).replaceAll("\\", "/")} (${size})`),
    "",
  ];
  await fs.writeFile(path.join(outRoot, "README.md"), lines.join("\n"), "utf8");
}

async function main() {
  await fs.mkdir(chromeOut, { recursive: true });
  await fs.mkdir(whopOut, { recursive: true });
  await captureLiveRenders();

  const files = [
    [path.join(chromeOut, "saturn-icon-128.png"), "128x128"],
    [path.join(chromeOut, "saturn-promo-small-440x280.png"), "440x280"],
    [path.join(chromeOut, "saturn-promo-marquee-1400x560.png"), "1400x560"],
    [path.join(chromeOut, "saturn-screenshot-1-dashboard-1280x800.png"), "1280x800"],
    [path.join(chromeOut, "saturn-screenshot-2-limits-1280x800.png"), "1280x800"],
    [path.join(chromeOut, "saturn-screenshot-3-schedules-1280x800.png"), "1280x800"],
    [path.join(chromeOut, "saturn-screenshot-4-blocked-page-1280x800.png"), "1280x800"],
    [path.join(chromeOut, "saturn-screenshot-5-profile-1280x800.png"), "1280x800"],
    [path.join(whopOut, "saturn-whop-avatar-400x400.png"), "400x400"],
    [path.join(whopOut, "saturn-whop-banner-2000x1000.png"), "2000x1000"],
    [path.join(whopOut, "saturn-whop-product-1280x720.png"), "1280x720"],
  ];

  await resizePng(assets.icon, files[0][0], 128, 128, "contain");
  await smallPromo(files[1][0]);
  await marqueePromo(files[2][0]);
  await storeScreenshot({
    output: files[3][0],
    capture: captures.dashboard,
    eyebrow: "Dashboard",
    title: "Understand where your time goes.",
    body: "Track daily screen time, visits, active blocks, and your focus journey in one compact Chrome view.",
  });
  await storeScreenshot({
    output: files[4][0],
    capture: captures.limits,
    eyebrow: "Limits",
    title: "Set real boundaries for distracting sites.",
    body: "Create per-site limits, choose block strength, and see exactly how much time each site has used today.",
  });
  await storeScreenshot({
    output: files[5][0],
    capture: captures.schedule,
    eyebrow: "Schedule",
    title: "Protect focus windows before the day starts.",
    body: "Schedule recurring blocks for your most distracting sites and keep your planned sessions visible.",
  });
  await blockedStoreScreenshot(files[6][0]);
  await storeScreenshot({
    output: files[7][0],
    capture: captures.profile,
    eyebrow: "Profile",
    title: "Turn reclaimed time into progress.",
    body: "Review blocked moments, streaks, subscription status, and the journey milestones Saturn tracks for you.",
  });
  await whopAvatar(files[8][0]);
  await whopBanner(files[9][0]);
  await whopProduct(files[10][0]);

  await verifyDimensions(files);
  await writeReadme(files);
  console.log(`Generated ${files.length} store media assets in ${outRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
