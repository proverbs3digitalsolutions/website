'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { outbox } = require('../src/lib/mailer');

let srv; let host; let a; let b; let ownerId;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Managed Stays');
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  a = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  b = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
});
test.after(async () => { await srv.close(); });

test('add an owner and assign their units', async () => {
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Too Much', management_fee_pct: '120' })).status, 400);
  const r = await host.post('/api/unit-owners', { full_name: 'Maria Santos', email: 'maria@example.com', management_fee_pct: '20', unit_ids: [a.unit_id] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  ownerId = r.data.owner_id;
  const list = (await host.get('/api/unit-owners')).data;
  assert.deepEqual(list.owners[0].unit_ids, [a.unit_id]);
  assert.equal(list.units.find((u) => u.unit_id === b.unit_id).owner_id, null);
  // Another workspace can't see or use them.
  const other = await ownerAccount(srv.base, 'other@example.com', 'Other Stays');
  assert.equal((await other.get(`/api/unit-owners/${ownerId}/statement?month=2026-09`)).status, 404);
  assert.equal((await other.post('/api/unit-owners', { full_name: 'X', unit_ids: [a.unit_id] })).status, 400);
});

test('monthly statement: stays by check-out month, channel and cleaning fees, management fee, expenses', async () => {
  // Checks out in September: counted. Airbnb stay with a channel fee.
  const r1 = await host.post('/api/reservations', { unit_id: a.unit_id, check_in: '2026-09-10', check_out: '2026-09-12', guest_name: 'Ana Cruz', channel: 'airbnb', channel_fee: '600' });
  assert.equal(r1.status, 201, JSON.stringify(r1.data));
  // Crosses into October: counted in October, not September.
  await host.post('/api/reservations', { unit_id: a.unit_id, check_in: '2026-09-30', check_out: '2026-10-02', guest_name: 'Ben Reyes' });
  // Another owner's unit: not counted.
  await host.post('/api/reservations', { unit_id: b.unit_id, check_in: '2026-09-05', check_out: '2026-09-06', guest_name: 'Cid' });
  // Expense on the unit.
  const org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Managed Stays'`))[0].organization_id;
  const user = (await sql(`SELECT user_id FROM users WHERE email = 'host@example.com'`))[0].user_id;
  await sql(`INSERT INTO expenses (organization_id, property_id, unit_id, category, description, amount, expense_date, recorded_by)
             VALUES ($1, $2, $3, 'repairs', 'Aircon cleaning', 800, '2026-09-20', $4)`, [org, a.property_id, a.unit_id, user]);

  const s = (await host.get(`/api/unit-owners/${ownerId}/statement?month=2026-09`)).data.statement;
  assert.equal(s.month_label, 'September 2026');
  assert.equal(s.stays.length, 1);
  assert.equal(s.stays[0].guest_first_name, 'Ana');
  // 4000 + 500 cleaning = 4500 gross; − 600 channel − 500 cleaning = 3400 net; 20% = 680; − 800 expenses = 1920.
  assert.deepEqual(s.totals, {
    stays: 1, nights: 2, occupancy_pct: 7, gross: '4500.00', channel_fees: '600.00', cleaning_fees: '500.00',
    net_rental: '3400.00', management_fee: '680.00', expenses: '800.00', payout: '1920.00',
  });
  assert.equal((await host.get(`/api/unit-owners/${ownerId}/statement?month=2026-10`)).data.statement.stays.length, 1);
  assert.equal((await host.get(`/api/unit-owners/${ownerId}/statement?month=2026-13`)).status, 400);

  // Cleaning fees that belong to the owner stay in their income.
  await host.patch(`/api/unit-owners/${ownerId}`, { cleaning_to_manager: false });
  const s2 = (await host.get(`/api/unit-owners/${ownerId}/statement?month=2026-09`)).data.statement;
  assert.equal(s2.totals.net_rental, '3900.00');
  assert.equal(s2.totals.payout, '2320.00');
});

test('email the statement; managers and staff cannot see owner finances', async () => {
  outbox.length = 0;
  const r = await host.post(`/api/unit-owners/${ownerId}/statement/send`, { month: '2026-09' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const m = outbox.find((x) => x.to === 'maria@example.com');
  assert.match(m.subject, /September 2026/);
  assert.match(m.text, /Payout to owner: +₱2,320\.00/);

  const inv = await host.post('/api/team/invitations', { email: 'mgr@example.com', role: 'manager', property_ids: [a.property_id] });
  const mgr = client(srv.base);
  await mgr.post('/api/auth/signup', { full_name: 'Mona Manager', email: 'mgr@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal((await mgr.get('/api/unit-owners')).status, 403);
  assert.equal((await mgr.get(`/api/unit-owners/${ownerId}/statement?month=2026-09`)).status, 403);

  await host.post(`/api/unit-owners/${ownerId}/archive`);
  assert.equal((await host.get('/api/unit-owners')).data.owners.length, 0);
  assert.equal((await sql('SELECT owner_id FROM units WHERE unit_id = $1', [a.unit_id]))[0].owner_id, null);
});
