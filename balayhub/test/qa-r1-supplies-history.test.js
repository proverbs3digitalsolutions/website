'use strict';

// QA round 1, lane F3: a supply movement note takes up to 200 characters (BACKEND-SCHEMA.MD), and
// owners and managers can read a supply's last 20 movements, newest first, with who recorded each.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};

let srv; let owner; let manager; let staff; let cleaner; let cleanerId; let other;
let azure; let grass; let unit; let bleach;

// A team member who signed up through a real invitation.
async function teamMember(role, email, name, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.ok(inv.data.inviteLink, JSON.stringify(inv.data));
  const c = client(srv.base);
  ok(await c.post('/api/auth/signup', {
    full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  }), 201);
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-history@example.com', 'History Co');
  azure = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  grass = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${azure.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = await teamMember('manager', 'manager-history@example.com', 'Ana Manager', [azure.property_id]);
  staff = await teamMember('staff', 'staff-history@example.com', 'Ben Staff', [azure.property_id]);
  cleaner = await teamMember('staff', 'cleaner-history@example.com', 'Nene Cleaner', [azure.property_id]);
  await sql(`UPDATE users SET role = 'cleaner' WHERE email = $1`, ['cleaner-history@example.com']);
  [{ user_id: cleanerId }] = await sql('SELECT user_id FROM users WHERE email = $1', ['cleaner-history@example.com']);
  other = await ownerAccount(srv.base, 'other-history@example.com', 'Other Co');
});
test.after(async () => { await srv.close(); });

test('a movement note takes up to 200 characters, and 201 is refused', async () => {
  const soap = ok(await owner.post('/api/supplies', { property_id: azure.property_id, name: 'Soap', par_level: 1, on_hand: 10 }), 201).supply;
  const move = (note) => owner.post(`/api/supplies/${soap.supply_id}/movements`, { kind: 'used', quantity: 1, note });
  ok(await move('x'.repeat(200)));
  const tooLong = await move('x'.repeat(201));
  assert.equal(tooLong.status, 400);
  assert.ok(tooLong.data.fields.note, JSON.stringify(tooLong.data));
  const [row] = await sql('SELECT note FROM supply_movements WHERE supply_id = $1 ORDER BY created_at DESC LIMIT 1', [soap.supply_id]);
  assert.equal(row.note.length, 200);
});

test('a long note still saves when more is used than is on hand, and the log note stays within 200', async () => {
  const shampoo = ok(await owner.post('/api/supplies', { property_id: azure.property_id, name: 'Shampoo', par_level: 1, on_hand: 2 }), 201).supply;
  const r = await owner.post(`/api/supplies/${shampoo.supply_id}/movements`, { kind: 'used', quantity: 10, note: 'n'.repeat(200) });
  assert.equal(ok(r).supply.on_hand, 0);
  const [row] = await sql('SELECT note FROM supply_movements WHERE supply_id = $1 ORDER BY created_at DESC LIMIT 1', [shampoo.supply_id]);
  assert.ok(row.note.length <= 200, `log note is ${row.note.length} characters`);
  assert.match(row.note, /Asked for 10, only 2 on hand\.$/);
});

test('owners and managers see the last 20 movements, newest first, with who recorded each', async () => {
  bleach = ok(await owner.post('/api/supplies', { property_id: azure.property_id, name: 'Bleach', par_level: 2 }), 201).supply;
  for (let i = 1; i <= 21; i += 1) {
    ok(await owner.post(`/api/supplies/${bleach.supply_id}/movements`, { kind: 'restocked', quantity: 1, note: `Batch ${i}` }));
  }
  const task = ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), assigned_to: cleanerId }), 201).task;
  ok(await cleaner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: bleach.supply_id, kind: 'used', quantity: 2 }] }));
  ok(await manager.post(`/api/supplies/${bleach.supply_id}/movements`, { kind: 'count', quantity: 5, note: 'Shelf count' }));

  const { movements } = ok(await owner.get(`/api/supplies/${bleach.supply_id}/movements`));
  assert.equal(movements.length, 20, '23 movements, the newest 20 are listed');
  assert.deepEqual(Object.keys(movements[0]).sort(), ['created_at', 'kind', 'note', 'quantity', 'recorded_by_name']);
  assert.deepEqual(movements.slice(0, 2).map(({ kind, quantity, note, recorded_by_name }) => [kind, quantity, note, recorded_by_name]), [
    ['count', 5, 'Shelf count', 'Ana Manager'],
    ['used', 2, null, 'Nene Cleaner'],
  ]);
  assert.equal(movements[2].note, 'Batch 21');
  assert.equal(movements[2].recorded_by_name, 'Maria Santos');
  assert.equal(movements[19].note, 'Batch 4');
  for (const m of movements) assert.match(m.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
  assert.deepEqual(ok(await manager.get(`/api/supplies/${bleach.supply_id}/movements`)).movements, movements);
});

test('history is scoped to the supply and to owners and managers', async () => {
  const path = (id) => `/api/supplies/${id}/movements`;
  const trash = ok(await owner.post('/api/supplies', { property_id: grass.property_id, name: 'Trash bags', par_level: 1 }), 201).supply;
  assert.deepEqual(ok(await owner.get(path(trash.supply_id))).movements, [], 'no movements yet is an empty list');
  assert.equal((await manager.get(path(trash.supply_id))).status, 404, 'a manager not on Grass');
  assert.equal((await other.get(path(bleach.supply_id))).status, 404, 'another workspace');
  assert.equal((await owner.get(path('00000000-0000-4000-8000-000000000000'))).status, 404);
  assert.equal((await owner.get(path('not-a-uuid'))).status, 404);
  assert.equal((await staff.get(path(bleach.supply_id))).status, 403, 'staff are refused');
  assert.equal((await cleaner.get(path(bleach.supply_id))).status, 403, 'cleaners are refused');
  assert.equal((await client(srv.base).get(path(bleach.supply_id))).status, 401, 'signed out');
});
