'use strict';

// List filters on the long-term pages: properties, tenants, rent roll,
// payments, expenses, maintenance and reports.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, manilaToday, addMonths } = require('./helpers');

let srv; let owner;
const today = manilaToday();
const plusDays = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayOfMonth = Number(today.slice(8));
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const ids = {};
const names = (rows, k = 'full_name') => rows.map((r) => r[k]).sort();

async function ok(res, status = 200) {
  assert.equal(res.status, status, JSON.stringify(res.data));
  return res.data;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base);

  const propA = await ok(await owner.post('/api/properties', { property_name: 'Sampaguita Apartments', property_type: 'apartment', address: '12 Mabini St', city: 'Bacoor', province: 'Cavite' }), 201);
  const propB = await ok(await owner.post('/api/properties', { property_name: 'Ilang-Ilang Dorm', property_type: 'dormitory', address: '5 Rizal Ave', city: 'Calamba', province: 'Laguna' }), 201);
  const propC = await ok(await owner.post('/api/properties', { property_name: 'Acacia House', property_type: 'house', address: '9 Luna St', city: 'Imus', province: 'Cavite' }), 201);
  Object.assign(ids, { A: propA.property.property_id, B: propB.property.property_id, C: propC.property.property_id });
  const unit = async (p, name, rent) => (await ok(await owner.post(`/api/properties/${p}/units`, { unit_name: name, unit_type: 'room', monthly_rent: rent }), 201)).unit.unit_id;
  ids.A1 = await unit(ids.A, 'A1', '8000');
  ids.A2 = await unit(ids.A, 'A2', '6000');
  ids.A3 = await unit(ids.A, 'A3', '5000');
  ids.B1 = await unit(ids.B, 'B1', '3500');

  const tenant = async (full_name) => (await ok(await owner.post('/api/tenants', { full_name }), 201)).tenant.tenant_id;
  ids.juan = await tenant('Juan Dela Cruz');
  ids.maria = await tenant('Maria Clara');
  ids.pedro = await tenant('Pedro Penduko');
  ids.lito = await tenant('Lito Lapid');
  ids.rosa = await tenant('Rosa Rosal');
  const lease = async (body) => (await ok(await owner.post('/api/leases', body), 201)).lease.lease_id;
  // Juan: two months in, no end date, behind on rent.
  ids.juanLease = await lease({ tenant_id: ids.juan, unit_id: ids.A1, start_date: addMonths(today, -2), monthly_rent: '8000', due_day: 5 });
  // Maria: lease ends in 20 days. Pedro: ends in 45 days, paid up.
  await lease({ tenant_id: ids.maria, unit_id: ids.A2, start_date: today, end_date: plusDays(20), monthly_rent: '6000', due_day: dayOfMonth });
  ids.pedroLease = await lease({ tenant_id: ids.pedro, unit_id: ids.B1, start_date: today, end_date: plusDays(45), monthly_rent: '3500', due_day: dayOfMonth });
  // Lito moved out today and still owes.
  const litoLease = await lease({ tenant_id: ids.lito, unit_id: ids.A3, start_date: addMonths(today, -2), monthly_rent: '5000', due_day: 5 });
  await ok(await owner.post(`/api/leases/${litoLease}/end`, { end_date: today, lease_status: 'ended' }));

  const pay = async (body) => (await ok(await owner.post('/api/payments', { payment_date: today, ...body }), 201)).payment.payment_id;
  ids.payJuan = await pay({ lease_id: ids.juanLease, amount_paid: '8000', payment_method: 'gcash', reference_number: 'GC-123' });
  ids.payVoid = await pay({ lease_id: ids.juanLease, amount_paid: '500', payment_method: 'cash' });
  await ok(await owner.post(`/api/payments/${ids.payVoid}/void`, { reason: 'Entered twice' }));
  ids.payPedro = await pay({ lease_id: ids.pedroLease, amount_paid: '3500', payment_method: 'maya' });
  await ok(await owner.raw('POST', `/api/files?record_type=payment&record_id=${ids.payPedro}`, png, { 'Content-Type': 'image/png', 'X-File-Name': 'r.png' }), 201);

  const exp = async (body) => (await ok(await owner.post('/api/expenses', { expense_date: today, ...body }), 201)).expense.expense_id;
  ids.e1 = await exp({ property_id: ids.A, category: 'utilities', amount: '1200', vendor_name: 'Meralco', description: 'Common area bill' });
  await ok(await owner.raw('POST', `/api/files?record_type=expense&record_id=${ids.e1}`, png, { 'Content-Type': 'image/png', 'X-File-Name': 'r.png' }), 201);
  ids.e3 = await exp({ property_id: ids.B, category: 'supplies', amount: '300', vendor_name: 'Ace Hardware' });
  await ok(await owner.post(`/api/expenses/${ids.e3}/void`, { reason: 'Wrong property' }));

  const req = async (body) => (await ok(await owner.post('/api/maintenance', body), 201)).request.request_id;
  ids.m1 = await req({ property_id: ids.A, unit_id: ids.A1, title: 'Leaking faucet', priority: 'high', assigned_to: 'Mang Tony' });
  ids.e2 = (await ok(await owner.post(`/api/maintenance/${ids.m1}/costs`, { amount: '750', expense_date: today, vendor_name: 'Mang Tony' }), 201)).expense.expense_id;
  ids.m2 = await req({ property_id: ids.A, title: 'Broken gate', priority: 'urgent', estimated_cost: '2000' });
  ids.m3 = await req({ property_id: ids.B, unit_id: ids.B1, title: 'Light bulb', priority: 'low', assigned_to: 'mang tony ', reported_by: 'Pedro' });
  await ok(await owner.patch(`/api/maintenance/${ids.m3}`, { status: 'resolved' }));
});
test.after(async () => { await srv.close(); });

