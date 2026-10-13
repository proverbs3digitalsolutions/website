'use strict';

// Refundable security deposits (e.g. ₱1,000 for a staycation). Not income:
// recorded apart from booking payments, then refunded in full or with
// deductions (reason + photos) after check-out, with a statement to the guest.

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const METHODS = ['cash', 'bank_transfer', 'gcash', 'maya', 'card', 'other'];
const METHOD_LABEL = { cash: 'cash', bank_transfer: 'bank transfer', gcash: 'GCash', maya: 'Maya', card: 'card', other: 'other' };
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const peso = (v) => `₱${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (v) => Math.round(Number(v) * 100);

async function loadReservation(user, id) {
  const params = [id];
  const b = await one(
    `SELECT b.booking_id, b.organization_id, b.status, b.check_in::text, b.check_out::text, b.confirmation_code, u.unit_name, u.security_deposit_amount,
            p.property_name, g.full_name AS guest_name, g.email AS guest_email, o.name AS workspace_name
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(user, params)}`, params);
  if (!b) throw notFound();
  return b;
}

async function depositOf(bookingId) {
  const d = await one('SELECT * FROM stay_deposits WHERE booking_id = $1', [bookingId]);
  if (!d) return null;
  const { rows: files } = await query(
    `SELECT file_id, file_name, mime_type FROM files WHERE related_record_type = 'deposit' AND related_record_id = $1 ORDER BY uploaded_at`, [d.deposit_id]);
  return { ...d, files };
}

router.get('/reservations/:id/deposit', ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  res.json({ deposit: await depositOf(b.booking_id), suggested: b.security_deposit_amount && Number(b.security_deposit_amount) > 0 ? b.security_deposit_amount : null });
}));

// Record the deposit received (staff can too: they often collect it at check-in).
router.post('/reservations/:id/deposit', ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  if (b.status !== 'confirmed') throw new HttpError(409, 'This reservation is cancelled.', { code: 'CANCELLED' });
  const body = validate(req.body, {
    amount: { type: 'money', required: true, positive: true, label: 'Amount' },
    received_date: { type: 'date', required: true, label: 'Date received' },
    method: { type: 'enum', values: METHODS, required: true, label: 'Method' },
    reference_number: { type: 'string', max: 100, label: 'Reference' },
    send_receipt: { type: 'bool', label: 'Email receipt' },
  });
  if (body.received_date > manilaToday()) throw validationError({ received_date: 'The date cannot be in the future.' });
  let d;
  try {
    d = await one(
      `INSERT INTO stay_deposits (organization_id, booking_id, amount, received_date, method, reference_number, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.organization_id, b.booking_id, body.amount, body.received_date, body.method, body.reference_number, req.user.user_id]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'A deposit is already recorded for this stay.', { code: 'EXISTS' });
    throw err;
  }
  await audit(null, req.user, 'deposit.received', 'booking', b.booking_id, { amount: body.amount });
  const mail = body.send_receipt ? await emailGuest(b, d, 'received') : null;
  res.status(201).json({ deposit: await depositOf(b.booking_id), receipt: mail });
}));

// Return it: in full, partly (with deductions), or keep it all. Owners and managers.
router.post('/reservations/:id/deposit/settle', managers, ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  const d = await depositOf(b.booking_id);
  if (!d) throw new HttpError(409, 'Record the deposit first.', { code: 'NO_DEPOSIT' });
  if (d.status !== 'held') throw new HttpError(409, 'This deposit has already been settled.', { code: 'SETTLED' });
  const body = validate(req.body, {
    deduction_amount: { type: 'money', label: 'Deduction' },
    deduction_reason: { type: 'text', max: 1000, label: 'Reason for the deduction' },
    refund_method: { type: 'enum', values: METHODS, label: 'Refund method' },
    refund_reference: { type: 'string', max: 100, label: 'Reference' },
    send_receipt: { type: 'bool', label: 'Email the guest' },
  });
  const ded = cents(body.deduction_amount || 0);
  if (ded > cents(d.amount)) throw validationError({ deduction_amount: `The deduction can't be more than the deposit (${peso(d.amount)}).` });
  if (ded > 0 && !body.deduction_reason) throw validationError({ deduction_reason: 'Explain the deduction (the guest sees this).' });
  const refund = cents(d.amount) - ded;
  if (refund > 0 && !body.refund_method) throw validationError({ refund_method: 'Choose how you returned the money.' });
  const status = ded === 0 ? 'refunded' : refund === 0 ? 'kept' : 'partly_refunded';
  const row = await one(
    `UPDATE stay_deposits SET status = $2, deduction_amount = $3, deduction_reason = $4, refund_amount = $5, refund_method = $6, refund_reference = $7,
            settled_at = now(), settled_by = $8
      WHERE deposit_id = $1 AND status = 'held' RETURNING *`,
    [d.deposit_id, status, (ded / 100).toFixed(2), ded ? body.deduction_reason : null, (refund / 100).toFixed(2), refund ? body.refund_method : null,
      refund ? body.refund_reference : null, req.user.user_id]);
  if (!row) throw new HttpError(409, 'This deposit has already been settled.', { code: 'SETTLED' });
  await audit(null, req.user, 'deposit.settled', 'booking', b.booking_id, { status, refund: (refund / 100).toFixed(2), deduction: (ded / 100).toFixed(2) });
  const mail = body.send_receipt ? await emailGuest(b, row, 'settled') : null;
  res.json({ deposit: await depositOf(b.booking_id), receipt: mail });
}));

