'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const account = require('../src/lib/account');
const { createStaysWorkspace } = require('../src/lib/demo');

let srv; let orgId; let userId; let unitId; let propertyId; let taskId; let bookingId;
test.before(async () => {
  srv = await startServer();
  orgId = await createStaysWorkspace({ email: 'm030@example.com', passwordHash: 'x' });
  [{ user_id: userId }] = await sql(`SELECT user_id FROM users WHERE organization_id = $1 LIMIT 1`, [orgId]);
  [{ unit_id: unitId, property_id: propertyId }] = await sql(`SELECT u.unit_id, u.property_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1 LIMIT 1`, [orgId]);
  [{ booking_id: bookingId }] = await sql(`INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, block_reason, confirmation_code)
    VALUES ($1, $2, 'block', current_date + 700, current_date + 702, 'm030', 'BLK' || substr(gen_random_uuid()::text, 1, 6)) RETURNING booking_id`, [orgId, unitId]);
  [{ task_id: taskId }] = await sql(`INSERT INTO cleaning_tasks (organization_id, unit_id, due_date) VALUES ($1, $2, current_date) RETURNING task_id`, [orgId, unitId]);
});
test.after(async () => { await srv.close(); });

const cols = async (table) => (await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).map((r) => r.column_name);
const bad = (q, p) => assert.rejects(sql(q, p), /check|violates|unique/i);

test('030: tables and columns exist', async () => {
  const want = {
    cleaning_tasks: ['pay_amount', 'pay_status', 'paid_on', 'paid_method', 'paid_reference', 'paid_by', 'pay_expense_id'],
    cleaner_rates: ['rate_id', 'organization_id', 'user_id', 'assignee_name', 'rate_type', 'amount', 'updated_at'],
    cleaning_inspections: ['inspection_id', 'organization_id', 'task_id', 'inspected_by', 'items', 'score', 'passed', 'notes', 'created_at'],
    damage_reports: ['report_id', 'organization_id', 'unit_id', 'booking_id', 'task_id', 'description', 'estimated_cost', 'status', 'charge_id', 'resolution_note', 'reported_by', 'resolved_by', 'created_at', 'resolved_at'],
    lost_found_items: ['item_id', 'organization_id', 'unit_id', 'booking_id', 'task_id', 'description', 'found_where', 'found_on', 'status', 'status_note', 'found_by', 'updated_by', 'created_at', 'updated_at'],
    supplies: ['supply_id', 'organization_id', 'property_id', 'name', 'unit_label', 'par_level', 'on_hand', 'archived_at', 'created_at', 'updated_at'],
    supply_movements: ['movement_id', 'organization_id', 'supply_id', 'kind', 'quantity', 'task_id', 'note', 'recorded_by', 'created_at'],
    maintenance_schedules: ['schedule_id', 'organization_id', 'property_id', 'unit_id', 'title', 'description', 'every_n', 'every_unit', 'next_due', 'priority', 'active', 'last_created_at', 'created_by', 'created_at'],
    maintenance_requests: ['cleaning_task_id', 'schedule_id'],
  };
  for (const [t, cs] of Object.entries(want)) { const have = await cols(t); for (const c of cs) assert.ok(have.includes(c), `${t}.${c}`); }
  const [t] = await sql(`SELECT pay_amount, pay_status, paid_on FROM cleaning_tasks WHERE task_id = $1`, [taskId]);
  assert.equal(t.pay_amount, null);
  assert.equal(t.pay_status, 'unpaid');
  assert.equal(t.paid_on, null);
  const [s] = await sql(`INSERT INTO supplies (organization_id, property_id, name) VALUES ($1, $2, 'Defaults') RETURNING unit_label, par_level, on_hand`, [orgId, propertyId]);
  assert.deepEqual({ ...s }, { unit_label: 'pcs', par_level: 0, on_hand: 0 });
  const [d] = await sql(`INSERT INTO damage_reports (organization_id, unit_id, description) VALUES ($1, $2, 'Chipped table') RETURNING status`, [orgId, unitId]);
  assert.equal(d.status, 'open');
  const [l] = await sql(`INSERT INTO lost_found_items (organization_id, unit_id, description) VALUES ($1, $2, 'Charger') RETURNING status`, [orgId, unitId]);
  assert.equal(l.status, 'held');
});

