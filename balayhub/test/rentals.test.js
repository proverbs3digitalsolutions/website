'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday, addMonths } = require('./helpers');

let srv; let owner; let property; let unitA; let unitB; let tenant; let lease;
const today = manilaToday();
const thisMonth = today.slice(0, 7);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base);
});
test.after(async () => { await srv.close(); });

test('properties: create, duplicate warning, units with derived occupancy', async () => {
  const p = await owner.post('/api/properties', {
    property_name: 'Sampaguita Apartments', property_type: 'apartment', address: '12 Mabini St', city: 'Bacoor', province: 'Cavite',
  });
  assert.equal(p.status, 201);
  property = p.data.property;

  const dup = await owner.post('/api/properties', {
    property_name: 'sampaguita apartments', property_type: 'apartment', address: 'Other', city: 'Bacoor', province: 'Cavite',
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.code, 'DUPLICATE');
  assert.equal(dup.data.duplicates.length, 1);

  const a = await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: '101', unit_type: 'studio', monthly_rent: '₱8,000' });
  assert.equal(a.status, 201);
  assert.equal(a.data.unit.monthly_rent, '8000.00');
  unitA = a.data.unit;
  const b = await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: '102', unit_type: 'studio', monthly_rent: '6000' });
  unitB = b.data.unit;
  const same = await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: '101', unit_type: 'room', monthly_rent: '1' });
  assert.equal(same.status, 409);
  const neg = await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: '103', unit_type: 'room', monthly_rent: '-5' });
  assert.equal(neg.status, 400);

  const detail = await owner.get(`/api/properties/${property.property_id}`);
  assert.deepEqual(detail.data.units.map((u) => u.occupancy_status), ['vacant', 'vacant']);
});

test('tenants & leases: duplicate warning, assign unit, one active lease per unit', async () => {
  const t = await owner.post('/api/tenants', { full_name: 'Juan Dela Cruz', phone: '0917 123 4567', email: 'juan@example.com' });
  assert.equal(t.status, 201);
  tenant = t.data.tenant;
  const dup = await owner.post('/api/tenants', { full_name: 'J. Cruz', phone: '09171234567' });
  assert.equal(dup.status, 409);
  const forced = await owner.post('/api/tenants', { full_name: 'J. Cruz', phone: '09171234567', confirm_duplicate: true });
  assert.equal(forced.status, 201);

  // Lease started two months ago, due on the 5th, rent 8000.
  const start = addMonths(today, -2);
  const l = await owner.post('/api/leases', {
    tenant_id: tenant.tenant_id, unit_id: unitA.unit_id, start_date: start, monthly_rent: '8000', due_day: 5, deposit_amount: '16000',
  });
  assert.equal(l.status, 201, JSON.stringify(l.data));
  lease = l.data.lease;

  const clash = await owner.post('/api/leases', {
    tenant_id: forced.data.tenant.tenant_id, unit_id: unitA.unit_id, start_date: today, monthly_rent: '8000', due_day: 5,
  });
  assert.equal(clash.status, 409);
  assert.equal(clash.data.code, 'UNIT_OCCUPIED');

  const badDates = await owner.post('/api/leases', {
    tenant_id: forced.data.tenant.tenant_id, unit_id: unitB.unit_id, start_date: today, end_date: addMonths(today, -1), monthly_rent: '6000', due_day: 1,
  });
  assert.equal(badDates.status, 400);

  const detail = await owner.get(`/api/properties/${property.property_id}`);
  const a = detail.data.units.find((u) => u.unit_id === unitA.unit_id);
  assert.equal(a.occupancy_status, 'occupied');
  assert.equal(a.tenant_name, 'Juan Dela Cruz');

  // Three monthly charges were generated (two months ago, last month, this month).
  const charges = await sql('SELECT * FROM rent_charges WHERE lease_id = $1 ORDER BY period', [lease.lease_id]);
  assert.equal(charges.length, 3);
  assert.equal(charges[2].period, `${thisMonth}-01`);
});

