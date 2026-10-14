'use strict';

// QA round 2, lane B23 (supplies). Using more than is on hand logs only what was actually used, with
// the amount asked for in the note, so usage totals aren't inflated. Staff can open the list and
// change nothing. The unit word agrees with the count ("1 roll", "2 rolls").

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};

let srv; let owner; let prop; let unit; let staff; let cleaner; let cleanerId;

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
  owner = await ownerAccount(srv.base, 'owner-r2-supplies@example.com', 'R2 Supplies Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  staff = (await teamMember('staff', 'staff-r2-supplies@example.com', 'Ben Staff', [prop.property_id])).c;
  const m = await teamMember('staff', 'cleaner-r2-supplies@example.com', 'Nene Cleaner', [prop.property_id]);
  await sql(`UPDATE users SET role = 'cleaner' WHERE user_id = $1`, [m.user_id]);
  cleaner = m.c;
  cleanerId = m.user_id;
});
test.after(async () => { await srv.close(); });

// The 'used' movements on one supply, oldest first.
const usedRows = (supplyId) => sql(
  `SELECT quantity, note, task_id FROM supply_movements WHERE supply_id = $1 AND kind = 'used' ORDER BY created_at`, [supplyId]);

test('using more than is on hand logs only what was used, and the note keeps what was asked for', async () => {
  const roll = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Toilet paper', unit_label: 'rolls', par_level: 2, on_hand: 4 }), 201).supply;
  const r = ok(await owner.post(`/api/supplies/${roll.supply_id}/movements`, { kind: 'used', quantity: 9, note: 'Guest 3' }));
  assert.equal(r.supply.on_hand, 0);
  const [mv] = await usedRows(roll.supply_id);
  assert.equal(mv.quantity, 4, 'the log holds the 4 that were used, not the 9 asked for');
  assert.equal(mv.note, 'Guest 3 Asked for 9, only 4 on hand.');
  const [{ used }] = await sql(
    `SELECT COALESCE(SUM(quantity), 0)::int AS used FROM supply_movements WHERE supply_id = $1 AND kind = 'used'`, [roll.supply_id]);
  assert.equal(used, 4, 'usage totals are not inflated');
  assert.equal(ok(await owner.get(`/api/supplies/${roll.supply_id}/movements`)).movements[0].quantity, 4);
});

test('a use that fits on hand, or uses exactly what is there, is logged as asked with no extra note', async () => {
  const soap = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Soap', par_level: 1, on_hand: 10 }), 201).supply;
  ok(await owner.post(`/api/supplies/${soap.supply_id}/movements`, { kind: 'used', quantity: 3 }));
  const exact = ok(await owner.post(`/api/supplies/${soap.supply_id}/movements`, { kind: 'used', quantity: 7 }));
  assert.equal(exact.supply.on_hand, 0);
  const rows = await usedRows(soap.supply_id);
  assert.deepEqual(rows.map((x) => [x.quantity, x.note]), [[3, null], [7, null]]);
});

test('with nothing on hand, a use is refused, because there is nothing to log as used', async () => {
  const bag = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Trash bags', par_level: 1, on_hand: 0 }), 201).supply;
  const r = await owner.post(`/api/supplies/${bag.supply_id}/movements`, { kind: 'used', quantity: 3 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.quantity, 'Trash bags is out of stock, so nothing can be recorded as used.');
  const [{ on_hand }] = await sql('SELECT on_hand FROM supplies WHERE supply_id = $1', [bag.supply_id]);
  assert.equal(on_hand, 0);
  assert.deepEqual(await usedRows(bag.supply_id), []);
});

test('a cleaner who uses more than is on hand is logged with what was actually used, against the task', async () => {
  const soap = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Dish soap', par_level: 1, on_hand: 1 }), 201).supply;
  const task = ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), assigned_to: cleanerId }), 201).task;
  const r = ok(await cleaner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: soap.supply_id, kind: 'used', quantity: 5 }] }));
  assert.equal(r.supplies[0].on_hand, 0);
  const [mv] = await usedRows(soap.supply_id);
  assert.equal(mv.quantity, 1);
  assert.equal(mv.task_id, task.task_id);
  assert.equal(mv.note, 'Asked for 5, only 1 on hand.');
});

