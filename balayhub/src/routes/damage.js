'use strict';

// Damage reports. Anyone who works a cleaning task, or can see a stay or unit,
// can log damage with an optional estimate and photos. Owners and managers then
// charge it to the guest's bill, mark it to deduct from the security deposit, or
// waive it. Cleaners only ever see the report they filed, never the resolution.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, forbidden, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadUnit } = require('../lib/access');
const { isCleaner } = require('../lib/cleaner');
const { closeOpenCheckouts } = require('./balancepay');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const STATUSES = ['open', 'charged', 'deducted', 'waived'];
const DAMAGE_SPEC = {
  description: { type: 'text', required: true, max: 1000, label: 'What happened' },
  estimated_cost: { type: 'money', label: 'Estimated cost' },
};

const notCleaner = (req, res, next) => (isCleaner(req.user) ? next(forbidden('Cleaners report damage from their cleaning job.')) : next());
const alreadyResolved = () => new HttpError(409, 'This damage report has already been resolved.', { code: 'ALREADY_RESOLVED' });
const noStay = (what) => new HttpError(409, `This damage report isn't linked to a stay, so ${what}.`, { code: 'NO_STAY' });

const REPORT_SELECT = `
  SELECT r.report_id, r.unit_id, r.booking_id, r.task_id, r.description, r.estimated_cost, r.status, r.charge_id,
         r.resolution_note, r.created_at, r.resolved_at, u.unit_name, p.property_name,
         rb.full_name AS reported_by_name, vb.full_name AS resolved_by_name,
         (SELECT COUNT(*) FROM files f WHERE f.related_record_type = 'damage' AND f.related_record_id = r.report_id) AS photo_count
    FROM damage_reports r
    JOIN units u ON u.unit_id = r.unit_id
    JOIN properties p ON p.property_id = u.property_id
    LEFT JOIN users rb ON rb.user_id = r.reported_by
    LEFT JOIN users vb ON vb.user_id = r.resolved_by`;

async function loadReport(user, id) {
  const params = [id];
  const row = await one(`${REPORT_SELECT} WHERE r.report_id = $1 AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

// The reservation, if the caller may see it (the same scope as charges.js).
async function loadStay(user, id) {
  const params = [id];
  const row = await one(
    `SELECT b.booking_id, b.unit_id
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

// The cleaning task, if the caller may see it. A cleaner sees only tasks assigned
// to them or to nobody (the same rule as the task list).
async function loadTask(user, id) {
  const params = [id];
  let sql = `SELECT t.task_id, t.unit_id, t.booking_id
               FROM cleaning_tasks t JOIN units u ON u.unit_id = t.unit_id JOIN properties p ON p.property_id = u.property_id
              WHERE t.task_id = $1 AND ${propertyScope(user, params)}`;
  if (isCleaner(user)) {
    params.push(user.user_id);
    sql += ` AND (t.assigned_to = $${params.length} OR (t.assigned_to IS NULL AND t.assignee_name IS NULL))`;
  }
  const row = await one(sql, params);
  if (!row) throw notFound();
  return row;
}

async function createReport(user, { unit_id, booking_id = null, task_id = null }, body) {
  const r = await one(
    `INSERT INTO damage_reports (organization_id, unit_id, booking_id, task_id, description, estimated_cost, reported_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING report_id`,
    [user.organization_id, unit_id, booking_id, task_id, body.description, body.estimated_cost, user.user_id]);
  await audit(null, user, 'damage.reported', 'damage_report', r.report_id, { unit_id, booking_id, task_id, estimated_cost: body.estimated_cost });
  const report = await loadReport(user, r.report_id);
  if (['owner', 'manager'].includes(user.role)) return report;
  // Staff and cleaners get back the same fields the job detail shows them for their own reports (BACKEND-SCHEMA 6.1a).
  // Photos are added in a second request, so a new report has none yet.
  const { report_id, description, created_at, reported_by_name } = report;
  return { report_id, description, created_at, reported_by_name, files: [] };
}

// From a cleaning task (the booking is the task's departing stay, if it has one).
router.post('/cleaning-tasks/:id/damage', ah(async (req, res) => {
  const task = await loadTask(req.user, uuidParam(req.params.id));
  const body = validate(req.body, DAMAGE_SPEC);
  const report = await createReport(req.user, { unit_id: task.unit_id, booking_id: task.booking_id, task_id: task.task_id }, body);
  res.status(201).json({ report });
}));

router.post('/reservations/:id/damage', notCleaner, ah(async (req, res) => {
  const stay = await loadStay(req.user, uuidParam(req.params.id));
  const body = validate(req.body, DAMAGE_SPEC);
  res.status(201).json({ report: await createReport(req.user, { unit_id: stay.unit_id, booking_id: stay.booking_id }, body) });
}));

router.post('/units/:id/damage', notCleaner, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const body = validate(req.body, DAMAGE_SPEC);
  res.status(201).json({ report: await createReport(req.user, { unit_id: unit.unit_id }, body) });
}));

