'use strict';

// Reports: changing the period must not empty the report body before the new data arrives
// (the page collapsed to a skeleton and regrew: layout shift 0.28).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reports.js'), 'utf8');

test('the skeleton shows only when the report body is still empty', () => {
  const uses = src.match(/h\('div', \{ class: 'skeleton' \}\)/g) || [];
  assert.equal(uses.length, 1);
  assert.match(src, /if \(!body\.firstChild\) body\.replaceChildren\(h\('div', \{ class: 'skeleton' \}\)\)/);
});

test('load() has no unconditional body clear before the fetch', () => {
  const start = src.indexOf('async function load()');
  const fetchAt = src.indexOf("await get(`/reports", start);
  const before = src.slice(start, fetchAt);
  // Only the "Pick both dates" early returns may replace the body ahead of the fetch.
  const clears = before.split('\n').filter((l) => /body\.replaceChildren\(/.test(l) && !/firstChild/.test(l));
  assert.equal(clears.length, 1, clears.join('\n'));
  assert.match(clears[0], /class: 'card'/);
});
