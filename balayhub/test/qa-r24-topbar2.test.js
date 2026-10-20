'use strict';

// QA r24 TOPBAR2: a card-due owner must not see the desktop search box from the first paint. The slot is built hidden
// when search is not wanted, the search module is not mounted while hidden, and updateTopbar mounts it when it becomes wanted.
// Source scans; frontend-only, no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
const src = strip(fs.readFileSync(path.join(ROOT, 'public/js/topbar.js'), 'utf8'));
const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');

test('the desktop search slot is built hidden when search is not wanted', () => {
  assert.match(src, /tb__search tb-desktop-only'[^)]*hidden: !want\.includes\('search'\)/);
});

test('the search module is mounted only while search is wanted, and when it becomes wanted', () => {
  assert.match(src, /if \(want\.includes\('search'\)\) mountDesktopSearch\(\)/);
  assert.match(src, /slot\.hidden = !wantSearch;[\s\S]*mount/);
});

test('CSS never shows a [hidden] desktop search slot', () => {
  assert.match(css, /\.tb__search\[hidden\]\s*\{\s*display:\s*none/);
});
