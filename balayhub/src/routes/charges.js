'use strict';

// Itemised extras on a stay bill (late check-out, extra guest, damage, ...).
// Every add or void recomputes bookings.extras_total, which is part of the
// booking's total, so the balance moves with it. Owners and managers change
// charges; staff can view them.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { closeOpenCheckouts } = require('./balancepay');

const router = express.Router();
const managers = requireRole('owner', 'manager');

const CATEGORIES = ['early_checkin', 'late_checkout', 'extra_guest', 'extra_bed', 'airport_transfer', 'damage', 'extra_cleaning', 'other'];
const CHARGE_SELECT = `SELECT c.charge_id, c.category, c.description, c.quantity, c.unit_price, c.amount, c.created_at,
         c.voided_at, c.void_reason, cu.full_name AS created_by_name, vu.full_name AS voided_by_name
    FROM booking_charges c
    LEFT JOIN users cu ON cu.user_id = c.created_by
    LEFT JOIN users vu ON vu.user_id = c.voided_by`;

// The reservation, if the caller may see it. Other workspaces and out-of-scope
// properties get the same 404 as a missing record.
async function loadReservation(user, id) {
  const params = [id];
  const row = await one(
    `SELECT b.booking_id, b.organization_id, b.extras_total
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

// Lock the booking for the rest of the transaction, so two charge edits can't
// both add up the old total. Cancelled reservations take no charge changes.
async function lockOpenBooking(db, bookingId) {
  const { rows: [b] } = await db.query('SELECT status FROM bookings WHERE booking_id = $1 FOR UPDATE', [bookingId]);
  if (b.status !== 'confirmed') throw new HttpError(409, 'This reservation is cancelled. Charges cannot be changed on it.', { code: 'CANCELLED' });
}

// Keep bookings.extras_total equal to the sum of the charges that aren't voided.
async function recomputeExtras(db, bookingId) {
  await db.query(
    `UPDATE bookings SET extras_total = (SELECT COALESCE(SUM(c.amount), 0) FROM booking_charges c
                                          WHERE c.booking_id = $1 AND c.voided_at IS NULL), updated_at = now()
      WHERE booking_id = $1`, [bookingId]);
}

const loadCharge = (id) => one(`${CHARGE_SELECT} WHERE c.charge_id = $1`, [id]);

router.get('/reservations/:id/charges', ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  const { rows: charges } = await query(`${CHARGE_SELECT} WHERE c.booking_id = $1 ORDER BY c.created_at, c.charge_id`, [b.booking_id]);
  res.json({ charges, extras_total: b.extras_total });
}));

router.post('/reservations/:id/charges', managers, ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    category: { type: 'enum', values: CATEGORIES, required: true, label: 'Category' },
    description: { type: 'string', required: true, max: 200, label: 'Description' },
    quantity: { type: 'int', min: 1, max: 99, label: 'Quantity' },
    unit_price: { type: 'money', required: true, positive: true, label: 'Unit price' },
  });
  const quantity = body.quantity ?? 1;
  const chargeId = await tx(async (db) => {
    await lockOpenBooking(db, b.booking_id);
    const { rows: [c] } = await db.query(
      `INSERT INTO booking_charges (organization_id, booking_id, category, description, quantity, unit_price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING charge_id`,
      [b.organization_id, b.booking_id, body.category, body.description, quantity, body.unit_price, req.user.user_id]);
    await recomputeExtras(db, b.booking_id);
    await audit(db, req.user, 'reservation.charge_added', 'booking_charge', c.charge_id,
      { booking_id: b.booking_id, category: body.category, quantity, unit_price: body.unit_price });
    return c.charge_id;
  });
  await closeOpenCheckouts(b.booking_id); // the amount owed just went up: old pay links must not work
  res.status(201).json({ charge: await loadCharge(chargeId) });
}));

router.post('/charges/:id/void', managers, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const c = await one('SELECT charge_id, booking_id FROM booking_charges WHERE charge_id = $1 AND organization_id = $2', [id, req.user.organization_id]);
  if (!c) throw notFound();
  await loadReservation(req.user, c.booking_id);
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 300, label: 'Reason' } });
  await tx(async (db) => {
    await lockOpenBooking(db, c.booking_id);
    const { rows: [v] } = await db.query(
      `UPDATE booking_charges SET voided_at = now(), voided_by = $2, void_reason = $3
        WHERE charge_id = $1 AND voided_at IS NULL RETURNING amount`, [id, req.user.user_id, reason]);
    if (!v) throw new HttpError(409, 'This charge is already voided.', { code: 'ALREADY_VOIDED' });
    await recomputeExtras(db, c.booking_id);
    await audit(db, req.user, 'reservation.charge_voided', 'booking_charge', id, { booking_id: c.booking_id, amount: v.amount, reason });
  });
  await closeOpenCheckouts(c.booking_id);
  res.json({ ok: true });
}));

module.exports = router;
