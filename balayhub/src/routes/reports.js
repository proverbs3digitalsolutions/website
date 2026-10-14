'use strict';

// Dashboard and financial reports. Every figure is computed from saved
// leases, charges, payments and expenses at request time.

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah } = require('../lib/http');
const { isValidDate, UUID_RE } = require('../lib/validate');
const { propertyScope } = require('../lib/access');
const { syncCharges, CHARGE_STATUS_CTE, LEASE_BALANCE_CTE, TODAY } = require('../lib/ledger');

const router = express.Router();

router.get('/dashboard', ah(async (req, res) => {
  const user = req.user;
  const org = user.organization_id;
  await syncCharges(org);
  const { today, month_start: monthStart } = await one(
    `SELECT ${TODAY} AS today, date_trunc('month', ${TODAY})::date AS month_start`);

  let params = [];
  let scope = propertyScope(user, params);
  const portfolio = await one(
    `SELECT COUNT(DISTINCT p.property_id) AS properties,
            COUNT(u.unit_id) AS units,
            COUNT(u.unit_id) FILTER (WHERE l.lease_id IS NOT NULL) AS occupied,
            COUNT(u.unit_id) FILTER (WHERE l.lease_id IS NULL AND u.availability = 'available') AS vacant,
            COUNT(u.unit_id) FILTER (WHERE l.lease_id IS NULL AND u.availability = 'unavailable') AS unavailable
       FROM properties p
       LEFT JOIN units u ON u.property_id = p.property_id AND u.status = 'active'
       LEFT JOIN leases l ON l.unit_id = u.unit_id AND l.lease_status = 'active'
      WHERE ${scope} AND p.status = 'active'`, params);

  params = [monthStart, today];
  scope = propertyScope(user, params);
  const collected = await one(
    `SELECT COALESCE(SUM(pm.amount_paid), 0)::numeric(12,2) AS amount, COUNT(*) AS count
       FROM payments pm JOIN leases l ON l.lease_id = pm.lease_id
       JOIN units u ON u.unit_id = l.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND pm.voided_at IS NULL AND pm.payment_date BETWEEN $1 AND $2`, params);

  params = [monthStart, today];
  scope = propertyScope(user, params);
  const expenses = await one(
    `SELECT COALESCE(SUM(e.amount), 0)::numeric(12,2) AS amount
       FROM expenses e JOIN properties p ON p.property_id = e.property_id
      WHERE ${scope} AND e.voided_at IS NULL AND e.expense_date BETWEEN $1 AND $2`, params);

  params = [org];
  scope = propertyScope(user, params);
  const { rows: leaseRows } = await query(
    `WITH ${LEASE_BALANCE_CTE}
     SELECT lb.*, l.lease_status, t.tenant_id, t.full_name AS tenant_name, t.status AS tenant_status, u.unit_name, p.property_id, p.property_name,
            (SELECT MIN(c.due_date) FROM charges c WHERE c.lease_id = l.lease_id AND c.status = 'overdue') AS oldest_overdue
       FROM lease_balance lb
       JOIN leases l ON l.lease_id = lb.lease_id
       JOIN tenants t ON t.tenant_id = l.tenant_id
       JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND lb.outstanding > 0
      ORDER BY lb.overdue DESC, lb.outstanding DESC`, params);
  const sum = (rows, k) => rows.reduce((acc, r) => acc + Math.round(Number(r[k]) * 100), 0) / 100;

  // This month's rent status per lease (Paid / Partial / Unpaid / Overdue).
  params = [org, monthStart];
  scope = propertyScope(user, params);
  const { rows: thisMonth } = await query(
    `WITH ${CHARGE_STATUS_CTE}
     SELECT c.charge_id, c.lease_id, c.due_date, c.amount_due, c.amount_applied, c.balance, c.status,
            t.tenant_id, t.full_name AS tenant_name, u.unit_name, p.property_name
       FROM charges c
       JOIN leases l ON l.lease_id = c.lease_id
       JOIN tenants t ON t.tenant_id = l.tenant_id
       JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND c.period = $2
      ORDER BY array_position(ARRAY['overdue','partial','unpaid','paid'], c.status), c.due_date, t.full_name
      LIMIT 8`, params);

  params = [];
  scope = propertyScope(user, params);
  const { rows: recentPayments } = await query(
    `SELECT pm.payment_id, pm.amount_paid, pm.payment_date, pm.payment_method, t.tenant_id, t.full_name AS tenant_name,
            u.unit_name, p.property_name
       FROM payments pm JOIN leases l ON l.lease_id = pm.lease_id JOIN tenants t ON t.tenant_id = l.tenant_id
       JOIN units u ON u.unit_id = l.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND pm.voided_at IS NULL
      ORDER BY pm.payment_date DESC, pm.created_at DESC LIMIT 5`, params);

  params = [];
  scope = propertyScope(user, params);
  const { rows: expiring } = await query(
    `SELECT l.lease_id, l.end_date, t.tenant_id, t.full_name AS tenant_name, u.unit_name, p.property_name
       FROM leases l JOIN units u ON u.unit_id = l.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN tenants t ON t.tenant_id = l.tenant_id
      WHERE ${scope} AND l.lease_status = 'active' AND l.end_date IS NOT NULL AND l.end_date <= ${TODAY} + 30
      ORDER BY l.end_date LIMIT 5`, params);

  params = [];
  scope = propertyScope(user, params);
  const { rows: maintenance } = await query(
    `SELECT m.request_id, m.title, m.priority, m.status, m.created_at, p.property_name, u.unit_name
       FROM maintenance_requests m JOIN properties p ON p.property_id = m.property_id
       LEFT JOIN units u ON u.unit_id = m.unit_id
      WHERE ${scope} AND m.status IN ('open', 'in_progress')
      ORDER BY array_position(ARRAY['urgent','high','medium','low'], m.priority), m.created_at
      LIMIT 5`, params);
  params = [];
  scope = propertyScope(user, params);
  const openMaintenance = await one(
    `SELECT COUNT(*) AS n FROM maintenance_requests m JOIN properties p ON p.property_id = m.property_id
      WHERE ${scope} AND m.status IN ('open', 'in_progress')`, params);

  const tenantsCount = await one('SELECT COUNT(*) AS n FROM tenants WHERE organization_id = $1 AND status = $2', [org, 'active']);

  res.json({
    today,
    month_start: monthStart,
    portfolio,
    collected_this_month: collected.amount,
    payments_this_month: collected.count,
    expenses_this_month: expenses.amount,
    outstanding: sum(leaseRows, 'outstanding').toFixed(2),
    overdue: sum(leaseRows, 'overdue').toFixed(2),
    overdue_tenants: leaseRows.filter((r) => Number(r.overdue) > 0).slice(0, 5),
    overdue_tenant_count: leaseRows.filter((r) => Number(r.overdue) > 0).length,
    rent_this_month: thisMonth,
    recent_payments: recentPayments,
    expiring_leases: expiring,
    open_maintenance: maintenance,
    open_maintenance_count: openMaintenance.n,
    has_tenants: tenantsCount.n > 0,
  });
}));

