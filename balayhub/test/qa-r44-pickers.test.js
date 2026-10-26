'use strict';
require('./helpers');

// QA round 44, lane PICKERS (D-126): the Listing picker on New quote and the Unit picker in the owner portal's
// Block dates showed bare unit names, so two units with one name in two buildings could not be told apart.
// Each option now reads "Unit — Building", like the reservation, group and Move-to pickers. The options arrow is
// pulled out of the file text and run on two listings with one name, so the test runs the code the page runs.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_44_pickers DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_44_pickers node --test --test-concurrency=1 test/qa-r44-pickers.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = process.env.R44_PICKERS_JS || path.join(__dirname, '..', 'public', 'js');
const read = (file) => fs.readFileSync(path.join(JS, 'views', file), 'utf8');

// The two options arrows, as the files write them.
const QUOTE_PICKER = /listings\.map\(\(l\) => \[l\.unit_id, [^\]]*\]\)/;
const BLOCK_PICKER = /units\.map\(\(u\) => \[u\.unit_id, [^\]]*\]\)/;

// Run an options arrow on the given rows, the way the page does (the page passes the same list under its own name).
function optionsOf(src, pattern, rows) {
  const m = src.match(pattern);
  assert.ok(m, `the options arrow is in the file: ${pattern}`);
  const build = new Function('listings', 'units', `return ${m[0]};`);
  return build(rows, rows);
}

// Two listings with one unit name in two buildings.
const rows = [
  { unit_id: 'u-1', unit_name: 'Unit 1201', property_name: 'Tower 1' },
  { unit_id: 'u-2', unit_name: 'Unit 1201', property_name: 'Tower 2' },
];

test('New quote lists each listing as "Unit — Building", so two units with one name can be told apart', () => {
  assert.deepEqual(optionsOf(read('quotes.js'), QUOTE_PICKER, rows), [
    ['u-1', 'Unit 1201 — Tower 1'],
    ['u-2', 'Unit 1201 — Tower 2'],
  ]);
});

test('the owner portal Block dates Unit picker lists each unit as "Unit — Building"', () => {
  assert.deepEqual(optionsOf(read('ownerportal.js'), BLOCK_PICKER, rows), [
    ['u-1', 'Unit 1201 — Tower 1'],
    ['u-2', 'Unit 1201 — Tower 2'],
  ]);
});
