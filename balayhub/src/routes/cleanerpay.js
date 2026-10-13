'use strict';

// Cleaner pay (D-52): rates per cleaner, the monthly pay list and mark-paid / undo for
// owners and managers, and each cleaner's own pay. Money is NUMERIC, read back as
// 2-decimal strings; sums are kept in whole centavos so they stay exact.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const owners = requireRole('owner');

const METHODS = ['cash', 'gcash', 'maya', 'bank_transfer'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
// Cleaner key: user:<user id> for a team member, name:<lower-case name> for an outside cleaner
// (the same keys housekeeping uses for the calendar and cleaner scores).
const KEY_RE = /^(user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|name:.{1,120})$/;
const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;

const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const conflict = (code, message, extra = {}) => new HttpError(409, message, { code, ...extra });

const cents = (v) => Math.round(Number(v || 0) * 100);
const money = (c) => (c / 100).toFixed(2);

function monthParam(v) {
  if (typeof v !== 'string' || !MONTH_RE.test(v)) throw validationError({ month: 'Use the format YYYY-MM.' });
  return v;
}

async function currentMonth() {
  return (await one(`SELECT to_char(${TODAY}, 'YYYY-MM') AS m`)).m;
}

// Clean finished in a Manila calendar month.
function inMonth(params, month) {
  params.push(`${month}-01`);
  const i = params.length;
  return `(t.completed_at AT TIME ZONE 'Asia/Manila')::date >= $${i}::date
          AND (t.completed_at AT TIME ZONE 'Asia/Manila')::date < ($${i}::date + interval '1 month')::date`;
}

// A cleaning task with the cleaner it is paid to. The cleaner is the assigned team
// member, else the named outside cleaner, else whoever marked it done.
const PAY_SELECT = `
  SELECT t.task_id, t.unit_id, t.status, t.pay_status, t.pay_amount, t.paid_on, t.paid_method, t.paid_reference,
         t.pay_expense_id, t.completed_at,
         u.unit_name, p.property_id, p.property_name,
         CASE WHEN t.assigned_to IS NOT NULL THEN 'user:' || t.assigned_to::text
              WHEN t.assignee_name IS NOT NULL THEN 'name:' || lower(t.assignee_name)
              ELSE 'user:' || t.completed_by::text END AS cleaner_key,
         CASE WHEN t.assigned_to IS NOT NULL THEN au.full_name
              WHEN t.assignee_name IS NOT NULL THEN t.assignee_name
              ELSE cu.full_name END AS cleaner_name,
         CASE WHEN t.assigned_to IS NOT NULL THEN t.assigned_to
              WHEN t.assignee_name IS NOT NULL THEN NULL
              ELSE t.completed_by END AS cleaner_user_id
    FROM cleaning_tasks t
    JOIN units u ON u.unit_id = t.unit_id
    JOIN properties p ON p.property_id = u.property_id
    LEFT JOIN users au ON au.user_id = t.assigned_to
    LEFT JOIN users cu ON cu.user_id = t.completed_by`;

const taskOut = (r) => ({
  task_id: r.task_id, unit_id: r.unit_id, unit_name: r.unit_name, property_id: r.property_id, property_name: r.property_name,
  completed_at: r.completed_at, pay_amount: r.pay_amount, pay_status: r.pay_status, paid_on: r.paid_on,
  paid_method: r.paid_method, paid_reference: r.paid_reference,
  cleaner_key: r.cleaner_key, cleaner_name: r.cleaner_name, cleaner_user_id: r.cleaner_user_id,
});

// Totals in whole centavos. Tasks with no pay yet are left out.
function tally(tasks) {
  const c = { paid: 0, unpaid: 0 };
  for (const t of tasks) if (t.pay_amount != null) c[t.pay_status] += cents(t.pay_amount);
  return { total: money(c.paid + c.unpaid), paid: money(c.paid), unpaid: money(c.unpaid) };
}

function groupCleaners(tasks) {
  const groups = new Map();
  for (const t of tasks) {
    if (!groups.has(t.cleaner_key)) groups.set(t.cleaner_key, { key: t.cleaner_key, name: t.cleaner_name, user_id: t.cleaner_user_id, rows: [] });
    groups.get(t.cleaner_key).rows.push(t);
  }
  return [...groups.values()]
    .map((g) => ({
      key: g.key, name: g.name, user_id: g.user_id,
      count: g.rows.length, unpriced: g.rows.filter((t) => t.pay_amount == null).length,
      ...tally(g.rows),
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// ---------------------------------------------------------------- rates (owners)
const RATE_SELECT = `
  SELECT r.rate_id, r.user_id, r.assignee_name, COALESCE(u.full_name, r.assignee_name) AS name,
         r.rate_type, r.amount, r.updated_at
    FROM cleaner_rates r
    LEFT JOIN users u ON u.user_id = r.user_id`;

router.get('/cleaner-rates', owners, ah(async (req, res) => {
  const { rows } = await query(`${RATE_SELECT} WHERE r.organization_id = $1 ORDER BY name`, [req.user.organization_id]);
  res.json({ rates: rows });
}));

// Add or change the rate for a team member (user_id) or an outside cleaner (assignee_name).
router.put('/cleaner-rates', owners, ah(async (req, res) => {
  const body = validate(req.body, {
    user_id: { type: 'uuid', label: 'Cleaner' },
    assignee_name: { type: 'string', max: 120, label: 'Name' },
    rate_type: { type: 'enum', values: ['per_clean', 'per_hour'], required: true, label: 'Paid' },
    amount: { type: 'money', required: true, positive: true, label: 'Amount' },
  });
  if (Boolean(body.user_id) === Boolean(body.assignee_name)) {
    throw validationError({ assignee_name: 'Choose a team member, or type the name of an outside cleaner. Not both.' });
  }
  const org = req.user.organization_id;
  if (body.user_id) {
    const member = await one(`SELECT user_id FROM users WHERE user_id = $1 AND organization_id = $2 AND account_status = 'active'`, [body.user_id, org]);
    if (!member) throw validationError({ user_id: 'Choose a member of this workspace.' });
  }
  const rate = body.user_id
    ? await one(`INSERT INTO cleaner_rates (organization_id, user_id, rate_type, amount) VALUES ($1, $2, $3, $4)
        ON CONFLICT (organization_id, user_id) WHERE user_id IS NOT NULL
        DO UPDATE SET rate_type = EXCLUDED.rate_type, amount = EXCLUDED.amount, updated_at = now()
        RETURNING rate_id`, [org, body.user_id, body.rate_type, body.amount])
    : await one(`INSERT INTO cleaner_rates (organization_id, assignee_name, rate_type, amount) VALUES ($1, $2, $3, $4)
        ON CONFLICT (organization_id, lower(assignee_name)) WHERE assignee_name IS NOT NULL
        DO UPDATE SET assignee_name = EXCLUDED.assignee_name, rate_type = EXCLUDED.rate_type, amount = EXCLUDED.amount, updated_at = now()
        RETURNING rate_id`, [org, body.assignee_name, body.rate_type, body.amount]);
  await audit(null, req.user, 'cleaner_rate.saved', 'cleaner_rate', rate.rate_id, { rate_type: body.rate_type, amount: body.amount });
  const saved = await one(`${RATE_SELECT} WHERE r.rate_id = $1 AND r.organization_id = $2`, [rate.rate_id, org]);
  res.json({ rate: saved });
}));

router.delete('/cleaner-rates/:id', owners, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { rowCount } = await query('DELETE FROM cleaner_rates WHERE rate_id = $1 AND organization_id = $2', [id, req.user.organization_id]);
  if (!rowCount) throw notFound();
  await audit(null, req.user, 'cleaner_rate.deleted', 'cleaner_rate', id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- pay list (owners, managers)
// Finished cleans for one month with their pay, grouped by cleaner. Optional filters:
// status (paid | unpaid) and cleaner (a cleaner key from the list).
router.get('/cleaner-pay', managers, ah(async (req, res) => {
  const q = validate(req.query, {
    status: { type: 'enum', values: ['paid', 'unpaid'], label: 'Status' },
    cleaner: { type: 'string', max: 130, label: 'Cleaner' },
  });
  if (q.cleaner && !KEY_RE.test(q.cleaner.toLowerCase())) throw validationError({ cleaner: 'Choose a cleaner from the list.' });
  const month = req.query.month ? monthParam(req.query.month) : await currentMonth();
  const params = [];
  const where = [`t.status = 'done'`, propertyScope(req.user, params), inMonth(params, month)];
  if (q.status) { params.push(q.status); where.push(`t.pay_status = $${params.length}`); }
  const { rows } = await query(`${PAY_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.completed_at, p.property_name, u.unit_name`, params);
  const tasks = rows
    .filter((r) => !q.cleaner || r.cleaner_key === q.cleaner.toLowerCase())
    .map((r) => ({ ...taskOut(r), pay_expense_id: r.pay_expense_id }));
  res.json({ month, tasks, cleaners: groupCleaners(tasks), totals: tally(tasks) });
}));

// Mark finished cleans paid, all at once. Optionally record one cleaning expense per unit.
router.post('/cleaner-pay/mark-paid', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    task_ids: { type: 'uuids', required: true, label: 'Cleans' },
    paid_on: { type: 'date', required: true, label: 'Date paid' },
    method: { type: 'enum', values: METHODS, required: true, label: 'How you paid' },
    reference: { type: 'string', max: 100, label: 'Reference' },
    record_expense: { type: 'bool', label: 'Record as expenses' },
  });
  if (!body.task_ids.length) throw validationError({ task_ids: 'Choose at least one clean.' });
  const today = (await one(`SELECT ${TODAY} AS d`)).d;
  if (body.paid_on > today) throw validationError({ paid_on: 'Date paid cannot be in the future.' });

  const result = await tx(async (db) => {
    const params = [body.task_ids];
    const { rows: tasks } = await db.query(
      `${PAY_SELECT} WHERE t.task_id = ANY($1::uuid[]) AND ${propertyScope(req.user, params)}
        ORDER BY t.completed_at, t.task_id FOR UPDATE OF t`, params);
    if (tasks.length !== body.task_ids.length) throw notFound();
    const pick = (list) => list.map((t) => t.task_id);
    const open = tasks.filter((t) => t.status !== 'done');
    if (open.length) throw conflict('NOT_DONE', 'Only finished cleans can be marked paid. Some of these are still open.', { task_ids: pick(open) });
    const paid = tasks.filter((t) => t.pay_status === 'paid');
    if (paid.length) throw conflict('ALREADY_PAID', 'Some of these cleans are already paid. Refresh the list and try again.', { task_ids: pick(paid) });
    const unpriced = tasks.filter((t) => t.pay_amount == null);
    if (unpriced.length) throw conflict('NO_PAY_AMOUNT', 'Some of these cleans have no pay yet. Set a rate for the cleaner, or set the pay on the clean.', { task_ids: pick(unpriced) });

    const units = new Map();
    for (const t of tasks) {
      if (!units.has(t.unit_id)) units.set(t.unit_id, { property_id: t.property_id, tasks: [] });
      units.get(t.unit_id).tasks.push(t);
    }
    const expenseByUnit = new Map();
    if (body.record_expense) {
      for (const [unitId, unit] of units) {
        const sum = unit.tasks.reduce((s, t) => s + cents(t.pay_amount), 0);
        if (!sum) continue; // an expense must be above zero
        const names = [...new Set(unit.tasks.map((t) => t.cleaner_name))].join(', ');
        const n = unit.tasks.length;
        const description = `Cleaning pay: ${names}, ${n} clean${n === 1 ? '' : 's'}`.slice(0, 300);
        const { rows: [e] } = await db.query(
          `INSERT INTO expenses (organization_id, property_id, unit_id, category, description, amount, expense_date, recorded_by)
           VALUES ($1, $2, $3, 'cleaning', $4, $5, $6, $7) RETURNING expense_id`,
          [req.user.organization_id, unit.property_id, unitId, description, money(sum), body.paid_on, req.user.user_id]);
        expenseByUnit.set(unitId, e.expense_id);
        await audit(db, req.user, 'expense.recorded', 'expense', e.expense_id, { amount: money(sum), category: 'cleaning', from: 'cleaner_pay' });
      }
    }
    for (const t of tasks) {
      await db.query(
        `UPDATE cleaning_tasks SET pay_status = 'paid', paid_on = $2, paid_method = $3, paid_reference = $4, paid_by = $5, pay_expense_id = $6
          WHERE task_id = $1`,
        [t.task_id, body.paid_on, body.method, body.reference, req.user.user_id, expenseByUnit.get(t.unit_id) || null]);
      await audit(db, req.user, 'cleaner_pay.paid', 'cleaning_task', t.task_id, { amount: t.pay_amount, method: body.method, paid_on: body.paid_on });
    }
    return {
      paid: tasks.length,
      total: money(tasks.reduce((s, t) => s + cents(t.pay_amount), 0)),
      expense_ids: [...expenseByUnit.values()],
    };
  });
  res.json(result);
}));

// Undo paid on one clean. Its cleaning expense is voided only when every clean on it is
// undone in the same request: send the other cleans (other_task_ids from the 409) in
// task_ids.
router.post('/cleaner-pay/:taskId/unpay', owners, ah(async (req, res) => {
  const taskId = uuidParam(req.params.taskId);
  const body = validate(req.body, { task_ids: { type: 'uuids', label: 'Cleans' } });
  const ids = [...new Set([taskId, ...body.task_ids])];
  const result = await tx(async (db) => {
    const params = [ids];
    const { rows: tasks } = await db.query(
      `${PAY_SELECT} WHERE t.task_id = ANY($1::uuid[]) AND ${propertyScope(req.user, params)}
        ORDER BY t.completed_at, t.task_id FOR UPDATE OF t`, params);
    if (tasks.length !== ids.length) throw notFound();
    const notPaid = tasks.filter((t) => t.pay_status !== 'paid');
    if (notPaid.length) throw conflict('NOT_PAID', 'These cleans are not marked paid, so there is nothing to undo.', { task_ids: notPaid.map((t) => t.task_id) });
    const expenseIds = [...new Set(tasks.map((t) => t.pay_expense_id).filter(Boolean))];
    if (expenseIds.length) {
      const { rows: others } = await db.query(
        `SELECT task_id FROM cleaning_tasks
          WHERE pay_expense_id = ANY($1::uuid[]) AND pay_status = 'paid' AND NOT (task_id = ANY($2::uuid[]))
          ORDER BY task_id FOR UPDATE`, [expenseIds, ids]);
      if (others.length) {
        throw conflict('EXPENSE_SHARED', `This cleaning expense also covers ${others.length} other paid clean${others.length === 1 ? '' : 's'}. Undo those at the same time.`,
          { other_task_ids: others.map((r) => r.task_id) });
      }
    }
    await db.query(
      `UPDATE cleaning_tasks SET pay_status = 'unpaid', paid_on = NULL, paid_method = NULL, paid_reference = NULL, paid_by = NULL, pay_expense_id = NULL
        WHERE task_id = ANY($1::uuid[])`, [ids]);
    const voided = [];
    for (const expenseId of expenseIds) {
      const { rowCount } = await db.query(
        `UPDATE expenses SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE expense_id = $1 AND voided_at IS NULL`,
        [expenseId, req.user.user_id, 'Cleaner pay marked unpaid']);
      if (rowCount) {
        voided.push(expenseId);
        await audit(db, req.user, 'expense.voided', 'expense', expenseId, { reason: 'Cleaner pay marked unpaid' });
      }
    }
    for (const t of tasks) await audit(db, req.user, 'cleaner_pay.unpaid', 'cleaning_task', t.task_id, { expense_id: t.pay_expense_id });
    return { unpaid: ids, voided_expense_ids: voided };
  });
  res.json(result);
}));

// ---------------------------------------------------------------- my pay (any role)
// The cleans assigned to the signed-in user or finished by them. A clean finished for
// someone else is listed, but its pay is hidden (pay_visible false) because it is not theirs.
router.get('/my-pay', ah(async (req, res) => {
  const month = req.query.month ? monthParam(req.query.month) : await currentMonth();
  const me = `user:${req.user.user_id}`;
  const params = [req.user.user_id, req.user.organization_id];
  const where = [`t.status = 'done'`, `t.organization_id = $2`, `(t.assigned_to = $1 OR t.completed_by = $1)`, inMonth(params, month)];
  const { rows } = await query(`${PAY_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.completed_at DESC`, params);
  const tasks = rows.map((r) => {
    const visible = r.cleaner_key === me;
    const hidden = { pay_amount: null, pay_status: null, paid_on: null, paid_method: null, paid_reference: null };
    return { ...taskOut(visible ? r : { ...r, ...hidden }), pay_visible: visible };
  });
  res.json({ month, tasks, totals: tally(tasks) });
}));

module.exports = router;
