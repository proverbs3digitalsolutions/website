'use strict';

// QA round 20, lane ACP: a ticked limit needs a number (server and form), CODE_TAKEN marks the code box,
// the code box has no maxlength, and the platform admin search hint fits at 390px.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_04 node --test --test-concurrency=1 test/qa-r20-acp.test.js

process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const view = read('public', 'js', 'views', 'admincoupons.js');
const adminView = read('public', 'js', 'views', 'admin.js');

let srv; let boss;
test.before(async () => { srv = await startServer(); boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ'); });
test.after(async () => { await srv.close(); });

const body = (over = {}) => ({
  name: 'R20 test', code: 'R20ONE', kind: 'percent', percent_off: 10, amount_off: null, duration: 'once', duration_months: null,
  plans: [], max_redemptions: null, once_per_workspace: true, require_card: false, starts_on: manilaToday(), note: '', ...over,
});

test('limit ticked with no number is refused on the Total uses box; ticked with a number, or no tick, is saved', async () => {
  for (const max_redemptions of [null, '', undefined]) {
    const r = await boss.post('/api/admin/coupons', body({ code: 'R20LIM', limit_on: true, max_redemptions }));
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.fields.max_redemptions, 'Enter how many times the coupon can be used.');
  }
  assert.equal((await sql(`SELECT 1 FROM platform_coupons WHERE code = 'R20LIM'`)).length, 0);
  assert.equal((await boss.post('/api/admin/coupons', body({ code: 'R20OK', limit_on: true, max_redemptions: 5 }))).status, 201);
  // API callers that never send limit_on keep working.
  assert.equal((await boss.post('/api/admin/coupons', body({ code: 'R20NOFLAG' }))).status, 201);
  assert.equal((await boss.post('/api/admin/coupons', body({ code: 'R20OFF', limit_on: false }))).status, 201);
});

test('CODE_TAKEN names the code field', async () => {
  const r = await boss.post('/api/admin/coupons', body({ code: 'r20ok' }));
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'CODE_TAKEN');
  assert.equal(r.data.fields.code, 'Another coupon already uses this code.');
});

test('form: required total, no code maxlength with a length check, search hints', () => {
  assert.ok(view.includes('Enter how many times the coupon can be used.'));
  assert.ok(view.includes('Codes can be up to 32 characters.'));
  assert.doesNotMatch(view, /name: 'code'[^\n]*maxlength/);
  assert.ok(adminView.includes("placeholder: 'Workspace or owner'"));
  assert.doesNotMatch(adminView, /placeholder: 'Search workspace/);
});
