'use strict';

// QA round 5, C12 ops views (#31, #33, #35, Q9). Supplies refuses a decimal quantity before it asks
// about stock. A request offers only the status buttons that make sense for it. A next-due date that
// is already past asks first. A cleaner rate is asked about only when it reads as a positive amount.
// Frontend-only: no database.
// node --test --test-concurrency=1 test/qa-r5-c12.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const VIEWS = path.join(__dirname, '../public/js/views');
const supplies = fs.readFileSync(path.join(VIEWS, 'supplies.js'), 'utf8');
const maintenance = fs.readFileSync(path.join(VIEWS, 'maintenance.js'), 'utf8');
const cleanerpay = fs.readFileSync(path.join(VIEWS, 'cleanerpay.js'), 'utf8');

let maint; let pay; let dir;
test.before(async () => {
  globalThis.Element = class { }; // ui.js names the DOM Element class at load time; a stub is enough here
  // The views import app.js for the signed-in user, so load them from a temp copy with a stub app.js.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r5-c12-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null, requireEmailVerification: true };\nexport const navigate = () => {};\n');
  for (const f of ['maintenance.js', 'cleanerpay.js']) fs.copyFileSync(path.join(VIEWS, f), path.join(dir, 'views', f));
  maint = await import(pathToFileURL(path.join(dir, 'views', 'maintenance.js')));
  pay = await import(pathToFileURL(path.join(dir, 'views', 'cleanerpay.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a decimal quantity is refused before the not-enough-on-hand question, and nothing is sent', () => {
  const check = supplies.indexOf('Number.isInteger(quantity)');
  const ask = supplies.indexOf("title: 'Not enough on hand'");
  const send = supplies.indexOf('/movements`');
  assert.ok(check > 0, 'the whole-number check is there');
  assert.ok(ask > check, 'the question comes after the check');
  assert.ok(send > check, 'the movement is sent only after the check');
  assert.match(supplies, /Quantity must be a whole number\./);
  assert.match(supplies, /showErrors\(form, \{ quantity:/, 'the message shows at the quantity field');
});

test('a resolved request offers Reopen and Cancel request; a cancelled one offers only Reopen', () => {
  assert.deepEqual(maint.nextStatuses('resolved'), ['open', 'cancelled']);
  assert.deepEqual(maint.nextStatuses('cancelled'), ['open']);
});

test('an open or in-progress request keeps every other status button', () => {
  assert.deepEqual(maint.nextStatuses('open'), ['in_progress', 'resolved', 'cancelled']);
  assert.deepEqual(maint.nextStatuses('in_progress'), ['open', 'resolved', 'cancelled']);
});

test('a next-due date already in the past asks first, and Cancel saves nothing', () => {
  const guard = maintenance.indexOf('d.next_due < todayManila()');
  const ask = maintenance.indexOf("title: 'Next due date is in the past'");
  const save = maintenance.indexOf("await post('/maintenance-schedules'");
  assert.ok(guard > 0 && ask > guard, 'the past-date check comes before the question');
  assert.ok(save > ask, 'the question comes before the save');
  assert.match(maintenance, /A request opens at the next hourly check\. Save anyway\?/);
  assert.match(maintenance.slice(ask, save), /return false;/, 'Cancel stops before the save');
});

test('readRate reads an amount the way the server does and gives NaN for anything else', () => {
  assert.equal(pay.readRate('1,000'), 1000);
  assert.equal(pay.readRate('₱1,250.50'), 1250.5);
  assert.equal(pay.readRate('PHP 400'), 400);
  assert.equal(pay.readRate('0'), 0);
  assert.ok(Number.isNaN(pay.readRate('-10')), 'a negative rate is not a readable amount');
  assert.ok(Number.isNaN(pay.readRate('1,5')), 'a comma in the wrong place is not readable');
  assert.ok(Number.isNaN(pay.readRate('abc')));
});

test('the change-rate question is asked only for a readable positive amount, and Cancel keeps the dialog', () => {
  const prior = cleanerpay.indexOf('const prior = !r && existingRate(rates, body)');
  const gate = cleanerpay.indexOf('if (prior && readRate(d.amount) > 0)');
  const ask = cleanerpay.indexOf("title: 'Change this rate?'");
  const save = cleanerpay.indexOf("await api('PUT', '/cleaner-rates', body)");
  assert.ok(prior > 0 && gate > prior, 'the amount is checked after the existing-rate lookup');
  assert.ok(ask > gate && save > ask, 'the question sits behind the amount check and before the save');
  assert.match(cleanerpay.slice(ask, save), /return false;/, 'Cancel returns false so the dialog stays open');
});