// ---------------------------------------------------------------- reports
function range(q) {
  const from = isValidDate(q.from) ? q.from : null;
  const to = isValidDate(q.to) ? q.to : null;
  if (!from || !to) throw new HttpError(400, 'Choose a valid start and end date.', { code: 'VALIDATION', fields: { from: 'Required', to: 'Required' } });
  if (from > to) throw new HttpError(400, 'The start date must be before the end date.', { code: 'VALIDATION', fields: { from: 'Must be before end date' } });
  return { from, to };
}

const PROPERTY_TYPES = ['apartment', 'boarding_house', 'condominium', 'house', 'commercial', 'dormitory', 'other'];

// Report filters from the query string: one property, or every property of one type.
function reportFilters(q) {
  return {
    propertyId: UUID_RE.test(q.property_id || '') ? q.property_id : null,
    propertyType: PROPERTY_TYPES.includes(q.property_type) ? q.property_type : null,
  };
}

async function buildReport(user, from, to, propertyId, propertyType = null) {
  const org = user.organization_id;
  await syncCharges(org);
  const filter = (params) => {
    let s = propertyScope(user, params);
    if (propertyId) { params.push(propertyId); s += ` AND p.property_id = $${params.length}`; }
    if (propertyType) { params.push(propertyType); s += ` AND p.property_type = $${params.length}`; }
    return s;
  };

  let params = [org, from, to];
  const { rows: byProperty } = await query(
    `WITH ${LEASE_BALANCE_CTE},
     pay AS (SELECT u.property_id, SUM(pm.amount_paid) AS amt FROM payments pm JOIN leases l ON l.lease_id = pm.lease_id
              JOIN units u ON u.unit_id = l.unit_id
             WHERE pm.organization_id = $1 AND pm.voided_at IS NULL AND pm.payment_date BETWEEN $2 AND $3 GROUP BY u.property_id),
     exp AS (SELECT e.property_id, SUM(e.amount) AS amt FROM expenses e
             WHERE e.organization_id = $1 AND e.voided_at IS NULL AND e.expense_date BETWEEN $2 AND $3 GROUP BY e.property_id),
     billed AS (SELECT u.property_id, SUM(c.amount_due) AS amt FROM charges c JOIN leases l ON l.lease_id = c.lease_id
                JOIN units u ON u.unit_id = l.unit_id WHERE c.due_date BETWEEN $2 AND $3 GROUP BY u.property_id),
     owed AS (SELECT u.property_id, SUM(lb.outstanding) AS amt, SUM(lb.overdue) AS overdue FROM lease_balance lb
              JOIN leases l ON l.lease_id = lb.lease_id JOIN units u ON u.unit_id = l.unit_id GROUP BY u.property_id),
     occ AS (SELECT u.property_id, COUNT(*) AS units, COUNT(l.lease_id) AS occupied FROM units u
             LEFT JOIN leases l ON l.unit_id = u.unit_id AND l.lease_status = 'active'
             WHERE u.status = 'active' GROUP BY u.property_id)
     SELECT p.property_id, p.property_name, p.status,
            COALESCE(occ.units, 0) AS units, COALESCE(occ.occupied, 0) AS occupied,
            COALESCE(billed.amt, 0)::numeric(12,2) AS billed,
            COALESCE(pay.amt, 0)::numeric(12,2) AS collected,
            COALESCE(exp.amt, 0)::numeric(12,2) AS expenses,
            (COALESCE(pay.amt, 0) - COALESCE(exp.amt, 0))::numeric(12,2) AS net,
            COALESCE(owed.amt, 0)::numeric(12,2) AS outstanding,
            COALESCE(owed.overdue, 0)::numeric(12,2) AS overdue
       FROM properties p
       LEFT JOIN pay ON pay.property_id = p.property_id
       LEFT JOIN exp ON exp.property_id = p.property_id
       LEFT JOIN billed ON billed.property_id = p.property_id
       LEFT JOIN owed ON owed.property_id = p.property_id
       LEFT JOIN occ ON occ.property_id = p.property_id
      WHERE ${filter(params)}
        AND (p.status = 'active' OR pay.amt IS NOT NULL OR exp.amt IS NOT NULL OR owed.amt > 0)
      ORDER BY net DESC, p.property_name`, params);

  params = [from, to];
  const { rows: byCategory } = await query(
    `SELECT e.category, SUM(e.amount)::numeric(12,2) AS amount, COUNT(*) AS count
       FROM expenses e JOIN properties p ON p.property_id = e.property_id
      WHERE ${filter(params)} AND e.voided_at IS NULL AND e.expense_date BETWEEN $1 AND $2
      GROUP BY e.category ORDER BY amount DESC`, params);

  params = [from, to];
  const { rows: monthly } = await query(
    `WITH months AS (SELECT generate_series(date_trunc('month', $1::date), date_trunc('month', $2::date), interval '1 month')::date AS m),
     pay AS (SELECT date_trunc('month', pm.payment_date)::date AS m, SUM(pm.amount_paid) AS amt
               FROM payments pm JOIN leases l ON l.lease_id = pm.lease_id JOIN units u ON u.unit_id = l.unit_id
               JOIN properties p ON p.property_id = u.property_id
              WHERE ${filter(params)} AND pm.voided_at IS NULL AND pm.payment_date BETWEEN $1 AND $2 GROUP BY 1),
     exp AS (SELECT date_trunc('month', e.expense_date)::date AS m, SUM(e.amount) AS amt
               FROM expenses e JOIN properties p ON p.property_id = e.property_id
              WHERE ${filter(params)} AND e.voided_at IS NULL AND e.expense_date BETWEEN $1 AND $2 GROUP BY 1)
     SELECT months.m AS month, COALESCE(pay.amt, 0)::numeric(12,2) AS collected, COALESCE(exp.amt, 0)::numeric(12,2) AS expenses,
            (COALESCE(pay.amt, 0) - COALESCE(exp.amt, 0))::numeric(12,2) AS net
       FROM months LEFT JOIN pay USING (m) LEFT JOIN exp USING (m) ORDER BY months.m`, params);

  params = [org];
  const { rows: outstanding } = await query(
    `WITH ${LEASE_BALANCE_CTE}
     SELECT t.tenant_id, t.full_name AS tenant_name, t.status AS tenant_status, u.unit_name, p.property_name, l.lease_status,
            lb.outstanding, lb.overdue,
            (SELECT MIN(c.due_date) FROM charges c WHERE c.lease_id = l.lease_id AND c.status = 'overdue') AS oldest_overdue
       FROM lease_balance lb JOIN leases l ON l.lease_id = lb.lease_id
       JOIN tenants t ON t.tenant_id = l.tenant_id JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE ${filter(params)} AND lb.outstanding > 0
      ORDER BY lb.overdue DESC, lb.outstanding DESC`, params);

  const cents = (rows, k) => rows.reduce((a, r) => a + Math.round(Number(r[k]) * 100), 0);
  const fmt = (c) => (c / 100).toFixed(2);
  const totals = {
    billed: fmt(cents(byProperty, 'billed')),
    collected: fmt(cents(byProperty, 'collected')),
    expenses: fmt(cents(byProperty, 'expenses')),
    net: fmt(cents(byProperty, 'collected') - cents(byProperty, 'expenses')),
    outstanding: fmt(cents(outstanding, 'outstanding')),
    overdue: fmt(cents(outstanding, 'overdue')),
  };
  return { from, to, totals, by_property: byProperty, by_category: byCategory, monthly, outstanding };
}

