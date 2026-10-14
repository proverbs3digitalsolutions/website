'use strict';

// QA round 2 (A01): GET /cleaning-tasks/:id sends each role only what BACKEND-SCHEMA 6.1 allows,
// and the cleaning-task write rules (one assignee, pay above zero, a non-empty checklist).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_01 node --test --test-concurrency=1 test/qa-r2-housekeeping-access.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const PASSWORD = 'longenough1';
const today = manilaToday();
const AMOUNT_KEYS = ['estimated_cost', 'status', 'charge_id', 'resolution_note', 'resolved_at', 'resolved_by_name'];

let srv; let owner; let manager; let staff; let ana; let ben; let unitA; let taskId; let anaId;

async function member(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return { c, id: (await c.get('/api/auth/me')).data.user.user_id };
}

const detail = async (who) => (await who.get(`/api/cleaning-tasks/${taskId}`)).data.task;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r2-host@example.com', 'R2 Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unitA = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = (await member('r2-mgr@example.com', 'manager', [prop.property_id])).c;
  staff = await member('r2-staff@example.com', 'staff', [prop.property_id]);
  ana = await member('r2-ana@example.com', 'cleaner', [prop.property_id]);
  ben = await member('r2-ben@example.com', 'cleaner', [prop.property_id]);
  anaId = ana.id;
  taskId = (await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: today, assigned_to: ana.id })).data.task.task_id;

  // Damage: one report each from the owner, staff, Ana and Ben (cleaners may report on a task they can see).
  assert.equal((await owner.post(`/api/cleaning-tasks/${taskId}/damage`, { description: 'Owner report', estimated_cost: '800' })).status, 201);
  assert.equal((await staff.c.post(`/api/cleaning-tasks/${taskId}/damage`, { description: 'Staff report', estimated_cost: '300' })).status, 201);
  assert.equal((await ana.c.post(`/api/cleaning-tasks/${taskId}/damage`, { description: 'Ana report', estimated_cost: '120' })).status, 201);
  assert.equal((await ben.c.post(`/api/cleaning-tasks/${taskId}/damage`, { description: 'Ben report' })).status, 404, 'Ben cannot see Ana\'s task');
  await sql(`UPDATE damage_reports SET resolution_note = 'secret note', resolved_at = now() WHERE description = 'Owner report'`);
  // Lost and found: owner, staff and Ana each log one; the owner's note holds guest contact details.
  for (const [who, text] of [[owner, 'Owner item'], [staff.c, 'Staff item'], [ana.c, 'Ana item']]) {
    assert.equal((await who.post(`/api/cleaning-tasks/${taskId}/lost-found`, { description: text })).status, 201);
  }
  await sql(`UPDATE lost_found_items SET status_note = 'call guest 0917 000 0000'`);
  const [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ana.id]);
  await sql(`INSERT INTO cleaning_inspections (organization_id, task_id, score, passed, notes) VALUES ($1, $2, 80, false, 'Dusty shelf')`, [orgId, taskId]);
  await sql(`INSERT INTO maintenance_requests (organization_id, property_id, unit_id, title, cleaning_task_id) VALUES ($1, $2, $3, 'Leaky tap', $4)`, [orgId, prop.property_id, unitA.unit_id, taskId]);
});
test.after(async () => { await srv.close(); });

test('owner and manager see everything', async () => {
  for (const who of [owner, manager]) {
    const t = await detail(who);
    assert.equal(t.damage_reports.length, 3);
    assert.equal(t.damage_reports.find((r) => r.description === 'Owner report').resolution_note, 'secret note');
    assert.equal(t.damage_reports.find((r) => r.description === 'Staff report').estimated_cost, '300.00');
    assert.equal(t.lost_found.length, 3);
    assert.ok(t.lost_found.every((l) => l.status_note));
    assert.equal(t.inspections.length, 1);
    assert.equal(t.work_orders.length, 1);
  }
});

test('staff get no amounts, charge or resolution data, no inspections, and only what they filed', async () => {
  const t = await detail(staff.c);
  assert.deepEqual(t.damage_reports.map((r) => r.description), ['Staff report']);
  for (const k of AMOUNT_KEYS) assert.equal(k in t.damage_reports[0], false, `${k} must not reach staff`);
  assert.deepEqual(t.lost_found.map((l) => l.description), ['Staff item']);
  assert.equal('status_note' in t.lost_found[0], false);
  assert.deepEqual(t.inspections, []);
  assert.equal(t.work_orders.length, 1, 'staff keep work orders');
});

test('a cleaner gets no amounts, no work orders and only their own reports and items', async () => {
  const t = await detail(ana.c);
  assert.deepEqual(t.damage_reports.map((r) => r.description), ['Ana report']);
  for (const k of AMOUNT_KEYS) assert.equal(k in t.damage_reports[0], false, `${k} must not reach a cleaner`);
  assert.deepEqual(t.lost_found.map((l) => l.description), ['Ana item']);
  assert.equal('status_note' in t.lost_found[0], false);
  assert.deepEqual(t.work_orders, []);
  assert.equal(t.inspections.length, 1, 'inspection result on their own job');
});

test('a cleaner who is not on the job gets no inspection result', async () => {
  await sql('UPDATE cleaning_tasks SET assigned_to = NULL WHERE task_id = $1', [taskId]);
  const t = await detail(ben.c);
  assert.deepEqual(t.inspections, []);
  assert.deepEqual(t.damage_reports, []);
  assert.deepEqual(t.lost_found, []);
  await sql('UPDATE cleaning_tasks SET assigned_to = $2 WHERE task_id = $1', [taskId, anaId]);
});

test('PATCH refuses a team member and a typed name together; pay must be above zero', async () => {
  const both = await owner.patch(`/api/cleaning-tasks/${taskId}`, { assigned_to: anaId, assignee_name: 'Aling Rosa' });
  assert.equal(both.status, 400, JSON.stringify(both.data));
  assert.equal(both.data.fields.assignee_name, 'Pick a team member or type a name, not both.');
  const zero = await owner.patch(`/api/cleaning-tasks/${taskId}`, { pay_amount: '0' });
  assert.equal(zero.status, 400);
  assert.equal(zero.data.fields.pay_amount, 'Pay must be greater than zero.');
  assert.equal((await owner.patch(`/api/cleaning-tasks/${taskId}`, { pay_amount: '350' })).status, 200);
});

test('the default checklist cannot be saved empty', async () => {
  const r = await owner.raw('PUT', '/api/cleaning-checklist', { items: ['  ', ''] });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.items, 'Add at least one checklist item.');
  assert.equal((await owner.raw('PUT', '/api/cleaning-checklist', { items: ['Wipe counters'] })).status, 200);
});
