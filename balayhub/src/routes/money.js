'use strict';

// Rent (charges and payments) and expenses.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { own } = require('../lib/pick');
const { validate, uuidParam, isValidDate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadLease, loadProperty, loadUnit } = require('../lib/access');
const { syncCharges, CHARGE_STATUS_CTE, LEASE_BALANCE_CTE, TODAY } = require('../lib/ledger');

const router = express.Router();
const managers = requireRole('owner', 'manager');

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'gcash', 'maya', 'check', 'other'];
const EXPENSE_CATEGORIES = ['repairs', 'utilities', 'taxes', 'insurance', 'association_dues', 'supplies', 'salaries', 'cleaning', 'other'];

function idempotencyKey(req) {
  const k = req.get('Idempotency-Key');
  if (!k) return null;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(k)) throw new HttpError(400, 'Invalid Idempotency-Key header.', { code: 'BAD_REQUEST' });
  return k;
}

function dateRange(q) {
  const from = isValidDate(q.from) ? q.from : null;
  const to = isValidDate(q.to) ? q.to : null;
  return { from, to };
}

// Amount filters: plain non-negative numbers only ("1500" or "1500.50").
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;
function amountRange(q, column, params, where) {
  if (AMOUNT_RE.test(String(q.min_amount || ''))) { params.push(q.min_amount); where.push(`${column} >= $${params.length}::numeric`); }
  if (AMOUNT_RE.test(String(q.max_amount || ''))) { params.push(q.max_amount); where.push(`${column} <= $${params.length}::numeric`); }
}

// Receipt / proof attached (files uploaded against the record), for bookkeeping.
function receiptFilter(value, type, idColumn, params, where) {
  if (value !== 'yes' && value !== 'no') return;
  params.push(type);
  where.push(`${value === 'no' ? 'NOT ' : ''}EXISTS (SELECT 1 FROM files f WHERE f.related_record_type = $${params.length} AND f.related_record_id = ${idColumn})`);
}

async function todayManila() {
  return (await one(`SELECT ${TODAY} AS d`)).d;
}

