'use strict';

// QA r1 #35: a refund that only returns an overpayment must not reduce income. The overpayment is
// paid - (total - channel_fee), the same balance rule the app uses, in both the P&L and owner statements.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday, addMonths } = require('./helpers');
const { unitPnl } = require('../src/lib/pnl');
const { ownerStatement, refundsBeyondOverpayment } = require('../src/lib/statements');

const M = addMonths(manilaToday(), -1).slice(0, 7);
const day = (n) => `${M}-${String(n).padStart(2, '0')}`;

let srv; let host; let org; let user; let ownerId; let unitA; let unitB;

async function stay(unit, paid, refund) {
  const r = (await host.post('/api/reservations', { unit_id: unit, check_in: day(9), check_out: day(10), guest_name: 'Guest', channel: 'airbnb', channel_fee: '500' })).data.reservation;
  await sql(`INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, recorded_by) VALUES ($1, $2, $3, $4, 'cash', $5)`, [org, r.booking_id, paid, day(10), user]);
  await sql(`INSERT INTO booking_refunds (organization_id, booking_id, amount, refund_date, method, reason, recorded_by) VALUES ($1, $2, $3, $4, 'cash', 'Refund', $5)`, [org, r.booking_id, refund, day(12), user]);
}

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Azure Stays');
  org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Azure Stays'`))[0].organization_id;
  user = (await sql(`SELECT user_id FROM users WHERE email = 'host@example.com'`))[0].user_id;
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unitA = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: 'A', unit_type: 'studio', nightly_rate: '9200' })).data.unit.unit_id;
  unitB = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: 'B', unit_type: 'studio', nightly_rate: '9200' })).data.unit.unit_id;
  ownerId = (await sql(`INSERT INTO unit_owners (organization_id, full_name) VALUES ($1, 'Maria Santos') RETURNING owner_id`, [org]))[0].owner_id;
  await sql('UPDATE units SET owner_id = $1 WHERE unit_id = ANY($2)', [ownerId, [unitA, unitB]]);
  // Total 9,200, fee 500, paid 9,000: the balance rule makes 300 an overpayment (9,000 - 8,700).
  await stay(unitA, '9000.00', '300.00'); // the whole refund returns the overpayment
  await stay(unitB, '9000.00', '400.00'); // only the 100 beyond it counts
});

test.after(async () => { await srv.close(); });

test('shared helper uses total - channel fee', () => {
  assert.equal(refundsBeyondOverpayment({ paid: '9000.00', total_amount: '9200.00', channel_fee: '500.00', before_period: '0', in_period: '300.00' }), 0);
  assert.equal(refundsBeyondOverpayment({ paid: '9000.00', total_amount: '9200.00', channel_fee: '500.00', before_period: '0', in_period: '400.00' }), 10000);
  assert.equal(refundsBeyondOverpayment({ paid: '9000.00', total_amount: '9200.00', channel_fee: '0', before_period: '0', in_period: '300.00' }), 30000);
});

test('P&L counts only the part of a refund beyond the overpayment', async () => {
  const { rows } = await unitPnl(org, M);
  const a = rows.find((r) => r.unit_name === 'A'); const b = rows.find((r) => r.unit_name === 'B');
  assert.equal(a.refunds, '0.00');
  assert.equal(a.net, '8700.00');
  assert.equal(b.refunds, '100.00');
  assert.equal(b.net, '8600.00');
});

test('owner statement matches the P&L', async () => {
  const s = await ownerStatement(org, ownerId, M);
  assert.equal(s.refunded, '100.00');
});