test('properties: type, city, occupancy, province search and sort', async () => {
  const list = async (q) => (await ok(await owner.get(`/api/properties${q}`))).properties.map((p) => p.property_name);
  assert.deepEqual(await list(''), ['Acacia House', 'Ilang-Ilang Dorm', 'Sampaguita Apartments']);
  assert.deepEqual(await list('?type=dormitory'), ['Ilang-Ilang Dorm']);
  assert.equal((await list('?type=castle')).length, 3, 'unknown type is ignored');
  assert.deepEqual(await list('?city=bacoor'), ['Sampaguita Apartments']);
  assert.deepEqual(await list('?occupancy=vacant'), ['Sampaguita Apartments']);
  assert.deepEqual(await list('?occupancy=full'), ['Ilang-Ilang Dorm']);
  assert.deepEqual(await list('?occupancy=no_units'), ['Acacia House']);
  assert.deepEqual(await list('?q=laguna'), ['Ilang-Ilang Dorm']);
  assert.deepEqual(await list('?sort=units'), ['Sampaguita Apartments', 'Ilang-Ilang Dorm', 'Acacia House']);
  assert.equal((await list('?sort=drop%20table')).length, 3, 'unknown sort falls back to name');
  const a = (await ok(await owner.get('/api/properties?type=apartment'))).properties[0];
  assert.equal(a.vacant_count, 1);
  assert.deepEqual(await list('?status=archived&type=apartment'), []);
});

test('tenants: lease, property, unit, balance and sort filters', async () => {
  const list = async (q) => names((await ok(await owner.get(`/api/tenants${q}`))).tenants);
  assert.deepEqual(await list('?lease=active'), ['Juan Dela Cruz', 'Maria Clara', 'Pedro Penduko']);
  assert.deepEqual(await list('?lease=ending30'), ['Maria Clara']);
  assert.deepEqual(await list('?lease=ending60'), ['Maria Clara', 'Pedro Penduko']);
  assert.deepEqual(await list('?lease=no_end'), ['Juan Dela Cruz']);
  assert.deepEqual(await list('?lease=moved_out'), ['Lito Lapid']);
  assert.deepEqual(await list('?lease=none'), ['Lito Lapid', 'Rosa Rosal']);
  assert.equal((await list('?lease=whatever')).length, 5, 'unknown lease filter is ignored');
  assert.deepEqual(await list(`?property_id=${ids.B}`), ['Pedro Penduko']);
  assert.deepEqual(await list(`?unit_id=${ids.A1}`), ['Juan Dela Cruz']);
  assert.deepEqual(await list('?balance=overdue'), ['Juan Dela Cruz']);
  assert.deepEqual(await list('?balance=owing'), ['Juan Dela Cruz', 'Maria Clara']);
  assert.deepEqual(await list('?balance=clear'), ['Pedro Penduko']);
  assert.deepEqual(await list('?min_balance=7000'), ['Juan Dela Cruz']);
  assert.equal((await list('?min_balance=1e9')).length, 5, 'non-numeric amount is ignored');
  const sorted = (await ok(await owner.get('/api/tenants?sort=balance'))).tenants;
  assert.equal(sorted[0].full_name, 'Juan Dela Cruz');
  const byEnd = (await ok(await owner.get('/api/tenants?sort=lease_end&lease=active'))).tenants;
  assert.deepEqual(byEnd.map((t) => t.full_name), ['Maria Clara', 'Pedro Penduko', 'Juan Dela Cruz']);
  assert.equal((await owner.get('/api/tenants?property_id=nope')).status, 404);
  assert.equal((await owner.get('/api/tenants?status=archived&lease=active')).data.tenants.length, 0);
});