// Undo a mistake: owners only, back to "held".
router.post('/reservations/:id/deposit/reopen', requireRole('owner'), ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  const r = await one(
    `UPDATE stay_deposits SET status = 'held', deduction_amount = 0, deduction_reason = NULL, refund_amount = NULL, refund_method = NULL,
            refund_reference = NULL, settled_at = NULL, settled_by = NULL WHERE booking_id = $1 AND status <> 'held' RETURNING deposit_id`, [b.booking_id]);
  if (!r) throw new HttpError(409, 'Nothing to undo.', { code: 'NOT_SETTLED' });
  await audit(null, req.user, 'deposit.reopened', 'booking', b.booking_id);
  res.json({ deposit: await depositOf(b.booking_id) });
}));

async function emailGuest(b, d, kind) {
  if (!b.guest_email) return { sent: false, error: 'The guest has no email address.' };
  const { sendMail } = require('../lib/mailer');
  const first = String(b.guest_name || 'Guest').split(' ')[0];
  const stay = `${b.unit_name}, ${b.property_name} (${b.check_in} to ${b.check_out}, booking ${b.confirmation_code})`;
  const text = kind === 'received'
    ? `Hi ${first},\n\nWe received your refundable security deposit of ${peso(d.amount)} by ${METHOD_LABEL[d.method]} on ${d.received_date.toISOString ? d.received_date.toISOString().slice(0, 10) : d.received_date} for ${stay}.\n\nWe'll return it after check-out once the unit has been checked.\n\nSalamat!\n${b.workspace_name}`
    : `Hi ${first},\n\nHere is the summary of your security deposit for ${stay}:\n\nDeposit:   ${peso(d.amount)}\n${Number(d.deduction_amount) > 0 ? `Deduction: ${peso(d.deduction_amount)}\nReason:    ${d.deduction_reason}\n` : ''}Returned:  ${peso(d.refund_amount)}${Number(d.refund_amount) > 0 ? ` by ${METHOD_LABEL[d.refund_method]}${d.refund_reference ? ` (ref. ${d.refund_reference})` : ''}` : ''}\n\nThank you for staying with us${Number(d.deduction_amount) > 0 ? '. If you have questions about the deduction, just reply to this email' : ''}.\n\nSalamat!\n${b.workspace_name}`;
  const r = await sendMail({ to: b.guest_email, subject: kind === 'received' ? `Security deposit received · ${b.confirmation_code}` : `Your security deposit · ${b.confirmation_code}`, text });
  return r.notConfigured || r.error ? { sent: false, error: r.reason || 'Email is not set up yet.' } : { sent: true, to: b.guest_email };
}

// Deposits still held after check-out (for Home).
router.get('/deposits/due', ah(async (req, res) => {
  const params = [manilaToday()];
  const { rows } = await query(
    `SELECT d.booking_id, d.amount, b.check_out::text, u.unit_name, COALESCE(g.full_name, b.guest_label) AS guest_name
       FROM stay_deposits d JOIN bookings b USING (booking_id) JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE d.status = 'held' AND b.check_out <= $1 AND ${propertyScope(req.user, params)} ORDER BY b.check_out LIMIT 20`, params);
  res.json({ deposits: rows });
}));

module.exports = router;
