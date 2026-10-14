'use strict';

// Supplies per property (D-53): item, unit label, par level and on hand. Owners
// and managers keep the list. Anyone who can open a cleaning task can record what
// they used or restocked on it. Every change to on hand is logged as a movement.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadProperty } = require('../lib/access');
const { taskScope } = require('../lib/housekeeping');

const router = express.Router();
const managers = requireRole('owner', 'manager');

const MAX_QTY = 100000;
const MAX_NOTE = 200;
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const nameTaken = () => validationError({ name: 'This property already has an item with that name.' });

const SUPPLY_FIELDS = {
  name: { type: 'string', required: true, max: 80, label: 'Item name' },
  unit_label: { type: 'string', max: 20, label: 'Unit' },
  par_level: { type: 'int', required: true, min: 0, max: MAX_QTY, label: 'Par level' },
};
const MOVEMENT_FIELDS = {
  kind: { type: 'enum', values: ['used', 'restocked', 'count'], required: true, label: 'Movement' },
  quantity: { type: 'int', required: true, min: 0, max: MAX_QTY, label: 'Quantity' },
  note: { type: 'string', max: MAX_NOTE, label: 'Note' },
};
// What a cleaner (or anyone working a task) may record: use or restock, at least one.
const TASK_ITEM_FIELDS = {
  supply_id: { type: 'uuid', required: true, label: 'Supply' },
  kind: { type: 'enum', values: ['used', 'restocked'], required: true, label: 'Movement' },
  quantity: { type: 'int', required: true, min: 1, max: MAX_QTY, label: 'Quantity' },
};

const SUPPLY_SELECT = `
  SELECT s.supply_id, s.property_id, p.property_name, s.name, s.unit_label, s.par_level, s.on_hand,
         s.on_hand < s.par_level AS low
    FROM supplies s
    JOIN properties p ON p.property_id = s.property_id`;

// Active supplies the user can see, in list shape.
async function listSupplies(user, { propertyId, ids, lowOnly } = {}) {
  const params = [];
  const where = ['s.archived_at IS NULL', propertyScope(user, params)];
  if (propertyId) { params.push(propertyId); where.push(`s.property_id = $${params.length}`); }
  if (ids) { params.push(ids); where.push(`s.supply_id = ANY($${params.length}::uuid[])`); }
  if (lowOnly) where.push('s.on_hand < s.par_level');
  const { rows } = await query(`${SUPPLY_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.property_name, s.name`, params);
  return rows;
}

async function loadSupply(user, id) {
  const [row] = await listSupplies(user, { ids: [id] });
  if (!row) throw notFound();
  return row;
}

// Lock one supply row before changing it. Null if it's archived or the user can't see it.
async function lockSupply(db, user, id) {
  const params = [id];
  const { rows: [s] } = await db.query(
    `SELECT s.* FROM supplies s JOIN properties p ON p.property_id = s.property_id
      WHERE s.supply_id = $1 AND s.archived_at IS NULL AND ${propertyScope(user, params)}
      FOR UPDATE OF s`, params);
  return s || null;
}

