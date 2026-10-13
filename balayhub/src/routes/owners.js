'use strict';

// Unit owners (people whose units this workspace manages) and their monthly statements.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { ownerStatement, statementText } = require('../lib/statements');

const router = express.Router();
const ownersOnly = requireRole('owner');
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const ownerSpec = {
  full_name: { type: 'string', required: true, max: 120, label: 'Owner name' },
  email: { type: 'email', label: 'Email' },
  phone: { type: 'phone', label: 'Mobile number' },
  management_fee_pct: { type: 'money', label: 'Management fee' },
  cleaning_to_manager: { type: 'bool', label: 'Cleaning fees' },
  notes: { type: 'text', max: 1000, label: 'Notes' },
  unit_ids: { type: 'uuids', label: 'Units' },
};

function checkFee(body) {
  if (body.management_fee_pct !== null && body.management_fee_pct !== undefined && Number(body.management_fee_pct) > 100) {
    throw validationError({ management_fee_pct: 'Management fee must be at most 100%.' });
  }
}

// Point the given units at this owner (and only these).
async function assignUnits(db, orgId, ownerId, unitIds) {
  if (!unitIds) return;
  const { rows } = await db.query(
    `SELECT u.unit_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1 AND u.unit_id = ANY($2)`, [orgId, unitIds]);
  if (rows.length !== new Set(unitIds).size) throw validationError({ unit_ids: 'One or more selected units were not found.' });
  await db.query(`UPDATE units SET owner_id = NULL WHERE owner_id = $1 AND NOT (unit_id = ANY($2)) AND status = 'active'`, [ownerId, unitIds]);
  await db.query('UPDATE units SET owner_id = $1 WHERE unit_id = ANY($2)', [ownerId, unitIds]);
}

async function loadOwner(user, id) {
  const o = await one('SELECT * FROM unit_owners WHERE owner_id = $1 AND organization_id = $2', [id, user.organization_id]);
  if (!o) throw notFound();
  return o;
}

// Filters: search (name, email, mobile), has units / no units yet, owns a
// given listing, sort. `units` is always the full list (for the forms).
const OWNER_SORTS = { name: 'o.full_name', fee: 'o.management_fee_pct DESC, o.full_name', units: 'COUNT(u.unit_id) DESC, o.full_name', newest: 'o.created_at DESC' };
router.get('/unit-owners', ownersOnly, ah(async (req, res) => {
  const org = req.user.organization_id;
  const q = req.query;
  const params = [org];
  const where = ['o.organization_id = $1', 'o.archived_at IS NULL'];
  const having = [];
  if (q.q) {
    params.push(`%${String(q.q).slice(0, 100)}%`);
    where.push(`(o.full_name ILIKE $${params.length} OR o.email ILIKE $${params.length} OR o.phone ILIKE $${params.length})`);
  }
  if (q.has_units === 'yes') having.push('COUNT(u.unit_id) > 0');
  if (q.has_units === 'no') having.push('COUNT(u.unit_id) = 0');
  if (q.unit_id) { params.push(uuidParam(q.unit_id)); where.push(`EXISTS (SELECT 1 FROM units x WHERE x.owner_id = o.owner_id AND x.unit_id = $${params.length})`); }
  const { rows: owners } = await query(
    `SELECT o.*, COALESCE(array_agg(u.unit_id) FILTER (WHERE u.unit_id IS NOT NULL), '{}') AS unit_ids
       FROM unit_owners o LEFT JOIN units u ON u.owner_id = o.owner_id AND u.status = 'active'
      WHERE ${where.join(' AND ')} GROUP BY o.owner_id ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
      ORDER BY ${OWNER_SORTS[q.sort] || OWNER_SORTS.name}`, params);
  const { rows: units } = await query(
    `SELECT u.unit_id, u.unit_name, p.property_name, u.owner_id FROM units u JOIN properties p USING (property_id)
      WHERE p.organization_id = $1 AND u.status = 'active' AND p.status = 'active' ORDER BY p.property_name, u.unit_name`, [org]);
  const { n: total } = await one('SELECT COUNT(*)::int AS n FROM unit_owners WHERE organization_id = $1 AND archived_at IS NULL', [org]);
  res.json({ owners, units, total });
}));

