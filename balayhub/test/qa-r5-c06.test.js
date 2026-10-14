'use strict';

// QA round 5, lane C06 (owners).
// Server half, against its own test database:
// 1. A payout to an owner who owes the workspace is refused for that month, whatever confirm_over says (owners#37).
// 2. A month with nothing owed either way still asks first, as D-76 says (owners#37, the boundary).
// 3. The over-due message names the month ("August 2026"), never the raw code "2026-08" (owners#38).
// Client half, a source scan (the views import the app shell, which does not load in Node):
// 4. The management fee is a percentage number field, not a money field (owners#39).
// 5. An expired or used sign-in link uses the APP-FLOW wording and offers a new link (owners#40).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_03 node --test --test-concurrency=1 test/qa-r5-c06.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');

const today = manilaToday();
const payouts = (id) => `/api/unit-owners/${id}/payouts`;
const body = (over = {}) => ({ amount: '50', paid_on: today, method: 'gcash', month: '2026-08', ...over });

let srv; let owner; let orgId; let property;
const O = {}; // owner ids by key

// A published statement, as the owner would see it: the frozen copy with its payout figure.
const publishedSnapshot = (ownerId, month, payout) => sql(
  `INSERT INTO owner_statements (organization_id, owner_id, month, status, snapshot, published_at)
   VALUES ($1, $2, $3, 'published', $4, now())`,
  [orgId, ownerId, month, JSON.stringify({ totals: { payout }, units: [] })]);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c06-owner@example.com', 'Owners C06 Stays');
  [{ organization_id: orgId }] = await sql(`SELECT organization_id FROM organizations WHERE name = 'Owners C06 Stays'`);
  property = (await owner.post('/api/properties', {
    property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila',
  })).data.property;
  const unit = (await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: '1407', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  O.cy = (await owner.post('/api/unit-owners', { full_name: 'Cy Tan', fee_model: 'flat', flat_monthly_fee: '1500' })).data.owner_id;
  O.ana = (await owner.post('/api/unit-owners', { full_name: 'Ana Cruz' })).data.owner_id;
  O.dee = (await owner.post('/api/unit-owners', { full_name: 'Dee Santos' })).data.owner_id;
  O.eli = (await owner.post('/api/unit-owners', { full_name: 'Eli Reyes' })).data.owner_id;
  // A flat-fee owner with a unit and no stays: July is still a draft, so its due is worked out live.
  O.ben = (await owner.post('/api/unit-owners', { full_name: 'Ben Lim', fee_model: 'flat', flat_monthly_fee: '1500', unit_ids: [unit.unit_id] })).data.owner_id;
  await publishedSnapshot(O.cy, '2026-08', '-1500.00');
  await publishedSnapshot(O.ana, '2026-08', '0.00');
  await publishedSnapshot(O.dee, '2026-09', '1000.00');
  await publishedSnapshot(O.eli, '2026-09', '1000.00');
});
test.after(async () => { await srv.close(); });

test('a payout to an owner who owes the workspace is refused, even when the host confirms it (owners#37)', async () => {
  const plain = await owner.post(payouts(O.cy), body({ amount: '50' }));
  assert.equal(plain.status, 409);
  assert.equal(plain.data.code, 'NOTHING_DUE');
  assert.equal(plain.data.error, "Nothing is due to Cy Tan for August 2026: they owe you ₱1,500.00. A payout can't be recorded for this month.");
  const confirmed = await owner.post(payouts(O.cy), body({ amount: '50', confirm_over: true }));
  assert.equal(confirmed.status, 409, 'confirm_over does not get past this refusal');
  assert.equal(confirmed.data.code, 'NOTHING_DUE');
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM owner_payouts WHERE owner_id = $1', [O.cy]))[0].n, 0, 'nothing saved');
});

