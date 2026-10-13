'use strict';

// Cleaner pay (D-52): the pay worked out when a clean is done, rates, the monthly pay
// list, mark-paid and undo, and each cleaner's own pay. Runs on its own database:
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_c node --test --test-concurrency=1 test/cleanerpay.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { pool } = require('../src/db');
const { computePay } = require('../src/lib/cleanerpay');
const { hashPassword } = require('../src/lib/auth');

const PASSWORD = 'longenough1';
const NO_TASK = '00000000-0000-4000-8000-000000000000';

let srv; let owner; let manager; let staff; let rosa; let other;
let ownerId; let orgId; let otherOwnerId; let otherOrgId;
let propA; let propB; let unitA1; let unitA2; let unitB; let otherUnit;
const who = {};
const aug = {};
const jun = {};
const may = {};

async function invite(email, fullName, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return { userId: (await c.get('/api/auth/me')).data.user.user_id, client: c };
}

// A cleaning task written straight to the table. Done tasks get their pay worked out the
// way the status route will do it (computePay), so the tests see real pay amounts.
async function task(o = {}) {
  const { unit = unitA1, month = '2026-08', day = 5, hhmm = '10:00', minutes = 60, assignedTo = null, assigneeName = null,
    completedBy = ownerId, org = orgId, done = true } = o;
  const ts = `${month}-${String(day).padStart(2, '0')}T${hhmm}:00+08:00`;
  const [{ task_id: id }] = await sql(
    `INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, status, assigned_to, assignee_name, completed_by, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             CASE WHEN $4 = 'done' THEN $8::timestamptz - make_interval(mins => $9) END,
             CASE WHEN $4 = 'done' THEN $8::timestamptz END)
     RETURNING task_id`,
    [org, unit, ts.slice(0, 10), done ? 'done' : 'todo', assignedTo, assigneeName, done ? completedBy : null, ts, minutes]);
  if (done) await computePay(pool, id);
  return id;
}