// ---------------------------------------------------------------- rent roll
// Charges with their allocated status, for the Rent screen.
router.get('/rent', ah(async (req, res) => {
  const org = req.user.organization_id;
  await syncCharges(org);
  const params = [org];
  const where = [propertyScope(req.user, params)];
  const status = req.query.status;
  if (status === 'outstanding') where.push(`c.status <> 'paid'`);
  // Partly paid: some money applied and a balance left, overdue or not (the Partial chip and the card agree).
  else if (status === 'partial') where.push(`c.amount_applied > 0 AND c.balance > 0`);
  else if (['paid', 'unpaid', 'overdue'].includes(status)) { params.push(status); where.push(`c.status = $${params.length}`); }
  if (req.query.property_id) { params.push(uuidParam(req.query.property_id)); where.push(`p.property_id = $${params.length}`); }
  if (req.query.unit_id) { params.push(uuidParam(req.query.unit_id)); where.push(`u.unit_id = $${params.length}`); }
  if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month) && isValidDate(`${req.query.month}-01`)) { params.push(`${req.query.month}-01`); where.push(`c.period = $${params.length}::date`); }
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(t.full_name ILIKE $${params.length} OR u.unit_name ILIKE $${params.length} OR p.property_name ILIKE $${params.length})`);
  }
  // Current tenants vs. people who have moved out but still owe.
  if (req.query.lease === 'current') where.push(`l.lease_status = 'active'`);
  if (req.query.lease === 'former') where.push(`l.lease_status <> 'active'`);
  // "Late by more than N days" for collections follow-up.
  if (['7', '30', '60', '90'].includes(req.query.late)) {
    params.push(Number(req.query.late));
    where.push(`c.status = 'overdue' AND c.due_date < ${TODAY} - $${params.length}::int`);
  }
  if (AMOUNT_RE.test(String(req.query.min_amount || ''))) { params.push(req.query.min_amount); where.push(`c.balance >= $${params.length}::numeric`); }
  const SORTS = {
    due: `(c.status = 'overdue') DESC, c.due_date DESC, t.full_name`,
    due_asc: 'c.due_date, t.full_name',
    amount: 'c.balance DESC, c.due_date',
    rent: 'c.amount_due DESC, c.due_date DESC',
    tenant: 't.full_name, c.due_date DESC',
    unit: 'p.property_name, u.unit_name, c.due_date DESC',
  };
  const { rows } = await query(
    `WITH ${CHARGE_STATUS_CTE}
     SELECT c.*, l.tenant_id, t.full_name AS tenant_name, t.status AS tenant_status, u.unit_id, u.unit_name, p.property_id, p.property_name, l.lease_status
       FROM charges c
       JOIN leases l ON l.lease_id = c.lease_id
       JOIN tenants t ON t.tenant_id = l.tenant_id
       JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${own(SORTS, req.query.sort) || SORTS.due}
      LIMIT 500`, params);
  // Totals cover everything unpaid (all months), narrowed to the chosen property.
  const totalParams = [org];
  let totalScope = propertyScope(req.user, totalParams);
  if (req.query.property_id) { totalParams.push(uuidParam(req.query.property_id)); totalScope += ` AND p.property_id = $${totalParams.length}`; }
  const { rows: [totals] } = await query(
    `WITH ${CHARGE_STATUS_CTE}
     SELECT COALESCE(SUM(c.balance), 0)::numeric(12,2) AS outstanding,
            COALESCE(SUM(c.balance) FILTER (WHERE c.status = 'overdue'), 0)::numeric(12,2) AS overdue,
            COUNT(*) FILTER (WHERE c.status = 'overdue') AS overdue_count,
            COUNT(*) FILTER (WHERE c.amount_applied > 0 AND c.balance > 0) AS partial_count,
            COUNT(*) FILTER (WHERE c.status = 'unpaid') AS unpaid_count
       FROM charges c
       JOIN leases l ON l.lease_id = c.lease_id
       JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE ${totalScope}`, totalParams);
  res.json({ charges: rows, totals });
}));

// Leases that can receive a payment (for the Record Payment form).
router.get('/rent/leases', ah(async (req, res) => {
  const org = req.user.organization_id;
  await syncCharges(org);
  const params = [org];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `WITH ${LEASE_BALANCE_CTE}
     SELECT l.lease_id, l.lease_status, l.monthly_rent, t.tenant_id, t.full_name AS tenant_name, t.status AS tenant_status, u.unit_name, p.property_name,
            lb.outstanding, lb.overdue, lb.credit,
            -- The month a payment goes to first: payments are applied oldest charge first (ledger.js).
            (SELECT MIN(c.period) FROM charges c WHERE c.lease_id = l.lease_id AND c.balance > 0) AS oldest_unpaid_period
       FROM leases l
       JOIN lease_balance lb ON lb.lease_id = l.lease_id
       JOIN tenants t ON t.tenant_id = l.tenant_id
       JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND (l.lease_status = 'active' OR lb.outstanding > 0)
      ORDER BY t.full_name`, params);
  res.json({ leases: rows });
}));

// ---------------------------------------------------------------- payments
router.get('/payments', ah(async (req, res) => {
  const params = [];
  const where = [propertyScope(req.user, params)];
  const { from, to } = dateRange(req.query);
  if (from) { params.push(from); where.push(`pm.payment_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`pm.payment_date <= $${params.length}`); }
  if (req.query.property_id) { params.push(uuidParam(req.query.property_id)); where.push(`p.property_id = $${params.length}`); }
  if (req.query.unit_id) { params.push(uuidParam(req.query.unit_id)); where.push(`u.unit_id = $${params.length}`); }
  if (req.query.tenant_id) { params.push(uuidParam(req.query.tenant_id)); where.push(`t.tenant_id = $${params.length}`); }
  if (PAYMENT_METHODS.includes(req.query.method)) { params.push(req.query.method); where.push(`pm.payment_method = $${params.length}`); }
  // include_voided: '1' shows voided entries too, 'only' shows just the voided ones.
  if (req.query.include_voided === 'only') where.push('pm.voided_at IS NOT NULL');
  else if (req.query.include_voided !== '1') where.push('pm.voided_at IS NULL');
  amountRange(req.query, 'pm.amount_paid', params, where);
  receiptFilter(req.query.receipt, 'payment', 'pm.payment_id', params, where);
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    const n = params.length;
    where.push(`(t.full_name ILIKE $${n} OR u.unit_name ILIKE $${n} OR p.property_name ILIKE $${n} OR pm.reference_number ILIKE $${n} OR pm.notes ILIKE $${n})`);
  }
  const SORTS = {
    date: 'pm.payment_date DESC, pm.created_at DESC',
    date_asc: 'pm.payment_date, pm.created_at',
    amount: 'pm.amount_paid DESC, pm.payment_date DESC',
    amount_asc: 'pm.amount_paid, pm.payment_date DESC',
    tenant: 't.full_name, pm.payment_date DESC',
  };
  const { rows } = await query(
    `SELECT pm.*, t.tenant_id, t.full_name AS tenant_name, u.unit_id, u.unit_name, p.property_id, p.property_name,
            ru.full_name AS recorded_by_name
       FROM payments pm
       JOIN leases l ON l.lease_id = pm.lease_id
       JOIN tenants t ON t.tenant_id = l.tenant_id
       JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
       JOIN users ru ON ru.user_id = pm.recorded_by
      WHERE ${where.join(' AND ')}
      ORDER BY ${own(SORTS, req.query.sort) || SORTS.date} LIMIT 500`, params);
  res.json({ payments: rows });
}));

