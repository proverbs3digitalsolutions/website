'use strict';

// QA round 17 RSN (O5, finding #6): an audit reason takes up to 500 characters. The server answers
// "Reason must be at most 500 characters." and stores the whole text, so nothing is cut.
// The refund record is widened too: migration 038 moves booking_refunds.reason's CHECK from 300 to 500.
// node --test --test-concurrency=1 test/qa-r17-rsn.test.js   (TEST_DATABASE_URL = balayhub_test_r2_03)

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const SENTENCE = 'Reason must be at most 500 characters.';
const AT_LIMIT = 'x'.repeat(500);
const OVER_LIMIT = 'x'.repeat(501);
const today = manilaToday();
const refused = (r) => {
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.reason, SENTENCE);
};

const f = {}; // ids made once in test.before
let srv; let owner;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'rsn-owner@example.com', 'Reason Stays');
  f.prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property.property_id;
  const unit = async (unitName) => (await owner.post(`/api/properties/${f.prop}/units`, { unit_name: unitName, unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  const stayUnit = await unit('1208');
  const rentUnit = await unit('1301');

  f.booking = (await owner.post('/api/reservations', { unit_id: stayUnit.unit_id, check_in: ical.addDays(today, 20), check_out: ical.addDays(today, 22), guest_name: 'Reason Guest' })).data.reservation.booking_id;
  assert.equal((await owner.post(`/api/reservations/${f.booking}/payments`, { amount: '3000.00', payment_date: today, payment_method: 'gcash' })).status, 201);

  const tenant = await owner.post('/api/tenants', { full_name: 'Reason Tenant' });
  const lease = await owner.post('/api/leases', { tenant_id: tenant.data.tenant.tenant_id, unit_id: rentUnit.unit_id, start_date: today, monthly_rent: '6000', due_day: 5 });
  assert.equal(lease.status, 201, JSON.stringify(lease.data));
  f.lease = lease.data.lease.lease_id;

  f.ownerId = (await owner.post('/api/unit-owners', { full_name: 'Reason Owner' })).data.owner_id;
  const [{ organization_id: org }] = await sql('SELECT organization_id FROM unit_owners WHERE owner_id = $1', [f.ownerId]);
  // A published statement worth 1,000.00 to the owner, and a reserve deposit to withdraw from.
  await sql(`INSERT INTO owner_statements (organization_id, owner_id, month, status, snapshot, published_at)
             VALUES ($1, $2, '2026-09', 'published', $3, now())`,
  [org, f.ownerId, JSON.stringify({ totals: { payout: '1000.00' }, units: [] })]);
  await sql(`INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, note)
             VALUES ($1, $2, 'deposit', 1000, $3, 'top-up')`, [org, f.ownerId, today]);

  // A pending payment proof: manual payments on, then the guest sends the details step.
  assert.equal((await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: 'GCash 0917 123 4567 (Maria Santos)' })).status, 200);
  const proofStay = (await owner.post('/api/reservations', { unit_id: stayUnit.unit_id, check_in: ical.addDays(today, 40), check_out: ical.addDays(today, 42), guest_name: 'Proof Guest', guest_email: 'proof@example.com' })).data.reservation.booking_id;
  const link = await owner.get(`/api/reservations/${proofStay}/payment-link`);
  assert.equal(link.data.available, true, JSON.stringify(link.data));
  const sent = await client(srv.base).post(`/api/public/pay/${link.data.link.split('/#/pay/')[1]}/proofs`, { amount: '1000', method: 'gcash', reference_number: 'REF-1000', payer_name: 'Ana Cruz' });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  f.proofId = sent.data.proof_id;
});
test.after(async () => { await srv.close(); });

test('refund record: a 501-character reason is refused with the 500 sentence, a 500-character one is saved', async () => {
  const p = `/api/reservations/${f.booking}/refunds`;
  const body = { amount: '100.00', refund_date: today, method: 'gcash' };
  refused(await owner.post(p, { ...body, reason: OVER_LIMIT }));
  assert.equal((await owner.post(p, { ...body, reason: AT_LIMIT })).status, 201);
});

