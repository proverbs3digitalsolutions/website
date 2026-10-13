'use strict';

// Daily close date check (QA round 1, #1): a typed or linked date is checked before the page loads.
// A date after tomorrow is clamped to tomorrow; a date that is not real falls back to today.
// Frontend-only: no database. The view is loaded from a temp copy, with reservations.js reduced to addDays.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let dailyclose; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-dailyclose-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/views/dailyclose.js'), path.join(dir, 'views', 'dailyclose.js'));
  // The real addDays, copied from reservations.js so the test cannot drift from it.
  const reservations = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
  globalThis.Element = class { };
  dailyclose = await import(pathToFileURL(path.join(dir, 'views', 'dailyclose.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const TODAY = '2026-10-13';
const TOMORROW = '2026-10-14';
const CLAMPED = 'You can close a day up to tomorrow, so this shows tomorrow.';
const INVALID = "That date isn't valid.";

test('a date after tomorrow is clamped to tomorrow with a message, never sent to the server', () => {
  assert.deepEqual(dailyclose.closeDayFor('2028-02-29', TODAY), { date: TOMORROW, message: CLAMPED });
  assert.deepEqual(dailyclose.closeDayFor('2026-10-16', TODAY), { date: TOMORROW, message: CLAMPED });
});

test('a date that is not real is refused with a message and today is shown', () => {
  assert.deepEqual(dailyclose.closeDayFor('2027-02-29', TODAY), { date: TODAY, message: INVALID });
  assert.deepEqual(dailyclose.closeDayFor('2026-02-30', TODAY), { date: TODAY, message: INVALID });
  assert.deepEqual(dailyclose.closeDayFor('garbage', TODAY), { date: TODAY, message: INVALID });
  assert.deepEqual(dailyclose.closeDayFor('2026-13-01', TODAY), { date: TODAY, message: INVALID });
});

test('today, tomorrow and earlier days load with no message', () => {
  assert.deepEqual(dailyclose.closeDayFor(TODAY, TODAY), { date: TODAY, message: null });
  assert.deepEqual(dailyclose.closeDayFor(TOMORROW, TODAY), { date: TOMORROW, message: null });
  assert.deepEqual(dailyclose.closeDayFor('2026-10-01', TODAY), { date: '2026-10-01', message: null });
});

test('a missing or empty date means today with no message', () => {
  assert.deepEqual(dailyclose.closeDayFor(undefined, TODAY), { date: TODAY, message: null });
  assert.deepEqual(dailyclose.closeDayFor('', TODAY), { date: TODAY, message: null });
});
