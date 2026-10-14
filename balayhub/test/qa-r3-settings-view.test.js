'use strict';

// Audit details for guest-experience and maintenance rows (QA round 3, lane C19). Raw field names never
// reach the Details column: the follow-up switch reads On or Off, the discount reads as a percentage, and a
// repeat schedule reads as one phrase ("every 3 months"), with the unit singular for 1.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const UUID = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
let settings; let dir;

test.before(async () => {
  // settings.js is a browser module. Load it from a temp copy, with its browser-only imports stubbed.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r3-settings-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/settings.js'), path.join(dir, 'views', 'settings.js'));
  globalThis.Element = class { };
  settings = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('the follow-up switch reads On or Off, and the discount reads as a percentage', () => {
  assert.equal(settings.summarize({ abandoned_followup: true, returning_guest_pct: 10 }), 'Follow-up email: On · Returning-guest discount: 10%');
  assert.equal(settings.summarize({ abandoned_followup: false, returning_guest_pct: 25 }), 'Follow-up email: Off · Returning-guest discount: 25%');
});

test('a turned-off discount (saved as null) reads as Off, and other empty values are still left out', () => {
  assert.equal(settings.summarize({ returning_guest_pct: null }), 'Returning-guest discount: Off');
  assert.equal(settings.summarize({ abandoned_followup: true, returning_guest_pct: null }), 'Follow-up email: On · Returning-guest discount: Off');
  assert.equal(settings.summarize({ note: null }), '');
});

test('a repeat schedule reads as one phrase, with the unit singular for 1', () => {
  assert.equal(settings.summarize({ title: 'Gutter check', every_n: 1, every_unit: 'months' }), 'Title: Gutter check · Repeats: every 1 month');
  assert.equal(settings.summarize({ every_n: 3, every_unit: 'months' }), 'Repeats: every 3 months');
  assert.equal(settings.summarize({ every_n: 1, every_unit: 'days' }), 'Repeats: every 1 day');
  assert.equal(settings.summarize({ every_n: 2, every_unit: 'days' }), 'Repeats: every 2 days');
});

test('no raw field name or underscore reaches the Details text of these rows', () => {
  const rows = [
    { abandoned_followup: true, returning_guest_pct: 10 },
    { abandoned_followup: false, returning_guest_pct: 50 },
    { title: 'Gutter check', every_n: 6, every_unit: 'months' },
  ];
  for (const d of rows) {
    const text = settings.summarize(d);
    assert.doesNotMatch(text, /_|every n|every unit|abandoned|guest pct/i, text);
  }
});

// The same assertions as qa-r2-settings-team.test.js, which needs a database. They must keep holding.
test('existing audit detail rules still hold', () => {
  assert.equal(settings.summarize({ enabled: true }), 'Turned on: Yes');
  assert.equal(settings.summarize({ every_n: 2, stray: UUID }), 'Every n: 2');
});
