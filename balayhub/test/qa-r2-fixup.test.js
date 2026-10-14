'use strict';
// R2 fixup (frontend): a hand-typed ?assignee= on the housekeeping list is dropped before the
// first fetch, the calendar-sync list names the link's host, archived tenants read "(archived)",
// the archive confirmation says the balance stays on record until it is paid, and a cancelled
// group shows a dash for its rooms.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const hk = read('public/js/views/housekeeping.js');
const home = read('public/js/views/home.js');
const tenants = read('public/js/views/tenants.js');
const rent = read('public/js/views/rent.js');
const reports = read('public/js/views/reports.js');
const groups = read('public/js/views/groups.js');

// The view imports browser modules, so pull the pure helper out of the source.
const grab = (name) => hk.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
const { cleanAssigneeFilter } = new Function(`${grab('cleanAssigneeFilter')}\nreturn { cleanAssigneeFilter };`)();

test('a team member id or one of the two offered keywords is kept as the assignee filter', () => {
  assert.equal(cleanAssigneeFilter('unassigned'), 'unassigned');
  assert.equal(cleanAssigneeFilter('outside'), 'outside');
  assert.equal(cleanAssigneeFilter('3f2c9d1e-8a4b-4c7d-9e21-0a1b2c3d4e5f'), '3f2c9d1e-8a4b-4c7d-9e21-0a1b2c3d4e5f');
  assert.equal(cleanAssigneeFilter('3F2C9D1E-8A4B-4C7D-9E21-0A1B2C3D4E5F'), '3F2C9D1E-8A4B-4C7D-9E21-0A1B2C3D4E5F');
  assert.equal(cleanAssigneeFilter(''), '');
});

test('any other assignee value is dropped, so the list does not 404 on load', () => {
  for (const bad of ['everyone', 'abc', '3f2c9d1e-8a4b-4c7d-9e21-0a1b2c3d4e5', "' OR 1=1 --", 'unassigned ']) {
    assert.equal(cleanAssigneeFilter(bad), '', bad);
  }
});

test('the tasks tab drops a bad assignee before its first fetch', () => {
  assert.match(hk, /filters\.assignee = cleanAssigneeFilter\(filters\.assignee\);\n\s+const \[\{ properties \}/);
});

test('the calendar-sync list names the link host on every kind of problem', () => {
  assert.match(home, /const feedName = \(p\) => `\$\{label\(p\.channel\)\}\$\{p\.host \? ` \(\$\{p\.host\}\)` : ''\}`;/);
  assert.match(home, /stale: \(p\) => `\$\{p\.unit_name\}: the \$\{feedName\(p\)\} calendar/);
  assert.match(home, /failing: \(p\) => \(p\.channel \? `\$\{p\.unit_name\} · \$\{feedName\(p\)\}: \$\{p\.message\}`/);
  assert.match(home, /overlap: \(p\) => `\$\{p\.unit_name\}: a \$\{feedName\(p\)\} booking/);
});

test('the archive confirmation says the unpaid balance stays on record until it is paid, with no write-off wording', () => {
  assert.match(tenants, /The unpaid balance stays on record until it is paid\./);
  assert.doesNotMatch(tenants, /written off|forgiv|waive/i);
});

test('archived tenants read "(archived)" on the rent screen and the reports outstanding table', () => {
  assert.match(rent, /const tenantTag = \(x\) => \(x\.tenant_status === 'archived' \? ' \(archived\)' : x\.lease_status !== 'active' \? ' \(former\)' : ''\);/);
  assert.match(rent, /tenantTag\(l\)/);
  assert.match(rent, /tenantTag\(c\) && h\('span', \{ class: 'muted small' \}, tenantTag\(c\)\)/);
  assert.match(reports, /const tenantTag = \(x\) => \(x\.tenant_status === 'archived' \? ' \(archived\)' : x\.lease_status !== 'active' \? ' \(former\)' : ''\);/);
  assert.match(reports, /tenantTag\(o\) && h\('span', \{ class: 'muted small' \}, tenantTag\(o\)\)/);
  assert.doesNotMatch(rent, /c\.lease_status !== 'active' \? h\('span'/);
});

test('a cancelled group shows a dash, not 0, in the rooms cell', () => {
  assert.match(groups, /isCancelled\(g\) \? '—' : String\(g\.rooms\)/);
});
