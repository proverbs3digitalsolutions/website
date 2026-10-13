'use strict';

// Lost and found: things guests leave behind. A cleaner, staff member or host
// logs an item from a cleaning task or a stay, then it is held, returned or
// disposed of. Owners and managers see the whole log with guest names; cleaners
// never see guest names.

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah, forbidden, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { isCleaner } = require('../lib/cleaner');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const STATUSES = ['held', 'returned', 'disposed'];
const ITEM_SPEC = {
  description: { type: 'text', required: true, max: 300, label: 'What was found' },
  found_where: { type: 'string', max: 200, label: 'Where it was found' },
  found_on: { type: 'date', label: 'Date found' },
};

const notCleaner = (req, res, next) => (isCleaner(req.user) ? next(forbidden('Cleaners log items from their cleaning job.')) : next());
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const ITEM_SELECT = `
  SELECT li.item_id, li.unit_id, li.booking_id, li.task_id, li.description, li.found_where, li.found_on,
         li.status, li.status_note, li.created_at, li.updated_at,
         u.unit_name, p.property_name, COALESCE(g.full_name, b.guest_label) AS guest_name,
         fb.full_name AS found_by_name, ub.full_name AS updated_by_name,
         (SELECT COUNT(*) FROM files f WHERE f.related_record_type = 'lost_found' AND f.related_record_id = li.item_id) AS photo_count
    FROM lost_found_items li
    JOIN units u ON u.unit_id = li.unit_id
    JOIN properties p ON p.property_id = u.property_id
    LEFT JOIN bookings b ON b.booking_id = li.booking_id
    LEFT JOIN guests g ON g.guest_id = b.guest_id
    LEFT JOIN users fb ON fb.user_id = li.found_by
    LEFT JOIN users ub ON ub.user_id = li.updated_by`;

async function loadItem(user, id) {
  const params = [id];
  const row = await one(`${ITEM_SELECT} WHERE li.item_id = $1 AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

async function loadStay(user, id) {
  const params = [id];
  const row = await one(
    `SELECT b.booking_id, b.unit_id
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

// The same task rule as damage.js: a cleaner sees only tasks assigned to them or to nobody.
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

// Validates an item and rejects a date found in the future (Manila time).
function parseItem(body) {
  const v = validate(body, ITEM_SPEC);
  if (v.found_on && v.found_on > manilaToday()) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { found_on: 'The date cannot be in the future.' } });
  }
  return v;
}

async function createItem(user, { unit_id, booking_id = null, task_id = null }, body) {
  const r = await one(
    `INSERT INTO lost_found_items (organization_id, unit_id, booking_id, task_id, description, found_where, found_on, found_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING item_id`,
    [user.organization_id, unit_id, booking_id, task_id, body.description, body.found_where, body.found_on, user.user_id]);
  await audit(null, user, 'lost_found.reported', 'lost_found_item', r.item_id, { unit_id, booking_id, task_id });
  return loadItem(user, r.item_id);
}

// Cleaners never see the guest's name, even on an item they just logged.
const forUser = (user, item) => {
  if (!isCleaner(user)) return item;
  const { guest_name, ...rest } = item;
  return rest;
};

router.post('/cleaning-tasks/:id/lost-found', ah(async (req, res) => {
  const task = await loadTask(req.user, uuidParam(req.params.id));
  const body = parseItem(req.body);
  const item = await createItem(req.user, { unit_id: task.unit_id, booking_id: task.booking_id, task_id: task.task_id }, body);
  res.status(201).json({ item: forUser(req.user, item) });
}));

router.post('/reservations/:id/lost-found', notCleaner, ah(async (req, res) => {
  const stay = await loadStay(req.user, uuidParam(req.params.id));
  const body = parseItem(req.body);
  res.status(201).json({ item: await createItem(req.user, { unit_id: stay.unit_id, booking_id: stay.booking_id }, body) });
}));

router.get('/lost-found', managers, ah(async (req, res) => {
  const qp = req.query;
  const params = [];
  const where = [propertyScope(req.user, params)];
  if (STATUSES.includes(qp.status)) { params.push(qp.status); where.push(`li.status = $${params.length}`); }
  if (typeof qp.q === 'string' && qp.q.trim()) {
    params.push(`%${qp.q.trim().slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    const i = params.length;
    where.push(`(li.description ILIKE $${i} OR li.found_where ILIKE $${i} OR u.unit_name ILIKE $${i} OR COALESCE(g.full_name, b.guest_label) ILIKE $${i})`);
  }
  const { rows } = await query(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY li.created_at DESC, li.item_id LIMIT 300`, params);
  res.json({ items: rows });
}));

router.get('/reservations/:id/lost-found', managers, ah(async (req, res) => {
  const stay = await loadStay(req.user, uuidParam(req.params.id));
  const { rows } = await query(`${ITEM_SELECT} WHERE li.booking_id = $1 ORDER BY li.created_at, li.item_id`, [stay.booking_id]);
  res.json({ items: rows });
}));

// Status moves freely between held, returned and disposed (back to held included).
// A status note is replaced with each change; leaving it out clears it.
router.patch('/lost-found/:id', managers, ah(async (req, res) => {
  const item = await loadItem(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    status: { type: 'enum', values: STATUSES, required: true, label: 'Status' },
    status_note: { type: 'text', max: 300, label: 'Note' },
  });
  await query(
    `UPDATE lost_found_items SET status = $2, status_note = $3, updated_by = $4, updated_at = now() WHERE item_id = $1`,
    [item.item_id, body.status, body.status_note, req.user.user_id]);
  await audit(null, req.user, 'lost_found.updated', 'lost_found_item', item.item_id, { from: item.status, to: body.status });
  res.json({ item: await loadItem(req.user, item.item_id) });
}));

module.exports = router;
