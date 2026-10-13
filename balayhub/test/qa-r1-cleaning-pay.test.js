'use strict';

// QA round 1, cleaning pay: #40 per-hour with no start leaves pay unset, #45 failed inspection
// says it cleared the pay, #46 rates above zero, #47 one payee rule on the job page.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_l08 node --test --test-concurrency=1 test/qa-r1-cleaning-pay.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { hashPassword } = require('../src/lib/auth');

const PASSWORD = 'longenough1';
let srv; let owner; let nena; let nenaId; let unit; let unit2; let ownerId;

const mkTask = async (assignedTo, name) => (await owner.post('/api/cleaning-tasks', { unit_id: unit, due_date: manilaToday(), assigned_to: assignedTo, assignee_name: name })).data.task.task_id;
const rate = (body) => owner.raw('PUT', '/api/cleaner-rates', body);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'l08-owner@example.com', 'L08 Stays');
  ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  unit2 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1202', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  const [{ organization_id: org }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]);
  [{ user_id: nenaId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, 'nena-l08@example.com', $2, 'Nena Cruz', 'cleaner', now()) RETURNING user_id`, [org, await hashPassword(PASSWORD)]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [nenaId, prop.property_id]);
  nena = client(srv.base);
  assert.equal((await nena.post('/api/auth/login', { email: 'nena-l08@example.com', password: PASSWORD })).status, 200);
});
test.after(async () => { await srv.close(); });

test('#40 per hour, done without Start: pay stays unset (null), not 0.00', async () => {
  assert.equal((await rate({ user_id: nenaId, rate_type: 'per_hour', amount: '200' })).status, 200);
  const id = await mkTask(nenaId);
  const r = await nena.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.task.pay_amount, null);
  const [row] = await sql('SELECT pay_amount, started_at FROM cleaning_tasks WHERE task_id = $1', [id]);
  assert.equal(row.pay_amount, null);
  assert.equal(row.started_at, null);
});

test('#40 mark-paid refuses a clean whose pay is not set; setting the pay lets it through', async () => {
  const id = await mkTask(nenaId);
  await nena.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' });
  const body = { task_ids: [id], paid_on: manilaToday(), method: 'cash' };
  const bad = await owner.post('/api/cleaner-pay/mark-paid', body);
  assert.equal(bad.status, 409);
  assert.equal(bad.data.code, 'NO_PAY_AMOUNT');
  assert.equal((await owner.patch(`/api/cleaning-tasks/${id}`, { pay_amount: '300' })).status, 200);
  assert.equal((await owner.post('/api/cleaner-pay/mark-paid', body)).status, 200);
});

test('#40 per hour with a real Start still pays the time worked; per clean is unaffected', async () => {
  const id = await mkTask(nenaId);
  await nena.post(`/api/cleaning-tasks/${id}/status`, { status: 'in_progress' });
  await sql(`UPDATE cleaning_tasks SET started_at = now() - interval '61 minutes' WHERE task_id = $1`, [id]);
  const r = await nena.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' });
  assert.equal(r.data.task.pay_amount, '250.00'); // 61 min rounds up to 75 min at 200/h
  assert.equal((await rate({ user_id: nenaId, rate_type: 'per_clean', amount: '350' })).status, 200);
  const id2 = await mkTask(nenaId);
  const r2 = await nena.post(`/api/cleaning-tasks/${id2}/status`, { status: 'done' });
  assert.equal(r2.data.task.pay_amount, '350.00');
});

test('#46 a cleaner rate of 0 is refused', async () => {
  for (const amount of ['0', '0.00']) {
    const r = await rate({ user_id: nenaId, rate_type: 'per_clean', amount });
    assert.equal(r.status, 400, amount);
    assert.ok(r.data.fields.amount);
  }
});

test('#47 the assigned cleaner sees the pay on the job page even when the owner finished it', async () => {
  await rate({ user_id: nenaId, rate_type: 'per_clean', amount: '350' });
  const id = await mkTask(nenaId);
  await owner.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' });
  const job = await nena.get(`/api/cleaning-tasks/${id}`);
  assert.equal(job.data.task.pay_amount, '350.00');
  const mine = (await nena.get('/api/my-pay')).data.tasks.find((t) => t.task_id === id);
  assert.equal(mine.pay_amount, '350.00');
});

test('#45 a failed inspection that clears a set pay says so', async () => {
  const id = await mkTask(nenaId);
  await nena.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' });
  await owner.patch(`/api/cleaning-tasks/${id}`, { pay_amount: '500' });
  const items = (await owner.get(`/api/cleaning-tasks/${id}`)).data.task.checklist.map((_, index) => ({ index, pass: false }));
  if (!items.length) {
    await sql(`UPDATE cleaning_tasks SET checklist = '[{"text":"Beds","done":true}]'::jsonb WHERE task_id = $1`, [id]);
    items.push({ index: 0, pass: false });
  }
  const r = await owner.post(`/api/cleaning-tasks/${id}/inspect`, { items });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.pay_cleared, true);
  assert.equal(r.data.task.pay_amount, null);
});

test('#45 a failed inspection with no pay set does not claim it cleared anything', async () => {
  await sql('DELETE FROM cleaner_rates');
  const id = await mkTask(null, 'No Rate Person');
  await owner.post(`/api/cleaning-tasks/${id}/status`, { status: 'done' });
  await sql(`UPDATE cleaning_tasks SET checklist = '[{"text":"Beds","done":true}]'::jsonb WHERE task_id = $1`, [id]);
  const r = await owner.post(`/api/cleaning-tasks/${id}/inspect`, { items: [{ index: 0, pass: false }] });
  assert.equal(r.status, 201);
  assert.equal(r.data.pay_cleared, false);
});
