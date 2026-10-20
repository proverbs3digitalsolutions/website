'use strict';

// QA r26 lane FILTERS (INB-1): the active-filter chips sit under the bar, above the Filters panel, at every width. Source scan; no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/filters.js'), 'utf8');
const place = src.slice(src.indexOf('const place = () => {'), src.indexOf('const place = () => {') + 400);

test('chips go before the panel at every width (no desktop panel.after)', () => {
  assert.ok(place.includes('panel.before(chips)'));
  assert.ok(!/panel\.after\(chips\)/.test(src));
  assert.ok(!/mq\.matches\)\s*panel\.before\(chips\)/.test(place), 'placement must not depend on the media query');
});

test('round 25 focus-matching land() is kept', () => {
  assert.ok(src.includes('const byKey = () =>'));
});
