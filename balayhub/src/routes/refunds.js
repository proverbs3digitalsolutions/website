'use strict';

// Refunds on a reservation, kept apart from payments: money returned to the guest,
// usually after a cancellation. They count in the guest balance (D-85, src/lib/balance.js). Staff can read the
// refund log and its suggestion; only owners and managers record or void refunds.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { suggestRefund, describePolicy } = require('../lib/policies');

const router = express.Router();
const managers = requireRole('owner', 'manager');

// Same as booking_payments.payment_method, minus channel payouts (migration 027).
const REFUND_METHODS = ['cash', 'bank_transfer', 'gcash', 'maya', 'card', 'other'];
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
// Money as whole centavos, so sums and caps are exact. pg returns NUMERIC as strings.
const centavos = (s) => Math.round(Number(s) * 100);
const money = (c) => (c / 100).toFixed(2);
// Pesos for messages the host reads, grouped like the rest of the app: "₱1,000.00".
const peso = (c) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A reservation with its policy, and what is paid and refunded (voided rows excluded).
async function loadRefundBooking(user, id, db) {
  const params = [id];
  const sql = `SELECT b.booking_id, b.kind, b.status, b.check_in,
          to_char(b.cancelled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS cancelled_on,
          u.cancellation_policy, u.cancellation_policy_text,
          COALESCE((SELECT SUM(x.amount) FROM booking_payments x WHERE x.booking_id = b.booking_id AND x.voided_at IS NULL), 0)::numeric(12,2) AS paid,
          COALESCE((SELECT SUM(x.amount) FROM booking_refunds x WHERE x.booking_id = b.booking_id AND x.voided_at IS NULL), 0)::numeric(12,2) AS refunded
     FROM bookings b
     JOIN units u ON u.unit_id = b.unit_id
     JOIN properties p ON p.property_id = u.property_id
    WHERE b.booking_id = $1 AND ${propertyScope(user, params)}`;
  const row = db ? (await db.query(sql, params)).rows[0] : await one(sql, params);
  if (!row || row.kind !== 'reservation') throw notFound();
  return row;
}

// Policy, suggested refund and the refund log. Staff can read this.
router.get('/reservations/:id/refunds', ah(async (req, res) => {
  const b = await loadRefundBooking(req.user, uuidParam(req.params.id));
  const { rows } = await query(
    `SELECT r.refund_id, r.amount, r.refund_date, r.method, r.reference_number, r.reason, r.created_at,
            r.voided_at, r.void_reason, ru.full_name AS recorded_by_name, vu.full_name AS voided_by_name
       FROM booking_refunds r
       LEFT JOIN users ru ON ru.user_id = r.recorded_by
       LEFT JOIN users vu ON vu.user_id = r.voided_by
      WHERE r.booking_id = $1
      ORDER BY r.created_at DESC`, [b.booking_id]);
  // ponytail: uses the listing's current policy, not the one at booking time (no snapshot column in migration 027).
  // A cancelled booking is judged on the day it was cancelled; anything else on today.
  const cancelDate = b.status === 'cancelled' && b.cancelled_on ? b.cancelled_on : manilaToday();
  // Never negative: if a payment was voided after a refund, nothing more can be refunded.
  const refundableCentavos = Math.max(0, centavos(b.paid) - centavos(b.refunded));
  const suggestion = suggestRefund(b.cancellation_policy, b.paid, b.check_in, cancelDate);
  // What is still owed back: the policy share less refunds already recorded. Never below 0, never more than is left to refund.
  if (suggestion) {
    suggestion.already_refunded = b.refunded;
    suggestion.remaining = money(Math.max(0, Math.min(centavos(suggestion.amount) - centavos(b.refunded), refundableCentavos)));
  }
  res.json({
    policy: describePolicy(b.cancellation_policy, b.cancellation_policy_text),
    suggestion,
    paid: b.paid,
    refunded: b.refunded,
    refundable: money(refundableCentavos),
    refunds: rows,
  });
}));