test('030: cleaner role is accepted for users and invitations; bad roles are not', async () => {
  const mk = (email, role, org = orgId) => sql(`INSERT INTO users (organization_id, email, password_hash, full_name, role) VALUES ($1, $2, 'x', 'Clea Ner', $3)`, [org, email, role]);
  await mk('cleaner030@example.com', 'cleaner');
  await assert.rejects(mk('bogus030@example.com', 'janitor'), /check/i);
  // The "org and role are both set or both null" rule still holds.
  await bad(`INSERT INTO users (email, password_hash, full_name, role) VALUES ('norg030@example.com', 'x', 'No Org', 'cleaner')`);
  await bad(`INSERT INTO users (organization_id, email, password_hash, full_name) VALUES ($1, 'norole030@example.com', 'x', 'No Role')`, [orgId]);
  const inv = (role) => sql(`INSERT INTO invitations (organization_id, email, role, token_hash, expires_at, invited_by) VALUES ($1, $2, $3, $4, now() + interval '1 day', $5)`,
    [orgId, `inv-${role}@example.com`, role, `h-inv-${role}`, userId]);
  await inv('cleaner');
  await inv('staff');
  await assert.rejects(inv('owner'), /check/i);
});

test('030: units can be inspected; old file types are kept, new ones added', async () => {
  for (const s of ['dirty', 'clean', 'inspected']) await sql(`UPDATE units SET cleaning_status = $2 WHERE unit_id = $1`, [unitId, s]);
  await bad(`UPDATE units SET cleaning_status = 'spotless' WHERE unit_id = $1`, [unitId]);
  const types = ['lease', 'payment', 'expense', 'maintenance', 'cleaning', 'registration', 'listing', 'deposit', 'support', 'payment_proof', 'booking_payment', 'damage', 'lost_found', 'inspection'];
  for (const ty of types) {
    await sql(`INSERT INTO files (organization_id, related_record_type, related_record_id, file_name, mime_type, size_bytes, storage_key, uploaded_by)
      VALUES ($1, $2, gen_random_uuid(), 'a.jpg', 'image/jpeg', 10, $3, $4)`, [orgId, ty, `k-030-${ty}`, userId]);
  }
  await bad(`INSERT INTO files (organization_id, related_record_type, related_record_id, file_name, mime_type, size_bytes, storage_key, uploaded_by)
    VALUES ($1, 'selfie', gen_random_uuid(), 'a.jpg', 'image/jpeg', 10, 'k-030-bad', $2)`, [orgId, userId]);
});

test('030: cleaning task pay columns are checked', async () => {
  await sql(`UPDATE cleaning_tasks SET pay_amount = 350.50, pay_status = 'paid', paid_on = current_date, paid_method = 'gcash', paid_reference = 'ref', paid_by = $2 WHERE task_id = $1`, [taskId, userId]);
  await bad(`UPDATE cleaning_tasks SET pay_amount = -1 WHERE task_id = $1`, [taskId]);
  await bad(`UPDATE cleaning_tasks SET pay_status = 'pending' WHERE task_id = $1`, [taskId]);
  await bad(`UPDATE cleaning_tasks SET paid_method = 'card' WHERE task_id = $1`, [taskId]);
  await bad(`UPDATE cleaning_tasks SET paid_reference = $2 WHERE task_id = $1`, [taskId, 'x'.repeat(101)]);
  await bad(`UPDATE cleaning_tasks SET pay_expense_id = gen_random_uuid() WHERE task_id = $1`, [taskId]);
  await sql(`UPDATE cleaning_tasks SET pay_status = 'unpaid', paid_on = NULL, paid_method = NULL, paid_reference = NULL, paid_by = NULL WHERE task_id = $1`, [taskId]);
  const [{ indexdef }] = await sql(`SELECT indexdef FROM pg_indexes WHERE indexname = 'cleaning_tasks_pay_idx'`);
  assert.match(indexdef, /\(organization_id, pay_status\)/);
});

