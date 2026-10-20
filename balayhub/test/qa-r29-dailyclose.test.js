'use strict';

// QA round 29, OPS-1 (wording): a date that is not real says what happened and what is shown instead
// ("That date isn't valid, so this shows today."), as the after-tomorrow case already does (D-111).
// Frontend-only: no database. The view is loaded from a temp copy, with reservations.js reduced to addDays (as qa-r1-dailyclose-date does).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let dailyclose; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-dailyclose-r29-'));
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

const TODAY = '2026-10-21';
const TOMORROW = '2026-10-22';
const INVALID_TODAY = "That date isn't valid, so this shows today.";
const CLAMPED = 'You can close a day up to tomorrow, so this shows tomorrow.';

test('a date that is not real says so and shows today', () => {
  assert.deepEqual(dailyclose.closeDayFor('1900-01-01', TODAY), { date: TODAY, message: INVALID_TODAY });
  assert.deepEqual(dailyclose.closeDayFor('2026-02-30', TODAY), { date: TODAY, message: INVALID_TODAY });
  assert.deepEqual(dailyclose.closeDayFor('2027-02-29', TODAY), { date: TODAY, message: INVALID_TODAY });
  assert.deepEqual(dailyclose.closeDayFor('garbage', TODAY), { date: TODAY, message: INVALID_TODAY });
});

test('a date after tomorrow still shows tomorrow with its own sentence', () => {
  assert.deepEqual(dailyclose.closeDayFor('2099-01-01', TODAY), { date: TOMORROW, message: CLAMPED });
});

test('a missing or empty date means today with no message', () => {
  assert.deepEqual(dailyclose.closeDayFor('', TODAY), { date: TODAY, message: null });
  assert.deepEqual(dailyclose.closeDayFor(undefined, TODAY), { date: TODAY, message: null });
});
