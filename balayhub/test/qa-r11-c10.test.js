'use strict';

// QA round 11, lane C10 (cleaner pay and supplies, server). A cleaner rate above P10,000.00 per clean or
// P1,000.00 per hour is refused at the amount: an extra zero is the likely typo (D-87). A supply movement's
// quantity floor depends on its kind: a use or restock is at least 1, a count may be 0. A cleaner's use above
// what is on hand saves what is there and returns `short`, so the job screen can say so. Owners and managers
// are asked first (D-77), so they are refused or record on purpose and never get `short`.
// Runs on its own database: TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_06 node --test --test-concurrency=1 test/qa-r11-c10.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};

let srv; let owner; let prop; let unit; let cleaner; let cleanerId; let cleanTask;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r11-c10@example.com', 'R11 C10 Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const email = 'cleaner-r11-c10@example.com';
  const inv = await owner.post('/api/team/invitations', { email, role: 'staff', property_ids: [prop.property_id] });
  assert.ok(inv.data.inviteLink, JSON.stringify(inv.data));
  cleaner = client(srv.base);
  ok(await cleaner.post('/api/auth/signup', {
    full_name: 'Nene Cleaner', email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  }), 201);
  [{ user_id: cleanerId }] = await sql('SELECT user_id FROM users WHERE email = $1', [email]);
  await sql(`UPDATE users SET role = 'cleaner' WHERE user_id = $1`, [cleanerId]);
  cleanTask = ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), assigned_to: cleanerId }), 201).task;
});
test.after(async () => { await srv.close(); });

const supply = async (fields) => ok(await owner.post('/api/supplies', { property_id: prop.property_id, ...fields }), 201).supply;
const onHand = async (id) => (await sql('SELECT on_hand FROM supplies WHERE supply_id = $1', [id]))[0].on_hand;

// Rates (#31): a rate above the ceiling is refused at the amount and nothing is saved.
const rate = (body) => owner.raw('PUT', '/api/cleaner-rates', { user_id: cleanerId, ...body });

test('a per-clean rate above P10,000.00 is refused at the amount, and nothing is saved; P10,000.00 is saved', async () => {
  ok(await rate({ rate_type: 'per_clean', amount: '300' }));
  const high = await rate({ rate_type: 'per_clean', amount: '10000.01' });
  assert.equal(high.status, 400, JSON.stringify(high.data));
  assert.equal(high.data.fields.amount, "That's more than ₱10,000.00 per clean. Check for an extra zero.");
  assert.equal((await rate({ rate_type: 'per_clean', amount: '99999999' })).status, 400, 'the round 11 case');
  const [{ amount }] = await sql('SELECT amount FROM cleaner_rates WHERE user_id = $1', [cleanerId]);
  assert.equal(Number(amount), 300, 'the refused rate did not replace the saved one');
  assert.equal(Number(ok(await rate({ rate_type: 'per_clean', amount: '10000' })).rate.amount), 10000);
});

test('a per-hour rate above P1,000.00 is refused the same way; P1,000.00 is saved', async () => {
  const high = await rate({ rate_type: 'per_hour', amount: '1000.01' });
  assert.equal(high.status, 400, JSON.stringify(high.data));
  assert.equal(high.data.fields.amount, "That's more than ₱1,000.00 per hour. Check for an extra zero.");
  assert.equal(Number(ok(await rate({ rate_type: 'per_hour', amount: '1000' })).rate.amount), 1000);
});

// Movements (#35): the floor is checked by kind. A use or restock below 1 gets the one message, whatever the sign.
test('a use or restock below 1 says "Enter a quantity of at least 1.", and a count may be 0', async () => {
  const soapless = await supply({ name: 'Bleach', unit_label: 'bottles', par_level: 1, on_hand: 5 });
  const move = (body) => owner.post(`/api/supplies/${soapless.supply_id}/movements`, body);
  for (const body of [{ kind: 'used', quantity: -4 }, { kind: 'used', quantity: 0 }, { kind: 'restocked', quantity: -2 }]) {
    const r = await move(body);
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.fields.quantity, 'Enter a quantity of at least 1.', JSON.stringify(body));
  }
  assert.equal(await onHand(soapless.supply_id), 5, 'a refused movement changes nothing');
  assert.equal((await move({ kind: 'used', quantity: 2.5 })).data.fields.quantity, 'Quantity must be a whole number.');
  assert.equal((await move({ kind: 'count', quantity: -1 })).data.fields.quantity, 'Quantity must be at least 0.');
  assert.equal(ok(await move({ kind: 'count', quantity: 0 })).supply.on_hand, 0, 'a count can set zero');
  assert.equal(ok(await move({ kind: 'restocked', quantity: 3 })).supply.on_hand, 3);
});

// Shortfall (#34): a cleaner's use above what is on hand is clamped, and `short` says what was asked and recorded.
test('a cleaner who asks for more than is on hand saves what is there and gets it back in short', async () => {
  const soap = await supply({ name: 'Soap', unit_label: 'bars', par_level: 2, on_hand: 7 });
  const r = ok(await cleaner.post(`/api/cleaning-tasks/${cleanTask.task_id}/supplies`, { items: [{ supply_id: soap.supply_id, kind: 'used', quantity: 20 }] }));
  assert.deepEqual(r.short, [{ name: 'Soap', unit_label: 'bars', asked: 20, recorded: 7 }]);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.supplies[0].on_hand, 0);
  const [mv] = await sql(`SELECT quantity FROM supply_movements WHERE supply_id = $1 AND kind = 'used'`, [soap.supply_id]);
  assert.equal(mv.quantity, 7, 'the log holds what was actually used');
});

test('a cleaner use of an empty item is skipped by name, not short; an owner is refused, not clamped, and gets no short', async () => {
  const empty = await supply({ name: 'Hand wash', unit_label: 'pcs', par_level: 1, on_hand: 0 });
  const c = ok(await cleaner.post(`/api/cleaning-tasks/${cleanTask.task_id}/supplies`, { items: [{ supply_id: empty.supply_id, kind: 'used', quantity: 1 }] }));
  assert.deepEqual(c.skipped, ['Hand wash']);
  assert.deepEqual(c.short, []);

  const refused = await owner.post(`/api/cleaning-tasks/${cleanTask.task_id}/supplies`, { items: [{ supply_id: empty.supply_id, kind: 'used', quantity: 1 }] });
  assert.equal(refused.status, 400, JSON.stringify(refused.data));
  assert.equal(refused.data.fields[`qty-${empty.supply_id}`], 'Nothing on hand. Restock it first.');

  const soap = await supply({ name: 'Dish soap', unit_label: 'bottles', par_level: 1, on_hand: 4 });
  const asked = ok(await owner.post(`/api/cleaning-tasks/${cleanTask.task_id}/supplies`, { items: [{ supply_id: soap.supply_id, kind: 'used', quantity: 9, record_on_hand: true }] }));
  assert.deepEqual(asked.short, [], 'owners are asked first, so they never get short');
  assert.equal(asked.supplies[0].on_hand, 0);
});