router.get('/damage-reports', managers, ah(async (req, res) => {
  const params = [];
  const where = [propertyScope(req.user, params)];
  if (STATUSES.includes(req.query.status)) { params.push(req.query.status); where.push(`r.status = $${params.length}`); }
  if (req.query.unit_id) { params.push(uuidParam(req.query.unit_id)); where.push(`r.unit_id = $${params.length}`); }
  const { rows } = await query(`${REPORT_SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC, r.report_id LIMIT 300`, params);
  res.json({ reports: rows });
}));

router.get('/reservations/:id/damage', managers, ah(async (req, res) => {
  const stay = await loadStay(req.user, uuidParam(req.params.id));
  const { rows } = await query(`${REPORT_SELECT} WHERE r.booking_id = $1 ORDER BY r.created_at, r.report_id`, [stay.booking_id]);
  res.json({ reports: rows });
}));

// Add the amount to the guest's bill as a damage line. Same steps as charges.js:
// lock the stay, insert the charge, recompute extras_total, audit. Then close any
// open pay links, since the amount owed has gone up.
router.post('/damage-reports/:id/charge', managers, ah(async (req, res) => {
  const r = await loadReport(req.user, uuidParam(req.params.id));
  if (r.status !== 'open') throw alreadyResolved();
  if (!r.booking_id) throw noStay('there is no bill to charge. Deduct it from the deposit or waive it instead');
  const body = validate(req.body, {
    amount: { type: 'money', required: true, positive: true, label: 'Amount' },
    description: { type: 'string', required: true, max: 200, label: 'Description' },
  });
  const chargeId = await tx(async (db) => {
    const { rows: [b] } = await db.query('SELECT status FROM bookings WHERE booking_id = $1 FOR UPDATE', [r.booking_id]);
    if (b.status !== 'confirmed') throw new HttpError(409, 'This reservation is cancelled. Charges cannot be changed on it.', { code: 'CANCELLED' });
    const { rows: [c] } = await db.query(
      `INSERT INTO booking_charges (organization_id, booking_id, category, description, quantity, unit_price, created_by)
       VALUES ($1, $2, 'damage', $3, 1, $4, $5) RETURNING charge_id`,
      [req.user.organization_id, r.booking_id, body.description, body.amount, req.user.user_id]);
    await db.query(
      `UPDATE bookings SET extras_total = (SELECT COALESCE(SUM(c.amount), 0) FROM booking_charges c
                                            WHERE c.booking_id = $1 AND c.voided_at IS NULL), updated_at = now()
        WHERE booking_id = $1`, [r.booking_id]);
    const { rows: [u] } = await db.query(
      `UPDATE damage_reports SET status = 'charged', charge_id = $2, resolved_by = $3, resolved_at = now()
        WHERE report_id = $1 AND status = 'open' RETURNING report_id`, [r.report_id, c.charge_id, req.user.user_id]);
    if (!u) throw alreadyResolved();
    await audit(db, req.user, 'damage.charged', 'damage_report', r.report_id, { booking_id: r.booking_id, charge_id: c.charge_id, amount: body.amount });
    return c.charge_id;
  });
  await closeOpenCheckouts(r.booking_id);
  const charge = await one('SELECT charge_id, category, description, quantity, unit_price, amount FROM booking_charges WHERE charge_id = $1', [chargeId]);
  res.json({ report: await loadReport(req.user, r.report_id), charge });
}));

// Marks the report for the security deposit. The deduction itself is recorded when the deposit is settled.
router.post('/damage-reports/:id/deduct', managers, ah(async (req, res) => {
  const r = await loadReport(req.user, uuidParam(req.params.id));
  if (r.status !== 'open') throw alreadyResolved();
  if (!r.booking_id) throw noStay('there is no deposit to deduct it from. Charge it or waive it instead');
  const done = await one(
    `UPDATE damage_reports SET status = 'deducted', resolved_by = $2, resolved_at = now()
      WHERE report_id = $1 AND status = 'open' RETURNING report_id`, [r.report_id, req.user.user_id]);
  if (!done) throw alreadyResolved();
  await audit(null, req.user, 'damage.deducted', 'damage_report', r.report_id, { booking_id: r.booking_id });
  res.json({ report: await loadReport(req.user, r.report_id) });
}));

router.post('/damage-reports/:id/waive', managers, ah(async (req, res) => {
  const r = await loadReport(req.user, uuidParam(req.params.id));
  if (r.status !== 'open') throw alreadyResolved();
  const body = validate(req.body, { note: { type: 'text', max: 500, label: 'Note' } });
  const done = await one(
    `UPDATE damage_reports SET status = 'waived', resolution_note = $2, resolved_by = $3, resolved_at = now()
      WHERE report_id = $1 AND status = 'open' RETURNING report_id`, [r.report_id, body.note, req.user.user_id]);
  if (!done) throw alreadyResolved();
  await audit(null, req.user, 'damage.waived', 'damage_report', r.report_id, { note: body.note });
  res.json({ report: await loadReport(req.user, r.report_id) });
}));

module.exports = router;
