'use strict';
// QA round 15, lane F2 (frontend only, no database): small hosts get the compact filter bar, not a bare "Filter" fold.
// node --test --test-concurrency=1 test/qa-r15-f2.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calendar = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'calendar.js'), 'utf8');

test('calendar no longer wraps the filter bar in a "Filter" fold', () => {
  assert.doesNotMatch(calendar, /fold\('Filter'/);
});

test('compact hosts move every quick filter into the "Filters" panel', () => {
  assert.match(calendar, /quick: compact \? \[\] : quick/);
  assert.match(calendar, /more: compact \? \[\.\.\.quick, \.\.\.more\] : more/);
});

test('the legend fold is unchanged', () => {
  assert.match(calendar, /fold\('What the colours mean', legend, false\)/);
});
