'use strict';

// QA round 13, lane F10 (ops). #49: a cleaner rate above its ceiling is refused at the amount field with the
// server's own sentence, before the "Change this rate?" question. #50: a rate added again under other capitals
// keeps the name already saved. K12: the shortage sentence names the unit for both numbers. The focus keys
// (hk-status, hk-pay, cp-pay-<task>, dc-close, dc-reopen) are the contract the focus guard in ui.js matches on.
// Runs on its own database: TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_05 node --test --test-concurrency=1 test/qa-r13-f10.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cleanerpay = read('public/js/views/cleanerpay.js');
const housekeeping = read('public/js/views/housekeeping.js');
const dailyclose = read('public/js/views/dailyclose.js');
const server = read('src/routes/cleanerpay.js');

let srv; let owner; let dir; let pure;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'f10-owner@example.com', 'F10 Ops');
  // The pure helper comes from a copy of public/js, with a stub for the app's signed-in user (as qa-r4-c09 does).
  globalThis.Element = class { }; // ui.js names the DOM Element class at load time; a stub is enough here
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-f10-r13-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(ROOT, 'public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null, requireEmailVerification: true };\n');
  fs.copyFileSync(path.join(ROOT, 'public/js/views/cleanerpay.js'), path.join(dir, 'views', 'cleanerpay.js'));
  pure = await import(pathToFileURL(path.join(dir, 'views', 'cleanerpay.js')).href);
});

test.after(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await srv.close();
});

test('#49: a rate above its ceiling gets the server sentence, and a readable rate gets none', () => {
  assert.equal(pure.rateCeilingProblem('per_clean', '10001'), "That's more than ₱10,000.00 per clean. Check for an extra zero.");
  assert.equal(pure.rateCeilingProblem('per_clean', '10,001'), "That's more than ₱10,000.00 per clean. Check for an extra zero.");
  assert.equal(pure.rateCeilingProblem('per_hour', '1000.01'), "That's more than ₱1,000.00 per hour. Check for an extra zero.");
  assert.equal(pure.rateCeilingProblem('per_clean', '10,000'), null);
  assert.equal(pure.rateCeilingProblem('per_hour', '1,000'), null);
  assert.equal(pure.rateCeilingProblem('per_clean', '1,0001'), null, 'an amount that cannot be read is left to the server to word');
});

test('#49: the server refuses the same amount with the same sentence', async () => {
  const r = await owner.raw('PUT', '/api/cleaner-rates', { assignee_name: 'QA Ceiling Probe', rate_type: 'per_clean', amount: '10001' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.amount, "That's more than ₱10,000.00 per clean. Check for an extra zero.");
  assert.ok(server.includes("text: '₱10,000.00 per clean'") && server.includes("text: '₱1,000.00 per hour'"), 'the server words the two ceilings as the view does');
});

test('#49: the ceiling is checked at the amount field before the change-rate question', () => {
  const check = cleanerpay.indexOf('rateCeilingProblem(d.rate_type, d.amount)');
  const prior = cleanerpay.indexOf('const prior = !r && existingRate(rates, body)');
  const ask = cleanerpay.indexOf("title: 'Change this rate?'");
  assert.ok(check > 0 && check < prior && prior < ask, 'the ceiling comes first, then the existing-rate lookup, then the question');
  assert.ok(cleanerpay.slice(check, prior).includes('fields: { amount: over }'), 'refused at the amount field, in the same shape as the server\'s VALIDATION error');
});

test('#50: a rate added again under other capitals keeps the name already saved', async () => {
  const put = (b) => owner.raw('PUT', '/api/cleaner-rates', b);
  assert.equal((await put({ assignee_name: 'QA Outside Cleaner', rate_type: 'per_clean', amount: '300' })).status, 200);
  const again = await put({ assignee_name: 'qa outside cleaner', rate_type: 'per_clean', amount: '350' });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.rate.name, 'QA Outside Cleaner');
  assert.equal(again.data.rate.amount, '350.00');
  const rates = (await owner.get('/api/cleaner-rates')).data.rates.filter((r) => r.name.toLowerCase() === 'qa outside cleaner');
  assert.deepEqual(rates.map((r) => r.name), ['QA Outside Cleaner']);
});

test('focus keys: the status, pay, cleaner-pay and daily-close controls carry the shared keys', () => {
  const count = (src, needle) => src.split(needle).length - 1;
  assert.ok(count(housekeeping, "'data-focus-key': 'hk-status'") >= 2, 'Start, Mark done and Reopen');
  assert.ok(count(housekeeping, "'data-focus-key': 'hk-pay'") >= 1, 'Set pay and Edit pay');
  assert.ok(count(cleanerpay, "'data-focus-key': `cp-pay-${x.task_id}`") >= 2, "a row's Edit pay and Undo paid");
  assert.equal(count(dailyclose, "'data-focus-key': 'dc-close'"), 1, 'Close the day or Update close only, so the first match after a save is never Reopen day');
  assert.equal(count(dailyclose, "'data-focus-key': 'dc-reopen'"), 1, 'Reopen day has its own key');
  assert.ok(dailyclose.includes("role: 'group', 'aria-label': 'Daily close actions'"), 'the header group is the shared fallback, so Reopen day lands on Close the day');
});

test('K12: the shortage sentence names the unit for both numbers, with the Taglish entry to match', () => {
  assert.ok(!housekeeping.includes('{count}'), 'no unitless count left in the shortage sentence');
  assert.ok(housekeeping.includes("T('Only {onHand} of {name} {verb} on hand, so {recorded} {verb} recorded.'"), 'the English key the toast uses');
  assert.ok(housekeeping.includes("onHand: qtyLabel(n, s.unit_label), recorded: qtyLabel(n, s.unit_label)"), 'both numbers go through qtyLabel');
  assert.ok(housekeeping.includes("'Only {onHand} of {name} {verb} on hand, so {recorded} {verb} recorded.': '{onHand} lang ng {name} ang nasa stock, kaya {recorded} ang na-record.'"), 'the Taglish entry matches the English key');
});