test('a cleaner save skips a used item with nothing on hand, names it, and saves the rest', async () => {
  const shampoo = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Shampoo bar', par_level: 1, on_hand: 0 }), 201).supply;
  const bleach = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Bleach refill', par_level: 1, on_hand: 3 }), 201).supply;
  const task = ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), assigned_to: cleanerId }), 201).task;
  const r = ok(await cleaner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [
    { supply_id: shampoo.supply_id, kind: 'used', quantity: 2 },
    { supply_id: bleach.supply_id, kind: 'used', quantity: 1 },
  ] }));
  assert.deepEqual(r.skipped, ['Shampoo bar']);
  assert.deepEqual(r.supplies.map((s) => [s.name, s.on_hand]), [['Bleach refill', 2], ['Shampoo bar', 0]]);
  assert.deepEqual(await usedRows(shampoo.supply_id), [], 'nothing logged for the skipped item');
  const [mv] = await usedRows(bleach.supply_id);
  assert.equal(mv.quantity, 1);
  assert.equal(mv.task_id, task.task_id);
});

test('when every used item is out of stock nothing is recorded, and restocking an empty item still saves', async () => {
  const handWash = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Hand wash', par_level: 1, on_hand: 0 }), 201).supply;
  const task = ok(await owner.post('/api/cleaning-tasks', { unit_id: unit.unit_id, due_date: manilaToday(), assigned_to: cleanerId }), 201).task;
  const none = ok(await cleaner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: handWash.supply_id, kind: 'used', quantity: 1 }] }));
  assert.deepEqual(none.skipped, ['Hand wash']);
  assert.deepEqual(await usedRows(handWash.supply_id), []);
  const back = ok(await cleaner.post(`/api/cleaning-tasks/${task.task_id}/supplies`, { items: [{ supply_id: handWash.supply_id, kind: 'restocked', quantity: 4 }] }));
  assert.deepEqual(back.skipped, []);
  assert.equal(back.supplies[0].on_hand, 4);
});

test('the cleaner supplies form names skipped items in a plain note', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');
  assert.ok(src.includes('const { skipped, short: shortfall = [] } = await post(`/cleaning-tasks/${task.task_id}/supplies`, { items });'), 'reads the skipped names from the save');
  assert.ok(src.includes("T('{name} was out of stock, so it wasn\\'t recorded.', { name })"), 'says which item was skipped');
  assert.ok(src.includes("T('Tell your manager.')"), 'tells the cleaner to tell the manager');
});

test('staff can open the list, but cannot change supplies or see their history', async () => {
  const item = ok(await owner.post('/api/supplies', { property_id: prop.property_id, name: 'Tissue', unit_label: 'boxes', par_level: 1, on_hand: 3 }), 201).supply;
  assert.ok(ok(await staff.get('/api/supplies')).supplies.some((s) => s.supply_id === item.supply_id));
  assert.equal((await staff.post('/api/supplies', { property_id: prop.property_id, name: 'Soap', par_level: 1 })).status, 403);
  assert.equal((await staff.patch(`/api/supplies/${item.supply_id}`, { par_level: 1 })).status, 403);
  assert.equal((await staff.post(`/api/supplies/${item.supply_id}/archive`)).status, 403);
  assert.equal((await staff.post(`/api/supplies/${item.supply_id}/movements`, { kind: 'used', quantity: 1 })).status, 403);
  assert.equal((await staff.get(`/api/supplies/${item.supply_id}/movements`)).status, 403);
});

test('the supplies page shows the write buttons and the history only to owners and managers', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/supplies.js'), 'utf8');
  assert.match(src, /const canManage = \['owner', 'manager'\]\.includes\(state\.user\.role\);/);
  assert.match(src, /actions: canManage && h\('button'/, 'header Add supply button');
  assert.match(src, /!hasFilter && canManage && h\('button'/, 'empty-state Add supply button');
  assert.match(src, /canManage && h\('div', \{ class: 'ops-supply__actions' \}/, 'Add stock, Count, Record use, History, Edit, Archive');
});

test('the unit word agrees with the count: "1 roll", "2 rolls", and known abbreviations stay', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r2-supplies-'));
  try {
    fs.cpSync(path.join(__dirname, '../public/js'), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\n");
    globalThis.Element = class { };
    const { qtyLabel } = await import(pathToFileURL(path.join(dir, 'views/supplies.js')));
    assert.equal(qtyLabel(1, 'rolls'), '1 roll');
    assert.equal(qtyLabel(2, 'rolls'), '2 rolls');
    assert.equal(qtyLabel(0, 'rolls'), '0 rolls');
    assert.equal(qtyLabel(1, 'pcs'), '1 pc');
    assert.equal(qtyLabel(1, 'boxes'), '1 box');
    assert.equal(qtyLabel(2, 'boxes'), '2 boxes');
    assert.equal(qtyLabel(1, 'batteries'), '1 battery');
    assert.equal(qtyLabel(1, 'glasses'), '1 glass');
    assert.equal(qtyLabel(1, 'bottles'), '1 bottle');
    assert.equal(qtyLabel(3, 'bottles'), '3 bottles');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
