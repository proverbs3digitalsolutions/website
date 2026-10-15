'use strict';

// QA round 16, lane TS: the top bar search panel states what it covers (O4, #26). Source scans.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/topsearch.js'), 'utf8');
const SENTENCE = 'Search covers guests, reservations, listings and pages.';

test('scope sentence appears exactly once, as a muted paragraph', () => {
  assert.equal(src.split(SENTENCE).length - 1, 1);
  assert.match(src, /h\('p', \{ class: 'muted small tb-scope' \}, 'Search covers guests, reservations, listings and pages\.'\)/);
});

test('scope line is in the results panel, outside the listbox and not an option', () => {
  assert.match(src, /h\('div', \{ class: 'tb-results', hidden: !open \}, list, extras\)/);
  assert.match(src, /extras\.replaceChildren\(\.\.\.extra, scope\)/);
  const line = src.split('\n').find((l) => l.includes(SENTENCE));
  assert.doesNotMatch(line, /role/);
});
