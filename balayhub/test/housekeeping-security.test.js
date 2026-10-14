'use strict';

// Housekeeping rules from the security review: a cleaner can't reopen a finished clean or
// take over one someone else finished, the finisher becomes the payee of an unassigned clean,
// a paid clean keeps its cleaner, and a cleaner sees only the damage reports they filed, with no amount.
// Own file so the phase 3 story stays readable.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_c node --test --test-concurrency=1 test/housekeeping-security.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const PASSWORD = 'longenough1';
const today = manilaToday();

let srv; let owner; let ownerId; let orgId; let propA; let unitA; let unitB; let ana; let ben;

// A cleaner with a login, assigned to the Azure property.
async function cleanerAccount(email, fullName) {
  const inv = await owner.post('/api/team/invitations', { email, role: 'cleaner', property_ids: [propA.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return { c, id: (await c.get('/api/auth/me')).data.user.user_id };
}

// A cleaning task made by the owner, due today unless told otherwise.
async function newTask(o = {}) {
  const r = await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: today, ...o });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.task.task_id;
}

const taskRow = async (id) => (await sql('SELECT * FROM cleaning_tasks WHERE task_id = $1', [id]))[0];

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'security-host@example.com', 'Security Stays');
  ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]);
  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const addUnit = async (name) => (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unitA = await addUnit('1201');
  unitB = await addUnit('1202');
  ana = await cleanerAccount('security-ana@example.com', 'Ana Cleaner');
  ben = await cleanerAccount('security-ben@example.com', 'Ben Cleaner');
});
test.after(async () => { await srv.close(); });

test('a cleaner cannot reopen a clean they finished; finishing it again changes nothing', async () => {
  const id = await newTask({ assigned_to: ana.id });
  assert.equal((await ana.c.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' })).status, 200);
  const back = await ana.c.post(`/api/cleaning-tasks/${id}/status`, { status: 'todo' });
  assert.equal(back.status, 409, JSON.stringify(back.data));
  assert.equal(back.data.code, 'FINISHED');
  const restart = await ana.c.post(`/api/cleaning-tasks/${id}/status`, { status: 'in_progress' });
  assert.equal(restart.status, 409);
  assert.equal(restart.data.code, 'FINISHED');
  assert.equal((await taskRow(id)).status, 'done');
});

test('a cleaner cannot take over a finished clean by reopening it and finishing it again', async () => {
  // A finished clean from before the fix: no team member on it, finished by Ana.
  const [{ task_id: id }] = await sql(
    `INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, status, completed_by, started_at, completed_at)
     VALUES ($1, $2, $3, 'done', $4, now() - interval '1 hour', now()) RETURNING task_id`,
    [orgId, unitA.unit_id, today, ana.id]);
  const before = await taskRow(id);
  const reopen = await ben.c.post(`/api/cleaning-tasks/${id}/status`, { status: 'in_progress' });
  assert.equal(reopen.status, 409, JSON.stringify(reopen.data));
  assert.equal(reopen.data.code, 'FINISHED');
  assert.equal((await ben.c.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' })).status, 200);
  assert.deepEqual(await taskRow(id), before, 'Ana is still the finisher and the finish time is unchanged');
});

test('an unassigned clean is given to the cleaner who finishes it, so no one else can take it', async () => {
  const id = await newTask();
  assert.equal((await ana.c.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' })).status, 200);
  assert.equal((await owner.get(`/api/cleaning-tasks/${id}`)).data.task.assigned_to, ana.id);
  assert.equal((await ana.c.get(`/api/cleaning-tasks/${id}`)).status, 200);
  assert.equal((await ben.c.get(`/api/cleaning-tasks/${id}`)).status, 404);
});

test('marking a unit clean gives its unassigned cleans to the owner who marked it', async () => {
  const id = await newTask({ unit_id: unitB.unit_id });
  assert.equal((await owner.post(`/api/units/${unitB.unit_id}/cleaning`, { status: 'clean' })).status, 200);
  const row = await taskRow(id);
  assert.equal(row.status, 'done');
  assert.equal(row.assigned_to, ownerId);
});

test('a paid clean keeps its cleaner and its name: changing them is refused, notes still save', async () => {
  const id = await newTask({ assigned_to: ana.id });
  assert.equal((await ana.c.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' })).status, 200);
  await sql(`UPDATE cleaning_tasks SET pay_status = 'paid', paid_on = $2, paid_method = 'cash' WHERE task_id = $1`, [id, today]);

  const toBen = await owner.patch(`/api/cleaning-tasks/${id}`, { assigned_to: ben.id });
  assert.equal(toBen.status, 409, JSON.stringify(toBen.data));
  assert.equal(toBen.data.code, 'PAID');
  const toName = await owner.patch(`/api/cleaning-tasks/${id}`, { assigned_to: null, assignee_name: 'Aling Rosa' });
  assert.equal(toName.status, 409);
  assert.equal(toName.data.code, 'PAID');

  const same = await owner.patch(`/api/cleaning-tasks/${id}`, { assigned_to: ana.id, assignee_name: null });
  assert.equal(same.status, 200, 'sending the cleaner already on the clean is not a change');
  const notes = await owner.patch(`/api/cleaning-tasks/${id}`, { notes: 'Late check-out' });
  assert.equal(notes.status, 200, JSON.stringify(notes.data));
  assert.equal(notes.data.task.notes, 'Late check-out');

  const row = await taskRow(id);
  assert.equal(row.assigned_to, ana.id);
  assert.equal(row.assignee_name, null);
  assert.equal(row.pay_status, 'paid');
});

test('a cleaner sees only the damage reports they filed, and never an amount or status (D-51)', async () => {
  const id = await newTask({ assigned_to: ana.id });
  assert.equal((await ana.c.post(`/api/cleaning-tasks/${id}/damage`, { description: 'Cracked tile', estimated_cost: '120' })).status, 201);
  assert.equal((await owner.post(`/api/cleaning-tasks/${id}/damage`, { description: 'Stain on the sofa', estimated_cost: '800' })).status, 201);

  const reports = (await ana.c.get(`/api/cleaning-tasks/${id}`)).data.task.damage_reports;
  const mine = reports.find((r) => r.description === 'Cracked tile');
  assert.equal(reports.length, 1, 'the owner\'s report is not sent to the cleaner');
  assert.equal(mine.estimated_cost, undefined, 'a cleaner gets no amount, even on her own report');
  assert.equal('status' in mine, false);

  const ownerReports = (await owner.get(`/api/cleaning-tasks/${id}`)).data.task.damage_reports;
  assert.equal(ownerReports.find((r) => r.description === 'Stain on the sofa').estimated_cost, '800.00');
});

test('a cleaner can only start a clean or finish it, not step it back to to-do', async () => {
  const id = await newTask({ assigned_to: ana.id });
  assert.equal((await ana.c.post(`/api/cleaning-tasks/${id}/status`, { status: 'in_progress' })).status, 200);
  const back = await ana.c.post(`/api/cleaning-tasks/${id}/status`, { status: 'todo' });
  assert.equal(back.status, 409, JSON.stringify(back.data));
  assert.equal(back.data.code, 'NOT_ALLOWED');
  assert.equal((await taskRow(id)).status, 'in_progress');
});
