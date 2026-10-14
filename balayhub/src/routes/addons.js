'use strict';

// Paid add-ons catalogue (D-59). Owners manage it; managers can read it. Prices
// are copied onto each booking as charges when they're bought, so editing an
// add-on never changes a past stay.

const express = require('express');
const { query, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { changedKeys } = require('../lib/auditdiff');
const { requireRole } = require('../lib/auth');
const { PRICING } = require('../lib/addons');

const router = express.Router();
const owners = requireRole('owner');
const managers = requireRole('owner', 'manager');

const COLUMNS = `addon_id, name, name_tl, description, price, pricing, max_quantity, unit_ids,
                 on_booking_page, before_arrival, active`;

const FIELDS = {
  name: { type: 'string', max: 80, label: 'Name' },
  name_tl: { type: 'string', max: 80, label: 'Taglish name' },
  description: { type: 'text', max: 300, label: 'Description' },
  price: { type: 'money', positive: true, label: 'Price' },
  pricing: { type: 'enum', values: PRICING, label: 'Pricing' },
  max_quantity: { type: 'int', min: 1, max: 20, label: 'Maximum quantity' },
  unit_ids: { type: 'uuids', label: 'Listings' },
  on_booking_page: { type: 'bool', label: 'Offer on the booking page' },
  before_arrival: { type: 'bool', label: 'Offer before arrival' },
  active: { type: 'bool', label: 'Active' },
};
// Creating always starts active; `active` is only changed by PATCH (and archive).
const { active: activeField, ...createFields } = FIELDS;
const CREATE_SPEC = {
  ...createFields,
  name: { ...FIELDS.name, required: true },
  price: { ...FIELDS.price, required: true },
  pricing: { ...FIELDS.pricing, required: true },
};
const UPDATE_SPEC = { ...CREATE_SPEC, max_quantity: { ...FIELDS.max_quantity, required: true }, active: activeField };

// Listings must belong to this workspace. An empty list means every listing.
async function assertUnits(orgId, unitIds) {
  if (!unitIds.length) return;
  const { rows } = await query(
    `SELECT u.unit_id FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE p.organization_id = $1 AND u.unit_id = ANY($2::uuid[])`, [orgId, unitIds]);
  if (rows.length !== unitIds.length) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { unit_ids: 'Choose listings from your workspace.' } });
  }
}

// Two active add-ons in one workspace can't share a name (ignoring case and spaces at the ends).
// Archived ones don't count. ponytail: check then insert, so two creates at the same instant could both pass; a partial unique index on (organization_id, lower(btrim(name))) WHERE active would close that.
async function assertNameFree(db, orgId, name, exceptId = null) {
  const { rows } = await db.query(
    `SELECT btrim(name) AS name FROM listing_addons
      WHERE organization_id = $1 AND active AND lower(btrim(name)) = lower(btrim($2)) AND addon_id IS DISTINCT FROM $3 LIMIT 1`,
    [orgId, name, exceptId]);
  if (rows.length) {
    throw new HttpError(409, 'That name is already in use.', { code: 'DUPLICATE', fields: { name: `You already have an add-on called ${rows[0].name}.` } });
  }
}

router.get('/addons', managers, ah(async (req, res) => {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM listing_addons WHERE organization_id = $1 ORDER BY active DESC, sort_order, created_at, addon_id`,
    [req.user.organization_id]);
  res.json({ addons: rows });
}));

router.post('/addons', owners, ah(async (req, res) => {
  const body = validate(req.body, CREATE_SPEC);
  await assertUnits(req.user.organization_id, body.unit_ids);
  await assertNameFree({ query }, req.user.organization_id, body.name);
  // Absent flags default to on; validate() alone would read absent as off.
  const flag = (key) => (req.body[key] === undefined ? true : body[key]);
  const { rows: [a] } = await query(
    `INSERT INTO listing_addons (organization_id, name, name_tl, description, price, pricing, max_quantity, unit_ids,
                                 on_booking_page, before_arrival)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLUMNS}`,
    [req.user.organization_id, body.name, body.name_tl, body.description, body.price, body.pricing,
      body.max_quantity ?? 1, body.unit_ids, flag('on_booking_page'), flag('before_arrival')]);
  await audit(null, req.user, 'addon.created', 'listing_addon', a.addon_id, { name: a.name, price: a.price, pricing: a.pricing });
  res.status(201).json({ addon: a });
}));

// Only the fields sent change. Sending a blank name, price, pricing or maximum is refused.
// A save that changes nothing writes nothing; the activity row names the changed fields, never their values.
router.patch('/addons/:id', owners, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const body = validate(req.body, UPDATE_SPEC, { partial: true });
  if (body.unit_ids) await assertUnits(req.user.organization_id, body.unit_ids);
  const a = await tx(async (db) => {
    const { rows: [cur] } = await db.query(
      `SELECT ${COLUMNS} FROM listing_addons WHERE addon_id = $1 AND organization_id = $2 FOR UPDATE`, [id, req.user.organization_id]);
    if (!cur) throw notFound();
    // The listings are a set: the same ids in another order are no change.
    const sortIds = (o) => (o.unit_ids ? { ...o, unit_ids: [...o.unit_ids].sort() } : o);
    const fields = changedKeys(sortIds(cur), sortIds(body));
    if (!fields.length) return cur;
    const next = { ...cur, ...body };
    // A rename, or switching an archived add-on back on, must not leave two active add-ons with one name.
    // Saving other fields on an older duplicate still goes through.
    const renamed = body.name !== undefined && body.name.toLowerCase() !== cur.name.trim().toLowerCase();
    if (next.active && (renamed || !cur.active)) await assertNameFree(db, req.user.organization_id, next.name, id);
    const { rows: [updated] } = await db.query(
      `UPDATE listing_addons SET name = $2, name_tl = $3, description = $4, price = $5, pricing = $6, max_quantity = $7,
              unit_ids = $8, on_booking_page = $9, before_arrival = $10, active = $11, updated_at = now()
        WHERE addon_id = $1 RETURNING ${COLUMNS}`,
      [id, next.name, next.name_tl, next.description, next.price, next.pricing, next.max_quantity, next.unit_ids,
        next.on_booking_page, next.before_arrival, next.active]);
    await audit(db, req.user, 'addon.updated', 'listing_addon', id, { fields, name: next.name });
    return updated;
  });
  res.json({ addon: a });
}));

// Archiving hides the add-on from guests and keeps it on past stays. Idempotent.
router.post('/addons/:id/archive', owners, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { rows: [a] } = await query(
    `UPDATE listing_addons SET active = false, updated_at = now() WHERE addon_id = $1 AND organization_id = $2 RETURNING ${COLUMNS}`,
    [id, req.user.organization_id]);
  if (!a) throw notFound();
  await audit(null, req.user, 'addon.archived', 'listing_addon', id, null);
  res.json({ addon: a });
}));

module.exports = router;