// Apply one movement to a locked supply row and log it. On hand never goes below zero: using more
// than is on hand uses up what is there, and the log records that amount, with the ask in the note.
async function applyMovement(db, user, supply, { kind, quantity, note = null, taskId = null }) {
  let onHand;
  let logged = quantity;
  let logNote = note;
  if (kind === 'count') onHand = quantity;
  else if (kind === 'restocked') onHand = supply.on_hand + quantity;
  else if (quantity > supply.on_hand) {
    // The log takes uses of at least 1, so with nothing on hand there is nothing to record.
    if (supply.on_hand === 0) throw validationError({ quantity: `${supply.name} is out of stock, so nothing can be recorded as used.` });
    onHand = 0;
    logged = supply.on_hand;
    // The log note holds MAX_NOTE characters, so a long note gives way to the message.
    const short = `Asked for ${quantity}, only ${supply.on_hand} on hand.`;
    logNote = [note?.slice(0, MAX_NOTE - short.length - 1), short].filter(Boolean).join(' ');
  } else onHand = supply.on_hand - quantity;
  await db.query(
    `INSERT INTO supply_movements (organization_id, supply_id, kind, quantity, task_id, note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [user.organization_id, supply.supply_id, kind, logged, taskId, logNote, user.user_id]);
  await db.query('UPDATE supplies SET on_hand = $2, updated_at = now() WHERE supply_id = $1', [supply.supply_id, onHand]);
  await audit(db, user, 'supply.movement', 'supply', supply.supply_id, { kind, quantity: logged, on_hand: onHand, task_id: taskId });
}

// Turn "this property already has an item with that name" into a field error.
async function withNameCheck(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23505') throw nameTaken();
    throw err;
  }
}

// The task must be visible to the user (housekeeping's rule: a cleaner sees only tasks assigned
// to them or unassigned). A cancelled task takes no supplies or work orders.
async function loadWorkableTask(user, id) {
  const params = [id];
  const task = await one(
    `SELECT t.task_id, t.status, t.unit_id, u.unit_name, p.property_id
       FROM cleaning_tasks t
       JOIN units u ON u.unit_id = t.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE t.task_id = $1 AND ${taskScope(user, params)}`, params);
  if (!task) throw notFound();
  if (task.status === 'cancelled') throw new HttpError(409, 'This task was cancelled.', { code: 'CANCELLED' });
  return task;
}

router.get('/supplies', ah(async (req, res) => {
  const propertyId = req.query.property_id ? uuidParam(req.query.property_id) : null;
  res.json({ supplies: await listSupplies(req.user, { propertyId, lowOnly: req.query.low === '1' }) });
}));

// Home screen badge: how many supplies are below par.
router.get('/supplies/low-count', managers, ah(async (req, res) => {
  const params = [];
  const row = await one(
    `SELECT COUNT(*) AS count FROM supplies s JOIN properties p ON p.property_id = s.property_id
      WHERE s.archived_at IS NULL AND s.on_hand < s.par_level AND ${propertyScope(req.user, params)}`, params);
  res.json({ count: row.count });
}));

router.post('/supplies', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    property_id: { type: 'uuid', required: true, label: 'Property' },
    ...SUPPLY_FIELDS,
    on_hand: { type: 'int', min: 0, max: MAX_QTY, label: 'On hand' },
  });
  await loadProperty(req.user, body.property_id);
  const id = await withNameCheck(() => tx(async (db) => {
    const { rows: [s] } = await db.query(
      `INSERT INTO supplies (organization_id, property_id, name, unit_label, par_level)
       VALUES ($1,$2,$3,$4,$5) RETURNING supply_id`,
      [req.user.organization_id, body.property_id, body.name, body.unit_label || 'pcs', body.par_level]);
    await audit(db, req.user, 'supply.created', 'supply', s.supply_id, { name: body.name, par_level: body.par_level });
    if (body.on_hand) {
      await applyMovement(db, req.user, { supply_id: s.supply_id, on_hand: 0 }, { kind: 'count', quantity: body.on_hand, note: 'Opening count' });
    }
    return s.supply_id;
  }));
  res.status(201).json({ supply: await loadSupply(req.user, id) });
}));

// On hand is changed only through movements, so it isn't accepted here.
router.patch('/supplies/:id', managers, ah(async (req, res) => {
  const supply = await loadSupply(req.user, uuidParam(req.params.id));
  const body = validate(req.body, SUPPLY_FIELDS, { partial: true });
  if ('unit_label' in body) body.unit_label = body.unit_label || 'pcs';
  const keys = Object.keys(body);
  if (keys.length) {
    await withNameCheck(() => tx(async (db) => {
      await db.query(`UPDATE supplies SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE supply_id = $1`,
        [supply.supply_id, ...keys.map((k) => body[k])]);
      await audit(db, req.user, 'supply.updated', 'supply', supply.supply_id, { after: body });
    }));
  }
  res.json({ supply: await loadSupply(req.user, supply.supply_id) });
}));

router.post('/supplies/:id/archive', managers, ah(async (req, res) => {
  const supply = await loadSupply(req.user, uuidParam(req.params.id));
  await tx(async (db) => {
    await db.query('UPDATE supplies SET archived_at = now(), updated_at = now() WHERE supply_id = $1', [supply.supply_id]);
    await audit(db, req.user, 'supply.archived', 'supply', supply.supply_id, { name: supply.name });
  });
  res.json({ ok: true });
}));

router.post('/supplies/:id/movements', managers, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const body = validate(req.body, MOVEMENT_FIELDS);
  if (body.kind !== 'count' && body.quantity < 1) throw validationError({ quantity: 'Enter a quantity of at least 1.' });
  await tx(async (db) => {
    const supply = await lockSupply(db, req.user, id);
    if (!supply) throw notFound();
    await applyMovement(db, req.user, supply, body);
  });
  res.json({ supply: await loadSupply(req.user, id) });
}));

// The last 20 movements on one supply, newest first, with the name of who recorded each.
router.get('/supplies/:id/movements', managers, ah(async (req, res) => {
  const supply = await loadSupply(req.user, uuidParam(req.params.id));
  const { rows } = await query(
    `SELECT m.kind, m.quantity, m.note, m.created_at, u.full_name AS recorded_by_name
       FROM supply_movements m
       LEFT JOIN users u ON u.user_id = m.recorded_by
      WHERE m.supply_id = $1
      ORDER BY m.created_at DESC
      LIMIT 20`, [supply.supply_id]);
  res.json({ movements: rows });
}));

// Cleaners record what they used or restocked on a task. Supplies must belong to the task's
// property. Rows are locked in id order so two tasks can't deadlock each other. A used item with
// nothing on hand is skipped and named back, so the rest of the job's supplies still save.
router.post('/cleaning-tasks/:id/supplies', ah(async (req, res) => {
  const task = await loadWorkableTask(req.user, uuidParam(req.params.id));
  const raw = req.body?.items;
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) throw validationError({ items: 'Add between 1 and 50 supplies.' });
  const items = raw.map((x) => validate(x, TASK_ITEM_FIELDS)).sort((a, b) => (a.supply_id < b.supply_id ? -1 : 1));
  const skipped = [];
  await tx(async (db) => {
    for (const item of items) {
      const supply = await lockSupply(db, req.user, item.supply_id);
      if (!supply || supply.property_id !== task.property_id) {
        throw validationError({ items: "One of these supplies isn't in this property." });
      }
      if (item.kind === 'used' && supply.on_hand === 0) {
        skipped.push(supply.name);
        continue;
      }
      await applyMovement(db, req.user, supply, { ...item, taskId: task.task_id });
    }
  });
  res.json({ supplies: await listSupplies(req.user, { ids: items.map((i) => i.supply_id) }), skipped });
}));

module.exports = router;
