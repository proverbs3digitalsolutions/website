'use strict';

// Supplies puts its Property and Stock selects in the Filters panel (more), so a phone shows one row.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/supplies.js'), 'utf8');
const call = src.slice(src.indexOf('filterBar({'));

test('supplies filter bar has no quick selects and both selects are in more', () => {
  assert.doesNotMatch(call, /\bquick:/);
  const more = call.slice(call.indexOf('more:'));
  assert.match(more, /name: 'property_id'/);
  assert.match(more, /name: 'low'/);
  assert.match(call, /key: 'supplies'/);
});