test('the same refusal applies to a draft month, which is worked out from the live figures (owners#37)', async () => {
  const { statement } = (await owner.get(`/api/unit-owners/${O.ben}/statement?month=2026-07`)).data;
  assert.equal(statement.totals.payout, '-1500.00', 'the flat fee is owed and there are no stays');
  const r = await owner.post(payouts(O.ben), body({ amount: '50', month: '2026-07' }));
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'NOTHING_DUE');
  assert.equal(r.data.error, "Nothing is due to Ben Lim for July 2026: they owe you ₱1,500.00. A payout can't be recorded for this month.");
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM owner_payouts WHERE owner_id = $1', [O.ben]))[0].n, 0, 'nothing saved');
});

test('a month with nothing owed still asks first, and the message names the month (owners#37, owners#38)', async () => {
  const plain = await owner.post(payouts(O.ana), body({ amount: '50' }));
  assert.equal(plain.status, 409);
  assert.equal(plain.data.code, 'PAYOUT_OVER_DUE');
  assert.equal(plain.data.error, 'This takes the August 2026 payouts to ₱50.00, more than the ₱0.00 due. Confirm to record it anyway.');
  assert.equal((await owner.post(payouts(O.ana), body({ amount: '50', confirm_over: true }))).status, 201);
});

test('the over-due confirm names the month for a normal month too (owners#38)', async () => {
  const over = await owner.post(payouts(O.dee), body({ amount: '1500', month: '2026-09' }));
  assert.equal(over.status, 409);
  assert.equal(over.data.code, 'PAYOUT_OVER_DUE');
  assert.equal(over.data.error, 'This takes the September 2026 payouts to ₱1,500.00, more than the ₱1,000.00 due. Confirm to record it anyway.');
  assert.equal(over.data.due, '1000.00');
  assert.equal(over.data.paid, '0.00');
  assert.equal((await owner.post(payouts(O.dee), body({ amount: '1500', month: '2026-09', confirm_over: true }))).status, 201);
});

test('a payout within the amount due is still recorded without a confirm', async () => {
  assert.equal((await owner.post(payouts(O.eli), body({ amount: '400', month: '2026-09' }))).status, 201);
  assert.equal((await owner.post(payouts(O.eli), body({ amount: '600', month: '2026-09' }))).status, 201, 'exactly the amount due is fine');
});

const ownersSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'owners.js'), 'utf8');
const portalSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'ownerportal.js'), 'utf8');

test('the payout form shows a refusal in the form, and asks "Record anyway" only for an over-due payout (owners#37)', () => {
  const submit = ownersSrc.slice(ownersSrc.indexOf('const recordPayout = () => formModal('), ownersSrc.indexOf('const voidPayout = async'));
  assert.ok(submit.includes("if (err.code !== 'PAYOUT_OVER_DUE') throw err;"));
});

test('the management fee is a percentage number field, not a money field (owners#39)', () => {
  const pct = ownersSrc.split('\n').find((l) => l.includes("name: 'management_fee_pct'"));
  assert.ok(pct, 'the management fee field is in the owner form');
  assert.match(pct, /type: 'number'/);
  assert.match(pct, /label: 'Management fee \(%\)'/);
  assert.match(pct, /inputmode: 'decimal'/);
  assert.match(pct, /step: 0\.01/);
  assert.match(pct, /min: 0/);
  assert.match(pct, /max: 100/);
  assert.doesNotMatch(pct, /type: 'money'/);
  assert.doesNotMatch(ownersSrc, /label: 'Management fee %'/);
});

test('an expired or used sign-in link uses the APP-FLOW wording and offers a new link (owners#40)', () => {
  const view = portalSrc.slice(portalSrc.indexOf('export async function ownerLinkView'), portalSrc.indexOf('export const ownerHomeView'));
  assert.ok(view.includes("'This sign-in link is invalid or has expired. Ask for a new link.'"));
  assert.doesNotMatch(view, /It may have expired or already been used/);
  assert.ok(view.includes("h('a', { class: 'btn btn--primary', href: '#/owner' }, t('Request a new link'))"));
  assert.doesNotMatch(view, /Get a new link/);
  assert.ok(view.includes('err.offline ? err.message :'), 'a connection problem still shows its own message');
});
