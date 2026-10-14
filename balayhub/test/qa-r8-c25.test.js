'use strict';

// QA round 8, lane C25 (properties-view). Frontend-only: no database.
// #17 / K12: every unit action on the property page (Assign Tenant, Edit, Archive, Restore) names its unit in
// its accessible name, so a screen reader user can tell five "Archive" buttons apart. Source scan of the unit
// row, since the view imports the app shell, which does not load in Node.
// node --test --test-concurrency=1 test/qa-r8-c25.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'properties.js'), 'utf8');
const detail = src.slice(src.indexOf('export async function propertyDetailView'));
const unitRow = detail.slice(detail.indexOf('const unitRow = (u) => {'), detail.indexOf('// Unit filters'));
// Each h('button', ...) call in the unit row, from its opening to the next call (or the end of the row).
const buttons = unitRow.split("h('button'").slice(1);

test('the unit row has four unit action buttons: Assign Tenant, Edit, Archive, Restore', () => {
  assert.equal(buttons.length, 4);
});

test('every unit action button carries an aria-label that names its unit', () => {
  for (const chunk of buttons) {
    assert.match(chunk, /'aria-label': `(Assign tenant to|Edit|Archive|Restore) unit \$\{u\.unit_name\}`/);
  }
});