router.get('/reports', ah(async (req, res) => {
  const { from, to } = range(req.query);
  const { propertyId, propertyType } = reportFilters(req.query);
  res.json(await buildReport(req.user, from, to, propertyId, propertyType));
}));

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvRows = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

// The names the reports screen shows for each expense category (LABELS in public/js/ui.js). Keep them in step.
const EXPENSE_CATEGORY_LABELS = {
  repairs: 'Repairs & maintenance', utilities: 'Utilities', taxes: 'Taxes & permits', insurance: 'Insurance',
  association_dues: 'Association dues', supplies: 'Supplies', salaries: 'Salaries & caretaker', cleaning: 'Cleaning', other: 'Other',
};

router.get('/reports/export', ah(async (req, res) => {
  const { from, to } = range(req.query);
  const { propertyId, propertyType } = reportFilters(req.query);
  const r = await buildReport(req.user, from, to, propertyId, propertyType);
  const lines = [
    ['BalayHub financial report'], ['Workspace', req.user.organization_name], ['Period', `${from} to ${to}`],
    ['Generated', new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })], ['Currency', 'PHP'], [],
    ['Summary'], ['Rent billed', r.totals.billed], ['Rent collected', r.totals.collected], ['Expenses', r.totals.expenses],
    ['Net operating result (collected - expenses)', r.totals.net], ['Outstanding rent (as of today)', r.totals.outstanding],
    ['Overdue rent (as of today)', r.totals.overdue], [],
    ['By property'], ['Property', 'Units', 'Occupied', 'Billed', 'Collected', 'Expenses', 'Net', 'Outstanding', 'Overdue'],
    ...r.by_property.map((p) => [p.property_name, p.units, p.occupied, p.billed, p.collected, p.expenses, p.net, p.outstanding, p.overdue]),
    [], ['By month'], ['Month', 'Collected', 'Expenses', 'Net'],
    ...r.monthly.map((m) => [m.month.slice(0, 7), m.collected, m.expenses, m.net]),
    [], ['Expenses by category'], ['Category', 'Amount', 'Entries'],
    ...r.by_category.map((c) => [EXPENSE_CATEGORY_LABELS[c.category] || c.category, c.amount, c.count]),
    [], ['Outstanding balances'], ['Tenant', 'Property', 'Unit', 'Outstanding', 'Overdue', 'Oldest overdue due date'],
    ...r.outstanding.map((o) => [o.tenant_name, o.property_name, o.unit_name, o.outstanding, o.overdue, o.oldest_overdue]),
  ];
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="balayhub-report-${from}-to-${to}.csv"`);
  res.send(`﻿${csvRows(lines)}\r\n`);
}));

module.exports = router;