const row = async (id) => (await sql('SELECT * FROM cleaning_tasks WHERE task_id = $1', [id]))[0];

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'pay-owner-c@example.com', 'Pay Stays');
  ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]);

  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unitA1 = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  unitA2 = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1202', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  unitB = (await owner.post(`/api/properties/${propB.property_id}/units`, { unit_name: '2101', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;

  const s = await invite('staff-a-c@example.com', 'Staff Azure', 'staff', [propA.property_id]);
  who.staffA = s.userId; staff = s.client;
  const m = await invite('manager-b-c@example.com', 'Manager Grass', 'manager', [propB.property_id]);
  who.managerB = m.userId; manager = m.client;

  // A cleaner with a login (role cleaner) assigned to the Azure property.
  [{ user_id: who.rosa }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, 'rosa-c@example.com', $2, 'Rosa Reyes', 'cleaner', now()) RETURNING user_id`,
    [orgId, await hashPassword(PASSWORD)]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [who.rosa, propA.property_id]);
  rosa = client(srv.base);
  assert.equal((await rosa.post('/api/auth/login', { email: 'rosa-c@example.com', password: PASSWORD })).status, 200);

  // Another workspace, to prove nothing leaks across.
  other = await ownerAccount(srv.base, 'pay-other-c@example.com', 'Other Co');
  otherOwnerId = (await other.get('/api/auth/me')).data.user.user_id;
  [{ organization_id: otherOrgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [otherOwnerId]);
  const otherProp = (await other.post('/api/properties', { property_name: 'Elsewhere', property_type: 'condominium', address: 'Pasig Blvd', city: 'Pasig', province: 'Metro Manila' })).data.property;
  otherUnit = (await other.post(`/api/properties/${otherProp.property_id}/units`, { unit_name: '901', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;

  // Rates: a team member per clean, an outside cleaner per clean, a team member per hour.
  const put = (body) => owner.raw('PUT', '/api/cleaner-rates', body);
  assert.equal((await put({ user_id: who.staffA, rate_type: 'per_clean', amount: '350.50' })).status, 200);
  assert.equal((await put({ assignee_name: 'Ate Lin', rate_type: 'per_clean', amount: '400.00' })).status, 200);
  assert.equal((await put({ user_id: who.rosa, rate_type: 'per_hour', amount: '200.00' })).status, 200);

  // August 2026 (Manila): the pay list and "my pay" tests read these.
  aug.a1 = await task({ unit: unitA1, assignedTo: who.staffA, month: '2026-08', day: 5 });
  aug.lin = await task({ unit: unitA1, assigneeName: 'Ate Lin', month: '2026-08', day: 6 });
  aug.rosa = await task({ unit: unitA2, assignedTo: who.rosa, month: '2026-08', day: 7, minutes: 70 });
  aug.rosaB = await task({ unit: unitB, assignedTo: who.rosa, month: '2026-08', day: 8, minutes: 30 });
  aug.cover = await task({ unit: unitA1, assignedTo: who.staffA, completedBy: who.rosa, month: '2026-08', day: 12 });
  aug.edge = await task({ unit: unitA2, assignedTo: who.staffA, month: '2026-08', day: 31, hhmm: '23:30' });
  aug.first = await task({ unit: unitA1, assignedTo: who.staffA, month: '2026-08', day: 1, hhmm: '00:30' });
  aug.julEnd = await task({ unit: unitA1, assignedTo: who.staffA, month: '2026-07', day: 31, hhmm: '23:30' });
  aug.sep = await task({ unit: unitA1, assignedTo: who.staffA, month: '2026-09', day: 1, hhmm: '00:30' });
  aug.open = await task({ unit: unitA1, assignedTo: who.staffA, month: '2026-08', day: 9, done: false });

  // June 2026: mark-paid tests.
  jun.m1 = await task({ unit: unitA1, assignedTo: who.staffA, month: '2026-06', day: 5 });
  jun.m2 = await task({ unit: unitA1, assigneeName: 'Ate Lin', month: '2026-06', day: 6 });
  jun.m3 = await task({ unit: unitA2, assignedTo: who.rosa, month: '2026-06', day: 7 });
  jun.m4 = await task({ unit: unitA2, assignedTo: who.staffA, month: '2026-06', day: 8, done: false });
  jun.m5 = await task({ unit: unitB, assignedTo: who.rosa, month: '2026-06', day: 8 });
  jun.m6 = await task({ unit: unitA2, assigneeName: 'Zero Pay', month: '2026-06', day: 10 });
  await sql('UPDATE cleaning_tasks SET pay_amount = 0.00 WHERE task_id = $1', [jun.m6]);
  jun.m7 = await task({ unit: unitB, assigneeName: 'Nobody Here', month: '2026-06', day: 11 });
  jun.m8 = await task({ unit: unitA1, assignedTo: who.staffA, month: '2026-06', day: 11 });
  jun.m9 = await task({ unit: unitA2, assignedTo: who.staffA, month: '2026-06', day: 12 });
  jun.otherOrg = await task({ unit: otherUnit, org: otherOrgId, completedBy: otherOwnerId, month: '2026-06', day: 12 });

  // May 2026: undo tests.
  may.u1 = await task({ unit: unitA1, assigneeName: 'Ate Lin', month: '2026-05', day: 5 });
  may.u2 = await task({ unit: unitA1, assignedTo: who.staffA, month: '2026-05', day: 6 });
  may.u3 = await task({ unit: unitA2, assignedTo: who.rosa, month: '2026-05', day: 7 });
  may.u4 = await task({ unit: unitA2, assignedTo: who.staffA, month: '2026-05', day: 8 });
});
test.after(async () => { await srv.close(); });

// ---------------------------------------------------------------- pay worked out at done
test('computePay: a per-clean rate sets the team member\'s pay exactly', async () => {
  const id = await task({ unit: unitA1, assignedTo: who.staffA, month: '2026-03', day: 2 });
  assert.equal((await row(id)).pay_amount, '350.50');
});

test('computePay: per hour rounds up to the next 15 minutes', async () => {
  // 40 minutes is billed as 45 minutes: 200 x 45 / 60.
  assert.equal((await row(await task({ assignedTo: who.rosa, month: '2026-03', day: 3, minutes: 40 }))).pay_amount, '150.00');
  // Exactly 60 minutes is 60 minutes; 61 minutes is 75.
  assert.equal((await row(await task({ assignedTo: who.rosa, month: '2026-03', day: 4, minutes: 60 }))).pay_amount, '200.00');
  assert.equal((await row(await task({ assignedTo: who.rosa, month: '2026-03', day: 5, minutes: 61 }))).pay_amount, '250.00');
});

test('computePay: per hour is capped at 12 hours', async () => {
  assert.equal((await row(await task({ assignedTo: who.rosa, month: '2026-03', day: 6, minutes: 20 * 60 }))).pay_amount, '2400.00');
});

test('computePay: per hour pay rounds to the centavo', async () => {
  await sql(`INSERT INTO cleaner_rates (organization_id, assignee_name, rate_type, amount) VALUES ($1, 'Kuya Ben', 'per_hour', 99.99)`, [orgId]);
  // 99.99 x 15 / 60 = 24.9975, which rounds to 25.00.
  assert.equal((await row(await task({ assigneeName: 'Kuya Ben', month: '2026-03', day: 7, minutes: 15 }))).pay_amount, '25.00');
});

test('computePay: an outside cleaner is matched by name, ignoring case', async () => {
  assert.equal((await row(await task({ assigneeName: 'ATE LIN', month: '2026-03', day: 8 }))).pay_amount, '400.00');
});

test('computePay: no rate leaves pay as it was (NULL here)', async () => {
  const id = await task({ assigneeName: 'Nobody Here', month: '2026-03', day: 9 });
  assert.equal((await row(id)).pay_amount, null);
  const kept = await task({ assigneeName: 'Still Nobody', month: '2026-03', day: 9, minutes: 30 });
  await sql('UPDATE cleaning_tasks SET pay_amount = 75.00 WHERE task_id = $1', [kept]);
  assert.equal(await computePay(pool, kept), null);
  assert.equal((await row(kept)).pay_amount, '75.00');
});

test('computePay: does nothing for a clean that is not done or is already paid', async () => {
  const open = await task({ assignedTo: who.staffA, month: '2026-03', day: 10, done: false });
  assert.equal(await computePay(pool, open), null);
  assert.equal((await row(open)).pay_amount, null);
  const paid = await task({ assignedTo: who.staffA, month: '2026-03', day: 11 });
  await sql(`UPDATE cleaning_tasks SET pay_status = 'paid', pay_amount = 99.00 WHERE task_id = $1`, [paid]);
  assert.equal(await computePay(pool, paid), null);
  assert.equal((await row(paid)).pay_amount, '99.00');
});

test('computePay: pay goes to the assigned member only, not to whoever finished it', async () => {
  // Assigned to a manager with no rate, finished by Rosa (who has one): no pay, not Rosa's rate.
  assert.equal((await row(await task({ assignedTo: who.managerB, completedBy: who.rosa, month: '2026-03', day: 12 }))).pay_amount, null);
});

test('computePay: an unassigned clean is paid to whoever finished it', async () => {
  assert.equal((await row(await task({ assignedTo: null, completedBy: who.staffA, month: '2026-03', day: 13 }))).pay_amount, '350.50');
});

test('marking a unit clean pays the due cleans it finishes, and leaves later ones unpaid', async () => {
  const unit = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1299', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  const [{ task_id: due }] = await sql(
    `INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, status, assigned_to)
     VALUES ($1, $2, (now() AT TIME ZONE 'Asia/Manila')::date, 'todo', $3) RETURNING task_id`, [orgId, unit, who.staffA]);
  const [{ task_id: later }] = await sql(
    `INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, status, assigned_to)
     VALUES ($1, $2, (now() AT TIME ZONE 'Asia/Manila')::date + 3, 'todo', $3) RETURNING task_id`, [orgId, unit, who.staffA]);
  assert.equal((await owner.post(`/api/units/${unit}/cleaning`, { status: 'clean' })).status, 200);
  assert.equal((await row(due)).status, 'done');
  assert.equal((await row(due)).pay_amount, '350.50', 'the staff member\'s per-clean rate');
  assert.equal((await row(later)).status, 'todo');
  assert.equal((await row(later)).pay_amount, null);
});

// ---------------------------------------------------------------- rates (owners)
test('rates: the owner adds and changes a rate for a team member, one row per person', async () => {
  const put = (b) => owner.raw('PUT', '/api/cleaner-rates', b);
  const first = await put({ user_id: who.managerB, rate_type: 'per_clean', amount: '300' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.rate.name, 'Manager Grass');
  assert.equal(first.data.rate.user_id, who.managerB);
  assert.equal(first.data.rate.amount, '300.00');
  const again = await put({ user_id: who.managerB, rate_type: 'per_hour', amount: '320.5' });
  assert.equal(again.data.rate.rate_type, 'per_hour');
  assert.equal(again.data.rate.amount, '320.50');
  const list = (await owner.get('/api/cleaner-rates')).data.rates.filter((r) => r.user_id === who.managerB);
  assert.equal(list.length, 1);
});

test('rates: an outside cleaner by name, matched ignoring case, is one row', async () => {
  const put = (b) => owner.raw('PUT', '/api/cleaner-rates', b);
  await put({ assignee_name: 'Ate Mila', rate_type: 'per_clean', amount: '250' });
  const again = await put({ assignee_name: 'ate mila', rate_type: 'per_clean', amount: '260' });
  assert.equal(again.data.rate.name, 'ate mila');
  assert.equal(again.data.rate.user_id, null);
  assert.equal(again.data.rate.amount, '260.00');
  const names = (await owner.get('/api/cleaner-rates')).data.rates.filter((r) => r.name.toLowerCase() === 'ate mila');
  assert.equal(names.length, 1);
});

test('rates: list rows carry a name, and the amounts are 2-decimal strings', async () => {
  const { rates } = (await owner.get('/api/cleaner-rates')).data;
  for (const r of rates) {
    assert.equal(typeof r.name, 'string');
    assert.match(r.amount, /^\d+\.\d{2}$/);
    assert.ok(['per_clean', 'per_hour'].includes(r.rate_type));
  }
  assert.equal(rates.find((r) => r.user_id === who.rosa).name, 'Rosa Reyes');
});

test('rates: a rate needs exactly one of a team member or a name, a valid type and a valid amount', async () => {
  const put = (b) => owner.raw('PUT', '/api/cleaner-rates', b);
  const both = await put({ user_id: who.staffA, assignee_name: 'Both', rate_type: 'per_clean', amount: '1' });
  assert.equal(both.status, 400);
  assert.ok(both.data.fields.assignee_name);
  const neither = await put({ rate_type: 'per_clean', amount: '1' });
  assert.equal(neither.status, 400);
  const badType = await put({ user_id: who.staffA, rate_type: 'monthly', amount: '1' });
  assert.equal(badType.status, 400);
  assert.ok(badType.data.fields.rate_type);
  const negative = await put({ user_id: who.staffA, rate_type: 'per_clean', amount: '-5' });
  assert.equal(negative.status, 400);
  assert.ok(negative.data.fields.amount);
  const stranger = await put({ user_id: otherOwnerId, rate_type: 'per_clean', amount: '1' });
  assert.equal(stranger.status, 400);
  assert.equal(stranger.data.fields.user_id, 'Choose a member of this workspace.');
  assert.equal(stranger.data.code, 'VALIDATION');
  assert.equal(stranger.data.stack, undefined);
});

test('rates: only the owner can see or change them', async () => {
  assert.equal((await manager.get('/api/cleaner-rates')).status, 403);
  assert.equal((await staff.get('/api/cleaner-rates')).status, 403);
  assert.equal((await manager.raw('PUT', '/api/cleaner-rates', { user_id: who.staffA, rate_type: 'per_clean', amount: '1' })).status, 403);
  assert.equal((await rosa.get('/api/cleaner-pay')).status, 403);
  assert.equal((await client(srv.base).get('/api/cleaner-rates')).status, 401);
});

test('rates: delete removes a rate; a second delete or another workspace\'s rate is a 404', async () => {
  const id = (await owner.get('/api/cleaner-rates')).data.rates.find((r) => r.name === 'ate mila').rate_id;
  assert.deepEqual((await owner.raw('DELETE', `/api/cleaner-rates/${id}`)).data, { ok: true });
  assert.equal((await owner.raw('DELETE', `/api/cleaner-rates/${id}`)).status, 404);
  const otherRate = await other.raw('PUT', '/api/cleaner-rates', { assignee_name: 'Other Cleaner', rate_type: 'per_clean', amount: '90' });
  const r = await owner.raw('DELETE', `/api/cleaner-rates/${otherRate.data.rate.rate_id}`);
  assert.equal(r.status, 404);
  assert.equal(r.data.code, 'NOT_FOUND');
});

// ---------------------------------------------------------------- the pay list
test('pay list: an August month lists finished cleans by Manila date and totals each cleaner exactly', async () => {
  const r = await owner.get('/api/cleaner-pay?month=2026-08');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.month, '2026-08');
  const ids = r.data.tasks.map((t) => t.task_id).sort();
  assert.deepEqual(ids, [aug.a1, aug.lin, aug.rosa, aug.rosaB, aug.cover, aug.edge, aug.first].sort());
  assert.ok(!ids.includes(aug.julEnd) && !ids.includes(aug.sep) && !ids.includes(aug.open), 'outside the month or not finished');
  assert.deepEqual(r.data.totals, { total: '2152.00', paid: '0.00', unpaid: '2152.00' });
  const staffGroup = r.data.cleaners.find((c) => c.key === `user:${who.staffA}`);
  assert.equal(staffGroup.name, 'Staff Azure');
  assert.equal(staffGroup.user_id, who.staffA);
  assert.equal(staffGroup.count, 4);
  assert.equal(staffGroup.total, '1402.00');
  const lin = r.data.cleaners.find((c) => c.key === 'name:ate lin');
  assert.deepEqual({ name: lin.name, user_id: lin.user_id, total: lin.total }, { name: 'Ate Lin', user_id: null, total: '400.00' });
  const rosaGroup = r.data.cleaners.find((c) => c.key === `user:${who.rosa}`);
  assert.equal(rosaGroup.total, '350.00');
});

test('pay list: each task carries cleaner_name, cleaner_key and money as 2-decimal strings', async () => {
  const { tasks } = (await owner.get('/api/cleaner-pay?month=2026-08')).data;
  const byId = Object.fromEntries(tasks.map((t) => [t.task_id, t]));
  assert.equal(byId[aug.a1].cleaner_name, 'Staff Azure');
  assert.equal(byId[aug.a1].cleaner_key, `user:${who.staffA}`);
  assert.equal(byId[aug.a1].pay_amount, '350.50');
  assert.equal(byId[aug.a1].pay_status, 'unpaid');
  assert.equal(byId[aug.lin].cleaner_name, 'Ate Lin', 'finished by the owner, but the outside cleaner it was assigned to');
  assert.equal(byId[aug.lin].cleaner_key, 'name:ate lin');
  assert.equal(byId[aug.rosa].pay_amount, '250.00', '70 minutes is 75 minutes at 200 an hour');
  assert.equal(byId[aug.rosaB].pay_amount, '100.00');
  assert.equal(byId[aug.cover].cleaner_name, 'Staff Azure');
  assert.match(byId[aug.a1].completed_at, /^\d{4}-\d{2}-\d{2}T/);
  for (const t of tasks) {
    assert.match(t.pay_amount ?? '0.00', /^\d+\.\d{2}$/);
    assert.equal(t.departing_guest, undefined);
    assert.equal(t.guest_phone, undefined);
  }
});

test('pay list: the default month is this month in Manila', async () => {
  const r = await owner.get('/api/cleaner-pay');
  assert.equal(r.status, 200);
  assert.equal(r.data.month, manilaToday().slice(0, 7));
});

test('pay list: filters by status and by cleaner key', async () => {
  const unpaid = await owner.get('/api/cleaner-pay?month=2026-08&status=unpaid');
  assert.equal(unpaid.data.tasks.length, 7);
  assert.equal((await owner.get('/api/cleaner-pay?month=2026-08&status=paid')).data.tasks.length, 0);
  const staffOnly = await owner.get(`/api/cleaner-pay?month=2026-08&cleaner=USER:${who.staffA.toUpperCase()}`);
  assert.equal(staffOnly.data.tasks.length, 4);
  assert.equal(staffOnly.data.totals.total, '1402.00');
  const lin = await owner.get('/api/cleaner-pay?month=2026-08&cleaner=name:Ate Lin');
  assert.equal(lin.data.tasks.length, 1);
  assert.equal(lin.data.totals.total, '400.00');
});

test('pay list: bad filters are a 400 with the field named', async () => {
  const month = await owner.get('/api/cleaner-pay?month=2026-13');
  assert.equal(month.status, 400);
  assert.equal(month.data.fields.month, 'Use the format YYYY-MM.');
  const status = await owner.get('/api/cleaner-pay?month=2026-08&status=all');
  assert.equal(status.status, 400);
  assert.ok(status.data.fields.status);
  assert.equal((await owner.get('/api/cleaner-pay?month=2026-08&cleaner=bogus')).data.fields.cleaner, 'Choose a cleaner from the list.');
});

test('pay list: a manager sees only the properties assigned to them; staff cannot open it; other workspaces see nothing', async () => {
  const mgr = await manager.get('/api/cleaner-pay?month=2026-08');
  assert.equal(mgr.status, 200);
  assert.deepEqual(mgr.data.tasks.map((t) => t.task_id), [aug.rosaB]);
  assert.equal((await staff.get('/api/cleaner-pay?month=2026-08')).status, 403);
  assert.equal((await other.get('/api/cleaner-pay?month=2026-08')).data.tasks.length, 0);
  assert.equal((await client(srv.base).get('/api/cleaner-pay?month=2026-08')).status, 401);
});

// ---------------------------------------------------------------- mark paid
test('mark paid: marks several cleans paid, records one cleaning expense per unit', async () => {
  const body = { task_ids: [jun.m1, jun.m2, jun.m3], paid_on: '2026-06-20', method: 'gcash', reference: 'GC-123', record_expense: true };
  const r = await owner.post('/api/cleaner-pay/mark-paid', body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.paid, 3);
  assert.equal(r.data.total, '950.50');
  assert.equal(r.data.expense_ids.length, 2);

  const t1 = await row(jun.m1);
  assert.equal(t1.pay_status, 'paid');
  assert.equal(t1.paid_on, '2026-06-20');
  assert.equal(t1.paid_method, 'gcash');
  assert.equal(t1.paid_reference, 'GC-123');
  assert.equal(t1.paid_by, ownerId);
  const t2 = await row(jun.m2);
  assert.equal(t2.pay_expense_id, t1.pay_expense_id, 'two cleans in one unit share one expense');
  const [e] = await sql('SELECT * FROM expenses WHERE expense_id = $1', [t1.pay_expense_id]);
  assert.equal(e.category, 'cleaning');
  assert.equal(e.amount, '750.50');
  assert.equal(e.expense_date, '2026-06-20');
  assert.equal(e.unit_id, unitA1);
  assert.equal(e.property_id, propA.property_id);
  assert.equal(e.recorded_by, ownerId);
  assert.equal(e.description, 'Cleaning pay: Staff Azure, Ate Lin, 2 cleans');
  const t3 = await row(jun.m3);
  const [e3] = await sql('SELECT amount FROM expenses WHERE expense_id = $1', [t3.pay_expense_id]);
  assert.equal(e3.amount, '200.00');
  assert.notEqual(t3.pay_expense_id, t1.pay_expense_id);
});

test('mark paid: a manager can pay cleans in their own property, without an expense', async () => {
  const r = await manager.post('/api/cleaner-pay/mark-paid', { task_ids: [jun.m5], paid_on: '2026-06-21', method: 'cash', record_expense: false });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.expense_ids, []);
  const t = await row(jun.m5);
  assert.equal(t.pay_status, 'paid');
  assert.equal(t.pay_expense_id, null);
  assert.equal(t.paid_reference, null);
});

test('mark paid: a manager cannot pay a clean outside their properties (404, nothing changes)', async () => {
  const r = await manager.post('/api/cleaner-pay/mark-paid', { task_ids: [jun.m8], paid_on: '2026-06-21', method: 'cash' });
  assert.equal(r.status, 404);
  assert.equal((await row(jun.m8)).pay_status, 'unpaid');
});

test('mark paid: one unfinished clean in the batch stops the whole batch', async () => {
  const r = await owner.post('/api/cleaner-pay/mark-paid', { task_ids: [jun.m9, jun.m4], paid_on: '2026-06-21', method: 'cash' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'NOT_DONE');
  assert.deepEqual(r.data.task_ids, [jun.m4]);
  assert.equal((await row(jun.m9)).pay_status, 'unpaid', 'the finished clean in the batch was not paid');
});

test('mark paid: already-paid, no-pay and unknown cleans are refused with a clear code', async () => {
  const again = await owner.post('/api/cleaner-pay/mark-paid', { task_ids: [jun.m1], paid_on: '2026-06-21', method: 'cash' });
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'ALREADY_PAID');
  const noPay = await owner.post('/api/cleaner-pay/mark-paid', { task_ids: [jun.m7], paid_on: '2026-06-21', method: 'cash' });
  assert.equal(noPay.status, 409);
  assert.equal(noPay.data.code, 'NO_PAY_AMOUNT');
  assert.deepEqual(noPay.data.task_ids, [jun.m7]);
  const missing = await owner.post('/api/cleaner-pay/mark-paid', { task_ids: [NO_TASK], paid_on: '2026-06-21', method: 'cash' });
  assert.equal(missing.status, 404);
});

test('mark paid: a clean with zero pay is paid but makes no expense (an expense must be above zero)', async () => {
  const r = await owner.post('/api/cleaner-pay/mark-paid', { task_ids: [jun.m6], paid_on: '2026-06-21', method: 'cash', record_expense: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.expense_ids, []);
  const t = await row(jun.m6);
  assert.equal(t.pay_status, 'paid');
  assert.equal(t.pay_expense_id, null);
});

test('mark paid: input is validated with field errors', async () => {
  const mark = (b) => owner.post('/api/cleaner-pay/mark-paid', { paid_on: '2026-06-21', method: 'cash', task_ids: [jun.m8], ...b });
  const empty = await mark({ task_ids: [] });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.fields.task_ids, 'Choose at least one clean.');
  const notId = await mark({ task_ids: ['not-a-uuid'] });
  assert.equal(notId.status, 400);
  assert.ok(notId.data.fields.task_ids);
  const method = await mark({ method: 'card' });
  assert.equal(method.status, 400);
  assert.ok(method.data.fields.method);
  const future = await mark({ paid_on: '2099-01-01' });
  assert.equal(future.status, 400);
  assert.equal(future.data.fields.paid_on, 'Date paid cannot be in the future.');
  const noDate = await mark({ paid_on: undefined });
  assert.equal(noDate.status, 400);
  assert.ok(noDate.data.fields.paid_on);
  assert.equal(noDate.data.stack, undefined);
  assert.equal((await staff.post('/api/cleaner-pay/mark-paid', { task_ids: [jun.m8], paid_on: '2026-06-21', method: 'cash' })).status, 403);
});

// ---------------------------------------------------------------- undo
test('undo: a clean whose expense covers only it voids that expense and keeps its pay', async () => {
  await owner.post('/api/cleaner-pay/mark-paid', { task_ids: [may.u3], paid_on: '2026-05-20', method: 'maya', record_expense: true });
  const before = await row(may.u3);
  const r = await owner.post(`/api/cleaner-pay/${may.u3}/unpay`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.unpaid, [may.u3]);
  assert.deepEqual(r.data.voided_expense_ids, [before.pay_expense_id]);
  const t = await row(may.u3);
  assert.equal(t.pay_status, 'unpaid');
  assert.equal(t.paid_on, null);
  assert.equal(t.paid_method, null);
  assert.equal(t.pay_expense_id, null);
  assert.equal(t.pay_amount, '200.00', 'the amount stays so it can be paid again');
  const [e] = await sql('SELECT voided_at, void_reason FROM expenses WHERE expense_id = $1', [before.pay_expense_id]);
  assert.ok(e.voided_at);
  assert.equal(e.void_reason, 'Cleaner pay marked unpaid');
});

test('undo: a clean sharing an expense is refused until the others on it are undone too', async () => {
  const paid = await owner.post('/api/cleaner-pay/mark-paid', { task_ids: [may.u1, may.u2], paid_on: '2026-05-21', method: 'cash', record_expense: true });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal(paid.data.expense_ids.length, 1);
  const expenseId = paid.data.expense_ids[0];

  const refused = await owner.post(`/api/cleaner-pay/${may.u1}/unpay`);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'EXPENSE_SHARED');
  assert.deepEqual(refused.data.other_task_ids, [may.u2]);
  assert.equal((await row(may.u1)).pay_status, 'paid', 'nothing changed');
  assert.equal((await row(may.u2)).pay_status, 'paid');
  const [e] = await sql('SELECT voided_at FROM expenses WHERE expense_id = $1', [expenseId]);
  assert.equal(e.voided_at, null, 'expense still stands');

  const together = await owner.post(`/api/cleaner-pay/${may.u1}/unpay`, { task_ids: [may.u2] });
  assert.equal(together.status, 200, JSON.stringify(together.data));
  assert.deepEqual(together.data.unpaid.sort(), [may.u1, may.u2].sort());
  assert.deepEqual(together.data.voided_expense_ids, [expenseId]);
  assert.equal((await row(may.u2)).pay_status, 'unpaid');
  assert.equal((await row(may.u2)).pay_expense_id, null);
  const [e2] = await sql('SELECT voided_at FROM expenses WHERE expense_id = $1', [expenseId]);
  assert.ok(e2.voided_at);
});

test('undo: a clean that is not paid, or not found, is refused; only owners may undo', async () => {
  const notPaid = await owner.post(`/api/cleaner-pay/${may.u4}/unpay`);
  assert.equal(notPaid.status, 409);
  assert.equal(notPaid.data.code, 'NOT_PAID');
  assert.equal((await owner.post(`/api/cleaner-pay/${NO_TASK}/unpay`)).status, 404);
  assert.equal((await owner.post(`/api/cleaner-pay/${jun.otherOrg}/unpay`)).status, 404, 'another workspace\'s clean is not found');
  await owner.post('/api/cleaner-pay/mark-paid', { task_ids: [may.u4], paid_on: '2026-05-22', method: 'cash' });
  assert.equal((await manager.post(`/api/cleaner-pay/${may.u4}/unpay`)).status, 403);
  assert.equal((await staff.post(`/api/cleaner-pay/${may.u4}/unpay`)).status, 403);
  assert.equal((await row(may.u4)).pay_status, 'paid');
});

// ---------------------------------------------------------------- my pay
test('my pay: a team member sees their own cleans and totals, and no one else\'s', async () => {
  const r = await staff.get('/api/my-pay?month=2026-08');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.month, '2026-08');
  const ids = r.data.tasks.map((t) => t.task_id).sort();
  assert.deepEqual(ids, [aug.a1, aug.cover, aug.edge, aug.first].sort(), 'assigned to them, the Ate Lin clean is not theirs');
  assert.deepEqual(r.data.totals, { total: '1402.00', paid: '0.00', unpaid: '1402.00' });
  assert.ok(r.data.tasks.every((t) => t.pay_visible === true));
});

test('my pay: a cleaner with a login sees the cleans assigned to or finished by them; a clean finished for someone else shows no pay', async () => {
  const r = await rosa.get('/api/my-pay?month=2026-08');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const byId = Object.fromEntries(r.data.tasks.map((t) => [t.task_id, t]));
  assert.deepEqual(Object.keys(byId).sort(), [aug.rosa, aug.rosaB, aug.cover].sort());
  assert.equal(byId[aug.rosa].pay_amount, '250.00');
  assert.equal(byId[aug.rosa].pay_visible, true);
  assert.equal(byId[aug.cover].pay_amount, null, 'Staff Azure\'s pay on a clean Rosa finished');
  assert.equal(byId[aug.cover].pay_status, null);
  assert.equal(byId[aug.cover].pay_visible, false);
  assert.equal(byId[aug.cover].cleaner_name, 'Staff Azure');
  assert.deepEqual(r.data.totals, { total: '350.00', paid: '0.00', unpaid: '350.00' });
  assert.equal(JSON.stringify(r.data).includes('350.50'), false, 'no one else\'s amount appears');
});

test('my pay: the owner, who finished cleans for others, sees them with no pay in them', async () => {
  const r = await owner.get('/api/my-pay?month=2026-08');
  assert.equal(r.status, 200);
  const ids = r.data.tasks.map((t) => t.task_id);
  assert.ok(ids.includes(aug.lin), 'finished by the owner');
  assert.ok(!ids.includes(aug.cover), 'finished by Rosa');
  assert.ok(r.data.tasks.every((t) => t.pay_visible === false && t.pay_amount === null));
  assert.deepEqual(r.data.totals, { total: '0.00', paid: '0.00', unpaid: '0.00' });
});

test('my pay: a paid clean shows as paid with its date and method', async () => {
  const r = await rosa.get('/api/my-pay?month=2026-05');
  const u3 = r.data.tasks.find((t) => t.task_id === may.u3);
  assert.equal(u3.pay_status, 'unpaid', 'undone earlier in this run');
  const paid = await rosa.get('/api/my-pay?month=2026-06');
  const m3 = paid.data.tasks.find((t) => t.task_id === jun.m3);
  assert.equal(m3.pay_status, 'paid');
  assert.equal(m3.paid_on, '2026-06-20');
  assert.equal(m3.paid_method, 'gcash');
  // m3 (200.00, paid in the batch above) and m5 (200.00, paid by the manager) both belong to Rosa.
  assert.equal(paid.data.totals.paid, '400.00');
});

test('my pay: the default month is this month, a bad month is a 400, signed-out is a 401, other workspaces see nothing', async () => {
  const now = await rosa.get('/api/my-pay');
  assert.equal(now.status, 200);
  assert.equal(now.data.month, manilaToday().slice(0, 7));
  const bad = await rosa.get('/api/my-pay?month=August');
  assert.equal(bad.status, 400);
  assert.equal(bad.data.fields.month, 'Use the format YYYY-MM.');
  assert.equal((await client(srv.base).get('/api/my-pay?month=2026-08')).status, 401);
  assert.equal((await other.get('/api/my-pay?month=2026-08')).data.tasks.length, 0);
});
