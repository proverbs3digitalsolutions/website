'use strict';

require('./helpers');

// QA round 40 (D-122): a removed unit owner takes no new payout, and the statement says whether the owner was removed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');

const today = manilaToday();
const payoutBody = (over = {}) => ({ amount: '100', paid_on: today, method: 'cash', month: '2026-09', ...over });
const payouts = (id) => `/api/unit-owners/${id}/payouts`;
const statement = (id) => `/api/unit-owners/${id}/statement?month=2026-09`;
const REMOVED_TEXT = "Juan Dela Cruz was removed, so a payout can't be recorded. Payouts already recorded stay on their statements.";

let srv; let host; let other; let leftId; let keepId; let earlyPayoutId;

const payoutRows = async (id) => (await sql('SELECT payout_id FROM owner_payouts WHERE owner_id = $1', [id])).length;

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'ownerpay-host@example.com', 'Ownerpay Stays');
  other = await ownerAccount(srv.base, 'ownerpay-other@example.com', 'Ownerpay Other');
  const property = (await host.post('/api/properties', {
    property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila',
  })).data.property;
  const unit = (await host.post(`/api/properties/${property.property_id}/units`,
    { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  leftId = (await host.post('/api/unit-owners', { full_name: 'Juan Dela Cruz', management_fee_pct: '20', unit_ids: [unit.unit_id] })).data.owner_id;
  keepId = (await host.post('/api/unit-owners', { full_name: 'Pedro Reyes' })).data.owner_id;
});
test.after(async () => { await srv.close(); });

test('a payout recorded before the owner is removed is saved', async () => {
  // Nothing is due yet (no bookings), so the host confirms the payout. The test is about the removal, not the amount.
  const r = await host.post(payouts(leftId), payoutBody({ confirm_over: true }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  earlyPayoutId = r.data.payout.payout_id;
});

test('a statement says archived: false for an owner who is still active', async () => {
  const left = await host.get(statement(leftId));
  assert.equal(left.status, 200);
  assert.equal(left.data.archived, false);
  assert.equal((await host.get(statement(keepId))).data.archived, false);
});

test('removing the owner archives it', async () => {
  const r = await host.post(`/api/unit-owners/${leftId}/archive`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('after removal the statement says archived: true, and the active owner still says false', async () => {
  const left = await host.get(statement(leftId));
  assert.equal(left.status, 200);
  assert.equal(left.data.archived, true);
  assert.equal((await host.get(statement(keepId))).data.archived, false);
});

test('a removed owner takes no new payout: 409 OWNER_REMOVED, the owner named, nothing written', async () => {
  const r = await host.post(payouts(leftId), payoutBody({ amount: '50' }), { 'Idempotency-Key': 'qa-r40-ownerpay-1' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'OWNER_REMOVED');
  assert.equal(r.data.error, REMOVED_TEXT);
  assert.equal(await payoutRows(leftId), 1, 'only the payout recorded before the removal');
});

test('the same Idempotency-Key sent again is refused the same way: no replay and no second row', async () => {
  const r = await host.post(payouts(leftId), payoutBody({ amount: '50' }), { 'Idempotency-Key': 'qa-r40-ownerpay-1' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'OWNER_REMOVED');
  assert.equal(await payoutRows(leftId), 1);
});

test('the payout recorded before the removal is still listed and can be voided after it', async () => {
  const list = await host.get(payouts(leftId));
  assert.equal(list.status, 200);
  const early = list.data.payouts.find((p) => p.payout_id === earlyPayoutId);
  assert.ok(early, 'listed after the removal');
  assert.equal(early.voided, false);
  const voided = await host.post(`/api/owner-payouts/${earlyPayoutId}/void`, { reason: 'QA r40 ownerpay void' });
  assert.equal(voided.status, 200, JSON.stringify(voided.data));
  const after = (await host.get(payouts(leftId))).data.payouts.find((p) => p.payout_id === earlyPayoutId);
  assert.equal(after.voided, true);
});

test('another workspace gets 404 for the removed owner and for the active one, as before', async () => {
  const removed = await other.post(payouts(leftId), payoutBody());
  assert.equal(removed.status, 404, JSON.stringify(removed.data));
  assert.equal(removed.data.code, 'NOT_FOUND');
  assert.equal((await other.post(payouts(keepId), payoutBody())).status, 404);
  assert.equal(await payoutRows(leftId), 1);
});

test('an active owner still takes a payout', async () => {
  const r = await host.post(payouts(keepId), payoutBody({ amount: '100' }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
});
