'use strict';
// QA round 18, lane PH (frontend only): search hints are short enough for a 390px phone; the full sentence stays as the screen-reader name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const v = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', f), 'utf8');

test('housekeeping, maintenance and expenses search hints are short and keep the full name', () => {
  assert.ok(v('housekeeping.js').includes("search: { placeholder: 'Listing, cleaner, notes', label: 'Search listing, cleaner or notes' }"));
  assert.ok(v('maintenance.js').includes("search: { placeholder: 'Issue, unit, person', label: 'Search issue, unit, reported by or assigned to' }"));
  assert.ok(v('rent.js').includes("search: { placeholder: 'Description or vendor', label: 'Search description, vendor or property' }"));
});

test('guests list search hint is short and keeps the full name (listings.js guestsView, route /guests)', () => {
  assert.ok(v('listings.js').includes("search: { placeholder: canManage ? 'Name, mobile, email' : 'Search guests', label: canManage ? 'Search name, mobile or email' : 'Search guests' }"));
});
