'use strict';

// QA round 8, lane C14 (access hardening):
// - a unit-level damage report is for owners and managers; staff are refused (#55);
// - no expense response carries the internal Idempotency-Key, for any role (#56);
// - a deposit receipt shows the guest's address only to owners and managers (K6).

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { emailGuest } = require('../src/routes/deposits');

const d = (n) => ical.addDays(manilaToday(), n);
const hasKey = (row) => 'idempotency_key' in row;

let srv; let owner; let manager; let staff; let prop; let unit; let stay;

async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'R8 Access');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500', security_deposit_amount: '1000' })).data.unit;
  stay = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-20), check_out: d(-18), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  staff = await invite('staff@example.com', 'staff', [prop.property_id]);
  manager = await invite('manager@example.com', 'manager', [prop.property_id]);
});

test.after(async () => { await srv.close(); });

test('a unit-level damage report is for owners and managers; staff are refused and nothing is stored', async () => {
  const refused = await staff.post(`/api/units/${unit.unit_id}/damage`, { description: 'Staff ceiling stain' });
  assert.equal(refused.status, 403, JSON.stringify(refused.data));
  const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM damage_reports WHERE unit_id = $1', [unit.unit_id]);
  assert.equal(n, 0, 'a refused report is not stored');

  const byManager = await manager.post(`/api/units/${unit.unit_id}/damage`, { description: 'Manager ceiling stain', estimated_cost: '120' });
  assert.equal(byManager.status, 201, JSON.stringify(byManager.data));
  const byOwner = await owner.post(`/api/units/${unit.unit_id}/damage`, { description: 'Owner door scuff' });
  assert.equal(byOwner.status, 201, JSON.stringify(byOwner.data));

  // Staff still report damage from a stay they can see.
  const onStay = await staff.post(`/api/reservations/${stay.booking_id}/damage`, { description: 'Broken lamp', estimated_cost: '80' });
  assert.equal(onStay.status, 201, JSON.stringify(onStay.data));
});

test('expense responses never carry the internal idempotency key, for owner, manager and staff', async () => {
  const KEY = 'r8c14-expense-key-1';
  const body = { property_id: prop.property_id, category: 'repairs', description: 'Fixed the AC', amount: '850', expense_date: d(-5), vendor_name: 'Cool Air' };
  const created = await owner.post('/api/expenses', body, { 'Idempotency-Key': KEY });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(hasKey(created.data.expense), false, 'create (owner)');
  const expenseId = created.data.expense.expense_id;

  // The key is still stored, so a retry is still recognised as the same expense.
  const [{ idempotency_key: stored }] = await sql('SELECT idempotency_key FROM expenses WHERE expense_id = $1', [expenseId]);
  assert.equal(stored, KEY);
  const retry = await owner.post('/api/expenses', body, { 'Idempotency-Key': KEY });
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
  assert.equal(retry.data.duplicate, true);
  assert.equal(retry.data.expense.expense_id, expenseId);

  for (const [who, c] of [['owner', owner], ['manager', manager], ['staff', staff]]) {
    const list = await c.get(`/api/expenses?property_id=${prop.property_id}`);
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.ok(list.data.expenses.length >= 1, `${who} sees the expense`);
    for (const e of list.data.expenses) assert.equal(hasKey(e), false, `list (${who})`);

    const detail = await c.get(`/api/expenses/${expenseId}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.data));
    assert.equal(hasKey(detail.data.expense), false, `detail (${who})`);
  }

  const staffCreate = await staff.post('/api/expenses', { ...body, description: 'Bleach', amount: '120', expense_date: d(-2) }, { 'Idempotency-Key': 'r8c14-expense-key-2' });
  assert.equal(staffCreate.status, 201, JSON.stringify(staffCreate.data));
  assert.equal(hasKey(staffCreate.data.expense), false, 'create (staff)');

  const managerCorrect = await manager.patch(`/api/expenses/${expenseId}`, { description: 'Fixed the AC unit' });
  assert.equal(managerCorrect.status, 200, JSON.stringify(managerCorrect.data));
  assert.equal(hasKey(managerCorrect.data.expense), false, 'correct (manager)');

  const ownerCorrect = await owner.patch(`/api/expenses/${expenseId}`, { amount: '900' });
  assert.equal(ownerCorrect.status, 200, JSON.stringify(ownerCorrect.data));
  assert.equal(hasKey(ownerCorrect.data.expense), false, 'correct (owner)');

  assert.equal((await staff.patch(`/api/expenses/${expenseId}`, { amount: '1' })).status, 403, 'staff cannot correct an expense');
});

test('the deposit receipt names the guest\'s address only to owners and managers', async () => {
  const guest = { guest_name: 'Ben Lim', guest_email: 'ben@example.com' };
  const stayFor = async (from, to) => (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(from), check_out: d(to), ...guest })).data.reservation;
  const deposit = { amount: '1000', received_date: d(-3), method: 'cash', send_receipt: true };

  const byStaff = await staff.post(`/api/reservations/${(await stayFor(-40, -38)).booking_id}/deposit`, deposit);
  assert.equal(byStaff.status, 201, JSON.stringify(byStaff.data));
  assert.equal(byStaff.data.receipt.sent, true);
  assert.equal(byStaff.data.receipt.to, 'the guest');
  assert.doesNotMatch(JSON.stringify(byStaff.data.receipt), /ben@example\.com/);

  const byManager = await manager.post(`/api/reservations/${(await stayFor(-50, -48)).booking_id}/deposit`, deposit);
  assert.equal(byManager.status, 201, JSON.stringify(byManager.data));
  assert.equal(byManager.data.receipt.to, 'ben@example.com');

  // Cleaners cannot reach the deposit routes, so the helper is checked directly.
  const b = { booking_id: stay.booking_id, guest_name: 'Ben Lim', guest_email: 'ben@example.com', unit_name: '1201', property_name: 'Azure', check_in: d(-40), check_out: d(-38), confirmation_code: 'R8C14', workspace_name: 'R8 Access' };
  const dep = { amount: '1000', method: 'cash', received_date: d(-39) };
  const forCleaner = await emailGuest(b, dep, 'received', { role: 'cleaner' });
  assert.equal(forCleaner.sent, true);
  assert.equal(forCleaner.to, 'the guest');
  const forOwner = await emailGuest(b, dep, 'received', { role: 'owner' });
  assert.equal(forOwner.to, 'ben@example.com');
});
