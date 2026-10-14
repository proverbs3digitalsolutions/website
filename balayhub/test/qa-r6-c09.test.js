'use strict';

// QA round 6, cleaner pay (C09). O-b: GET /my-pay answers cleaners only. O-k: a clean finished
// for someone else shows no pay and none of the names it is paid to.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_06 node --test --test-concurrency=1 test/qa-r6-c09.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { hashPassword } = require('../src/lib/auth');

const PASSWORD = 'longenough1';
const VIEW = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'cleanerpay.js'), 'utf8');
let srv; let owner; let manager; let staff; let rosa; let rosaId; let nenaId; let orgId; let unit;

async function invite(email, fullName, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

// A finished clean written straight to the table, with its pay already set.
async function done({ assignedTo = null, assigneeName = null, completedBy, pay, day }) {
  const at = `2026-08-${String(day).padStart(2, '0')}T10:00:00+08:00`;
  const [{ task_id: id }] = await sql(
    `INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, status, assigned_to, assignee_name, completed_by, completed_at, pay_amount)
     VALUES ($1, $2, $3::date, 'done', $4, $5, $6, $7::timestamptz, $8)
     RETURNING task_id`,
    [orgId, unit, at.slice(0, 10), assignedTo, assigneeName, completedBy, at, pay]);
  return id;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c09-owner@example.com', 'C09 Stays');
  const ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]);

  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;

  manager = await invite('manager-c09@example.com', 'Manager Azure', 'manager', [prop.property_id]);
  staff = await invite('staff-c09@example.com', 'Staff Azure', 'staff', [prop.property_id]);

  [{ user_id: rosaId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, 'rosa-c09@example.com', $2, 'Rosa Reyes', 'cleaner', now()) RETURNING user_id`, [orgId, await hashPassword(PASSWORD)]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [rosaId, prop.property_id]);
  rosa = client(srv.base);
  assert.equal((await rosa.post('/api/auth/login', { email: 'rosa-c09@example.com', password: PASSWORD })).status, 200);

  [{ user_id: nenaId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, 'nena-c09@example.com', $2, 'Nena Cruz', 'cleaner', now()) RETURNING user_id`, [orgId, await hashPassword(PASSWORD)]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [nenaId, prop.property_id]);
});
test.after(async () => { await srv.close(); });

test('my pay is for cleaners only: owners, managers and staff get 403 with the cleaner message', async () => {
  for (const c of [owner, manager, staff]) {
    const r = await c.get('/api/my-pay?month=2026-08');
    assert.equal(r.status, 403, JSON.stringify(r.data));
    assert.equal(r.data.code, 'FORBIDDEN');
    assert.equal(r.data.error, 'My pay is for cleaners.');
    assert.equal(r.data.tasks, undefined);
  }
});

test('my pay: a clean finished for someone else shows no pay and no name of the cleaner it is paid to', async () => {
  const mine = await done({ assignedTo: rosaId, completedBy: rosaId, pay: '250.00', day: 5 });
  const nenas = await done({ assignedTo: nenaId, completedBy: rosaId, pay: '300.00', day: 6 });
  const lin = await done({ assigneeName: 'Ate Lin', completedBy: rosaId, pay: '400.00', day: 7 });

  const r = await rosa.get('/api/my-pay?month=2026-08');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const byId = Object.fromEntries(r.data.tasks.map((t) => [t.task_id, t]));

  assert.equal(byId[mine].pay_visible, true);
  assert.equal(byId[mine].pay_amount, '250.00');
  assert.equal(byId[mine].cleaner_key, `user:${rosaId}`);
  assert.equal(byId[mine].cleaner_name, 'Rosa Reyes');
  assert.equal(byId[mine].cleaner_user_id, rosaId);

  for (const id of [nenas, lin]) {
    assert.equal(byId[id].pay_visible, false);
    assert.equal(byId[id].pay_amount, null);
    assert.equal(byId[id].pay_status, null);
    for (const key of ['cleaner_key', 'cleaner_name', 'cleaner_user_id']) assert.equal(key in byId[id], false, `${key} on a hidden row`);
  }
  assert.equal(JSON.stringify(r.data).includes('Nena Cruz'), false);
  assert.equal(JSON.stringify(r.data).includes('Ate Lin'), false);
  assert.deepEqual(r.data.totals, { total: '250.00', paid: '0.00', unpaid: '250.00' });
});

// #28: the select-all box is a visible, labelled check in the bar. The table header is clipped on phones,
// so a focusable box there is a Tab stop nobody can see.
test('select all unpaid is a labelled check in the bar, and the table header holds only screen-reader text', () => {
  const head = VIEW.slice(VIEW.indexOf("h('thead'"), VIEW.indexOf("h('tbody'"));
  assert.ok(head.length > 0);
  assert.equal(/\ball\b/.test(head), false, 'the select-all checkbox is not in thead');
  assert.equal(head.includes("'Select'"), true, 'the header keeps screen-reader text only');
  assert.ok(VIEW.includes("h('label', { class: 'check' }, all, h('span', null, 'Select all unpaid'))"));
});
