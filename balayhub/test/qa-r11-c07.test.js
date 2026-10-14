'use strict';

// QA round 11, lane C07 (listings-settings). Frontend-only: no database. Source scans, plus the pure helpers of
// settings.js run on their own (settings.js imports the signed-in user from app.js, so it is loaded from a temp copy
// with its browser-only imports stubbed, as qa-r3-settings-view does).
// K10, N6: the building name, street address, city and province sit in Basics and are required while a new building
//          is shown (always when the workspace has none); a hidden building is never required.
// K5:      the plan card's "Monthly units are not counted." shows when a listing has no nightly rate, not by the
//          workspace type.
// #19:     the delete-workspace warning and the download text name tenants and leases for a long-term workspace; a
//          short-term workspace reads as before.
// node --test --test-concurrency=1 test/qa-r11-c07.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const views = path.join(__dirname, '..', 'public', 'js', 'views');
const src = fs.readFileSync(path.join(views, 'listings.js'), 'utf8');
const settingsSrc = fs.readFileSync(path.join(views, 'settings.js'), 'utf8');

// Text from a start marker up to the first end marker after it.
function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `found: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `found the end after: ${startMarker}`);
  return text.slice(start, end);
}

const fieldsFn = () => between(src, 'function listingFields(', 'async function addListingModal(');
const addModal = () => between(src, 'async function addListingModal(', '// Listing photos for the booking page');
const bookingCard = () => between(settingsSrc, 'async function bookingCard(', '// Guest experience: public review links');
const planCard = () => between(settingsSrc, 'async function planCard(', '// Choose a plan and length');
const dataCard = () => between(settingsSrc, 'function dataCard(', 'async function manualPaymentsCard(');

// settings.js loaded from a temp copy, with its browser-only imports stubbed (ui.js names the DOM Element class at load).
let settings; let dir;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r11-c07-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  fs.copyFileSync(path.join(views, 'settings.js'), path.join(dir, 'views', 'settings.js'));
  settings = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// ---- K10, N6: the building fields in Basics
test('K10/N6: the building name, street address, city and province are in Basics and marked required', () => {
  const block = between(addModal(), 'const newProp = h(', 'const newPropMore = h(');
  for (const name of ['property_name', 'address', 'city', 'province']) {
    assert.match(block, new RegExp(`field\\(\\{ name: '${name}',[^\\n]*required: true`), `${name} is required in Basics`);
  }
});

test('K10/N6: the four building fields are outside More details; only the property type stays there', () => {
  const more = between(addModal(), 'const newPropMore = h(', 'const showNewBuilding');
  assert.ok(more.includes("name: 'property_type'"), 'the property type is in the new-building block');
  for (const name of ['property_name', 'address', 'city', 'province']) {
    assert.ok(!more.includes(`name: '${name}'`), `${name} is not in the More details block`);
  }
  assert.doesNotMatch(fieldsFn(), /name: '(property_name|address|city|province)'/, 'no building field is inside listingFields (its details groups)');
});

test('K10/N6: a hidden building is never required, so a save on an existing building is not stopped by a blank hidden field', () => {
  const text = addModal();
  assert.match(text, /el\.required = show/, 'showing or hiding the building also sets its required flag');
  assert.match(text, /showNewBuilding\(!properties\.length\);/, 'the starting state follows whether the workspace has a building');
});

// ---- K5: the plan card's monthly note
test('K5: the plan card notes monthly units by listing, not by the workspace type', () => {
  const card = planCard();
  assert.match(card, /monthlyNote\(listings\) && h\('div', \{ class: 'muted small' \}, 'Monthly units are not counted\.'\)/,
    'the note is shown when a listing has no nightly rate');
  assert.doesNotMatch(card, /business_type/, 'the workspace type no longer decides the note');
});

test('K5: monthlyNote is true only when some listing has no nightly rate', () => {
  assert.equal(settings.monthlyNote([{ nightly_rate: '2500.00' }]), false, 'every listing is short-term');
  assert.equal(settings.monthlyNote([{ nightly_rate: '2500.00' }, { nightly_rate: null }]), true, 'one monthly-only listing');
  assert.equal(settings.monthlyNote([{ nightly_rate: null }]), true, 'only monthly listings (long-term)');
  assert.equal(settings.monthlyNote([]), false, 'no listings');
});

// ---- #19: the delete and download texts by workspace type
test('#19: the delete warning and the download text take their names from the workspace type', () => {
  const card = dataCard();
  assert.match(card, /This permanently deletes \$\{deleteText\(u\.business_type\)\} in /, 'the warning names the records of this workspace type');
  assert.match(card, /Download everything in this workspace \(\$\{exportText\(u\.business_type\)\}\) as a file/,
    'the download text names the records of this workspace type');
});

test('#19: the delete warning names tenants and leases for a long-term workspace, and reads as before for short-term', () => {
  assert.equal(settings.deleteText('short_term'), 'all listings, reservations, guests, messages, payments, files and team accounts');
  assert.match(settings.deleteText('long_term'), /tenants, leases, rent payments/);
  assert.doesNotMatch(settings.deleteText('long_term'), /reservations|guests/, 'a long-term workspace is not told about stays');
  assert.match(settings.deleteText('both'), /listings, reservations.*tenants, leases/, 'both sets are named');
});

test('#19: the download text names tenants and leases for a long-term workspace, and reads as before for short-term', () => {
  assert.equal(settings.exportText('short_term'), 'listings, reservations, guests, messages, payments, expenses and more');
  assert.equal(settings.exportText('long_term'), 'properties, units, tenants, leases, rent payments, expenses, maintenance and more');
  assert.match(settings.exportText('both'), /reservations.*tenants, leases/, 'both sets are named');
});

// ---- guard: the 409 text from the booking page's server refusal reaches a toast (C06 contract)
test('the booking page refusal (409 NO_LISTING) shows the server message in a toast', () => {
  assert.match(bookingCard(), /catch \(err\) \{ toast\(err\.message, 'error'\); \}/);
});

// ---- guard: no native dialogs
test('no window.alert, confirm or prompt in the two files', () => {
  for (const text of [src, settingsSrc]) {
    assert.doesNotMatch(text, /(?<![\w.])(window\.)?(alert|confirm|prompt)\(/);
  }
});
