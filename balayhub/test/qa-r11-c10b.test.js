'use strict';

// QA round 11, fix lane C10b (cleaning pay, housekeeping). Setting one clean's pay above P10,000.00 is refused at the
// field, the same ceiling as a cleaner's per-clean rate (D-87): an extra zero is the likely typo. It is checked after the
// amount is read as money, and nothing is saved on refusal. An amount already saved is not changed by later edits.
// Runs on its own database: TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_08 node --test --test-concurrency=1 test/qa-r11-c10b.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql, manilaToday } = require('./helpers');

const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};

const CEILING = "That's more than ₱10,000.00 per clean. Check for an extra zero.";

let srv; let owner; let task;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r11-c10b@example.com', 'R11 C10b Co');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  task = ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday() }), 201).task;
});
test.after(async () => { await srv.close(); });

const setPay = (body) => owner.patch(`/api/cleaning-tasks/${task.task_id}`, body);
const saved = async () => (await sql('SELECT pay_amount, notes FROM cleaning_tasks WHERE task_id = $1', [task.task_id]))[0];

// The round 11 case: 99999999 typed for one clean is refused at the pay field, and nothing else in the same save goes through.
test('a clean pay above P10,000.00 is refused at the field, and nothing is saved', async () => {
  for (const amount of ['10000.01', '99999999', '99999999.99']) {
    const r = await setPay({ pay_amount: amount, notes: 'Typed in a hurry' });
    assert.equal(r.status, 400, `${amount}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.fields.pay_amount, CEILING, amount);
  }
  assert.deepEqual(await saved(), { pay_amount: null, notes: null }, 'a refused pay saves neither the amount nor the notes');
});

test('P10,000.00 is saved', async () => {
  const r = ok(await setPay({ pay_amount: '10000' }));
  assert.equal(r.task.pay_amount, '10000.00');
  assert.equal((await saved()).pay_amount, '10000.00');
});

// The ceiling is checked after the amount is read as money: a word is still the amount message.
test('a pay that is not an amount gets the amount message, not the ceiling', async () => {
  const r = await setPay({ pay_amount: 'lots' });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.pay_amount, 'Pay must be a valid amount (e.g. 8500 or 8500.50).');
});

// An amount saved before the ceiling existed is kept: an edit that does not send a pay leaves it alone.
test('an amount already saved above the ceiling is not changed by an edit that does not send a pay', async () => {
  await sql('UPDATE cleaning_tasks SET pay_amount = 25000.00 WHERE task_id = $1', [task.task_id]);
  const r = ok(await owner.patch(`/api/cleaning-tasks/${task.task_id}`, { notes: 'Checked the bins' }));
  assert.equal(r.task.pay_amount, '25000.00');
  assert.equal((await saved()).pay_amount, '25000.00');
});
