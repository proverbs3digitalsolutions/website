'use strict';

// QA round 7, cleaners (C05). #29: a typed outside-cleaner name equal to a team member is refused (400 on
// assignee_name) on rate save, task create and task edit. K3: a task edit stores only the changed field names.
// K6/K7: My pay shows cleans paid to someone else without money; the pay bar count does not wrap.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_03 node --test --test-concurrency=1 test/qa-r7-c05.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount } = require('./helpers');
const { hashPassword } = require('../src/lib/auth');

const VIEW = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'cleanerpay.js'), 'utf8');
const SENTENCE = 'Pick Nena Cruz from the team list instead.';
let srv; let owner; let orgId; let unit; let nenaId; let rateCount;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c05r7-owner@example.com', 'C05 Stays');
  const ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]);
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  [{ user_id: nenaId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, 'nena-c05r7@example.com', $2, 'Nena Cruz', 'cleaner', now()) RETURNING user_id`, [orgId, await hashPassword('longenough1')]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [nenaId, prop.property_id]);
  rateCount = async () => Number((await sql('SELECT count(*) FROM cleaner_rates WHERE organization_id = $1', [orgId]))[0].count);
});
test.after(async () => { await srv.close(); });

test('#29 a rate for an outside name equal to a team member is refused and writes nothing', async () => {
  const before = await rateCount();
  const r = await owner.raw('PUT', '/api/cleaner-rates', { assignee_name: ' nena  cruz ', rate_type: 'per_clean', amount: '300' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.assignee_name, SENTENCE);
  assert.equal(await rateCount(), before);
  const ok = await owner.raw('PUT', '/api/cleaner-rates', { assignee_name: 'Ate Lin', rate_type: 'per_clean', amount: '300' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test('#29 task create and task edit refuse the same name; another outside name still works', async () => {
  const base = { unit_id: unit, due_date: '2026-10-20' };
  const c = await owner.post('/api/cleaning-tasks', { ...base, assignee_name: 'NENA CRUZ' });
  assert.equal(c.status, 400, JSON.stringify(c.data));
  assert.equal(c.data.fields.assignee_name, SENTENCE);
  const made = await owner.post('/api/cleaning-tasks', { ...base, assignee_name: 'Ate Lin' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.task.task_id;
  const p = await owner.patch(`/api/cleaning-tasks/${id}`, { assignee_name: 'nena cruz' });
  assert.equal(p.status, 400, JSON.stringify(p.data));
  assert.equal(p.data.fields.assignee_name, SENTENCE);
  const [row] = await sql('SELECT assignee_name FROM cleaning_tasks WHERE task_id = $1', [id]);
  assert.equal(row.assignee_name, 'Ate Lin');
  const ok = await owner.patch(`/api/cleaning-tasks/${id}`, { assignee_name: 'Ate Mia' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test('K3 a task edit stores only the changed field names, and a save with no change adds no row', async () => {
  const made = await owner.post('/api/cleaning-tasks', { unit_id: unit, due_date: '2026-10-21', notes: 'old' });
  const id = made.data.task.task_id;
  const rows = () => sql(`SELECT details FROM audit_logs WHERE action = 'cleaning.task_updated' AND record_id = $1 ORDER BY created_at`, [id]);
  assert.equal((await owner.patch(`/api/cleaning-tasks/${id}`, { notes: 'new' })).status, 200);
  assert.deepEqual((await rows()).map((r) => r.details), [{ fields: ['notes'] }]);
  assert.equal((await owner.patch(`/api/cleaning-tasks/${id}`, { notes: 'new', due_date: '2026-10-21' })).status, 200);
  assert.equal((await rows()).length, 1);
});

test('K6 and K7 My pay lists hidden rows without money; the pay bar count does not wrap', () => {
  const my = VIEW.slice(VIEW.indexOf('export async function myPayView'));
  assert.equal(my.includes('.filter((x) => x.pay_visible)'), false);
  assert.ok(my.includes("t('Paid to another cleaner')"));
  assert.ok(VIEW.includes("'Paid to another cleaner': 'Bayad sa ibang tagalinis'"));
  const at = my.indexOf('pay_visible === false');
  const hidden = my.slice(at, my.indexOf(": h('strong'", at));
  assert.ok(my.includes('pay_visible === false'));
  assert.equal(hidden.includes('peso('), false);
  assert.ok(VIEW.includes("whiteSpace: 'nowrap'"));
});

test('#29 the remove dialog names the person and the rate, and only says no rate when none is left', () => {
  assert.ok(VIEW.includes('Remove the ${rateText(r)} rate for ${who}?'));
  assert.ok(VIEW.includes('(outside cleaner)'));
  assert.ok(VIEW.includes('will have no rate'));
});
