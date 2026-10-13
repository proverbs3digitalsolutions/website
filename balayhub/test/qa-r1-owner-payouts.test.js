'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');

const today = manilaToday();
let srv; let owner; let ownerId; let orgId;
const payouts = (id) => `/api/unit-owners/${id}/payouts`;
const body = (over = {}) => ({ amount: '400', paid_on: today, method: 'gcash', month: '2026-09', ...over });

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'overpay-owner@example.com', 'Overpay Stays');
  ownerId = (await owner.post('/api/unit-owners', { full_name: 'Juan Dela Cruz' })).data.owner_id;
  [{ organization_id: orgId }] = await sql('SELECT organization_id FROM unit_owners WHERE owner_id = $1', [ownerId]);
  // A published September statement worth 1,000.00 to the owner.
  await sql(`INSERT INTO owner_statements (organization_id, owner_id, month, status, snapshot, published_at)
             VALUES ($1, $2, '2026-09', 'published', $3, now())`,
  [orgId, ownerId, JSON.stringify({ totals: { payout: '1000.00' }, units: [] })]);
});
test.after(async () => { await srv.close(); });

test('a payout that takes the month above the amount due needs confirmation', async () => {
  assert.equal((await owner.post(payouts(ownerId), body({ amount: '400' }))).status, 201);
  assert.equal((await owner.post(payouts(ownerId), body({ amount: '600' }))).status, 201, 'exactly the amount due is fine');
  const over = await owner.post(payouts(ownerId), body({ amount: '50' }));
  assert.equal(over.status, 409);
  assert.equal(over.data.code, 'PAYOUT_OVER_DUE');
  assert.equal(over.data.due, '1000.00');
  assert.equal(over.data.paid, '1000.00');
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM owner_payouts WHERE owner_id = $1', [ownerId]))[0].n, 2, 'nothing saved');
  const ok = await owner.post(payouts(ownerId), body({ amount: '50', confirm_over: true }));
  assert.equal(ok.status, 201);
});

test('a payout with no month is not checked', async () => {
  assert.equal((await owner.post(payouts(ownerId), body({ amount: '99999', month: undefined }))).status, 201);
});

test('voided payouts do not count toward the amount paid', async () => {
  const [{ payout_id }] = await sql("SELECT payout_id FROM owner_payouts WHERE owner_id = $1 AND amount = 600", [ownerId]);
  assert.equal((await owner.post(`/api/owner-payouts/${payout_id}/void`, { reason: 'wrong' })).status, 200);
  assert.equal((await owner.post(payouts(ownerId), body({ amount: '500' }))).status, 201);
});

test('the reserve error shows pesos with a thousands separator', async () => {
  await sql(`INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, note)
             VALUES ($1, $2, 'deposit', 1000, $3, 'top-up')`, [orgId, ownerId, today]);
  const r = await owner.post(`/api/unit-owners/${ownerId}/reserve/withdrawals`, { amount: '1500', entry_date: today, note: 'Repair' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'Only ₱1,000.00 is in the repairs reserve.');
});
