'use strict';

// QA round 5, lane C03 (housekeeping server): #50 staff don't receive a cleaner's pay on another
// person's job; #36 reopening a finished clean marks its unit dirty; #34 the checklist refuses a
// repeated line. TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_01 node --test --test-concurrency=1 test/qa-r5-c03.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const PASSWORD = 'longenough1';
const today = manilaToday();

let srv; let owner; let manager; let staff; let nena;
let unitA; let unitB; let unitC; let taskPaid; let taskStaffDone; let taskOpen;

async function member(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return { c, id: (await c.get('/api/auth/me')).data.user.user_id };
}

const readTask = async (who, id) => (await who.get(`/api/cleaning-tasks/${id}`)).data.task;
const listedTask = async (who, id) => (await who.get('/api/cleaning-tasks?view=all')).data.tasks.find((t) => t.task_id === id);
const unitStatus = async (unit) => (await sql('SELECT cleaning_status FROM units WHERE unit_id = $1', [unit.unit_id]))[0].cleaning_status;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r5c03-host@example.com', 'C03 Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unitA = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unitB = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1202', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unitC = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1203', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = (await member('r5c03-mgr@example.com', 'manager', [prop.property_id])).c;
  staff = await member('r5c03-staff@example.com', 'staff', [prop.property_id]);
  nena = await member('r5c03-nena@example.com', 'cleaner', [prop.property_id]);

  // Nena's clean, priced by the owner and finished.
  taskPaid = (await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: today, assigned_to: nena.id })).data.task.task_id;
  assert.equal((await owner.patch(`/api/cleaning-tasks/${taskPaid}`, { pay_amount: '450' })).status, 200);
  assert.equal((await owner.post(`/api/cleaning-tasks/${taskPaid}/status`, { status: 'done' })).status, 200);

  // An unassigned clean that staff finish themselves, so it is paid to them.
  taskStaffDone = (await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: today })).data.task.task_id;
  assert.equal((await owner.patch(`/api/cleaning-tasks/${taskStaffDone}`, { pay_amount: '300' })).status, 200);
  assert.equal((await staff.c.post(`/api/cleaning-tasks/${taskStaffDone}/status`, { status: 'done' })).status, 200);

  // An open, unassigned clean with a price typed in.
  taskOpen = (await owner.post('/api/cleaning-tasks', { unit_id: unitB.unit_id, due_date: today })).data.task.task_id;
  assert.equal((await owner.patch(`/api/cleaning-tasks/${taskOpen}`, { pay_amount: '200' })).status, 200);
});
test.after(async () => { await srv.close(); });

test('staff see no cleaner pay on another person\'s job, in the list or on the job', async () => {
  for (const row of [await listedTask(staff.c, taskPaid), await readTask(staff.c, taskPaid)]) {
    assert.equal(row.pay_amount, null, 'pay_amount must not reach staff');
    assert.equal(row.pay_status, null, 'pay_status must not reach staff');
  }
});

test('staff see no pay on an open job nobody has finished, even when a price is typed', async () => {
  const t = await readTask(staff.c, taskOpen);
  assert.equal(t.pay_amount, null);
  assert.equal(t.pay_status, null);
});

test('staff see the pay on the job they finished themselves', async () => {
  const t = await readTask(staff.c, taskStaffDone);
  assert.equal(t.pay_amount, '300.00');
  assert.equal(t.pay_status, 'unpaid');
});

test('every role can tell a job is paid, and staff still see no amount on another person\'s paid job', async () => {
  const id = (await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: today, assigned_to: nena.id })).data.task.task_id;
  assert.equal((await owner.patch(`/api/cleaning-tasks/${id}`, { pay_amount: '380' })).status, 200);
  assert.equal((await owner.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' })).status, 200);
  await sql(`UPDATE cleaning_tasks SET pay_status = 'paid', paid_on = $2, paid_method = 'cash' WHERE task_id = $1`, [id, today]);
  const s = await readTask(staff.c, id);
  assert.equal(s.is_paid, true, 'staff must learn the job is paid');
  assert.equal(s.pay_amount, null, 'but no amount');
  assert.equal(s.pay_status, null);
  assert.equal((await listedTask(staff.c, id)).is_paid, true);
  assert.equal((await readTask(owner, id)).is_paid, true);
  assert.equal((await readTask(manager, id)).is_paid, true);
  assert.equal((await readTask(nena.c, id)).is_paid, true);
  assert.equal((await readTask(staff.c, taskPaid)).is_paid, false, 'an unpaid job says so');
});

test('owners and managers see the pay on every job, in the list and on the job', async () => {
  for (const who of [owner, manager]) {
    const t = await readTask(who, taskPaid);
    assert.equal(t.pay_amount, '450.00');
    assert.equal(t.pay_status, 'unpaid');
    assert.equal((await listedTask(who, taskPaid)).pay_amount, '450.00');
    assert.equal((await readTask(who, taskOpen)).pay_amount, '200.00');
  }
});

test('the assigned cleaner sees their own pay', async () => {
  const t = await readTask(nena.c, taskPaid);
  assert.equal(t.pay_amount, '450.00');
  assert.equal(t.pay_status, 'unpaid');
});

test('reopening a finished clean marks its unit dirty, as a failed inspection does', async () => {
  const id = (await owner.post('/api/cleaning-tasks', { unit_id: unitC.unit_id, due_date: today })).data.task.task_id;
  assert.equal((await owner.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' })).status, 200);
  assert.equal(await unitStatus(unitC), 'clean');
  const items = (await readTask(owner, id)).checklist.map((_, index) => ({ index, pass: true }));
  assert.equal((await owner.post(`/api/cleaning-tasks/${id}/inspect`, { items })).status, 201);
  assert.equal(await unitStatus(unitC), 'inspected');
  const reopened = await owner.post(`/api/cleaning-tasks/${id}/status`, { status: 'in_progress' });
  assert.equal(reopened.status, 200, JSON.stringify(reopened.data));
  assert.equal(await unitStatus(unitC), 'dirty');
});

test('the checklist refuses a line repeated in another case or with spaces, and saves nothing', async () => {
  const before = (await owner.get('/api/cleaning-checklist')).data.items;
  const r = await owner.raw('PUT', '/api/cleaning-checklist', { items: ['Beds', 'Change towels', ' change TOWELS '] });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.items, 'This checklist has “Change towels” twice.');
  assert.deepEqual((await owner.get('/api/cleaning-checklist')).data.items, before);
  assert.equal((await owner.raw('PUT', '/api/cleaning-checklist', { items: ['Beds', 'Bathroom'] })).status, 200);
  assert.equal((await owner.raw('PUT', '/api/cleaning-checklist', { items: before })).status, 200);
});