test('030: cleaner_rates needs exactly one of user or name, and is unique per workspace', async () => {
  const rate = (u, n, type = 'per_clean', amt = 300) => sql(`INSERT INTO cleaner_rates (organization_id, user_id, assignee_name, rate_type, amount) VALUES ($1, $2, $3, $4, $5)`, [orgId, u, n, type, amt]);
  await rate(userId, null);
  await rate(null, 'Aling Nena', 'per_hour', 80);
  await assert.rejects(rate(userId, 'Both'), /check/i);
  await assert.rejects(rate(null, null), /check/i);
  await assert.rejects(rate(userId, null), (e) => e.code === '23505' && e.constraint === 'cleaner_rates_user_uq');
  await assert.rejects(rate(null, 'ALING NENA'), (e) => e.code === '23505' && e.constraint === 'cleaner_rates_name_uq');
  await assert.rejects(rate(null, 'Other', 'per_day'), /check/i);
  await assert.rejects(rate(null, 'Neg', 'per_clean', -1), /check/i);
  await assert.rejects(rate(null, 'x'.repeat(121)), /check/i);
  // A different workspace can use the same name.
  const org2 = await createStaysWorkspace({ email: 'm030b@example.com', passwordHash: 'x' });
  await sql(`INSERT INTO cleaner_rates (organization_id, assignee_name, rate_type, amount) VALUES ($1, 'Aling Nena', 'per_clean', 100)`, [org2]);
  await account.purgeOrganization(org2);
});