async function loadPayment(user, id) {
  const params = [id];
  const row = await one(
    `SELECT pm.*, t.tenant_id, t.full_name AS tenant_name, u.unit_name, p.property_id, p.property_name,
            ru.full_name AS recorded_by_name, vu.full_name AS voided_by_name
       FROM payments pm
       JOIN leases l ON l.lease_id = pm.lease_id
       JOIN tenants t ON t.tenant_id = l.tenant_id
       JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
       JOIN users ru ON ru.user_id = pm.recorded_by
       LEFT JOIN users vu ON vu.user_id = pm.voided_by
      WHERE pm.payment_id = $1 AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

router.get('/payments/:id', ah(async (req, res) => {
  const payment = await loadPayment(req.user, uuidParam(req.params.id));
  const { rows: files } = await query(
    `SELECT file_id, file_name, mime_type, size_bytes, uploaded_at FROM files
      WHERE related_record_type = 'payment' AND related_record_id = $1 AND organization_id = $2`,
    [payment.payment_id, req.user.organization_id]);
  res.json({ payment, files });
}));

router.post('/payments', ah(async (req, res) => {
  const body = validate(req.body, {
    lease_id: { type: 'uuid', required: true, label: 'Tenant / lease' },
    amount_paid: { type: 'money', required: true, positive: true, label: 'Amount paid' },
    payment_date: { type: 'date', required: true, label: 'Payment date' },
    payment_method: { type: 'enum', values: PAYMENT_METHODS, required: true, label: 'Payment method' },
    reference_number: { type: 'string', max: 100, label: 'Reference number' },
    notes: { type: 'text', max: 500, label: 'Notes' },
    confirm_over: { type: 'bool' },
  });
  const key = idempotencyKey(req);
  const org = req.user.organization_id;
  if (body.payment_date > await todayManila()) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { payment_date: 'Payment date cannot be in the future.' } });
  }
  if (key) {
    const existing = await one('SELECT payment_id FROM payments WHERE organization_id = $1 AND idempotency_key = $2', [org, key]);
    if (existing) return res.status(200).json({ payment: await loadPayment(req.user, existing.payment_id), duplicate: true });
  }
  const lease = await loadLease(req.user, body.lease_id);
  if (lease.lease_status === 'cancelled') throw new HttpError(409, 'This lease was cancelled. Payments cannot be recorded on it.', { code: 'LEASE_CANCELLED' });
  // Paying more than the tenant owes is allowed (it becomes advance credit), but only when the request says it was meant.
  if (!body.confirm_over) {
    await syncCharges(org);
    const { rows: [b] } = await query(
      `WITH ${LEASE_BALANCE_CTE} SELECT outstanding, total_paid, total_charged FROM lease_balance WHERE lease_id = $2`, [org, lease.lease_id]);
    const owed = Math.max(0, Math.round(Number(b.outstanding) * 100));
    const amount = Math.round(Number(body.amount_paid) * 100);
    if (amount > owed) {
      const credit = Math.max(0, Math.round((Number(b.total_paid) - Number(b.total_charged)) * 100) + amount);
      const fmt = (c) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      throw new HttpError(409, `This is ${fmt(amount - owed)} more than the ${fmt(owed)} owed. Confirm to record it; ${fmt(credit)} becomes advance credit.`,
        { code: 'PAYMENT_OVER_BALANCE', owed: (owed / 100).toFixed(2), credit_after: (credit / 100).toFixed(2) });
    }
  }
  let paymentId;
  try {
    paymentId = await tx(async (db) => {
      const { rows: [p] } = await db.query(
        `INSERT INTO payments (organization_id, lease_id, amount_paid, payment_date, payment_method, reference_number, notes, recorded_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING payment_id`,
        [org, lease.lease_id, body.amount_paid, body.payment_date, body.payment_method, body.reference_number, body.notes, req.user.user_id, key]);
      await audit(db, req.user, 'payment.recorded', 'payment', p.payment_id, {
        lease_id: lease.lease_id, tenant: lease.tenant_name, amount: body.amount_paid, method: body.payment_method });
      return p.payment_id;
    });
  } catch (err) {
    if (err.constraint === 'payments_idem_uq') {
      const existing = await one('SELECT payment_id FROM payments WHERE organization_id = $1 AND idempotency_key = $2', [org, key]);
      return res.status(200).json({ payment: await loadPayment(req.user, existing.payment_id), duplicate: true });
    }
    throw err;
  }
  await syncCharges(org);
  const { rows: [balance] } = await query(
    `WITH ${LEASE_BALANCE_CTE} SELECT * FROM lease_balance WHERE lease_id = $2`, [org, lease.lease_id]);
  res.status(201).json({ payment: await loadPayment(req.user, paymentId), balance });
}));

// Payments are never edited or deleted; a mistaken entry is voided with a reason.
router.post('/payments/:id/void', managers, ah(async (req, res) => {
  const payment = await loadPayment(req.user, uuidParam(req.params.id));
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 500, label: 'Reason' } });
  if (payment.voided_at) throw new HttpError(409, 'This payment is already voided.', { code: 'ALREADY_VOIDED' });
  await tx(async (db) => {
    await db.query(`UPDATE payments SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE payment_id = $1`,
      [payment.payment_id, req.user.user_id, reason]);
    await audit(db, req.user, 'payment.voided', 'payment', payment.payment_id, { amount: payment.amount_paid, reason });
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- expenses
const expenseSpec = {
  property_id: { type: 'uuid', required: true, label: 'Property' },
  unit_id: { type: 'uuid', label: 'Unit' },
  category: { type: 'enum', values: EXPENSE_CATEGORIES, required: true, label: 'Category' },
  description: { type: 'string', max: 300, label: 'Description' },
  amount: { type: 'money', required: true, positive: true, label: 'Amount' },
  expense_date: { type: 'date', required: true, label: 'Expense date' },
  vendor_name: { type: 'string', max: 120, label: 'Vendor / paid to' },
};

// An expense's idempotency key is an internal retry token: no response carries it.
const withoutIdemKey = ({ idempotency_key: idem, ...expense }) => expense;

async function loadExpense(user, id) {
  const params = [id];
  const row = await one(
    `SELECT e.*, p.property_name, u.unit_name, ru.full_name AS recorded_by_name
       FROM expenses e
       JOIN properties p ON p.property_id = e.property_id
       LEFT JOIN units u ON u.unit_id = e.unit_id
       JOIN users ru ON ru.user_id = e.recorded_by
      WHERE e.expense_id = $1 AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return withoutIdemKey(row);
}

async function checkExpenseTargets(user, body) {
  await loadProperty(user, body.property_id);
  if (body.unit_id) {
    const unit = await loadUnit(user, body.unit_id);
    if (unit.property_id !== body.property_id) {
      throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { unit_id: 'This unit belongs to a different property.' } });
    }
  }
}

