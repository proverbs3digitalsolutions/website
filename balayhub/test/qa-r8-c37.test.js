'use strict';

// QA round 8, lane C37 (supplies server, D-77). Owners and managers are asked before stock moves on a
// cleaning task: a use with nothing on hand is refused on its row, and a use above what is on hand is
// refused unless the item says the host chose "Record what is on hand". Cleaners and staff keep the
// skip-and-name rule, and restocks are never refused.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};

let srv; let owner; let manager; let staff; let cleaner; let cleanerId; let prop; let unit;

// A team member who signed up through a real invitation.
async function teamMember(role, email, name, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.ok(inv.data.inviteLink, JSON.stringify(inv.data));
  const c = client(srv.base);
  ok(await c.post('/api/auth/signup', {
    full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  }), 201);
  const [{ user_id }] = await sql('SELECT user_id FROM users WHERE email = $1', [email]);
  return { c, user_id };
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r8-c37@example.com', 'R8 C37 Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = (await teamMember('manager', 'manager-r8-c37@example.com', 'Ana Manager', [prop.property_id])).c;
  staff = (await teamMember('staff', 'staff-r8-c37@example.com', 'Ben Staff', [prop.property_id])).c;
  const m = await teamMember('staff', 'cleaner-r8-c37@example.com', 'Nene Cleaner', [prop.property_id]);
  await sql(`UPDATE users SET role = 'cleaner' WHERE user_id = $1`, [m.user_id]);
  cleaner = m.c;
  cleanerId = m.user_id;
});
test.after(async () => { await srv.close(); });

const newSupply = async (name, onHand) => ok(await owner.post('/api/supplies', {
  property_id: prop.property_id, name, unit_label: 'pcs', par_level: 1, on_hand: onHand,
}), 201).supply;
const newTask = async () => ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), assigned_to: cleanerId }), 201).task;
const onHandOf = async (supplyId) => (await sql('SELECT on_hand FROM supplies WHERE supply_id = $1', [supplyId]))[0].on_hand;
// The 'used' movements on one supply, oldest first.
const usedRows = (supplyId) => sql(
  `SELECT quantity, note, task_id FROM supply_movements WHERE supply_id = $1 AND kind = 'used' ORDER BY created_at`, [supplyId]);
// The job screen's row key for an item (housekeeping.js: data-field `qty-<supply_id>`), where a refusal lands.
const rowKey = (supply) => `qty-${supply.supply_id}`;

test('an owner or manager is refused a use with nothing on hand, on the item row', async () => {
  const soap = await newSupply('Soap', 0);
  const task = await newTask();
  for (const c of [owner, manager]) {
    const r = await c.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: soap.supply_id, kind: 'used', quantity: 1 }] });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.deepEqual(r.data.fields, { [rowKey(soap)]: 'Nothing on hand. Restock it first.' });
  }
  assert.equal(await onHandOf(soap.supply_id), 0);
  assert.deepEqual(await usedRows(soap.supply_id), []);
});

test('an owner or manager asked to use more than is on hand is refused unless they choose to record what is on hand', async () => {
  const bleach = await newSupply('Bleach', 3);
  const task = await newTask();
  const use = (c, extra = {}) => c.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: bleach.supply_id, kind: 'used', quantity: 7, ...extra }] });
  const refused = await use(owner);
  assert.equal(refused.status, 400, JSON.stringify(refused.data));
  assert.deepEqual(refused.data.fields, { [rowKey(bleach)]: 'Asked for 7, only 3 on hand.' });
  const notChosen = await use(manager, { record_on_hand: false });
  assert.equal(notChosen.status, 400, JSON.stringify(notChosen.data));
  assert.equal(await onHandOf(bleach.supply_id), 3, 'a refused use changes nothing');
  assert.deepEqual(await usedRows(bleach.supply_id), []);
});

test('an owner who chooses to record what is on hand logs only that much, with the ask in the note', async () => {
  const bleach = await newSupply('Bleach refill', 3);
  const task = await newTask();
  const r = ok(await owner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: bleach.supply_id, kind: 'used', quantity: 7, record_on_hand: true }] }));
  assert.equal(r.supplies[0].on_hand, 0);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(await usedRows(bleach.supply_id), [{ quantity: 3, note: 'Asked for 7, only 3 on hand.', task_id: task.task_id }]);
});

test('a use that fits on hand is logged as asked with no note, with or without the choice', async () => {
  const towels = await newSupply('Towels', 5);
  const task = await newTask();
  const use = (quantity, extra = {}) => owner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: towels.supply_id, kind: 'used', quantity, ...extra }] });
  assert.equal(ok(await use(2)).supplies[0].on_hand, 3);
  assert.equal(ok(await use(3, { record_on_hand: true })).supplies[0].on_hand, 0);
  assert.deepEqual((await usedRows(towels.supply_id)).map((x) => [x.quantity, x.note]), [[2, null], [3, null]]);
});

test('restocks are not refused for an owner, even with nothing on hand', async () => {
  const pads = await newSupply('Pads', 0);
  const task = await newTask();
  const r = ok(await owner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: pads.supply_id, kind: 'restocked', quantity: 4 }] }));
  assert.equal(r.supplies[0].on_hand, 4);
});

test('one refused line in an owner save changes nothing, including the lines before it', async () => {
  const tissue = await newSupply('Tissue', 5);
  const hand = await newSupply('Hand wash', 0);
  const task = await newTask();
  const r = await owner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [
    { supply_id: tissue.supply_id, kind: 'used', quantity: 1 },
    { supply_id: hand.supply_id, kind: 'used', quantity: 1 },
  ] });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(r.data.fields, { [rowKey(hand)]: 'Nothing on hand. Restock it first.' });
  assert.equal(await onHandOf(tissue.supply_id), 5);
  assert.deepEqual(await usedRows(tissue.supply_id), []);
});

test('a cleaner or staff member with nothing on hand is skipped and named, and the rest saves', async () => {
  const shampoo = await newSupply('Shampoo bar', 0);
  const bleach = await newSupply('Bleach refill 2', 3);
  const task = await newTask();
  const r = ok(await cleaner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [
    { supply_id: shampoo.supply_id, kind: 'used', quantity: 2 },
    { supply_id: bleach.supply_id, kind: 'used', quantity: 1 },
  ] }));
  assert.deepEqual(r.skipped, ['Shampoo bar']);
  assert.equal(r.supplies.find((s) => s.supply_id === bleach.supply_id).on_hand, 2);
  const s = ok(await staff.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: shampoo.supply_id, kind: 'used', quantity: 1 }] }));
  assert.deepEqual(s.skipped, ['Shampoo bar']);
  assert.deepEqual(await usedRows(shampoo.supply_id), []);
});

test('a cleaner who uses more than is on hand is capped and logged as before, with or without the choice', async () => {
  const soap = await newSupply('Dish soap', 1);
  const task = await newTask();
  const r = ok(await cleaner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: soap.supply_id, kind: 'used', quantity: 5, record_on_hand: true }] }));
  assert.equal(r.supplies[0].on_hand, 0);
  assert.deepEqual(await usedRows(soap.supply_id), [{ quantity: 1, note: 'Asked for 5, only 1 on hand.', task_id: task.task_id }]);
});

test('the job screen keys each supply row the way the server answers it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');
  assert.ok(src.includes('key: `qty-${sp.supply_id}`'), 'row key is qty-<supply id>');
  assert.ok(src.includes("'data-field': r.key"), 'the row carries that key as its data-field');
});
