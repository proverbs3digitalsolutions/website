'use strict';

// QA round 8, lane C41 (last re-verify items). Two fixes:
// SEV2: the Listings status tabs (All / Needs cleaning / Clean) keep one tablist element for the page's life. Each render
//   replaces only its buttons, so the shared focus guard in ui.js (D-89) finds the tablist it started from,
//   and keyboard focus stays on the tab after ArrowRight instead of dropping to the page body.
// SEV3: the Notifications card Save button on My account names its card ("Save notifications"), as settings.js does.
// Frontend-only: no database. Source scans of listings.js and account.js (both import app.js, so they are read as text).
// node --test --test-concurrency=1 test/qa-r8-c41.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const views = path.join(__dirname, '..', 'public', 'js', 'views');
const src = fs.readFileSync(path.join(views, 'listings.js'), 'utf8');
const account = fs.readFileSync(path.join(views, 'account.js'), 'utf8');

// The Listings page view, from its export up to the next view in the file.
function listingsView() {
  const start = src.indexOf('export async function listingsView(');
  const end = src.indexOf('export async function guestsView(', start);
  assert.notEqual(start, -1, 'listingsView is exported');
  assert.notEqual(end, -1, 'guestsView follows listingsView');
  return src.slice(start, end);
}

test('the status tablist is built once for the page and reused by every render (SEV2)', () => {
  const view = listingsView();
  const made = "h('div', { class: 'tabs', role: 'tablist' })";
  assert.equal(view.split(made).length - 1, 1, 'the status tablist element is built in exactly one place');
  const built = view.indexOf(`const tabs = ${made};`);
  assert.notEqual(built, -1, 'the one tablist is named tabs');
  const load = view.indexOf('  async function load() {');
  assert.notEqual(load, -1, 'load() is in the view');
  assert.ok(built < load, 'the tablist is built before load(), which runs on every render');
  const body = view.slice(load);
  assert.doesNotMatch(body, /h\('div', \{ class: 'tabs', role: 'tablist' \}/, 'load() never builds a new tablist');
  assert.match(body, /tabs\.replaceChildren\(/, 'load() swaps the tab buttons inside that same tablist');
  assert.match(body, /box\.replaceChildren\(tabs, /, 'the page shows that same tablist');
});

test('the three status tabs keep their labels, counts and aria-selected (SEV2)', () => {
  const view = listingsView();
  const body = view.slice(view.indexOf('  async function load() {'));
  assert.ok(body.includes("'aria-selected': String(!filters.cleaning)"), 'All is selected when no cleaning filter is set');
  assert.ok(body.includes("'aria-selected': String(filters.cleaning === 'dirty')"), 'Needs cleaning is selected on dirty');
  assert.ok(body.includes("'aria-selected': String(filters.cleaning === 'clean')"), 'Clean is selected on clean');
  assert.ok(body.includes('`All (${base.length})`'), 'All shows its count');
  assert.ok(body.includes('`Needs cleaning (${dirtyCount})`'), 'Needs cleaning shows its count');
  assert.ok(body.includes('`Clean (${base.length - dirtyCount})`'), 'Clean shows its count');
  assert.equal(body.split("role: 'tab'").length - 1, 3, 'exactly three tab buttons');
});

test('the Notifications card Save button names its card and still shows Save (SEV3)', () => {
  const start = account.indexOf('function notifyCard(role) {');
  const end = account.indexOf('export async function accountView(', start);
  assert.notEqual(start, -1, 'notifyCard is in account.js');
  assert.notEqual(end, -1, 'accountView follows notifyCard');
  const card = account.slice(start, end);
  assert.match(card, /const save = h\('button', \{ class: 'btn btn--primary btn--sm', type: 'submit', 'aria-label': 'Save notifications' \}, 'Save'\);/,
    'the Save button is named for its card, and its visible text stays Save');
});