test('refund void: a 501-character reason is refused and voids nothing; 500 voids and is stored whole', async () => {
  const made = await owner.post(`/api/reservations/${f.booking}/refunds`, { amount: '100.00', refund_date: today, method: 'gcash', reason: 'Cancelled by guest' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.refund.refund_id;
  refused(await owner.post(`/api/refunds/${id}/void`, { reason: OVER_LIMIT }));
  assert.equal((await sql('SELECT voided_at FROM booking_refunds WHERE refund_id = $1', [id]))[0].voided_at, null);
  assert.equal((await owner.post(`/api/refunds/${id}/void`, { reason: AT_LIMIT })).status, 200);
  assert.equal((await sql('SELECT length(void_reason) AS n FROM booking_refunds WHERE refund_id = $1', [id]))[0].n, 500);
});

test('charge void: a 501-character reason is refused; 500 voids and is stored whole', async () => {
  const made = await owner.post(`/api/reservations/${f.booking}/charges`, { category: 'late_checkout', description: 'Late check-out', unit_price: '500' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.charge.charge_id;
  refused(await owner.post(`/api/charges/${id}/void`, { reason: OVER_LIMIT }));
  assert.equal((await owner.post(`/api/charges/${id}/void`, { reason: AT_LIMIT })).status, 200);
  assert.equal((await sql('SELECT length(void_reason) AS n FROM booking_charges WHERE charge_id = $1', [id]))[0].n, 500);
});

test('rent payment void: a 501-character reason is refused; 500 voids and is stored whole', async () => {
  const made = await owner.post('/api/payments', { lease_id: f.lease, amount_paid: '500.00', payment_date: today, payment_method: 'cash' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.payment.payment_id;
  refused(await owner.post(`/api/payments/${id}/void`, { reason: OVER_LIMIT }));
  assert.equal((await owner.post(`/api/payments/${id}/void`, { reason: AT_LIMIT })).status, 200);
  assert.equal((await sql('SELECT length(void_reason) AS n FROM payments WHERE payment_id = $1', [id]))[0].n, 500);
});

test('expense void: a 501-character reason is refused; 500 voids and is stored whole', async () => {
  const made = await owner.post('/api/expenses', { property_id: f.prop, category: 'repairs', amount: '250.00', expense_date: today, description: 'Fix the tap' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.expense.expense_id;
  refused(await owner.post(`/api/expenses/${id}/void`, { reason: OVER_LIMIT }));
  assert.equal((await owner.post(`/api/expenses/${id}/void`, { reason: AT_LIMIT })).status, 200);
  assert.equal((await sql('SELECT length(void_reason) AS n FROM expenses WHERE expense_id = $1', [id]))[0].n, 500);
});

test('owner payout void: a 501-character reason is refused; 500 voids', async () => {
  const made = await owner.post(`/api/unit-owners/${f.ownerId}/payouts`, { amount: '400', paid_on: today, method: 'gcash', month: '2026-09' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.payout.payout_id;
  refused(await owner.post(`/api/owner-payouts/${id}/void`, { reason: OVER_LIMIT }));
  assert.equal((await owner.post(`/api/owner-payouts/${id}/void`, { reason: AT_LIMIT })).status, 200);
});

test('reserve withdrawal void: a 501-character reason is refused; 500 voids', async () => {
  const made = await owner.post(`/api/unit-owners/${f.ownerId}/reserve/withdrawals`, { amount: '100', entry_date: today, note: 'Repair' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.entry.entry_id;
  refused(await owner.post(`/api/reserve-entries/${id}/void`, { reason: OVER_LIMIT }));
  assert.equal((await owner.post(`/api/reserve-entries/${id}/void`, { reason: AT_LIMIT })).status, 200);
});

test('proof reject: a 501-character reason is refused; 500 rejects the proof and is stored whole', async () => {
  refused(await owner.post(`/api/payment-proofs/${f.proofId}/reject`, { reason: OVER_LIMIT }));
  assert.equal((await owner.post(`/api/payment-proofs/${f.proofId}/reject`, { reason: AT_LIMIT })).status, 200);
  const [row] = await sql('SELECT status, length(reject_reason) AS n FROM payment_proofs WHERE proof_id = $1', [f.proofId]);
  assert.equal(row.status, 'rejected');
  assert.equal(row.n, 500);
});
