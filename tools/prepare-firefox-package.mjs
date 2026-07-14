import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "dist", "firefox");

const extensionFiles = [
  "activity-heartbeat.js",
  "background.js",
  "blocked.css",
  "blocked.html",
  "blocked.js",
  "gdpr-utils.js",
  "insights.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "shared-extension-utils.js",
  "update-log.css",
  "update-log.html",
  "update-log.js",
  "welcome.css",
  "welcome.html",
  "welcome.js",
];

async function copyEntry(entry) {
  await cp(path.join(root, entry), path.join(outDir, entry), {
    recursive: true,
  });
}

const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

manifest.background = {
  scripts: [
    "shared-extension-utils.js",
    "gdpr-utils.js",
    "insights.js",
    "background.js",
  ],
};

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await Promise.all([...extensionFiles, "assets"].map(copyEntry));
await writeFile(
  path.join(outDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Prepared Firefox extension source in ${path.relative(root, outDir)}`);
