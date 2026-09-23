// Keeps the service worker's offline list in sync with the files the app actually ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const sw = readFileSync('sw.js', 'utf8');
const listed = new Set([...sw.matchAll(/^\s*'([^']+)',$/gm)].map((m) => m[1]));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name).replace(/\\/g, '/');
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('every shipped file is precached for offline use', () => {
  const shipped = [...walk('src'), ...walk('styles'), ...walk('assets/icons')];
  const missing = shipped.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `add to PRECACHE in sw.js: ${missing.join(', ')}`);
});

test('every precached file exists', () => {
  const gone = [...listed].filter((f) => f !== './' && !existsSync(f));
  assert.deepEqual(gone, []);
});

test('manifest and index reference existing icons', () => {
  const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
  for (const icon of manifest.icons) assert.ok(existsSync(icon.src), icon.src);
  const html = readFileSync('index.html', 'utf8');
  for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(existsSync(href), href);
});