// Adding and correcting an expense both refuse a future date, the same as payments.
async function refuseFutureExpenseDate(expenseDate) {
  if (expenseDate > await todayManila()) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { expense_date: 'Expense date cannot be in the future.' } });
  }
}

async function createExpense(req, body, maintenanceRequestId = null) {
  const key = idempotencyKey(req);
  const org = req.user.organization_id;
  await refuseFutureExpenseDate(body.expense_date);
  if (key) {
    const existing = await one('SELECT expense_id FROM expenses WHERE organization_id = $1 AND idempotency_key = $2', [org, key]);
    if (existing) return { expense: await loadExpense(req.user, existing.expense_id), duplicate: true };
  }
  try {
    const id = await tx(async (db) => {
      const { rows: [e] } = await db.query(
        `INSERT INTO expenses (organization_id, property_id, unit_id, maintenance_request_id, category, description, amount, expense_date, vendor_name, recorded_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING expense_id`,
        [org, body.property_id, body.unit_id, maintenanceRequestId, body.category, body.description, body.amount,
          body.expense_date, body.vendor_name, req.user.user_id, key]);
      await audit(db, req.user, 'expense.recorded', 'expense', e.expense_id, { amount: body.amount, category: body.category, maintenance_request_id: maintenanceRequestId });
      return e.expense_id;
    });
    return { expense: await loadExpense(req.user, id), duplicate: false };
  } catch (err) {
    if (err.constraint === 'expenses_idem_uq') {
      const existing = await one('SELECT expense_id FROM expenses WHERE organization_id = $1 AND idempotency_key = $2', [org, key]);
      return { expense: await loadExpense(req.user, existing.expense_id), duplicate: true };
    }
    throw err;
  }
}

