'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const account = require('../src/lib/account');
const { createStaysWorkspace } = require('../src/lib/demo');

let srv; let orgId;
test.before(async () => {
  srv = await startServer();
  orgId = await createStaysWorkspace({ email: 'm027@example.com', passwordHash: 'x' });
});
test.after(async () => { await srv.close(); });

const cols = async (table) => (await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).map((r) => r.column_name);

test('027: new tables and columns exist with the spec defaults', async () => {
  for (const t of ['booking_charges', 'booking_refunds', 'payment_proofs']) assert.ok((await cols(t)).length > 0, `${t} exists`);
  assert.ok((await cols('booking_charges')).includes('amount'));
  assert.ok((await cols('bookings')).includes('extras_total'));
  for (const c of ['cancellation_policy', 'cancellation_policy_text', 'deposit_pct']) assert.ok((await cols('units')).includes(c), c);
  for (const c of ['manual_payments_enabled', 'manual_payment_instructions']) assert.ok((await cols('organizations')).includes(c), c);
  const u = (await sql(`SELECT deposit_pct, cancellation_policy FROM units LIMIT 1`))[0];
  assert.equal(u.deposit_pct, 50);
  assert.equal(u.cancellation_policy, null);
  const o = (await sql(`SELECT manual_payments_enabled FROM organizations WHERE organization_id = $1`, [orgId]))[0];
  assert.equal(o.manual_payments_enabled, false);
});

test('027: total_amount includes extras_total; charge amount is quantity x unit price', async () => {
  const [b] = await sql(`SELECT booking_id, accommodation_total, cleaning_fee, other_fees, total_amount FROM bookings WHERE organization_id = $1 AND kind = 'reservation' LIMIT 1`, [orgId]);
  const before = Number(b.total_amount);
  assert.equal(before, Number(b.accommodation_total) + Number(b.cleaning_fee) + Number(b.other_fees));
  await sql(`UPDATE bookings SET extras_total = 250.50 WHERE booking_id = $1`, [b.booking_id]);
  const [after] = await sql(`SELECT total_amount FROM bookings WHERE booking_id = $1`, [b.booking_id]);
  assert.equal(Number(after.total_amount), before + 250.5);
  await assert.rejects(sql(`UPDATE bookings SET extras_total = -1 WHERE booking_id = $1`, [b.booking_id]), /check/i);
  await assert.rejects(sql(`UPDATE bookings SET total_amount = 1 WHERE booking_id = $1`, [b.booking_id]), /only be updated to DEFAULT/i);
  const [c] = await sql(`INSERT INTO booking_charges (organization_id, booking_id, category, description, quantity, unit_price)
    VALUES ($1, $2, 'extra_bed', 'Extra bed', 3, 400.25) RETURNING amount`, [orgId, b.booking_id]);
  assert.equal(c.amount, '1200.75');
  await assert.rejects(sql(`INSERT INTO booking_charges (organization_id, booking_id, category, description, unit_price) VALUES ($1, $2, 'bogus', 'x', 5)`, [orgId, b.booking_id]), /check/i);
  await assert.rejects(sql(`INSERT INTO booking_charges (organization_id, booking_id, category, description, unit_price) VALUES ($1, $2, 'other', 'x', 0)`, [orgId, b.booking_id]), /check/i);
  await assert.rejects(sql(`INSERT INTO booking_charges (organization_id, booking_id, category, description, quantity, unit_price) VALUES ($1, $2, 'other', 'x', 100, 5)`, [orgId, b.booking_id]), /check/i);
});

test('027: files accepts payment_proof and booking_payment, still rejects unknown types', async () => {
  const def = (await sql(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'files_related_record_type_check'`))[0].d;
  assert.match(def, /payment_proof/);
  assert.match(def, /booking_payment/);
  assert.match(def, /support/, 'earlier values kept');
  const [u] = await sql(`SELECT user_id FROM users WHERE organization_id = $1 LIMIT 1`, [orgId]);
  const ins = (type) => sql(`INSERT INTO files (organization_id, related_record_type, related_record_id, file_name, storage_key, mime_type, size_bytes, uploaded_by)
    VALUES ($1, $2, gen_random_uuid(), 'a.png', 'k-' || gen_random_uuid(), 'image/png', 10, $3)`, [orgId, type, u.user_id]);
  await ins('payment_proof');
  await ins('booking_payment');
  await assert.rejects(ins('nonsense'), /check/i);
});

test('027: purge removes the new rows and the workspace; export includes them', async () => {
  const [b] = await sql(`SELECT booking_id FROM bookings WHERE organization_id = $1 AND kind = 'reservation' LIMIT 1`, [orgId]);
  const [u] = await sql(`SELECT user_id FROM users WHERE organization_id = $1 LIMIT 1`, [orgId]);
  const [p] = await sql(`INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, recorded_by)
    VALUES ($1, $2, 100, current_date, 'gcash', $3) RETURNING payment_id`, [orgId, b.booking_id, u.user_id]);
  await sql(`INSERT INTO booking_charges (organization_id, booking_id, category, description, unit_price) VALUES ($1, $2, 'damage', 'Broken glass', 50)`, [orgId, b.booking_id]);
  await sql(`INSERT INTO booking_refunds (organization_id, booking_id, amount, refund_date, method, reason) VALUES ($1, $2, 20, current_date, 'cash', 'Goodwill')`, [orgId, b.booking_id]);
  await sql(`INSERT INTO payment_proofs (organization_id, booking_id, amount, method, status, payment_id) VALUES ($1, $2, 100, 'gcash', 'confirmed', $3)`, [orgId, b.booking_id, p.payment_id]);
  await assert.rejects(sql(`INSERT INTO booking_refunds (organization_id, booking_id, amount, refund_date, method, reason) VALUES ($1, $2, 20, current_date, 'channel_payout', 'x')`, [orgId, b.booking_id]), /check/i);
  await assert.rejects(sql(`INSERT INTO payment_proofs (organization_id, booking_id, amount, method, status) VALUES ($1, $2, 5, 'cash', 'pending')`, [orgId, b.booking_id]), /check/i);

  const exp = await account.exportOrganization(orgId);
  assert.equal(exp.booking_charges.length, 2, "one from the earlier test, one here");
  assert.equal(exp.booking_refunds.length, 1);
  assert.equal(exp.payment_proofs.length, 1);

  for (const t of ['booking_charges', 'booking_refunds', 'payment_proofs']) assert.ok(account.PURGED_TABLES.includes(t), t);
  await account.purgeOrganization(orgId);
  for (const t of ['booking_charges', 'booking_refunds', 'payment_proofs']) {
    assert.equal((await sql(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [orgId]))[0].n, 0, t);
  }
  assert.equal((await sql(`SELECT count(*)::int AS n FROM organizations WHERE organization_id = $1`, [orgId]))[0].n, 0);
});
