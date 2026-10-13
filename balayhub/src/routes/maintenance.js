'use strict';

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam, isValidDate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadProperty, loadUnit } = require('../lib/access');
const { createExpense, expenseSpec } = require('./money');

const router = express.Router();
const managers = requireRole('owner', 'manager');

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['open', 'in_progress', 'resolved', 'cancelled'];

const SELECT = `
  SELECT m.*, p.property_name, u.unit_name, cu.full_name AS created_by_name,
         COALESCE((SELECT SUM(e.amount) FROM expenses e
                    WHERE e.maintenance_request_id = m.request_id AND e.voided_at IS NULL), 0)::numeric(12,2) AS actual_cost
    FROM maintenance_requests m
    JOIN properties p ON p.property_id = m.property_id
    LEFT JOIN units u ON u.unit_id = m.unit_id
    LEFT JOIN users cu ON cu.user_id = m.created_by`;

async function loadRequest(user, id) {
  const params = [id];
  const row = await one(`${SELECT} WHERE m.request_id = $1 AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

router.get('/maintenance', ah(async (req, res) => {
  const params = [];
  const where = [propertyScope(req.user, params)];
  const status = req.query.status;
  if (status === 'active') where.push(`m.status IN ('open', 'in_progress')`);
  else if (STATUSES.includes(status)) { params.push(status); where.push(`m.status = $${params.length}`); }
  if (req.query.priority === 'high_up') where.push(`m.priority IN ('high', 'urgent')`);
  else if (PRIORITIES.includes(req.query.priority)) { params.push(req.query.priority); where.push(`m.priority = $${params.length}`); }
  if (req.query.property_id) { params.push(uuidParam(req.query.property_id)); where.push(`m.property_id = $${params.length}`); }
  // A unit, or "none" for common areas / the whole property.
  if (req.query.unit_id === 'none') where.push('m.unit_id IS NULL');
  else if (req.query.unit_id) { params.push(uuidParam(req.query.unit_id)); where.push(`m.unit_id = $${params.length}`); }
  if (req.query.assigned === 'none') where.push(`COALESCE(trim(m.assigned_to), '') = ''`);
  else if (req.query.assigned) { params.push(String(req.query.assigned).trim().slice(0, 120)); where.push(`lower(trim(m.assigned_to)) = lower($${params.length})`); }
  // Reported date, in Manila time.
  const reported = `(m.created_at AT TIME ZONE 'Asia/Manila')::date`;
  if (isValidDate(req.query.from)) { params.push(req.query.from); where.push(`${reported} >= $${params.length}::date`); }
  if (isValidDate(req.query.to)) { params.push(req.query.to); where.push(`${reported} <= $${params.length}::date`); }
  const spent = `(SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.maintenance_request_id = m.request_id AND e.voided_at IS NULL)`;
  if (req.query.cost === 'recorded') where.push(`${spent} > 0`);
  if (req.query.cost === 'none') where.push(`${spent} = 0`);
  if (req.query.cost === 'estimate_only') where.push(`${spent} = 0 AND m.estimated_cost IS NOT NULL`);
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100)}%`);
    const n = params.length;
    where.push(`(m.title ILIKE $${n} OR m.description ILIKE $${n} OR p.property_name ILIKE $${n} OR u.unit_name ILIKE $${n} OR m.reported_by ILIKE $${n} OR m.assigned_to ILIKE $${n})`);
  }
  const SORTS = {
    newest: 'm.created_at DESC',
    oldest: 'm.created_at',
    priority: `array_position(ARRAY['urgent','high','medium','low'], m.priority), m.created_at`,
    cost: `${spent} DESC, m.estimated_cost DESC NULLS LAST, m.created_at DESC`,
    property: 'p.property_name, u.unit_name NULLS FIRST, m.created_at DESC',
  };
  const { rows } = await query(
    `${SELECT} WHERE ${where.join(' AND ')}
     ORDER BY ${SORTS[req.query.sort] || `(m.status IN ('open','in_progress')) DESC,
              array_position(ARRAY['urgent','high','medium','low'], m.priority), m.created_at DESC`}
     LIMIT 500`, params);
  // Names used in "Assigned to", for the filter list.
  const aParams = [];
  const { rows: assignees } = await query(
    `SELECT MIN(trim(m.assigned_to)) AS name FROM maintenance_requests m JOIN properties p ON p.property_id = m.property_id
      WHERE ${propertyScope(req.user, aParams)} AND COALESCE(trim(m.assigned_to), '') <> ''
      GROUP BY lower(trim(m.assigned_to)) ORDER BY 1 LIMIT 100`, aParams);
  res.json({ requests: rows, assignees: assignees.map((a) => a.name) });
}));