router.get('/expenses', ah(async (req, res) => {
  const params = [];
  const where = [propertyScope(req.user, params)];
  const { from, to } = dateRange(req.query);
  if (from) { params.push(from); where.push(`e.expense_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`e.expense_date <= $${params.length}`); }
  if (req.query.property_id) { params.push(uuidParam(req.query.property_id)); where.push(`p.property_id = $${params.length}`); }
  if (req.query.unit_id === 'none') where.push('e.unit_id IS NULL');
  else if (req.query.unit_id) { params.push(uuidParam(req.query.unit_id)); where.push(`e.unit_id = $${params.length}`); }
  if (EXPENSE_CATEGORIES.includes(req.query.category)) { params.push(req.query.category); where.push(`e.category = $${params.length}`); }
  if (req.query.include_voided === 'only') where.push('e.voided_at IS NOT NULL');
  else if (req.query.include_voided !== '1') where.push('e.voided_at IS NULL');
  if (req.query.vendor) { params.push(`%${String(req.query.vendor).slice(0, 120).replace(/[%_\\]/g, '\\$&')}%`); where.push(`e.vendor_name ILIKE $${params.length}`); }
  if (req.query.source === 'maintenance') where.push('e.maintenance_request_id IS NOT NULL');
  if (req.query.source === 'direct') where.push('e.maintenance_request_id IS NULL');
  amountRange(req.query, 'e.amount', params, where);
  receiptFilter(req.query.receipt, 'expense', 'e.expense_id', params, where);
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(e.description ILIKE $${params.length} OR e.vendor_name ILIKE $${params.length} OR p.property_name ILIKE $${params.length})`);
  }
  const SORTS = {
    date: 'e.expense_date DESC, e.created_at DESC',
    date_asc: 'e.expense_date, e.created_at',
    amount: 'e.amount DESC, e.expense_date DESC',
    amount_asc: 'e.amount, e.expense_date DESC',
    category: 'e.category, e.expense_date DESC',
  };
  const { rows } = await query(
    `SELECT e.*, p.property_name, u.unit_name, ru.full_name AS recorded_by_name
       FROM expenses e
       JOIN properties p ON p.property_id = e.property_id
       LEFT JOIN units u ON u.unit_id = e.unit_id
       JOIN users ru ON ru.user_id = e.recorded_by
      WHERE ${where.join(' AND ')}
      ORDER BY ${own(SORTS, req.query.sort) || SORTS.date} LIMIT 500`, params);
  res.json({ expenses: rows.map(withoutIdemKey) });
}));