test('rent roll: unit, former tenants, days late, amount, sort, property totals', async () => {
  const charges = async (q) => (await ok(await owner.get(`/api/rent${q}`))).charges;
  const juan = await charges(`?status=all&unit_id=${ids.A1}`);
  assert.ok(juan.length >= 3 && juan.every((c) => c.tenant_name === 'Juan Dela Cruz'));
  const former = await charges('?status=all&lease=former');
  assert.ok(former.length > 0 && former.every((c) => c.tenant_name === 'Lito Lapid'));
  const current = await charges('?status=all&lease=current');
  assert.ok(current.every((c) => c.tenant_name !== 'Lito Lapid'));
  const late = await charges('?late=30');
  assert.ok(late.length > 0);
  assert.ok(late.every((c) => c.status === 'overdue' && c.due_date < plusDays(-30)));
  assert.ok(late.every((c) => ['Juan Dela Cruz', 'Lito Lapid'].includes(c.tenant_name)));
  assert.equal((await charges('?late=90')).length, 0);
  assert.equal((await charges('?late=5')).length, (await charges('')).length, 'unsupported late value is ignored');
  const big = await charges('?min_amount=6000');
  assert.ok(big.length > 0 && big.every((c) => Number(c.balance) >= 6000));
  const byAmount = await charges('?sort=amount');
  assert.equal(Number(byAmount[0].balance), Math.max(...byAmount.map((c) => Number(c.balance))));
  const dorm = await ok(await owner.get(`/api/rent?status=outstanding&property_id=${ids.B}`));
  assert.equal(dorm.charges.length, 0);
  assert.equal(dorm.totals.outstanding, '0.00', 'totals follow the property filter');
  assert.equal((await owner.get('/api/rent?unit_id=x')).status, 404);
});

test('payments: method, tenant, unit, amount range, voided, receipt, sort', async () => {
  const list = async (q) => (await ok(await owner.get(`/api/payments${q}`))).payments.map((p) => p.payment_id).sort();
  assert.deepEqual(await list(''), [ids.payJuan, ids.payPedro].sort());
  assert.deepEqual(await list('?method=gcash'), [ids.payJuan]);
  assert.equal((await list('?method=bitcoin')).length, 2, 'unknown method is ignored');
  assert.deepEqual(await list(`?tenant_id=${ids.pedro}`), [ids.payPedro]);
  assert.deepEqual(await list(`?unit_id=${ids.B1}`), [ids.payPedro]);
  assert.deepEqual(await list('?min_amount=4000'), [ids.payJuan]);
  assert.deepEqual(await list('?max_amount=4000'), [ids.payPedro]);
  assert.deepEqual(await list('?max_amount=4000&include_voided=1'), [ids.payPedro, ids.payVoid].sort());
  assert.deepEqual(await list('?include_voided=only'), [ids.payVoid]);
  assert.equal((await list('?min_amount=-5')).length, 2, 'negative amount is ignored');
  assert.deepEqual(await list('?receipt=yes'), [ids.payPedro]);
  assert.deepEqual(await list('?receipt=no'), [ids.payJuan]);
  assert.deepEqual(await list('?q=gc-123'), [ids.payJuan]);
  assert.deepEqual(await list('?q=dorm'), [ids.payPedro], 'search includes the property name');
  const asc = (await ok(await owner.get('/api/payments?sort=amount_asc'))).payments;
  assert.equal(asc[0].payment_id, ids.payPedro);
  assert.equal((await owner.get('/api/payments?tenant_id=1')).status, 404);
});

test('expenses: unit / common area, vendor, source, amount, voided, receipt, sort', async () => {
  const list = async (q) => (await ok(await owner.get(`/api/expenses${q}`))).expenses.map((x) => x.expense_id).sort();
  assert.deepEqual(await list(''), [ids.e1, ids.e2].sort());
  assert.deepEqual(await list('?unit_id=none'), [ids.e1]);
  assert.deepEqual(await list(`?unit_id=${ids.A1}`), [ids.e2]);
  assert.deepEqual(await list('?vendor=meralco'), [ids.e1]);
  assert.deepEqual(await list('?source=maintenance'), [ids.e2]);
  assert.deepEqual(await list('?source=direct'), [ids.e1]);
  assert.deepEqual(await list('?min_amount=1000'), [ids.e1]);
  assert.deepEqual(await list('?max_amount=1000'), [ids.e2]);
  assert.deepEqual(await list('?include_voided=only'), [ids.e3]);
  assert.deepEqual(await list('?receipt=yes'), [ids.e1]);
  assert.deepEqual(await list('?receipt=maybe'), [ids.e1, ids.e2].sort(), 'unknown receipt value is ignored');
  const byAmount = (await ok(await owner.get('/api/expenses?sort=amount'))).expenses;
  assert.equal(byAmount[0].expense_id, ids.e1);
  assert.equal((await owner.get('/api/expenses?unit_id=nope')).status, 404);
});

