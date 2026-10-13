'use strict';

// QA round 1 #48: for a month with a published statement, the owner portal P&L shows the frozen copy (D-41),
// not live numbers. Months without one stay live.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { outbox } = require('../src/lib/mailer');

const AUG = '2026-08';
const JUN = '2026-06';
let srv; let host; let propertyId; let unit; let other; let owner; let ownerC;

const addExpense = async (u, amount, date) => (await host.post('/api/expenses', {
  property_id: propertyId, unit_id: u.unit_id, category: 'repairs', description: 'Aircon', amount, expense_date: date,
})).data;

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host-l06@example.com', 'L06 Stays');
  propertyId = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property.property_id;
  const mk = async (name) => (await host.post(`/api/properties/${propertyId}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unit = await mk('1201');
  other = await mk('805');
  owner = (await host.post('/api/unit-owners', { full_name: 'Maria Santos', email: 'maria-l06@example.com', management_fee_pct: '10', unit_ids: [unit.unit_id] })).data.owner_id;
  const r = await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: '2026-08-10', check_out: '2026-08-12', guest_name: 'Ana', channel: 'airbnb', channel_fee: '500' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await host.post(`/api/reservations/${r.data.reservation.booking_id}/payments`, { amount: '4000', payment_date: '2026-08-10', payment_method: 'gcash' });
  const rf = await host.post(`/api/reservations/${r.data.reservation.booking_id}/refunds`, { amount: '300', refund_date: '2026-08-15', method: 'gcash', reason: 'Refund' });
  assert.equal(rf.status, 201, JSON.stringify(rf.data));
  await addExpense(unit, '700', '2026-08-20');
  await addExpense(unit, '200', '2026-06-05');
  assert.equal((await host.post(`/api/unit-owners/${owner}/statement/publish`, { month: AUG })).status, 200);

  outbox.length = 0;
  assert.equal((await host.post(`/api/unit-owners/${owner}/portal-invite`)).status, 200);
  for (let i = 0; i < 300 && !outbox.length; i++) await new Promise((x) => setTimeout(x, 10));
  ownerC = client(srv.base);
  const token = decodeURIComponent(/token=([^&\s]+)/.exec(outbox.at(-1).text)[1]);
  assert.equal((await ownerC.post('/api/owner-portal/session', { token })).status, 200);
});
test.after(async () => { await srv.close(); });

test('a published month shows the frozen numbers, even after a new expense', async () => {
  const before = await ownerC.get(`/api/owner-portal/pnl?month=${AUG}`);
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.equal(before.data.source, 'published');
  assert.ok(before.data.published_at);
  const row = before.data.rows.find((x) => x.unit_id === unit.unit_id);
  assert.deepEqual([row.stays, row.nights, row.gross, row.channel_fees, row.expenses], [1, 2, '4000.00', '500.00', '700.00']);
  // Refunds are not split by unit in the frozen copy, so they show as one owner-level line.
  const [{ refunded }] = await sql(`SELECT snapshot->>'refunded' AS refunded FROM owner_statements WHERE owner_id = $1 AND month = $2`, [owner, AUG]);
  assert.equal(before.data.totals.refunds, refunded);
  assert.equal(before.data.totals.net, ((400000 - 50000 - 70000 - Math.round(Number(refunded) * 100)) / 100).toFixed(2));

  // Added after publishing: the owner's P&L must not move, and the other owner's unit must not leak in.
  await addExpense(unit, '1000', '2026-08-25');
  await addExpense(other, '50', '2026-08-25');
  const after = await ownerC.get(`/api/owner-portal/pnl?month=${AUG}`);
  assert.deepEqual(after.data.rows, before.data.rows);
  assert.deepEqual(after.data.totals, before.data.totals);
});

test('a month with no published statement stays live and says so', async () => {
  const r = await ownerC.get(`/api/owner-portal/pnl?month=${JUN}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.source, 'live');
  assert.equal(r.data.rows.find((x) => x.unit_id === unit.unit_id).expenses, '200.00');
});
