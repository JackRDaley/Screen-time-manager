const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function expectExistingLocalPath(reference, source) {
  const clean = String(reference || '').split(/[?#]/)[0];
  if (!clean || clean.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return;

  const absolutePath = path.resolve(rootDir, clean);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${source} references missing file: ${clean}`);
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function htmlAssetReferences(relativePath) {
  const html = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const refs = [];
  const assetRefPattern = /\b(?:href|src)=["']([^"']+)["']/gi;
  let match;

  while ((match = assetRefPattern.exec(html)) !== null) {
    refs.push(match[1]);
  }

  return refs;
}

describe('Extension packaging references', () => {
  test('manifest references files that exist in the extension bundle', () => {
    const manifest = readJson('manifest.json');
    const references = [
      ...Object.values(manifest.icons || {}),
      manifest.action?.default_popup,
      manifest.background?.service_worker,
      ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
      ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
    ];

    for (const reference of references) {
      expectExistingLocalPath(reference, 'manifest.json');
    }
  });

  test('extension HTML pages reference local assets that exist', () => {
    for (const htmlFile of ['popup.html', 'blocked.html', 'welcome.html']) {
      for (const reference of htmlAssetReferences(htmlFile)) {
        expectExistingLocalPath(reference, htmlFile);
      }
    }
  });
});