router.get('/expenses/:id', ah(async (req, res) => {
  const expense = await loadExpense(req.user, uuidParam(req.params.id));
  const { rows: files } = await query(
    `SELECT file_id, file_name, mime_type, size_bytes, uploaded_at FROM files
      WHERE related_record_type = 'expense' AND related_record_id = $1 AND organization_id = $2`,
    [expense.expense_id, req.user.organization_id]);
  res.json({ expense, files });
}));

router.post('/expenses', ah(async (req, res) => {
  const body = validate(req.body, expenseSpec);
  await checkExpenseTargets(req.user, body);
  const result = await createExpense(req, body);
  res.status(result.duplicate ? 200 : 201).json(result);
}));

router.patch('/expenses/:id', managers, ah(async (req, res) => {
  const expense = await loadExpense(req.user, uuidParam(req.params.id));
  if (expense.voided_at) throw new HttpError(409, 'Voided expenses cannot be edited.', { code: 'ALREADY_VOIDED' });
  const body = validate(req.body, expenseSpec, { partial: true });
  const merged = { ...expense, ...body };
  await checkExpenseTargets(req.user, merged);
  if (body.expense_date) await refuseFutureExpenseDate(body.expense_date);
  const keys = Object.keys(body);
  if (!keys.length) return res.json({ expense });
  await tx(async (db) => {
    await db.query(`UPDATE expenses SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE expense_id = $1`,
      [expense.expense_id, ...keys.map((k) => body[k])]);
    await audit(db, req.user, 'expense.corrected', 'expense', expense.expense_id, {
      before: Object.fromEntries(keys.map((k) => [k, expense[k]])), after: body });
  });
  res.json({ expense: await loadExpense(req.user, expense.expense_id) });
}));

router.post('/expenses/:id/void', managers, ah(async (req, res) => {
  const expense = await loadExpense(req.user, uuidParam(req.params.id));
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 500, label: 'Reason' } });
  if (expense.voided_at) throw new HttpError(409, 'This expense is already voided.', { code: 'ALREADY_VOIDED' });
  await tx(async (db) => {
    await db.query(`UPDATE expenses SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE expense_id = $1`,
      [expense.expense_id, req.user.user_id, reason]);
    await audit(db, req.user, 'expense.voided', 'expense', expense.expense_id, { amount: expense.amount, reason });
  });
  res.json({ ok: true });
}));

module.exports = router;
module.exports.createExpense = createExpense;
module.exports.expenseSpec = expenseSpec;
module.exports.loadPayment = loadPayment;
module.exports.loadExpense = loadExpense;