test('payments: partial payment keeps correct balance; oldest charge first', async () => {
  const before = await owner.get('/api/rent/leases');
  const lb = before.data.leases.find((l) => l.lease_id === lease.lease_id);
  assert.equal(lb.outstanding, '24000.00');

  const neg = await owner.post('/api/payments', { lease_id: lease.lease_id, amount_paid: '-100', payment_date: today, payment_method: 'cash' });
  assert.equal(neg.status, 400);
  const zero = await owner.post('/api/payments', { lease_id: lease.lease_id, amount_paid: '0', payment_date: today, payment_method: 'cash' });
  assert.equal(zero.status, 400);
  const future = await owner.post('/api/payments', { lease_id: lease.lease_id, amount_paid: '100', payment_date: addMonths(today, 2), payment_method: 'cash' });
  assert.equal(future.status, 400);

  const p = await owner.post('/api/payments',
    { lease_id: lease.lease_id, amount_paid: '10000', payment_date: today, payment_method: 'gcash', reference_number: '1234' },
    { 'Idempotency-Key': 'key-0000000001' });
  assert.equal(p.status, 201);
  assert.equal(p.data.balance.outstanding, '14000.00');

  const rent = await owner.get(`/api/rent`);
  const mine = rent.data.charges.filter((c) => c.lease_id === lease.lease_id).sort((a, b) => a.period.localeCompare(b.period));
  assert.equal(mine[0].status, 'paid');
  assert.equal(mine[1].amount_applied, '2000.00');
  assert.equal(mine[1].balance, '6000.00');
  assert.equal(mine[1].status, 'overdue', 'last month, partially paid, past due');
  assert.equal(mine[2].amount_applied, '0.00');
});

test('double-click Save does not create duplicate payments', async () => {
  const body = { lease_id: lease.lease_id, amount_paid: '500', payment_date: today, payment_method: 'cash' };
  const h = { 'Idempotency-Key': 'key-dblclick-01' };
  const [r1, r2] = await Promise.all([owner.post('/api/payments', body, h), owner.post('/api/payments', body, h)]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 201]);
  assert.equal(r1.data.payment.payment_id, r2.data.payment.payment_id);
  const rows = await sql(`SELECT * FROM payments WHERE idempotency_key = 'key-dblclick-01'`);
  assert.equal(rows.length, 1);
});

test('voiding a payment restores the balance and keeps history', async () => {
  const list = await owner.get('/api/payments');
  const p = list.data.payments.find((x) => x.amount_paid === '500.00');
  assert.equal((await owner.post(`/api/payments/${p.payment_id}/void`, {})).status, 400, 'reason required');
  assert.equal((await owner.post(`/api/payments/${p.payment_id}/void`, { reason: 'Entered twice' })).status, 200);
  assert.equal((await owner.post(`/api/payments/${p.payment_id}/void`, { reason: 'again' })).status, 409);
  const after = await owner.get('/api/rent/leases');
  assert.equal(after.data.leases.find((l) => l.lease_id === lease.lease_id).outstanding, '14000.00');
  const withVoided = await owner.get('/api/payments?include_voided=1');
  assert.ok(withVoided.data.payments.some((x) => x.payment_id === p.payment_id && x.void_reason === 'Entered twice'));
  const audit = await owner.get('/api/audit');
  assert.ok(audit.data.entries.some((e) => e.action === 'payment.voided'));
});