router.post('/maintenance', ah(async (req, res) => {
  const body = validate(req.body, {
    property_id: { type: 'uuid', required: true, label: 'Property' },
    unit_id: { type: 'uuid', label: 'Unit' },
    title: { type: 'string', required: true, max: 150, label: 'Issue' },
    description: { type: 'text', max: 2000, label: 'Details' },
    priority: { type: 'enum', values: PRIORITIES, required: true, label: 'Priority' },
    reported_by: { type: 'string', max: 120, label: 'Reported by' },
    assigned_to: { type: 'string', max: 120, label: 'Assigned to' },
    estimated_cost: { type: 'money', label: 'Estimated cost' },
  });
  await loadProperty(req.user, body.property_id);
  if (body.unit_id) {
    const unit = await loadUnit(req.user, body.unit_id);
    if (unit.property_id !== body.property_id) {
      throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { unit_id: 'This unit belongs to a different property.' } });
    }
  }
  const id = await tx(async (db) => {
    const { rows: [m] } = await db.query(
      `INSERT INTO maintenance_requests (organization_id, property_id, unit_id, reported_by, title, description, priority, assigned_to, estimated_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING request_id`,
      [req.user.organization_id, body.property_id, body.unit_id, body.reported_by, body.title, body.description,
        body.priority, body.assigned_to, body.estimated_cost, req.user.user_id]);
    await audit(db, req.user, 'maintenance.created', 'maintenance', m.request_id, { title: body.title, priority: body.priority });
    return m.request_id;
  });
  res.status(201).json({ request: await loadRequest(req.user, id) });
}));

router.get('/maintenance/:id', ah(async (req, res) => {
  const request = await loadRequest(req.user, uuidParam(req.params.id));
  const { rows: costs } = await query(
    `SELECT e.expense_id, e.amount, e.expense_date, e.description, e.vendor_name, e.voided_at, e.void_reason
       FROM expenses e WHERE e.maintenance_request_id = $1 ORDER BY e.expense_date DESC`, [request.request_id]);
  const { rows: files } = await query(
    `SELECT file_id, file_name, mime_type, size_bytes, uploaded_at FROM files
      WHERE related_record_type = 'maintenance' AND related_record_id = $1 AND organization_id = $2`,
    [request.request_id, req.user.organization_id]);
  res.json({ request, costs, files });
}));

router.patch('/maintenance/:id', managers, ah(async (req, res) => {
  const request = await loadRequest(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    title: { type: 'string', max: 150, label: 'Issue' },
    description: { type: 'text', max: 2000, label: 'Details' },
    priority: { type: 'enum', values: PRIORITIES, label: 'Priority' },
    status: { type: 'enum', values: STATUSES, label: 'Status' },
    assigned_to: { type: 'string', max: 120, label: 'Assigned to' },
    estimated_cost: { type: 'money', label: 'Estimated cost' },
  }, { partial: true });
  if ('title' in body && !body.title) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { title: 'Issue is required.' } });
  }
  for (const k of ['priority', 'status']) if (k in body && body[k] === null) delete body[k];
  const keys = Object.keys(body);
  if (!keys.length) return res.json({ request });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  if (body.status) {
    sets.push(body.status === 'resolved' ? 'resolved_at = COALESCE(resolved_at, now())' : 'resolved_at = NULL');
  }
  await tx(async (db) => {
    await db.query(`UPDATE maintenance_requests SET ${sets.join(', ')} WHERE request_id = $1`,
      [request.request_id, ...keys.map((k) => body[k])]);
    await audit(db, req.user, body.status && body.status !== request.status ? 'maintenance.status_changed' : 'maintenance.updated',
      'maintenance', request.request_id, { before: Object.fromEntries(keys.map((k) => [k, request[k]])), after: body });
  });
  res.json({ request: await loadRequest(req.user, request.request_id) });
}));

// Record a repair cost: creates a linked expense so reports include it.
router.post('/maintenance/:id/costs', ah(async (req, res) => {
  const request = await loadRequest(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    amount: expenseSpec.amount,
    expense_date: expenseSpec.expense_date,
    vendor_name: expenseSpec.vendor_name,
    description: expenseSpec.description,
  });
  const result = await createExpense(req, {
    ...body,
    property_id: request.property_id,
    unit_id: request.unit_id,
    category: 'repairs',
    description: body.description || `Repair: ${request.title}`,
  }, request.request_id);
  res.status(result.duplicate ? 200 : 201).json(result);
}));

module.exports = router;