// Record a refund. The total refunded can't exceed the total paid.
router.post('/reservations/:id/refunds', managers, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const body = validate(req.body, {
    amount: { type: 'money', required: true, positive: true, label: 'Amount' },
    refund_date: { type: 'date', required: true, label: 'Refund date' },
    method: { type: 'enum', values: REFUND_METHODS, required: true, label: 'Method' },
    reference_number: { type: 'string', max: 100, label: 'Reference number' },
    reason: { type: 'string', required: true, max: 500, label: 'Reason' },
  });
  if (body.refund_date > manilaToday()) throw validationError({ refund_date: 'Refund date cannot be in the future.' });
  // A retried save (same Idempotency-Key) returns the refund already recorded instead of adding a second.
  const key = req.get('Idempotency-Key');
  if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(400, 'Invalid Idempotency-Key header.', { code: 'BAD_REQUEST' });
  const org = req.user.organization_id;
  await loadRefundBooking(req.user, id);
  // Only this reservation's refunds replay: a key used on another reservation is never shown.
  const replay = async () => {
    const r = await one('SELECT * FROM booking_refunds WHERE organization_id = $1 AND idempotency_key = $2 AND booking_id = $3', [org, key, id]);
    return r ? res.json({ duplicate: true, refund: r }) : null;
  };
  if (key && await replay()) return undefined;
  let refund;
  try {
    refund = await tx(async (db) => {
      // Lock the reservation so two refunds can't both pass the cap.
      await db.query('SELECT booking_id FROM bookings WHERE booking_id = $1 FOR UPDATE', [id]);
      const b = await loadRefundBooking(req.user, id, db);
      const left = centavos(b.paid) - centavos(b.refunded);
      if (centavos(body.amount) > left) {
        const paid = peso(centavos(b.paid));
        const refunded = peso(centavos(b.refunded));
        throw validationError({ amount: left > 0
          ? `Only ${peso(left)} is left to refund (${paid} paid, ${refunded} already refunded).`
          : `Nothing is left to refund (${paid} paid, ${refunded} already refunded).` });
      }
      const { rows: [r] } = await db.query(
        `INSERT INTO booking_refunds (organization_id, booking_id, amount, refund_date, method, reference_number, reason, recorded_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [org, id, body.amount, body.refund_date, body.method, body.reference_number, body.reason, req.user.user_id, key || null]);
      await audit(db, req.user, 'reservation.refund_recorded', 'booking_refund', r.refund_id, { booking_id: id, amount: body.amount, method: body.method });
      return r;
    });
  } catch (err) {
    if (err.constraint === 'booking_refunds_idem_uq') {
      // Two saves with the same key raced on this reservation: the other one won, so replay it.
      if (await replay()) return undefined;
      // Otherwise the key was used for a refund on another reservation.
      throw new HttpError(409, 'This refund request was already used for another reservation. Please reload the page and try again.', { code: 'IDEMPOTENCY_KEY_USED' });
    }
    throw err;
  }
  res.status(201).json({ refund });
}));

// Void a refund. The row stays for the record, and its amount counts toward the cap again.
router.post('/refunds/:id/void', managers, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const r = await one('SELECT * FROM booking_refunds WHERE refund_id = $1 AND organization_id = $2', [id, req.user.organization_id]);
  if (!r) throw notFound();
  await loadRefundBooking(req.user, r.booking_id);
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 500, label: 'Reason' } });
  await tx(async (db) => {
    const { rows: [cur] } = await db.query('SELECT voided_at FROM booking_refunds WHERE refund_id = $1 FOR UPDATE', [id]);
    if (cur.voided_at) throw new HttpError(409, 'This refund is already voided.', { code: 'ALREADY_VOIDED' });
    await db.query('UPDATE booking_refunds SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE refund_id = $1', [id, req.user.user_id, reason]);
    await audit(db, req.user, 'reservation.refund_voided', 'booking_refund', id, { booking_id: r.booking_id, amount: r.amount, reason });
  });
  res.json({ ok: true });
}));

module.exports = router;