test('expenses and maintenance costs feed the dashboard and reports', async () => {
  const e = await owner.post('/api/expenses',
    { property_id: property.property_id, category: 'utilities', amount: '1500.50', expense_date: today, description: 'Water bill' },
    { 'Idempotency-Key': 'exp-key-000001' });
  assert.equal(e.status, 201);
  const again = await owner.post('/api/expenses',
    { property_id: property.property_id, category: 'utilities', amount: '1500.50', expense_date: today },
    { 'Idempotency-Key': 'exp-key-000001' });
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);

  const wrongUnit = await owner.post('/api/expenses', { property_id: property.property_id, unit_id: '00000000-0000-0000-0000-000000000000', category: 'other', amount: '1', expense_date: today });
  assert.equal(wrongUnit.status, 404);

  const m = await owner.post('/api/maintenance', { property_id: property.property_id, unit_id: unitA.unit_id, title: 'Leaking faucet', priority: 'high' });
  assert.equal(m.status, 201);
  const id = m.data.request.request_id;
  const cost = await owner.post(`/api/maintenance/${id}/costs`, { amount: '750', expense_date: today, vendor_name: 'Mang Tony' });
  assert.equal(cost.status, 201);
  const upd = await owner.patch(`/api/maintenance/${id}`, { status: 'resolved' });
  assert.equal(upd.data.request.status, 'resolved');
  assert.ok(upd.data.request.resolved_at);
  assert.equal(upd.data.request.actual_cost, '750.00');

  const d = await owner.get('/api/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.data.portfolio.properties, 1);
  assert.equal(d.data.portfolio.units, 2);
  assert.equal(d.data.portfolio.occupied, 1);
  assert.equal(d.data.portfolio.vacant, 1);
  assert.equal(d.data.collected_this_month, '10000.00');
  assert.equal(d.data.expenses_this_month, '2250.50');
  assert.equal(d.data.outstanding, '14000.00');
  assert.equal(d.data.overdue_tenant_count, 1);

  const from = addMonths(today, -2);
  const r = await owner.get(`/api/reports?from=${from}&to=${today}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.totals.collected, '10000.00');
  assert.equal(r.data.totals.expenses, '2250.50');
  assert.equal(r.data.totals.net, '7749.50');
  assert.equal(r.data.totals.outstanding, '14000.00');
  assert.equal(r.data.by_category.find((c) => c.category === 'repairs').amount, '750.00');

  const csv = await owner.get(`/api/reports/export?from=${from}&to=${today}`);
  assert.equal(csv.status, 200);
  assert.match(csv.data, /Rent collected,10000\.00/);
  assert.match(csv.data, /Juan Dela Cruz/);

  const bad = await owner.get(`/api/reports?from=${today}&to=${from}`);
  assert.equal(bad.status, 400);
});

test('ending a lease frees the unit; archive rules protect history', async () => {
  const blocked = await owner.post(`/api/properties/${property.property_id}/archive`);
  assert.equal(blocked.status, 409);
  const cancel = await owner.post(`/api/leases/${lease.lease_id}/cancel`);
  assert.equal(cancel.status, 409, 'cannot cancel a lease with payments');
  const end = await owner.post(`/api/leases/${lease.lease_id}/end`, { end_date: today, lease_status: 'ended' });
  assert.equal(end.status, 200);
  const detail = await owner.get(`/api/properties/${property.property_id}`);
  assert.equal(detail.data.units.find((u) => u.unit_id === unitA.unit_id).occupancy_status, 'vacant');
  // Balance from the ended lease is still owed.
  const d = await owner.get('/api/dashboard');
  assert.equal(d.data.outstanding, '14000.00');
  assert.equal((await owner.post(`/api/tenants/${tenant.tenant_id}/archive`)).status, 200);
});

test('workspace isolation: another owner cannot see or touch these records', async () => {
  const other = await ownerAccount(srv.base, 'other@example.com', 'Other Co');
  for (const url of [`/api/properties/${property.property_id}`, `/api/tenants/${tenant.tenant_id}`, `/api/leases/${lease.lease_id}`]) {
    const r = await other.get(url);
    assert.equal(r.status, 404, url);
  }
  const pay = await other.post('/api/payments', { lease_id: lease.lease_id, amount_paid: '1', payment_date: today, payment_method: 'cash' });
  assert.equal(pay.status, 404);
  const unit = await other.post(`/api/properties/${property.property_id}/units`, { unit_name: 'X', unit_type: 'room', monthly_rent: '1' });
  assert.equal(unit.status, 404);
  const exp = await other.post('/api/expenses', { property_id: property.property_id, category: 'other', amount: '1', expense_date: today });
  assert.equal(exp.status, 404);
  const list = await other.get('/api/properties');
  assert.equal(list.data.properties.length, 0);
  const d = await other.get('/api/dashboard');
  assert.equal(d.data.outstanding, '0.00');
  const anon = await client(srv.base).get('/api/properties');
  assert.equal(anon.status, 401);
});

test('roles: managers see only assigned properties; staff are limited', async () => {
  const p2 = await owner.post('/api/properties', { property_name: 'Ilang-Ilang Dorm', property_type: 'dormitory', address: '5 Rizal Ave', city: 'Calamba', province: 'Laguna' });
  const prop2 = p2.data.property;
  const u2 = await owner.post(`/api/properties/${prop2.property_id}/units`, { unit_name: 'R1', unit_type: 'room', monthly_rent: '3500' });
  const t2 = await owner.post('/api/tenants', { full_name: 'Ana Reyes', phone: '09181112222', email: 'ana@example.com' });
  const l2 = await owner.post('/api/leases', { tenant_id: t2.data.tenant.tenant_id, unit_id: u2.data.unit.unit_id, start_date: today, monthly_rent: '3500', due_day: 15 });
  assert.equal(l2.status, 201);

  async function invite(email, role, ids) {
    const inv = await owner.post('/api/team/invitations', { email, role, property_ids: ids });
    assert.equal(inv.status, 201, JSON.stringify(inv.data));
    const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
    const c = client(srv.base);
    const info = await c.get(`/api/invitations/${encodeURIComponent(token)}`);
    assert.equal(info.data.organization_name, 'Santos Rentals');
    const s = await c.post('/api/auth/signup', { full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
    assert.equal(s.status, 201, JSON.stringify(s.data));
    assert.equal(s.data.user.role, role);
    return c;
  }
  const manager = await invite('mgr@example.com', 'manager', [prop2.property_id]);
  const staff = await invite('staff@example.com', 'staff', [prop2.property_id]);

  const mp = await manager.get('/api/properties');
  assert.deepEqual(mp.data.properties.map((p) => p.property_name), ['Ilang-Ilang Dorm']);
  assert.equal((await manager.get(`/api/properties/${property.property_id}`)).status, 404);
  assert.equal((await manager.post('/api/properties', { property_name: 'Z', property_type: 'house', address: 'a', city: 'b', province: 'c' })).status, 403);
  assert.equal((await manager.get('/api/team')).status, 403);
  const mt = await manager.get('/api/tenants');
  assert.ok(mt.data.tenants.some((t) => t.full_name === 'Ana Reyes'));
  assert.ok(!mt.data.tenants.some((t) => t.full_name === 'Juan Dela Cruz'));

  const st = await staff.get('/api/tenants');
  const ana = st.data.tenants.find((t) => t.full_name === 'Ana Reyes');
  assert.equal(ana.phone, undefined);
  assert.equal(ana.email, undefined);
  const sp = await staff.post('/api/payments', { lease_id: l2.data.lease.lease_id, amount_paid: '3500', payment_date: today, payment_method: 'cash' });
  assert.equal(sp.status, 201);
  assert.equal((await staff.post(`/api/payments/${sp.data.payment.payment_id}/void`, { reason: 'x' })).status, 403);
  assert.equal((await staff.post('/api/tenants', { full_name: 'Nope' })).status, 403);
  assert.equal((await staff.get('/api/audit')).status, 403);
  const sd = await staff.get('/api/dashboard');
  assert.equal(sd.data.portfolio.properties, 1);
  assert.equal(sd.data.collected_this_month, '3500.00');

  // Removing a member revokes access immediately.
  const team = await owner.get('/api/team');
  const staffId = team.data.members.find((m) => m.email === 'staff@example.com').user_id;
  assert.equal((await owner.post(`/api/team/members/${staffId}/remove`)).status, 200);
  assert.equal((await staff.get('/api/dashboard')).status, 401);
});

test('file uploads: type checked, private, scoped', async () => {
  const payments = await owner.get('/api/payments');
  const pid = payments.data.payments[0].payment_id;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  const up = await owner.raw('POST', `/api/files?record_type=payment&record_id=${pid}`, png, { 'Content-Type': 'image/png', 'X-File-Name': 'receipt.png' });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const fake = await owner.raw('POST', `/api/files?record_type=payment&record_id=${pid}`, Buffer.from('not a png'), { 'Content-Type': 'image/png' });
  assert.equal(fake.status, 415);
  const html = await owner.raw('POST', `/api/files?record_type=payment&record_id=${pid}`, Buffer.from('<script>'), { 'Content-Type': 'text/html' });
  assert.equal(html.status, 415);
  const dl = await owner.get(`/api/files/${up.data.file.file_id}`);
  assert.equal(dl.status, 200);
  const other = client(srv.base);
  await other.post('/api/auth/login', { email: 'other@example.com', password: 'correct-horse-1' });
  assert.equal((await other.get(`/api/files/${up.data.file.file_id}`)).status, 404);
});
