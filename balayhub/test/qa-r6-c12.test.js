'use strict';

// QA round 6, lane C12 (empty lists under a status chip). Frontend-only: no database.
// O-e: a status chip with no matches says "No results found" with Clear filters, not the empty-workspace prompt
// (Resolved showed "No requests here" with a New request button). Clear filters also resets the status chip
// on maintenance, tenants and properties. Source scans of the three views.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const MAINT_SRC = read('public/js/views/maintenance.js');
const TENANTS_SRC = read('public/js/views/tenants.js');
const PROPS_SRC = read('public/js/views/properties.js');

test('maintenance: a status chip other than Open & in progress or All counts as a filter for the empty list (O-e)', () => {
  assert.match(MAINT_SRC, /\(\(isFiltered\(\) \|\| !\['active', 'all'\]\.includes\(filters\.status\)\)\s*\? emptyState\(\{ title: 'No results found'/);
  // The workspace prompt stays for the default chip, and for All when nothing is recorded at all.
  assert.match(MAINT_SRC, /: emptyState\(\{ iconName: 'wrench', title: filters\.status === 'active' \? 'No open repair requests' : 'No requests here'/);
});

test('maintenance: Clear filters resets the status chip too (O-e)', () => {
  assert.doesNotMatch(MAINT_SRC, /Object\.assign\(filters, defaults, \{ status: filters\.status \}\)/);
  assert.match(MAINT_SRC, /Object\.assign\(filters, defaults\); rememberFilters\('maintenance', filters\); renderBar\(\); load\(\);/);
});

test('tenants and properties: Clear filters resets the status chip too (O-e)', () => {
  assert.doesNotMatch(TENANTS_SRC, /Object\.assign\(filters, defaults, \{ status: filters\.status \}\)/);
  assert.match(TENANTS_SRC, /Object\.assign\(filters, defaults\); rememberFilters\('tenants', filters\); renderBar\(\); load\(\);/);
  assert.doesNotMatch(PROPS_SRC, /Object\.assign\(filters, defaults, \{ status: filters\.status \}\)/);
  assert.match(PROPS_SRC, /Object\.assign\(filters, defaults\); rememberFilters\('properties', filters\); renderBar\(\); load\(\);/);
});

test('tenants and properties: the Archived chip keeps its own empty text, so its empty list is not "No results found" (O-e)', () => {
  assert.match(TENANTS_SRC, /title: filters\.status === 'archived' \? 'No archived tenants' : 'No tenants yet'/);
  assert.match(PROPS_SRC, /title: filters\.status === 'archived' \? 'No archived properties' : \(isOwner \? 'No properties yet' : 'No properties assigned to you'\)/);
});
