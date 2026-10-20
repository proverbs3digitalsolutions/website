'use strict';
require('./helpers');

// Round 32 (SUPPLIES, OPS-1, D-114): a box that holds a whole list is never a live region; saves are said by their toast.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/supplies.js'), 'utf8');

test('supplies.js has no aria-live', () => {
  assert.equal(/aria-live/.test(src), false);
});

test('the list box and the history body are plain divs', () => {
  assert.match(src, /const box = h\('div', null, skeleton\(3\)\)/);
  assert.match(src, /const body = h\('div'\);/);
});