router.post('/unit-owners', ownersOnly, ah(async (req, res) => {
  const body = validate(req.body, ownerSpec);
  checkFee(body);
  const { n } = await one('SELECT COUNT(*)::int AS n FROM unit_owners WHERE organization_id = $1 AND archived_at IS NULL', [req.user.organization_id]);
  if (n >= 100) throw new HttpError(409, 'You can have up to 100 unit owners.', { code: 'LIMIT' });
  const id = await tx(async (db) => {
    const { rows: [o] } = await db.query(
      `INSERT INTO unit_owners (organization_id, full_name, email, phone, management_fee_pct, cleaning_to_manager, notes)
       VALUES ($1,$2,$3,$4,COALESCE($5::numeric, 20),COALESCE($6::boolean, true),$7) RETURNING owner_id`,
      [req.user.organization_id, body.full_name, body.email, body.phone, body.management_fee_pct,
        req.body.cleaning_to_manager === undefined ? null : body.cleaning_to_manager, body.notes]);
    await assignUnits(db, req.user.organization_id, o.owner_id, body.unit_ids);
    await audit(db, req.user, 'unit_owner.created', 'unit_owner', o.owner_id, { name: body.full_name });
    return o.owner_id;
  });
  res.status(201).json({ owner_id: id });
}));

router.patch('/unit-owners/:id', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const body = validate(req.body, ownerSpec, { partial: true });
  checkFee(body);
  const cols = ['full_name', 'email', 'phone', 'management_fee_pct', 'cleaning_to_manager', 'notes']
    .filter((k) => k in body && (body[k] !== null || ['email', 'phone', 'notes'].includes(k)));
  await tx(async (db) => {
    if (cols.length) {
      await db.query(`UPDATE unit_owners SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE owner_id = $1`, [o.owner_id, ...cols.map((k) => body[k])]);
    }
    await assignUnits(db, req.user.organization_id, o.owner_id, body.unit_ids);
    await audit(db, req.user, 'unit_owner.updated', 'unit_owner', o.owner_id, { fields: [...cols, ...(body.unit_ids ? ['unit_ids'] : [])] });
  });
  res.json({ ok: true });
}));

router.post('/unit-owners/:id/archive', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  await tx(async (db) => {
    await db.query('UPDATE unit_owners SET archived_at = now() WHERE owner_id = $1', [o.owner_id]);
    await db.query('UPDATE units SET owner_id = NULL WHERE owner_id = $1', [o.owner_id]);
    await audit(db, req.user, 'unit_owner.archived', 'unit_owner', o.owner_id, { name: o.full_name });
  });
  res.json({ ok: true });
}));

function monthParam(v) {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v) || Number(v.slice(0, 4)) < 2000 || Number(v.slice(0, 4)) > 2100) throw validationError({ month: 'Choose a month.' });
  return v;
}

router.get('/unit-owners/:id/statement', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const s = await ownerStatement(req.user.organization_id, o.owner_id, monthParam(req.query.month));
  res.json({ statement: { ...s, month_label: monthLabel(s.month) } });
}));

router.post('/unit-owners/:id/statement/send', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  if (!o.email) throw new HttpError(409, 'Add the owner\'s email first.', { code: 'NO_EMAIL' });
  const month = monthParam(req.body?.month);
  const s = await ownerStatement(req.user.organization_id, o.owner_id, month);
  const { sendMail } = require('../lib/mailer');
  const r = await sendMail({
    to: o.email, replyTo: req.user.email,
    subject: `Owner statement for ${monthLabel(month)} · ${s.workspace}`,
    text: `Hi ${o.full_name.split(' ')[0]},\n\nHere is your statement for ${monthLabel(month)}.\n\n${statementText(s, monthLabel(month))}\n\nReply to this email if you have questions.\n\n— ${req.user.full_name}, ${s.workspace}`,
  });
  if (r.notConfigured || r.error) throw new HttpError(502, r.reason || 'Email is not set up on this server yet.', { code: 'NOT_SENT' });
  await audit(null, req.user, 'unit_owner.statement_sent', 'unit_owner', o.owner_id, { month, payout: s.totals.payout });
  res.json({ sent: true, to: o.email });
}));

module.exports = router;
