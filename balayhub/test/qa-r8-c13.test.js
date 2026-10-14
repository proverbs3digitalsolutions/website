'use strict';

// QA round 8, cleaner names (C13). #32/K17: a typed outside-cleaner name that is a team member's is refused on task
// create, task edit and rate save, and the refusal does not repeat the name. N34: saving the cleaning checklist as it
// already is writes no row; a changed order is a change. A task save with no change writes no activity row.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_12 node --test --test-concurrency=1 test/qa-r8-c13.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { hashPassword } = require('../src/lib/auth');

const TASK_SENTENCE = 'That name belongs to someone on your team. Pick them from the team list, or add them to this property in Settings → Team first.';
const RATE_SENTENCE = 'That name belongs to someone on your team. Pick them from the team list instead.';
let srv; let owner; let orgId; let unit;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c13r8-owner@example.com', 'C13 Stays');
  const ownerId = (await owner.get('/api/auth/me')).data.user.user_id;
  [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerId]);
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  const [{ user_id: nenaId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, 'nena-c13r8@example.com', $2, 'Nena Cruz', 'cleaner', now()) RETURNING user_id`, [orgId, await hashPassword('longenough1')]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [nenaId, prop.property_id]);
});
test.after(async () => { await srv.close(); });

test('#32 a task create or edit with a team member name is refused, and the refusal does not repeat the name', async () => {
  const c = await owner.raw('POST', '/api/cleaning-tasks', { unit_id: unit, due_date: '2026-10-20', assignee_name: ' nena  cruz ' });
  assert.equal(c.status, 400, JSON.stringify(c.data));
  assert.equal(c.data.fields.assignee_name, TASK_SENTENCE);
  assert.doesNotMatch(JSON.stringify(c.data).toLowerCase(), /nena\s+cruz/);

  const made = await owner.post('/api/cleaning-tasks', { unit_id: unit, due_date: '2026-10-20', assignee_name: 'Ate Lin' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const p = await owner.raw('PATCH', `/api/cleaning-tasks/${made.data.task.task_id}`, { assignee_name: 'NENA CRUZ' });
  assert.equal(p.status, 400, JSON.stringify(p.data));
  assert.equal(p.data.fields.assignee_name, TASK_SENTENCE);
  assert.doesNotMatch(JSON.stringify(p.data).toLowerCase(), /nena\s+cruz/);
});

test('#32 a rate for a team member name is refused with the rate sentence, and the refusal does not repeat the name', async () => {
  const r = await owner.raw('PUT', '/api/cleaner-rates', { assignee_name: 'nena cruz', rate_type: 'per_clean', amount: '300' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.assignee_name, RATE_SENTENCE);
  assert.doesNotMatch(JSON.stringify(r.data).toLowerCase(), /nena\s+cruz/);
});

test('N34 saving the checklist as it already is writes no row; a changed order is a change', async () => {
  const rows = async () => Number((await sql(
    `SELECT count(*) FROM audit_logs WHERE action = 'cleaning.checklist_updated' AND organization_id = $1`, [orgId]))[0].count);
  const save = (items) => owner.raw('PUT', '/api/cleaning-checklist', { items });
  const before = await rows();
  assert.equal((await save(['C13 sweep', 'C13 mop'])).status, 200);
  assert.equal(await rows(), before + 1, 'the first real change writes one row');
  assert.equal((await save(['C13 sweep', 'C13 mop'])).status, 200);
  assert.equal(await rows(), before + 1, 'the same list writes no row');
  assert.equal((await save([' C13 sweep ', 'C13 mop'])).status, 200);
  assert.equal(await rows(), before + 1, 'the same list with spaces around the text writes no row');
  assert.equal((await save(['C13 mop', 'C13 sweep'])).status, 200);
  assert.equal(await rows(), before + 2, 'the same items in another order is a change');
  assert.deepEqual((await owner.get('/api/cleaning-checklist')).data.items, ['C13 mop', 'C13 sweep']);
});

test('a task save that changes nothing writes no activity row; a real change names only its field', async () => {
  const made = await owner.post('/api/cleaning-tasks', { unit_id: unit, due_date: '2026-10-21', notes: 'c13 notes' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.task.task_id;
  const rows = () => sql(`SELECT details FROM audit_logs WHERE action = 'cleaning.task_updated' AND record_id = $1 ORDER BY created_at`, [id]);
  assert.equal((await owner.patch(`/api/cleaning-tasks/${id}`, { notes: 'c13 notes', due_date: '2026-10-21' })).status, 200);
  assert.equal((await rows()).length, 0);
  assert.equal((await owner.patch(`/api/cleaning-tasks/${id}`, { notes: 'c13 notes 2' })).status, 200);
  assert.deepEqual((await rows()).map((r) => r.details), [{ fields: ['notes'] }]);
});