test('maintenance: priority, unit, assigned to, reported dates, cost, sort, assignee list', async () => {
  const list = async (q) => (await ok(await owner.get(`/api/maintenance${q}`))).requests.map((m) => m.request_id).sort();
  assert.deepEqual(await list('?status=all&priority=high_up'), [ids.m1, ids.m2].sort());
  assert.deepEqual(await list('?status=all&unit_id=none'), [ids.m2]);
  assert.deepEqual(await list(`?status=all&unit_id=${ids.A1}`), [ids.m1]);
  assert.deepEqual(await list('?status=all&assigned=none'), [ids.m2]);
  assert.deepEqual(await list('?status=all&assigned=MANG%20TONY'), [ids.m1, ids.m3].sort());
  assert.deepEqual(await list('?status=all&q=tony'), [ids.m1, ids.m3].sort(), 'search includes assigned to');
  assert.deepEqual(await list('?status=all&q=pedro'), [ids.m3], 'search includes reported by');
  assert.deepEqual(await list(`?status=all&from=${plusDays(1)}`), []);
  assert.equal((await list(`?status=all&from=${today}&to=${today}`)).length, 3);
  assert.equal((await list('?status=all&from=2026-02-30')).length, 3, 'invalid date is ignored');
  assert.deepEqual(await list('?status=all&cost=recorded'), [ids.m1]);
  assert.deepEqual(await list('?status=all&cost=estimate_only'), [ids.m2]);
  assert.deepEqual(await list('?status=all&cost=none'), [ids.m2, ids.m3].sort());
  assert.deepEqual(await list('?priority=high_up'), [ids.m1, ids.m2].sort(), 'default still hides resolved');
  const res = await ok(await owner.get('/api/maintenance?status=all&sort=priority'));
  assert.deepEqual(res.requests.map((m) => m.request_id), [ids.m2, ids.m1, ids.m3]);
  assert.equal(res.assignees.length, 1, 'names are grouped ignoring case and spaces');
  assert.equal((await owner.get('/api/maintenance?unit_id=bad')).status, 404);
});

test('reports: property type filter', async () => {
  const from = addMonths(today, -3);
  const dorm = await ok(await owner.get(`/api/reports?from=${from}&to=${today}&property_type=dormitory`));
  assert.deepEqual(dorm.by_property.map((p) => p.property_name), ['Ilang-Ilang Dorm']);
  assert.equal(dorm.totals.collected, '3500.00');
  const all = await ok(await owner.get(`/api/reports?from=${from}&to=${today}&property_type=castle`));
  assert.equal(all.totals.collected, '11500.00', 'unknown type is ignored');
  const csv = await owner.get(`/api/reports/export?from=${from}&to=${today}&property_type=dormitory`);
  assert.equal(csv.status, 200);
  assert.ok(csv.data.includes('Ilang-Ilang Dorm') && !csv.data.includes('Sampaguita Apartments'));
});

test('filters stay inside a manager’s assigned properties', async () => {
  const inv = await ok(await owner.post('/api/team/invitations', { email: 'mgr@example.com', role: 'manager', property_ids: [ids.B] }), 201);
  const token = decodeURIComponent(inv.inviteLink.split('invite=')[1]);
  const mgr = client(srv.base);
  await ok(await mgr.post('/api/auth/signup', { full_name: 'Mgr', email: 'mgr@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token }), 201);
  assert.deepEqual((await ok(await mgr.get('/api/properties?occupancy=vacant'))).properties, []);
  assert.deepEqual(names((await ok(await mgr.get('/api/tenants?lease=moved_out'))).tenants), []);
  assert.deepEqual(names((await ok(await mgr.get('/api/tenants?lease=active'))).tenants), ['Pedro Penduko']);
  assert.deepEqual((await ok(await mgr.get('/api/payments?method=gcash'))).payments, []);
  assert.deepEqual((await ok(await mgr.get('/api/maintenance?status=all&assigned=mang%20tony'))).requests.map((m) => m.request_id), [ids.m3]);
  assert.equal((await ok(await mgr.get('/api/maintenance'))).assignees.length, 1);
});
