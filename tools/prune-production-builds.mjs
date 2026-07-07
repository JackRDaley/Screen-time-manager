import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const keepCount = Number.parseInt(process.argv.find((arg) => arg.startsWith("--keep="))?.split("=")[1] || "3", 10);
const dryRun = process.argv.includes("--dry-run");
const releasePattern = /^production-(\d+)\.(\d+)\.(\d+)\.zip$/;

function compareVersionsDesc(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a.version[index] !== b.version[index]) {
      return b.version[index] - a.version[index];
    }
  }

  return b.mtimeMs - a.mtimeMs;
}

const entries = await readdir(root);
const releases = [];

for (const entry of entries) {
  const match = releasePattern.exec(entry);
  if (!match) continue;

  const fullPath = path.join(root, entry);
  const details = await stat(fullPath);
  releases.push({
    name: entry,
    fullPath,
    mtimeMs: details.mtimeMs,
    version: match.slice(1).map(Number)
  });
}

releases.sort(compareVersionsDesc);

const kept = releases.slice(0, keepCount);
const removed = releases.slice(keepCount);

for (const release of removed) {
  if (!dryRun) {
    await rm(release.fullPath, { force: true });
  }
}

console.log(`Found ${releases.length} production build(s). Keeping ${kept.length}.`);

if (kept.length > 0) {
  console.log("Kept:");
  for (const release of kept) {
    console.log(`- ${release.name}`);
  }
}

if (removed.length > 0) {
  console.log(dryRun ? "Would remove:" : "Removed:");
  for (const release of removed) {
    console.log(`- ${release.name}`);
  }
}
