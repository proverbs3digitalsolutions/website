'use strict';
require('./helpers');

// Round 31 (LIVEREGION, LT-1, D-113): #app is not a live region (a live region holds a short status line or a list of
// results, never a whole page); #toasts is the one shell live region. The boot failure puts focus on its heading.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('index.html: one aria-live, on #toasts; #app has none', () => {
  const html = read('public/index.html');
  assert.equal((html.match(/aria-live/g) || []).length, 1);
  assert.match(html, /<div id="toasts"[^>]*aria-live="polite"/);
  assert.match(html, /<div id="app">/);
});

test('app.js boot failure moves focus to the error page heading', () => {
  const js = read('public/js/app.js');
  assert.match(js, /replaceChildren\(pageError\([^\n]*\n\s*focusPageHeading\(document\.getElementById\('app'\)\);/);
});

test('the small live regions inside pages stay', () => {
  for (const f of ['filters', 'topsearch', 'assistant', 'tophelp']) {
    assert.match(read(`public/js/${f}.js`), /aria-live/, f);
  }
});
