'use strict';

// QA round 3, lane C17 (properties-view). A short-term workspace sees its property detail without the
// long-term parts: no Assign Tenant button, no monthly rent on each unit, no Rent roll tile (listings#6),
// no Occupied or Vacant tile, no Occupied or Vacant unit badge, no Vacant, Occupied or "Lease ends within 60 days"
// status option, and the unit search reads "Search unit".
// In the unit editor Monthly rent stays required for long-term and both-type workspaces and is hidden for a
// short-term one; the security deposit is unchanged. Long-term and both-type workspaces keep the rest. Frontend source scan
// only: the view imports the app shell, which does not load in Node.
// node --test --test-concurrency=1 test/qa-r3-properties-view.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'properties.js'), 'utf8');
const detail = src.slice(src.indexOf('export async function propertyDetailView'));
const unitRow = detail.slice(detail.indexOf('const unitRow = (u) => {'), detail.indexOf('// Unit filters'));
const lineWith = (block, text) => block.split('\n').find((l) => l.includes(text));

test('the property detail knows when the workspace is short-term only (same check as rent.js)', () => {
  assert.match(detail, /const stayOnly = state\.user\.business_type === 'short_term';/);
});

test('a short-term workspace gets no Assign Tenant button on a vacant unit', () => {
  const line = lineWith(unitRow, "'Assign Tenant'");
  assert.ok(line, 'the Assign Tenant button is in the unit row');
  assert.match(line, /if \(!stayOnly && u\.occupancy_status === 'vacant'\)/);
});

test('unit rows show the monthly rent only outside short-term workspaces; the deposit line is unchanged', () => {
  const line = lineWith(unitRow, '/month');
  assert.ok(line, 'the unit subtitle is in the unit row');
  assert.match(line, /\$\{stayOnly \? '' : u\.lease_rent == null \? ` · \$\{peso\(u\.monthly_rent\)\}\/month` : /);
  assert.match(line, /deposit \$\{peso\(u\.security_deposit_amount\)\}/);
});

test('the Rent roll tile is only shown outside short-term workspaces', () => {
  const tile = lineWith(detail, "'Rent roll'");
  assert.ok(tile, 'the Rent roll tile is in the stats row');
  assert.match(tile, /!stayOnly && h\('a', \{ class: 'stat', href: `#\/rent\?property_id=/);
});

test('the Occupied and Vacant tiles are only shown outside short-term workspaces', () => {
  assert.match(detail, /!stayOnly && h\('div', \{ class: 'stat' \}, h\('div', \{ class: 'stat__label' \}, 'Occupied'\)/);
  assert.match(detail, /!stayOnly && h\('div', \{ class: 'stat' \}, h\('div', \{ class: 'stat__label' \}, 'Vacant'\)/);
});

test('the Vacant, Occupied and "Lease ends within 60 days" status options are only offered outside short-term workspaces; Not available and Archived stay', () => {
  const line = lineWith(detail, "'Lease ends within 60 days'");
  assert.ok(line, 'the status filter and its options are on one line');
  assert.match(line, /\.\.\.\(stayOnly \? \[\] : \[\['vacant', 'Vacant'\], \['occupied', 'Occupied'\], \['ending', 'Lease ends within 60 days'\]\]\)/);
  assert.match(line, /\['unavailable', 'Not available'\]/);
  assert.match(line, /\['archived', 'Archived'\]/);
});

test('a unit row shows its Occupied or Vacant badge only outside short-term workspaces; the Unavailable and Archived badges stay', () => {
  const line = lineWith(unitRow, 'badge(u.occupancy_status)');
  assert.ok(line, 'the occupancy badge is in the unit title');
  assert.match(line, /!\(stayOnly && \['vacant', 'occupied'\]\.includes\(u\.occupancy_status\)\) && badge\(u\.occupancy_status\)/);
});

test('the unit search reads "Search unit" in a short-term workspace and keeps the old text elsewhere', () => {
  assert.match(detail, /placeholder: stayOnly \? 'Search unit' : 'Search unit or tenant'/);
});

const unitFieldsSrc = src.slice(src.indexOf('function unitFields('), src.indexOf('function unitModal('));

test('the unit editor checks the short-term workspace the same way', () => {
  assert.match(unitFieldsSrc, /const stayOnly = state\.user\.business_type === 'short_term';/);
});

test('Monthly rent stays required in the unit editor for long-term and both-type workspaces, and is hidden for a short-term one', () => {
  const rent = lineWith(unitFieldsSrc, "name: 'monthly_rent'");
  assert.ok(rent, 'the monthly rent field is in the unit editor');
  assert.match(rent, /required: true/);
  assert.match(rent, /^\s*!stayOnly && field\(\{ name: 'monthly_rent'/);
});

test('the rent and deposit row drops its two-column layout for a short-term workspace', () => {
  assert.match(unitFieldsSrc, /h\('div', \{ class: stayOnly \? 'form-row' : 'form-row form-row--2' \},\s*!stayOnly && field\(\{ name: 'monthly_rent'/);
});

test('the security deposit field in the unit editor is unchanged and still shown to every workspace', () => {
  const deposit = lineWith(unitFieldsSrc, "name: 'security_deposit_amount'");
  assert.ok(deposit, 'the deposit field is in the unit editor');
  assert.doesNotMatch(deposit, /stayOnly/);
  assert.match(deposit, /^\s*field\(\{ name: 'security_deposit_amount', label: 'Security deposit', type: 'money', value: u\.security_deposit_amount, placeholder: '16,000' \}\)/);
});
