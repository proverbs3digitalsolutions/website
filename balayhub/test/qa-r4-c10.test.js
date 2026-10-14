'use strict';

// QA round 4, lane C10 (properties view). Frontend source scan: the view imports the app shell, which does not load in Node.
// 1. A short-term workspace sees no occupied or vacant badge on a property card (listings#9, O-f).
// 2. A short-term workspace has no Occupancy quick filter, and an occupancy value in the link is ignored (listings#9, O-f).
// Long-term and both-type workspaces keep the badge, the filter and the "No units yet" badge.
// node --test --test-concurrency=1 test/qa-r4-c10.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'properties.js'), 'utf8');
const listView = src.slice(src.indexOf('export async function propertiesView'), src.indexOf('// ---------------------------------------------------------------- detail'));

test('the property list knows when the workspace is short-term', () => {
  assert.match(listView, /const stayOnly = state\.user\.business_type === 'short_term';/);
});

test('a short-term workspace sees no occupied or vacant badge on a property card (listings#9)', () => {
  const card = listView.slice(listView.indexOf('p.unit_count ?'), listView.indexOf("badge('unpaid', 'No units yet')"));
  assert.match(card, /!stayOnly\s*&&\s*badge\(\s*p\.occupied_count/);
  // The unit count and the "No units yet" badge stay for every workspace.
  assert.match(listView, /`\$\{p\.unit_count\} unit\$\{p\.unit_count === 1 \? '' : 's'\}`/);
  assert.match(listView, /badge\('unpaid', 'No units yet'\)/);
});

test('a short-term workspace has no Occupancy quick filter (listings#9)', () => {
  assert.match(listView, /\.\.\.\(stayOnly \? \[\] : \[\{ name: 'occupancy'/);
  assert.match(listView, /\['vacant', 'Has vacant units'\]/);
});

test('an occupancy value in a short-term workspace link is ignored (listings#9)', () => {
  const init = listView.indexOf("initFilters('properties'");
  const drop = listView.indexOf("if (stayOnly) filters.occupancy = '';");
  assert.notEqual(drop, -1, 'the link value is not cleared for short-term workspaces');
  assert.ok(drop > init, 'the clear must run after the filters are read from the link');
  assert.ok(listView.indexOf('const stayOnly') < drop, 'stayOnly must be declared before it is used');
});

test('a short-term workspace has no Most vacant units sort option (listings#9)', () => {
  assert.match(listView, /\.\.\.\(stayOnly \? \[\] : \[\['vacant', 'Most vacant units'\]\]\)/);
  // The other sort choices stay for every workspace.
  assert.match(listView, /\['units', 'Most units'\]/);
  assert.match(listView, /\['newest', 'Newest added'\]/);
});

test('a sort=vacant value in a short-term workspace link falls back to the default sort (listings#9)', () => {
  const init = listView.indexOf("initFilters('properties'");
  const drop = listView.indexOf("if (stayOnly && filters.sort === 'vacant') filters.sort = '';");
  assert.notEqual(drop, -1, 'a sort=vacant link value is not reset for short-term workspaces');
  assert.ok(drop > init, 'the reset must run after the filters are read from the link');
});