test('030: inspections, damage reports and lost and found enforce their checks', async () => {
  const insp = (score, passed = true, notes = null) => sql(`INSERT INTO cleaning_inspections (organization_id, task_id, inspected_by, items, score, passed, notes) VALUES ($1, $2, $3, '[{"text":"Beds","pass":true}]', $4, $5, $6)`, [orgId, taskId, userId, score, passed, notes]);
  await insp(0, false);
  await insp(100);
  await assert.rejects(insp(101), /check/i);
  await assert.rejects(insp(-1), /check/i);
  await assert.rejects(insp(50, true, 'x'.repeat(1001)), /check/i);

  const dmg = (over = {}) => {
    const v = { desc: 'Broken glass', cost: 500, status: 'open', note: null, ...over };
    return sql(`INSERT INTO damage_reports (organization_id, unit_id, booking_id, task_id, description, estimated_cost, status, resolution_note, reported_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [orgId, unitId, bookingId, taskId, v.desc, v.cost, v.status, v.note, userId]);
  };
  await dmg();
  await dmg({ cost: null });
  for (const s of ['charged', 'deducted', 'waived']) await dmg({ status: s });
  await assert.rejects(dmg({ status: 'paid' }), /check/i);
  await assert.rejects(dmg({ desc: '' }), /check/i);
  await assert.rejects(dmg({ desc: 'x'.repeat(1001) }), /check/i);
  await assert.rejects(dmg({ cost: -1 }), /check/i);
  await assert.rejects(dmg({ note: 'x'.repeat(501) }), /check/i);
  await bad(`INSERT INTO damage_reports (organization_id, unit_id, description, charge_id) VALUES ($1, $2, 'x', gen_random_uuid())`, [orgId, unitId]);

  const lf = (over = {}) => {
    const v = { desc: 'Sunglasses', where: 'Bedroom', status: 'held', note: null, ...over };
    return sql(`INSERT INTO lost_found_items (organization_id, unit_id, task_id, description, found_where, found_on, status, status_note) VALUES ($1, $2, $3, $4, $5, current_date, $6, $7)`,
      [orgId, unitId, taskId, v.desc, v.where, v.status, v.note]);
  };
  await lf();
  await lf({ status: 'returned' });
  await lf({ status: 'disposed' });
  await assert.rejects(lf({ status: 'lost' }), /check/i);
  await assert.rejects(lf({ desc: '' }), /check/i);
  await assert.rejects(lf({ desc: 'x'.repeat(301) }), /check/i);
  await assert.rejects(lf({ where: 'x'.repeat(201) }), /check/i);
  await assert.rejects(lf({ note: 'x'.repeat(301) }), /check/i);
});

test('030: supplies and movements enforce quantities and unique names', async () => {
  const sup = (name, over = {}) => sql(`INSERT INTO supplies (organization_id, property_id, name, unit_label, par_level, on_hand) VALUES ($1, $2, $3, $4, $5, $6) RETURNING supply_id`,
    [orgId, propertyId, name, over.label || 'rolls', over.par ?? 10, over.on ?? 4]);
  const [{ supply_id: sid }] = await sup('Toilet paper');
  await assert.rejects(sup('toilet PAPER'), (e) => e.code === '23505' && e.constraint === 'supplies_name_uq');
  await assert.rejects(sup('Bad par', { par: -1 }), /check/i);
  await assert.rejects(sup('Bad hand', { on: -1 }), /check/i);
  await assert.rejects(sup('Bad label', { label: 'x'.repeat(21) }), /check/i);
  await assert.rejects(sup(''), /check/i);
  await assert.rejects(sup('x'.repeat(81)), /check/i);
  // An archived supply frees its name.
  await sql(`UPDATE supplies SET archived_at = now() WHERE supply_id = $1`, [sid]);
  await sup('Toilet paper');

  const mv = (kind, qty, note = null) => sql(`INSERT INTO supply_movements (organization_id, supply_id, kind, quantity, task_id, note, recorded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [orgId, sid, kind, qty, taskId, note, userId]);
  await mv('used', 2);
  await mv('restocked', 5);
  await mv('count', 0);
  await mv('count', 7);
  await assert.rejects(mv('used', 0), /check/i);
  await assert.rejects(mv('restocked', -1), /check/i);
  await assert.rejects(mv('count', -1), /check/i);
  await assert.rejects(mv('thrown', 1), /check/i);
  await assert.rejects(mv('used', 1, 'x'.repeat(201)), /check/i);
});

test('030: maintenance schedules and request links', async () => {
  const sch = (over = {}) => {
    const v = { title: 'Service aircon', n: 3, unit: 'months', priority: 'medium', ...over };
    return sql(`INSERT INTO maintenance_schedules (organization_id, property_id, unit_id, title, every_n, every_unit, next_due, priority) VALUES ($1, $2, $3, $4, $5, $6, current_date, $7) RETURNING schedule_id, active`,
      [orgId, propertyId, unitId, v.title, v.n, v.unit, v.priority]);
  };
  const [s] = await sch();
  assert.equal(s.active, true);
  await sch({ n: 365, unit: 'days', priority: 'urgent' });
  await assert.rejects(sch({ n: 0 }), /check/i);
  await assert.rejects(sch({ n: 366 }), /check/i);
  await assert.rejects(sch({ unit: 'years' }), /check/i);
  await assert.rejects(sch({ priority: 'critical' }), /check/i);
  await assert.rejects(sch({ title: '' }), /check/i);
  await assert.rejects(sch({ title: 'x'.repeat(151) }), /check/i);
  await sql(`INSERT INTO maintenance_requests (organization_id, property_id, unit_id, title, cleaning_task_id, schedule_id) VALUES ($1, $2, $3, 'From task', $4, $5)`, [orgId, propertyId, unitId, taskId, s.schedule_id]);
  await bad(`INSERT INTO maintenance_requests (organization_id, property_id, title, schedule_id) VALUES ($1, $2, 'Orphan', gen_random_uuid())`, [orgId, propertyId]);
  await bad(`INSERT INTO maintenance_requests (organization_id, property_id, title, cleaning_task_id) VALUES ($1, $2, 'Orphan', gen_random_uuid())`, [orgId, propertyId]);
});

test('030: export includes the new tables; purge removes everything (including the pay/expense/request loop)', async () => {
  const [exp1] = await sql(`INSERT INTO expenses (organization_id, property_id, unit_id, category, description, amount, expense_date, recorded_by) VALUES ($1, $2, $3, 'cleaning', 'Cleaning pay', 350, current_date, $4) RETURNING expense_id`, [orgId, propertyId, unitId, userId]);
  await sql(`UPDATE cleaning_tasks SET pay_expense_id = $2 WHERE task_id = $1`, [taskId, exp1.expense_id]);
  const [req] = await sql(`SELECT request_id FROM maintenance_requests WHERE organization_id = $1 LIMIT 1`, [orgId]);
  await sql(`UPDATE expenses SET maintenance_request_id = $2 WHERE expense_id = $1`, [exp1.expense_id, req.request_id]);

  const exp = await account.exportOrganization(orgId);
  for (const t of ['cleaner_rates', 'cleaning_inspections', 'damage_reports', 'lost_found_items', 'supplies', 'supply_movements', 'maintenance_schedules']) {
    assert.ok(Array.isArray(exp[t]) && exp[t].length > 0, `export ${t}`);
    assert.ok(account.PURGED_TABLES.includes(t), `PURGED_TABLES ${t}`);
  }
  assert.ok(exp.cleaning_tasks.some((r) => r.pay_expense_id === exp1.expense_id));

  await account.purgeOrganization(orgId);
  const tables = ['cleaner_rates', 'cleaning_inspections', 'damage_reports', 'lost_found_items', 'supplies', 'supply_movements', 'maintenance_schedules',
    'maintenance_requests', 'expenses', 'cleaning_tasks', 'files', 'users', 'invitations'];
  for (const t of tables) assert.equal((await sql(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [orgId]))[0].n, 0, t);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM organizations WHERE organization_id = $1`, [orgId]))[0].n, 0);
});
