'use strict';
require('./helpers');

// Round 32 (CLEANERPAY, OPS-1, D-114): a whole table is never a live region; the month name on My pay is the one live line.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/cleanerpay.js'), 'utf8');

test('cleanerpay.js: exactly one aria-live, on mypay__month', () => {
  assert.equal((src.match(/aria-live/g) || []).length, 1);
  assert.match(src, /const label1 = h\('span', \{ class: 'mypay__month', 'aria-live': 'polite' \}\)/);
});

test('cleanerpay.js: neither box is a live region', () => {
  const boxes = src.split('\n').filter((l) => /const box = h\('div'/.test(l));
  assert.equal(boxes.length, 2);
  for (const l of boxes) assert.doesNotMatch(l, /aria-live/);
});
