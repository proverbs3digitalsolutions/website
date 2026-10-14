'use strict';

// QA round 6, lane C19 (settings and launchpad). An audit row for a listing edit or a guide edit names the fields
// it changed, as labels only, never their values (#43). The launchpad counts a skipped step as skipped, not as
// done, in its headline, its progress bar, its Home reminder and each phase's count (#42).
// Pure helpers are loaded from temp copies of the browser modules, with their browser-only imports stubbed (the same
// approach as test/qa-r3-settings-view.test.js). No database is needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const UUID = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const LAUNCHPAD_SRC = path.join(__dirname, '../public/js/views/launchpad.js');
let settings; let launchpad; let dir;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r6-c19-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/settings.js'), path.join(dir, 'views', 'settings.js'));
  fs.copyFileSync(LAUNCHPAD_SRC, path.join(dir, 'views', 'launchpad.js'));
  globalThis.Element = class { };
  settings = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
  launchpad = await import(pathToFileURL(path.join(dir, 'views', 'launchpad.js')).href);
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------- audit details (#43)

test('a guide edit lists the fields it changed, as plain labels', () => {
  assert.equal(settings.summarize({ fields: ['arrival', 'parking'] }), 'Changed: Arrival, Parking');
  assert.equal(settings.summarize({ fields: ['door_code'] }), 'Changed: Door code');
  assert.equal(settings.summarize({ fields: [] }), '');
});

test('a Taglish guide field reads as a Taglish field, not as a raw key', () => {
  assert.equal(settings.summarize({ fields: ['arrival_tl', 'building_notes'] }), 'Changed: Arrival (Taglish), Building notes');
  assert.equal(settings.summarize({ fields: ['vip', 'gatepass_attach_ids'] }), 'Changed: VIP, Attach IDs');
  assert.equal(settings.summarize({ fields: ['booking_id', 'parking'] }), 'Changed: Parking', 'an id in a change list is left out');
});

test('a listing edit names the fields whose values changed, and never prints a value', () => {
  const text = settings.summarize({
    before: { nightly_rate: '2500.00', cleaning_fee: '300.00', unit_name: 'Unit A' },
    after: { nightly_rate: '2800.00', cleaning_fee: 300, unit_name: 'Unit A' },
  });
  assert.equal(text, 'Changed: Nightly rate');
  assert.doesNotMatch(text, /2800|2500|300/);
});

test('a listing edit that changes nothing shows no changed fields, and a numeric text difference is not a change', () => {
  assert.equal(settings.summarize({ before: { nightly_rate: '2500.00', enabled: true }, after: { nightly_rate: 2500, enabled: true } }), '');
});

test('a changed secret is named by its label only, and ids are not listed', () => {
  const text = settings.summarize({
    before: { door_code: '4455', unit_id: UUID, nightly_rate: '1' },
    after: { door_code: '9988', unit_id: UUID, nightly_rate: '2' },
  });
  assert.equal(text, 'Changed: Door code, Nightly rate');
  assert.doesNotMatch(text, /4455|9988|unit id/i);
});

test('the listing page address reads as a page address in a change list', () => {
  assert.equal(settings.summarize({
    before: { public_slug: 'rio-2210', monthly_rent: '8000' },
    after: { public_slug: 'rio-2211', monthly_rent: '9000' },
  }), 'Changed: Page address, Monthly rent');
});

// ---------------------------------------------------------------- launchpad counts (#42)

test('the headline counts a skipped step as skipped, not as done', () => {
  const steps = [
    { done: true }, { done: true }, { done: true }, { done: true }, { done: true },
    { done: true }, { done: true }, { done: true }, { done: true }, { skipped: true }, {},
  ];
  assert.equal(launchpad.progressLine({ total: 11, steps }), '9 of 11 steps done · 1 skipped');
});

test('the headline has no skipped part when nothing was skipped', () => {
  assert.equal(launchpad.progressLine({ total: 2, steps: [{ done: true }, {}] }), '1 of 2 steps done');
});

test('a phase count does not count its skipped steps as done', () => {
  assert.equal(launchpad.phaseCount([{ done: true }, { skipped: true }, {}]), '1/3 · 1 skipped');
  assert.equal(launchpad.phaseCount([{ skipped: true }]), '0/1 · 1 skipped');
});

test('the launchpad source no longer adds skipped steps into the done count', () => {
  const src = fs.readFileSync(LAUNCHPAD_SRC, 'utf8');
  assert.doesNotMatch(src, /filter\(\(x\) => x\.done \|\| x\.skipped\)\.length/);
  assert.doesNotMatch(src, /\$\{o\.done\}/, 'the headline and reminder do not read the server settled count');
});
