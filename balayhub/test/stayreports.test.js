'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');

let srv; let host; let a; let b;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Report Stays');
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  a = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  b = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const r = async (unit, ci, co, extra = {}) => (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: ci, check_out: co, guest_name: 'G', ...extra })).data.reservation;
  // 3 nights in Sept (Sep 28-30) + 1 in Oct; accommodation 8000 → 2000/night; Airbnb fee 800 → 200/night.
  const r1 = await r(a, '2026-09-28', '2026-10-02', { channel: 'airbnb', channel_fee: '800' });
  await r(a, '2026-09-10', '2026-09-12'); // direct, 2 nights, 4000 + 500 cleaning
  await r(b, '2026-09-05', '2026-09-06', { channel: 'booking', channel_fee: '225' }); // 1500
  const c = await r(b, '2026-09-20', '2026-09-22');
  await host.post(`/api/reservations/${c.booking_id}/cancel`, { reason: 'x' });
  await host.post(`/api/reservations/${r1.booking_id}/payments`, { amount: '5000', payment_date: '2026-09-15', payment_method: 'gcash' });
  await host.post(`/api/reservations/${r1.booking_id}/payments`, { amount: '3500', payment_date: '2026-10-01', payment_method: 'cash' });
  const org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Report Stays'`))[0].organization_id;
  const user = (await sql(`SELECT user_id FROM users WHERE email = 'host@example.com'`))[0].user_id;
  await sql(`INSERT INTO expenses (organization_id, property_id, unit_id, category, amount, expense_date, recorded_by) VALUES ($1,$2,$3,'repairs',700,'2026-09-15',$4)`, [org, p.property_id, a.unit_id, user]);
  await sql(`INSERT INTO expenses (organization_id, property_id, category, amount, expense_date, recorded_by) VALUES ($1,$2,'association_dues',300,'2026-09-30',$3)`, [org, p.property_id, user]);
});
test.after(async () => { await srv.close(); });

test('monthly performance: nights by month, fees on check-in, channel fees, expenses', async () => {
  const r = (await host.get('/api/stay-reports?month=2026-09')).data;
  // Earned: a: 3 Airbnb nights (6000) + 2 direct nights (4000) + cleaning 500 (Sep 10 check-in) + cleaning 500 (Sep 28 check-in); b: 1500.
  assert.equal(r.totals.revenue, '12500.00');
  assert.equal(r.totals.nights, 6);
  assert.equal(r.totals.channel_fees, '825.00'); // 3×200 + 225
  assert.equal(r.totals.expenses, '1000.00');
  assert.equal(r.totals.net, '10675.00');
  assert.equal(r.totals.stays, 3);
  assert.equal(r.totals.cancelled, 1);
  assert.equal(r.totals.occupancy, 10); // 6 / (2 × 30)
  assert.equal(r.totals.adr, '1916.67');
  const airbnb = r.channels.find((c) => c.channel === 'airbnb');
  assert.deepEqual([airbnb.nights, airbnb.revenue, airbnb.channel_fees], [3, '6500.00', '600.00']);
  const ua = r.units.find((u) => u.unit_id === a.unit_id);
  assert.deepEqual([ua.nights, ua.expenses, ua.occupancy], [5, '700.00', 17]);
  assert.equal(r.building_expenses, '300.00');
  const oct = (await host.get('/api/stay-reports?month=2026-10')).data;
  assert.equal(oct.totals.revenue, '2000.00');
});

test('income summary for the year: earned vs received, quarters, CSV', async () => {
  const t = (await host.get('/api/stay-reports/tax?year=2026')).data;
  const sep = t.months.find((m) => m.month === '2026-09');
  assert.equal(sep.received, '5000.00');
  assert.equal(sep.received_by_method.gcash, '5000.00');
  assert.equal(t.months.find((m) => m.month === '2026-10').received, '3500.00');
  assert.equal(t.quarters[2].revenue, '12500.00');
  assert.equal(t.totals.revenue, '14500.00');
  const csv = await host.get('/api/stay-reports/export?kind=tax&year=2026');
  assert.match(csv.data, /2026-09,12500\.00,5000\.00,825\.00,1000\.00,10675\.00/);
  assert.match(csv.data, /Total,14500\.00,8500\.00/);
  const csv2 = await host.get('/api/stay-reports/export?month=2026-09');
  assert.match(csv2.data, /1201,Azure,2,5,17/);
});

test('staff can\'t see reports', async () => {
  const inv = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [] });
  const staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'S', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal((await staff.get('/api/stay-reports?month=2026-09')).status, 403);
});
