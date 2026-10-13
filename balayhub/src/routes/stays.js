'use strict';

// Short-term rentals: listings, reservations, guests, calendar, nightly rates,
// blocks, cleaning status, homepage stats and channel (iCal) sync.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam, isValidDate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadUnit } = require('../lib/access');
const ical = require('../lib/ical');
const { ensureTaskForBooking, syncOpenTasks } = require('../lib/housekeeping');
const receipts = require('../lib/receipts');
// The amount owed changed: close the guest's open online-payment checkouts (lazy require: circular-safe).
const closeOpenCheckouts = (bookingId) => require('./balancepay').closeOpenCheckouts(bookingId);

const router = express.Router();
const managers = requireRole('owner', 'manager');

const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;
const CHANNELS = ['direct', 'airbnb', 'booking', 'agoda', 'vrbo', 'expedia', 'tripcom', 'other'];
const METHODS = ['cash', 'bank_transfer', 'gcash', 'maya', 'card', 'channel_payout', 'other'];

const today = async () => (await one(`SELECT ${TODAY} AS d`)).d;
const addDays = ical.addDays;
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

function redactGuest(user, g) {
  if (!g || user.role !== 'staff') return g;
  const { email, phone, notes, guest_email: ge, guest_phone: gp, ...rest } = g;
  return { ...rest, limited: true };
}

// Guests are workspace-level; non-owners see guests with stays in their
// assigned properties, plus guests with no stays yet.
function guestScope(user, params, alias = 'g') {
  params.push(user.organization_id);
  let sql = `${alias}.organization_id = $${params.length}`;
  if (user.role !== 'owner') {
    params.push(user.user_id);
    sql += ` AND (NOT EXISTS (SELECT 1 FROM bookings bx WHERE bx.guest_id = ${alias}.guest_id)
              OR EXISTS (SELECT 1 FROM bookings bx JOIN units ux ON ux.unit_id = bx.unit_id
                           JOIN property_assignments pa ON pa.property_id = ux.property_id AND pa.user_id = $${params.length}
                          WHERE bx.guest_id = ${alias}.guest_id))`;
  }
  return sql;
}

const BOOKING_SELECT = `
  SELECT b.*, u.unit_name, u.max_guests, p.property_id, p.property_name,
         g.full_name AS guest_name, g.email AS guest_email, g.phone AS guest_phone,
         (b.check_out - b.check_in) AS nights,
         COALESCE((SELECT SUM(bp.amount) FROM booking_payments bp WHERE bp.booking_id = b.booking_id AND bp.voided_at IS NULL), 0)::numeric(12,2) AS amount_paid,
         (b.total_amount - COALESCE((SELECT SUM(bp.amount) FROM booking_payments bp WHERE bp.booking_id = b.booking_id AND bp.voided_at IS NULL), 0))::numeric(12,2) AS balance
    FROM bookings b
    JOIN units u ON u.unit_id = b.unit_id
    JOIN properties p ON p.property_id = u.property_id
    LEFT JOIN guests g ON g.guest_id = b.guest_id`;

async function loadBooking(user, id, db) {
  const params = [id];
  const sql = `${BOOKING_SELECT} WHERE b.booking_id = $1 AND ${propertyScope(user, params)}`;
  const row = db ? (await db.query(sql, params)).rows[0] : await one(sql, params);
  if (!row) throw notFound();
  return row;
}

async function overlapError(unitId, checkIn, checkOut, exceptId) {
  const clash = await one(
    `SELECT b.kind, b.check_in, b.check_out, b.confirmation_code, COALESCE(g.full_name, b.guest_label) AS who
       FROM bookings b LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.unit_id = $1 AND b.status = 'confirmed' AND daterange(b.check_in, b.check_out) && daterange($2::date, $3::date)
        AND b.booking_id IS DISTINCT FROM $4 LIMIT 1`, [unitId, checkIn, checkOut, exceptId || null]);
  const what = clash
    ? (clash.kind === 'block' ? `a block (${clash.check_in} to ${clash.check_out})` : `${clash.who || 'another guest'}'s stay ${clash.check_in} to ${clash.check_out} (${clash.confirmation_code})`)
    : 'another booking';
  return new HttpError(409, `These dates overlap ${what} on this listing.`, { code: 'DATES_TAKEN', fields: { check_in: 'Dates not available', check_out: 'Dates not available' } });
}

const { quote } = require('../lib/pricing');

// ---------------------------------------------------------------- listings
router.get('/listings', ah(async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `SELECT u.unit_id, u.unit_name, u.unit_type, u.nightly_rate, u.cleaning_fee, u.max_guests, u.cleaning_status,
            to_char(u.checkin_time, 'HH24:MI') AS checkin_time, to_char(u.checkout_time, 'HH24:MI') AS checkout_time,
            p.property_id, p.property_name, p.city,
            (SELECT COUNT(*) FROM ical_feeds f WHERE f.unit_id = u.unit_id) AS channel_count,
            cur.booking_id AS current_booking_id, COALESCE(cg.full_name, cur.guest_label) AS current_guest,
            cur.check_out AS current_check_out,
            nxt.check_in AS next_check_in, COALESCE(ng.full_name, nxt.guest_label) AS next_guest
       FROM units u
       JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN LATERAL (SELECT * FROM bookings b WHERE b.unit_id = u.unit_id AND b.kind = 'reservation' AND b.status = 'confirmed'
                            AND b.check_in <= ${TODAY} AND b.check_out > ${TODAY} LIMIT 1) cur ON true
       LEFT JOIN guests cg ON cg.guest_id = cur.guest_id
       LEFT JOIN LATERAL (SELECT * FROM bookings b WHERE b.unit_id = u.unit_id AND b.kind = 'reservation' AND b.status = 'confirmed'
                            AND b.check_in > ${TODAY} ORDER BY b.check_in LIMIT 1) nxt ON true
       LEFT JOIN guests ng ON ng.guest_id = nxt.guest_id
      WHERE ${scope} AND u.status = 'active' AND p.status = 'active'
      ORDER BY p.property_name, u.unit_name`, params);
  res.json({ listings: rows });
}));

router.post('/units/:id/cleaning', ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const { status } = validate(req.body, { status: { type: 'enum', values: ['clean', 'dirty'], required: true, label: 'Status' } });
  await query('UPDATE units SET cleaning_status = $2, cleaning_updated_at = now() WHERE unit_id = $1', [unit.unit_id, status]);
  if (status === 'clean') {
    // Marking the listing clean finishes its open cleaning tasks that are due.
    await query(
      `UPDATE cleaning_tasks SET status = 'done', completed_at = now(), completed_by = $2, started_at = COALESCE(started_at, now())
        WHERE unit_id = $1 AND status IN ('todo', 'in_progress') AND due_date <= ${TODAY}`, [unit.unit_id, req.user.user_id]);
  }
  await audit(null, req.user, `cleaning.${status}`, 'unit', unit.unit_id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- guests
const guestSpec = {
  full_name: { type: 'string', required: true, max: 120, label: 'Guest name' },
  email: { type: 'email', label: 'Email' },
  phone: { type: 'phone', label: 'Mobile number' },
  notes: { type: 'text', max: 1000, label: 'Notes' },
};

router.get('/guests', ah(async (req, res) => {
  const params = [];
  const where = [guestScope(req.user, params)];
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100)}%`);
    const n = params.length;
    where.push(req.user.role === 'staff' ? `g.full_name ILIKE $${n}` : `(g.full_name ILIKE $${n} OR g.email ILIKE $${n} OR g.phone ILIKE $${n})`);
  }
  const { rows } = await query(
    `SELECT g.*, (SELECT COUNT(*) FROM bookings b WHERE b.guest_id = g.guest_id AND b.status = 'confirmed') AS stays,
            (SELECT MAX(b.check_in) FROM bookings b WHERE b.guest_id = g.guest_id AND b.status = 'confirmed') AS last_stay
       FROM guests g WHERE ${where.join(' AND ')} ORDER BY g.full_name LIMIT 500`, params);
  res.json({ guests: rows.map((g) => redactGuest(req.user, g)) });
}));

async function loadGuest(user, id) {
  const params = [id];
  const g = await one(`SELECT g.* FROM guests g WHERE g.guest_id = $1 AND ${guestScope(user, params)}`, params);
  if (!g) throw notFound();
  return g;
}

router.get('/guests/:id', ah(async (req, res) => {
  const guest = await loadGuest(req.user, uuidParam(req.params.id));
  const params = [guest.guest_id];
  const { rows: stays } = await query(
    `${BOOKING_SELECT} WHERE b.guest_id = $1 AND ${propertyScope(req.user, params)} ORDER BY b.check_in DESC`, params);
  res.json({ guest: redactGuest(req.user, guest), stays: stays.map((s) => redactGuest(req.user, s)) });
}));

router.post('/guests', managers, ah(async (req, res) => {
  const body = validate(req.body, guestSpec);
  const { rows: [g] } = await query(
    `INSERT INTO guests (organization_id, full_name, email, phone, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.organization_id, body.full_name, body.email, body.phone, body.notes, req.user.user_id]);
  await audit(null, req.user, 'guest.created', 'guest', g.guest_id);
  res.status(201).json({ guest: g });
}));

router.patch('/guests/:id', managers, ah(async (req, res) => {
  const guest = await loadGuest(req.user, uuidParam(req.params.id));
  const body = validate(req.body, guestSpec, { partial: true });
  const keys = Object.keys(body);
  if (keys.length) {
    await query(`UPDATE guests SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE guest_id = $1`,
      [guest.guest_id, ...keys.map((k) => body[k])]);
    await audit(null, req.user, 'guest.updated', 'guest', guest.guest_id, { fields: keys });
  }
  res.json({ guest: await loadGuest(req.user, guest.guest_id) });
}));

// ---------------------------------------------------------------- reservations
const VIEWS = {
  upcoming: { where: `b.status = 'confirmed' AND b.check_in >= ${TODAY}`, order: 'b.check_in, b.created_at' },
  hosting: { where: `b.status = 'confirmed' AND b.check_in <= ${TODAY} AND b.check_out > ${TODAY}`, order: 'b.check_out' },
  arrivals_today: { where: `b.status = 'confirmed' AND b.check_in = ${TODAY}`, order: 'u.unit_name' },
  arrivals_tomorrow: { where: `b.status = 'confirmed' AND b.check_in = ${TODAY} + 1`, order: 'u.unit_name' },
  departures_today: { where: `b.status = 'confirmed' AND b.check_out = ${TODAY}`, order: 'u.unit_name' },
  departures_tomorrow: { where: `b.status = 'confirmed' AND b.check_out = ${TODAY} + 1`, order: 'u.unit_name' },
  unpaid: { where: `b.status = 'confirmed' AND b.check_out >= ${TODAY} AND b.total_amount > COALESCE((SELECT SUM(bp.amount) FROM booking_payments bp WHERE bp.booking_id = b.booking_id AND bp.voided_at IS NULL), 0)`, order: 'b.check_in' },
  past: { where: `b.status = 'confirmed' AND b.check_out < ${TODAY}`, order: 'b.check_out DESC' },
  cancelled: { where: `b.status = 'cancelled'`, order: 'b.cancelled_at DESC NULLS LAST' },
  recent: { where: 'true', order: 'b.created_at DESC' },
  all: { where: 'true', order: 'b.check_in DESC' },
};

function reservationQuery(req) {
  const view = VIEWS[req.query.view] ? req.query.view : 'upcoming';
  const params = [];
  const where = [propertyScope(req.user, params), `b.kind = 'reservation'`, VIEWS[view].where];
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100)}%`);
    const n = params.length;
    where.push(`(g.full_name ILIKE $${n} OR b.guest_label ILIKE $${n} OR b.confirmation_code ILIKE $${n} OR u.unit_name ILIKE $${n} OR p.property_name ILIKE $${n})`);
  }
  if (req.query.unit_id) { params.push(uuidParam(req.query.unit_id)); where.push(`b.unit_id = $${params.length}`); }
  if (CHANNELS.includes(req.query.channel)) { params.push(req.query.channel); where.push(`b.channel = $${params.length}`); }
  if (isValidDate(req.query.from)) { params.push(req.query.from); where.push(`b.check_in >= $${params.length}`); }
  if (isValidDate(req.query.to)) { params.push(req.query.to); where.push(`b.check_in <= $${params.length}`); }
  return { view, sql: `${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${VIEWS[view].order} LIMIT 1000`, params };
}

router.get('/reservations', ah(async (req, res) => {
  const { view, sql, params } = reservationQuery(req);
  const { rows } = await query(sql, params);
  res.json({ view, reservations: rows.map((r) => redactGuest(req.user, r)) });
}));

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/reservations/export', ah(async (req, res) => {
  const { view, sql, params } = reservationQuery(req);
  const { rows } = await query(sql, params);
  const head = ['Confirmation code', 'Check-in', 'Check-out', 'Nights', 'Listing', 'Property', 'Guest', 'Guests', 'Channel', 'Status', 'Total', 'Paid', 'Balance'];
  const lines = [head, ...rows.map((r) => [r.confirmation_code, r.check_in, r.check_out, r.nights, r.unit_name, r.property_name,
    r.guest_name || r.guest_label, r.num_guests, r.channel, r.status, r.total_amount, r.amount_paid, r.balance])];
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="balayhub-reservations-${view}.csv"`);
  res.send(`﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`);
}));

router.get('/reservations/quote', ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.query.unit_id));
  const { check_in: ci, check_out: co } = req.query;
  if (!isValidDate(ci) || !isValidDate(co) || co <= ci) throw validationError({ check_out: 'Check-out must be after check-in.' });
  if (nightsBetween(ci, co) > 366) throw validationError({ check_out: 'Stays are limited to one year.' });
  const q = await quote(unit.unit_id, ci, co);
  res.json({ ...q, cleaning_fee: unit.cleaning_fee, max_guests: unit.max_guests });
}));

router.get('/reservations/:id', ah(async (req, res) => {
  const booking = await loadBooking(req.user, uuidParam(req.params.id));
  const { rows: payments } = await query(
    `SELECT bp.*, u.full_name AS recorded_by_name FROM booking_payments bp LEFT JOIN users u ON u.user_id = bp.recorded_by
      WHERE bp.booking_id = $1 ORDER BY bp.payment_date DESC, bp.created_at DESC`, [booking.booking_id]);
  res.json({ reservation: redactGuest(req.user, booking), payments });
}));

const reservationSpec = {
  unit_id: { type: 'uuid', required: true, label: 'Listing' },
  check_in: { type: 'date', required: true, label: 'Check-in' },
  check_out: { type: 'date', required: true, label: 'Check-out' },
  guest_id: { type: 'uuid', label: 'Guest' },
  guest_name: { type: 'string', max: 120, label: 'Guest name' },
  guest_phone: { type: 'phone', label: 'Guest mobile' },
  guest_email: { type: 'email', label: 'Guest email' },
  num_guests: { type: 'int', min: 1, max: 50, label: 'Number of guests' },
  channel: { type: 'enum', values: CHANNELS, label: 'Booked through' },
  accommodation_total: { type: 'money', label: 'Accommodation total' },
  cleaning_fee: { type: 'money', label: 'Cleaning fee' },
  other_fees: { type: 'money', label: 'Other fees' },
  notes: { type: 'text', max: 1000, label: 'Notes' },
  send_confirmation: { type: 'bool', label: 'Email confirmation' },
};

function checkStay(body, unit) {
  if (body.check_out <= body.check_in) throw validationError({ check_out: 'Check-out must be after check-in.' });
  if (nightsBetween(body.check_in, body.check_out) > 366) throw validationError({ check_out: 'Stays are limited to one year.' });
  if (body.num_guests && unit.max_guests && body.num_guests > unit.max_guests) {
    throw validationError({ num_guests: `This listing allows up to ${unit.max_guests} guests.` });
  }
}

router.post('/reservations', managers, ah(async (req, res) => {
  const body = validate(req.body, reservationSpec);
  const unit = await loadUnit(req.user, body.unit_id);
  if (unit.status !== 'active' || unit.property_status !== 'active') throw new HttpError(409, 'This listing is archived.', { code: 'ARCHIVED' });
  checkStay(body, unit);
  if (body.guest_id) await loadGuest(req.user, body.guest_id);
  else if (!body.guest_name) throw validationError({ guest_name: 'Enter the guest name or choose an existing guest.' });

  let accommodation = body.accommodation_total;
  if (accommodation === null) {
    const q = await quote(unit.unit_id, body.check_in, body.check_out);
    if (q.missing_rates) throw validationError({ accommodation_total: 'This listing has no nightly rate for some of these nights. Enter the accommodation total.' });
    accommodation = q.accommodation_total;
  }
  try {
    const id = await tx(async (db) => {
      let guestId = body.guest_id;
      if (!guestId) {
        const { rows: [g] } = await db.query(
          `INSERT INTO guests (organization_id, full_name, email, phone, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING guest_id`,
          [req.user.organization_id, body.guest_name, body.guest_email, body.guest_phone, req.user.user_id]);
        guestId = g.guest_id;
      }
      const { rows: [b] } = await db.query(
        `INSERT INTO bookings (organization_id, unit_id, kind, guest_id, channel, check_in, check_out, num_guests,
                               accommodation_total, cleaning_fee, other_fees, confirmation_code, notes, created_by)
         VALUES ($1,$2,'reservation',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING booking_id, confirmation_code`,
        [req.user.organization_id, unit.unit_id, guestId, body.channel || 'direct', body.check_in, body.check_out, body.num_guests,
          accommodation, body.cleaning_fee ?? unit.cleaning_fee ?? '0.00', body.other_fees || '0.00', ical.randomCode('BH'), body.notes, req.user.user_id]);
      await audit(db, req.user, 'reservation.created', 'booking', b.booking_id, { code: b.confirmation_code, check_in: body.check_in, check_out: body.check_out });
      // Claim the "on booking" automation now, so it can't also send the confirmation.
      if (body.send_confirmation) await receipts.claimConfirmation(db, b.booking_id, req.user.organization_id);
      return b.booking_id;
    });
    const confirmation = body.send_confirmation ? await receipts.sendConfirmation(id, req.user) : null;
    res.status(201).json({ reservation: await loadBooking(req.user, id), confirmation });
  } catch (err) {
    if (err.constraint === 'bookings_no_overlap') throw await overlapError(unit.unit_id, body.check_in, body.check_out);
    throw err;
  }
}));

router.patch('/reservations/:id', managers, ah(async (req, res) => {
  const booking = await loadBooking(req.user, uuidParam(req.params.id));
  if (booking.kind !== 'reservation') throw notFound();
  if (booking.status !== 'confirmed') throw new HttpError(409, 'Cancelled reservations cannot be changed.', { code: 'CANCELLED' });
  const body = validate(req.body, {
    unit_id: reservationSpec.unit_id, check_in: reservationSpec.check_in, check_out: reservationSpec.check_out,
    num_guests: reservationSpec.num_guests, channel: reservationSpec.channel, accommodation_total: reservationSpec.accommodation_total,
    cleaning_fee: reservationSpec.cleaning_fee, other_fees: reservationSpec.other_fees, notes: reservationSpec.notes,
  }, { partial: true });
  for (const k of ['unit_id', 'check_in', 'check_out', 'channel', 'accommodation_total', 'cleaning_fee', 'other_fees']) {
    if (k in body && body[k] === null) delete body[k];
  }
  if (booking.ical_feed_id && (body.check_in || body.check_out || body.unit_id)) {
    throw new HttpError(409, 'Dates for this stay come from the channel calendar. Change them on the channel; BalayHub updates on the next sync.', { code: 'CHANNEL_MANAGED' });
  }
  const merged = { ...booking, ...body };
  const unit = await loadUnit(req.user, merged.unit_id);
  checkStay(merged, unit);
  const keys = Object.keys(body);
  if (!keys.length) return res.json({ reservation: booking });
  try {
    await tx(async (db) => {
      await db.query(`UPDATE bookings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE booking_id = $1`,
        [booking.booking_id, ...keys.map((k) => body[k])]);
      await audit(db, req.user, 'reservation.updated', 'booking', booking.booking_id, {
        before: Object.fromEntries(keys.map((k) => [k, booking[k]])), after: body });
      await syncOpenTasks(booking.booking_id, db);
    });
  } catch (err) {
    if (err.constraint === 'bookings_no_overlap') throw await overlapError(merged.unit_id, merged.check_in, merged.check_out, booking.booking_id);
    throw err;
  }
  await closeOpenCheckouts(booking.booking_id);
  res.json({ reservation: redactGuest(req.user, await loadBooking(req.user, booking.booking_id)) });
}));

router.post('/reservations/:id/cancel', managers, ah(async (req, res) => {
  const booking = await loadBooking(req.user, uuidParam(req.params.id));
  if (booking.kind !== 'reservation') throw notFound();
  if (booking.status === 'cancelled') throw new HttpError(409, 'This reservation is already cancelled.', { code: 'CANCELLED' });
  if (booking.ical_feed_id) {
    throw new HttpError(409, 'This stay comes from a channel calendar. Cancel it on the channel; BalayHub updates on the next sync.', { code: 'CHANNEL_MANAGED' });
  }
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 300, label: 'Reason' } });
  await query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE booking_id = $1`,
    [booking.booking_id, reason]);
  await audit(null, req.user, 'reservation.cancelled', 'booking', booking.booking_id, { reason });
  await closeOpenCheckouts(booking.booking_id);
  res.json({ ok: true });
}));

// Check-in / check-out. Checking out marks the listing dirty for cleaning.
router.post('/reservations/:id/stay-status', ah(async (req, res) => {
  const booking = await loadBooking(req.user, uuidParam(req.params.id));
  if (booking.kind !== 'reservation' || booking.status !== 'confirmed') throw new HttpError(409, 'Only confirmed reservations can be checked in or out.', { code: 'CANCELLED' });
  const { action } = validate(req.body, { action: { type: 'enum', values: ['check_in', 'undo_check_in', 'check_out', 'undo_check_out'], required: true, label: 'Action' } });
  const d = await today();
  if (action === 'check_in' && booking.check_in > d) throw new HttpError(409, `Check-in is on ${booking.check_in}.`, { code: 'TOO_EARLY' });
  if (action === 'check_out' && !booking.checked_in_at) throw new HttpError(409, 'Check the guest in first.', { code: 'NOT_CHECKED_IN' });
  await tx(async (db) => {
    const set = {
      check_in: 'checked_in_at = COALESCE(checked_in_at, now())',
      undo_check_in: 'checked_in_at = NULL, checked_out_at = NULL',
      check_out: 'checked_out_at = COALESCE(checked_out_at, now())',
      undo_check_out: 'checked_out_at = NULL',
    }[action];
    await db.query(`UPDATE bookings SET ${set}, updated_at = now() WHERE booking_id = $1`, [booking.booking_id]);
    if (action === 'check_out') {
      await db.query(`UPDATE units SET cleaning_status = 'dirty', cleaning_updated_at = now() WHERE unit_id = $1`, [booking.unit_id]);
      await ensureTaskForBooking(booking.booking_id, req.user, db);
    }
    await audit(db, req.user, `reservation.${action}`, 'booking', booking.booking_id);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- reservation payments
router.post('/reservations/:id/payments', ah(async (req, res) => {
  const booking = await loadBooking(req.user, uuidParam(req.params.id));
  if (booking.kind !== 'reservation') throw notFound();
  if (booking.status !== 'confirmed') throw new HttpError(409, 'This reservation is cancelled. Payments cannot be recorded on it.', { code: 'CANCELLED' });
  const body = validate(req.body, {
    amount: { type: 'money', required: true, positive: true, label: 'Amount' },
    payment_date: { type: 'date', required: true, label: 'Payment date' },
    payment_method: { type: 'enum', values: METHODS, required: true, label: 'Method' },
    reference_number: { type: 'string', max: 100, label: 'Reference number' },
    notes: { type: 'text', max: 500, label: 'Notes' },
    send_receipt: { type: 'bool', label: 'Email receipt' },
  });
  if (body.payment_date > await today()) throw validationError({ payment_date: 'Payment date cannot be in the future.' });
  const key = req.get('Idempotency-Key');
  if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(400, 'Invalid Idempotency-Key header.', { code: 'BAD_REQUEST' });
  const org = req.user.organization_id;
  const existing = key && await one('SELECT payment_id FROM booking_payments WHERE organization_id = $1 AND idempotency_key = $2', [org, key]);
  if (existing) return res.json({ duplicate: true, reservation: await loadBooking(req.user, booking.booking_id) });
  let paymentId;
  try {
    paymentId = await tx(async (db) => {
      const receiptNumber = await receipts.nextReceiptNumber(db, org);
      const { rows: [p] } = await db.query(
        `INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, idempotency_key, receipt_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING payment_id`,
        [org, booking.booking_id, body.amount, body.payment_date, body.payment_method, body.reference_number, body.notes, req.user.user_id, key || null, receiptNumber]);
      await audit(db, req.user, 'reservation.payment_recorded', 'booking_payment', p.payment_id, { booking_id: booking.booking_id, amount: body.amount, receipt: receiptNumber });
      return p.payment_id;
    });
  } catch (err) {
    if (err.constraint !== 'booking_payments_idem_uq') throw err;
    return res.json({ duplicate: true, reservation: await loadBooking(req.user, booking.booking_id) });
  }
  await closeOpenCheckouts(booking.booking_id);
  const receipt = body.send_receipt ? await receipts.sendReceipt(paymentId, req.user) : null;
  res.status(201).json({ reservation: await loadBooking(req.user, booking.booking_id), payment_id: paymentId, receipt });
}));

router.post('/booking-payments/:id/void', managers, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const p = await one('SELECT * FROM booking_payments WHERE payment_id = $1 AND organization_id = $2', [id, req.user.organization_id]);
  if (!p) throw notFound();
  await loadBooking(req.user, p.booking_id);
  if (p.voided_at) throw new HttpError(409, 'This payment is already voided.', { code: 'ALREADY_VOIDED' });
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 300, label: 'Reason' } });
  await query('UPDATE booking_payments SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE payment_id = $1', [id, req.user.user_id, reason]);
  await audit(null, req.user, 'reservation.payment_voided', 'booking_payment', id, { amount: p.amount, reason });
  await closeOpenCheckouts(p.booking_id);
  res.json({ ok: true });
}));

async function loadBookingPayment(user, id) {
  const p = await one('SELECT * FROM booking_payments WHERE payment_id = $1 AND organization_id = $2', [id, user.organization_id]);
  if (!p) throw notFound();
  await loadBooking(user, p.booking_id);
  return p;
}

// Printable acknowledgement receipt.
router.get('/booking-payments/:id/receipt', ah(async (req, res) => {
  const p = await loadBookingPayment(req.user, uuidParam(req.params.id));
  const r = await receipts.receiptData(p.payment_id);
  res.json({ receipt: redactGuest(req.user, r) });
}));

router.post('/booking-payments/:id/send-receipt', managers, ah(async (req, res) => {
  const p = await loadBookingPayment(req.user, uuidParam(req.params.id));
  const r = await receipts.sendReceipt(p.payment_id, req.user);
  if (!r.sent) throw new HttpError(409, r.error, { code: 'NOT_SENT' });
  await audit(null, req.user, 'reservation.receipt_sent', 'booking_payment', p.payment_id);
  res.json({ ok: true });
}));

router.post('/reservations/:id/send-confirmation', managers, ah(async (req, res) => {
  const booking = await loadBooking(req.user, uuidParam(req.params.id));
  if (booking.kind !== 'reservation' || booking.status !== 'confirmed') throw new HttpError(409, 'Only confirmed reservations can be confirmed by email.', { code: 'CANCELLED' });
  const r = await receipts.sendConfirmation(booking.booking_id, req.user);
  if (!r.sent) throw new HttpError(409, r.error, { code: 'NOT_SENT' });
  await audit(null, req.user, 'reservation.confirmation_sent', 'booking', booking.booking_id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- blocks
router.post('/blocks', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    unit_id: { type: 'uuid', required: true, label: 'Listing' },
    start_date: { type: 'date', required: true, label: 'First blocked night' },
    end_date: { type: 'date', required: true, label: 'Last blocked night' },
    reason: { type: 'string', max: 200, label: 'Reason' },
  });
  const unit = await loadUnit(req.user, body.unit_id);
  if (body.end_date < body.start_date) throw validationError({ end_date: 'Must be on or after the first blocked night.' });
  const checkOut = addDays(body.end_date, 1);
  if (nightsBetween(body.start_date, checkOut) > 366) throw validationError({ end_date: 'Blocks are limited to one year.' });
  try {
    const { rows: [b] } = await query(
      `INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, block_reason, confirmation_code, created_by)
       VALUES ($1,$2,'block',$3,$4,$5,$6,$7) RETURNING booking_id`,
      [req.user.organization_id, unit.unit_id, body.start_date, checkOut, body.reason || 'Blocked', ical.randomCode('BL'), req.user.user_id]);
    await audit(null, req.user, 'calendar.blocked', 'booking', b.booking_id, { start: body.start_date, end: body.end_date });
    res.status(201).json({ block_id: b.booking_id });
  } catch (err) {
    if (err.constraint === 'bookings_no_overlap') throw await overlapError(unit.unit_id, body.start_date, checkOut);
    throw err;
  }
}));

router.post('/blocks/:id/remove', managers, ah(async (req, res) => {
  const b = await loadBooking(req.user, uuidParam(req.params.id));
  if (b.kind !== 'block') throw notFound();
  if (b.ical_feed_id) throw new HttpError(409, 'This block comes from a channel calendar. Remove it on the channel; BalayHub updates on the next sync.', { code: 'CHANNEL_MANAGED' });
  await query('DELETE FROM bookings WHERE booking_id = $1', [b.booking_id]);
  await audit(null, req.user, 'calendar.unblocked', 'booking', b.booking_id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- calendar & rates
router.get('/calendar', ah(async (req, res) => {
  const start = isValidDate(req.query.start) ? req.query.start : await today();
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 7), 62);
  const end = addDays(start, days);
  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows: listings } = await query(
    `SELECT u.unit_id, u.unit_name, u.nightly_rate, u.cleaning_status, u.max_guests, p.property_id, p.property_name
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND u.status = 'active' AND p.status = 'active'
      ORDER BY p.property_name, u.unit_name`, params);
  const ids = listings.map((l) => l.unit_id);
  const { rows: bookings } = await query(
    `SELECT b.booking_id, b.unit_id, b.kind, b.channel, b.check_in, b.check_out, b.num_guests, b.confirmation_code,
            b.block_reason, b.checked_in_at, b.checked_out_at, b.ical_feed_id IS NOT NULL AS from_channel,
            COALESCE(g.full_name, b.guest_label) AS guest_name
       FROM bookings b LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.unit_id = ANY($1) AND b.status = 'confirmed' AND b.check_in < $3 AND b.check_out > $2
      ORDER BY b.check_in`, [ids, start, end]);
  const { rows: rates } = await query(
    `SELECT unit_id, rate_date, price FROM nightly_rates WHERE unit_id = ANY($1) AND rate_date >= $2 AND rate_date < $3`, [ids, start, end]);
  res.json({ start, days, today: await today(), listings, bookings, rates });
}));

router.put('/rates', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    unit_id: { type: 'uuid', required: true, label: 'Listing' },
    start_date: { type: 'date', required: true, label: 'From' },
    end_date: { type: 'date', required: true, label: 'To' },
    price: { type: 'money', label: 'Nightly price' },
  });
  const unit = await loadUnit(req.user, body.unit_id);
  if (body.end_date < body.start_date) throw validationError({ end_date: 'Must be on or after the start date.' });
  if (nightsBetween(body.start_date, body.end_date) > 366) throw validationError({ end_date: 'Up to one year at a time.' });
  await tx(async (db) => {
    if (body.price === null) {
      await db.query('DELETE FROM nightly_rates WHERE unit_id = $1 AND rate_date BETWEEN $2 AND $3', [unit.unit_id, body.start_date, body.end_date]);
    } else {
      await db.query(
        `INSERT INTO nightly_rates (unit_id, rate_date, price)
         SELECT $1, d::date, $4 FROM generate_series($2::date, $3::date, interval '1 day') d
         ON CONFLICT (unit_id, rate_date) DO UPDATE SET price = EXCLUDED.price`,
        [unit.unit_id, body.start_date, body.end_date, body.price]);
    }
    await audit(db, req.user, 'rates.updated', 'unit', unit.unit_id, body);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- homepage
// Arrivals, departures, turnovers and in-house guests for today, tomorrow or the next 7 days.
router.get('/stays/overview', ah(async (req, res) => {
  const d = await today();
  const range = ['today', 'tomorrow', '7d'].includes(req.query.range) ? req.query.range : 'today';
  const start = range === 'tomorrow' ? addDays(d, 1) : d;
  const end = addDays(start, range === '7d' ? 7 : 1);
  const params = [start, end];
  const scope = propertyScope(req.user, params);
  const base = `${BOOKING_SELECT} WHERE ${scope} AND b.kind = 'reservation' AND b.status = 'confirmed'`;
  const { rows: arrivals } = await query(`${base} AND b.check_in >= $1 AND b.check_in < $2 ORDER BY b.check_in, u.unit_name`, params);
  const { rows: departures } = await query(`${base} AND b.check_out >= $1 AND b.check_out < $2 ORDER BY b.check_out, u.unit_name`, params);
  const { rows: staying } = await query(`${base} AND b.check_in <= $1::date AND b.check_out > $1::date AND b.check_in < $2::date ORDER BY b.check_out`, params);
  const arrivalKeys = new Set(arrivals.map((a) => `${a.unit_id}|${a.check_in}`));
  const turnovers = departures.filter((x) => arrivalKeys.has(`${x.unit_id}|${x.check_out}`));
  const p2 = [];
  const dirty = await one(
    `SELECT COUNT(*) AS n FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE ${propertyScope(req.user, p2)} AND u.status = 'active' AND p.status = 'active' AND u.cleaning_status = 'dirty'`, p2);
  const red = (rows) => rows.map((r) => redactGuest(req.user, r));
  res.json({
    range, start, end,
    arrivals: red(arrivals), departures: red(departures), staying: red(staying),
    turnovers: turnovers.map((t) => ({ unit_id: t.unit_id, unit_name: t.unit_name, property_name: t.property_name, date: t.check_out })),
    guests_staying: staying.reduce((s, r) => s + (r.num_guests || 0), 0),
    dirty_listings: dirty.n,
  });
}));

// Day-by-day check-ins, check-outs, turnovers and occupancy for the next 7 or 30 days.
router.get('/stays/trends', ah(async (req, res) => {
  const days = req.query.days === '30' ? 30 : 7;
  const start = await today();
  const params = [start, days];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `WITH listing AS (
       SELECT u.unit_id FROM units u JOIN properties p ON p.property_id = u.property_id
        WHERE ${scope} AND u.status = 'active' AND p.status = 'active'),
     days AS (SELECT ($1::date + i) AS day FROM generate_series(0, $2 - 1) i),
     res AS (SELECT b.* FROM bookings b JOIN listing l ON l.unit_id = b.unit_id
              WHERE b.status = 'confirmed' AND b.check_out >= $1 AND b.check_in < $1::date + $2)
     SELECT d.day,
            (SELECT COUNT(*) FROM res WHERE kind = 'reservation' AND check_in = d.day) AS check_ins,
            (SELECT COUNT(*) FROM res WHERE kind = 'reservation' AND check_out = d.day) AS check_outs,
            (SELECT COUNT(*) FROM res a JOIN res b2 ON a.unit_id = b2.unit_id AND a.kind = 'reservation' AND b2.kind = 'reservation'
               WHERE a.check_out = d.day AND b2.check_in = d.day) AS turnovers,
            (SELECT COUNT(*) FROM res WHERE kind = 'reservation' AND check_in <= d.day AND check_out > d.day) AS occupied,
            (SELECT COUNT(*) FROM res WHERE kind = 'block' AND check_in <= d.day AND check_out > d.day) AS blocked,
            (SELECT COUNT(*) FROM listing) AS listings
       FROM days d ORDER BY d.day`, params);
  const series = rows.map((r) => {
    const available = r.listings - r.blocked;
    return { day: r.day, check_ins: r.check_ins, check_outs: r.check_outs, turnovers: r.turnovers,
      occupancy: available > 0 ? Math.round((r.occupied / available) * 100) : 0 };
  });
  const sum = (k) => series.reduce((s, r) => s + r[k], 0);
  const occ = rows.reduce((a, r) => ({ o: a.o + r.occupied, n: a.n + Math.max(0, r.listings - r.blocked) }), { o: 0, n: 0 });
  res.json({ days, series, totals: {
    check_ins: sum('check_ins'), check_outs: sum('check_outs'), turnovers: sum('turnovers'),
    occupancy: occ.n ? Math.round((occ.o / occ.n) * 100) : 0 } });
}));

// Revenue for a month vs the previous month. Accommodation is spread evenly
// across the nights of each stay; cleaning and other fees count on check-in.
async function monthRevenue(user, monthStart) {
  const params = [monthStart];
  const scope = propertyScope(user, params);
  const { rows: [m] } = await query(
    `WITH bounds AS (SELECT $1::date AS s, ($1::date + interval '1 month')::date AS e),
     listing AS (SELECT u.unit_id, (u.status = 'active' AND p.status = 'active') AS active
                   FROM units u JOIN properties p ON p.property_id = u.property_id WHERE ${scope}),
     blocked AS (SELECT COUNT(*) AS n FROM bookings b JOIN listing l ON l.unit_id = b.unit_id AND l.active, bounds,
                   generate_series(GREATEST(b.check_in, bounds.s), LEAST(b.check_out, bounds.e) - 1, interval '1 day') g
                  WHERE b.kind = 'block' AND b.status = 'confirmed' AND b.check_in < bounds.e AND b.check_out > bounds.s),
     res AS (SELECT b.* FROM bookings b JOIN listing l ON l.unit_id = b.unit_id, bounds
              WHERE b.kind = 'reservation' AND b.status = 'confirmed' AND b.check_in < bounds.e AND b.check_out > bounds.s),
     nights AS (SELECT r.booking_id, n::date AS night, r.accommodation_total / (r.check_out - r.check_in) AS rate
                  FROM res r, bounds, generate_series(GREATEST(r.check_in, bounds.s), LEAST(r.check_out, bounds.e) - 1, interval '1 day') n)
     SELECT (SELECT COALESCE(SUM(rate), 0) FROM nights) AS accommodation,
            (SELECT COUNT(*) FROM nights) AS booked_nights,
            (SELECT COALESCE(SUM(cleaning_fee + other_fees), 0) FROM res, bounds WHERE check_in >= bounds.s AND check_in < bounds.e) AS fees,
            GREATEST(0, (SELECT COUNT(*) FROM listing WHERE active) * (SELECT e - s FROM bounds) - (SELECT n FROM blocked)) AS capacity_nights,
            (SELECT e - s FROM bounds) AS days_in_month,
            (SELECT json_agg(json_build_object('day', EXTRACT(DAY FROM night)::int, 'adr', round(avg_rate, 2)) ORDER BY night)
               FROM (SELECT night, AVG(rate) AS avg_rate FROM nights GROUP BY night) x) AS daily_adr,
            (SELECT json_agg(json_build_object('week', w, 'revenue', round(amt, 2)) ORDER BY w)
               FROM (SELECT LEAST(((EXTRACT(DAY FROM night)::int - 1) / 7) + 1, 5) AS w, SUM(rate) AS amt FROM nights GROUP BY 1) y) AS weekly`,
    params);
  const accommodation = Number(m.accommodation);
  return {
    month: monthStart.slice(0, 7),
    total_revenue: (accommodation + Number(m.fees)).toFixed(2),
    accommodation: accommodation.toFixed(2),
    fees: Number(m.fees).toFixed(2),
    booked_nights: m.booked_nights,
    adr: m.booked_nights ? (accommodation / m.booked_nights).toFixed(2) : '0.00',
    occupancy: m.capacity_nights ? Math.round((m.booked_nights / m.capacity_nights) * 100) : 0,
    days_in_month: m.days_in_month,
    daily_adr: m.daily_adr || [],
    weekly: m.weekly || [],
  };
}

router.get('/stays/revenue', ah(async (req, res) => {
  const d = await today();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') && isValidDate(`${req.query.month}-01`) ? req.query.month : d.slice(0, 7);
  const start = `${month}-01`;
  const [y, mo] = month.split('-').map(Number);
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 10);
  res.json({ current: await monthRevenue(req.user, start), previous: await monthRevenue(req.user, prev) });
}));

// ---------------------------------------------------------------- channel sync (iCal)
router.get('/units/:id/channels', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  let token = unit.ical_token;
  if (!token) {
    token = ical.newFeedToken();
    await query('UPDATE units SET ical_token = $2 WHERE unit_id = $1 AND ical_token IS NULL', [unit.unit_id, token]);
    token = (await one('SELECT ical_token FROM units WHERE unit_id = $1', [unit.unit_id])).ical_token;
  }
  const { rows: feeds } = await query(
    'SELECT feed_id, channel, url, last_synced_at, last_status, last_message FROM ical_feeds WHERE unit_id = $1 ORDER BY created_at', [unit.unit_id]);
  res.json({ export_url: `${require('../config').appUrl}/ical/${token}.ics`, feeds });
}));

router.post('/units/:id/channels/rotate', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  await query('UPDATE units SET ical_token = $2 WHERE unit_id = $1', [unit.unit_id, ical.newFeedToken()]);
  await audit(null, req.user, 'ical.export_rotated', 'unit', unit.unit_id);
  res.json({ ok: true });
}));

router.post('/ical-feeds', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    unit_id: { type: 'uuid', required: true, label: 'Listing' },
    channel: { type: 'enum', values: ['airbnb', 'booking', 'agoda', 'vrbo', 'expedia', 'tripcom', 'other'], required: true, label: 'Channel' },
    url: { type: 'string', required: true, max: 1000, label: 'Calendar link' },
  });
  const unit = await loadUnit(req.user, body.unit_id);
  const url = ical.validateFeedUrl(body.url);
  if (!url) throw validationError({ url: 'Paste the full https:// calendar (iCal) link from the channel.' });
  let feedId;
  try {
    feedId = (await one(
      `INSERT INTO ical_feeds (organization_id, unit_id, channel, url) VALUES ($1,$2,$3,$4) RETURNING feed_id`,
      [req.user.organization_id, unit.unit_id, body.channel, url.toString()])).feed_id;
  } catch (err) {
    if (err.code === '23505') throw validationError({ url: 'This calendar link is already connected to this listing.' });
    throw err;
  }
  await audit(null, req.user, 'ical.feed_added', 'unit', unit.unit_id, { channel: body.channel });
  const result = await ical.syncFeed(feedId);
  res.status(201).json({ feed_id: feedId, sync: result });
}));

async function loadFeed(user, id) {
  const feed = await one('SELECT * FROM ical_feeds WHERE feed_id = $1 AND organization_id = $2', [id, user.organization_id]);
  if (!feed) throw notFound();
  await loadUnit(user, feed.unit_id);
  return feed;
}

router.post('/ical-feeds/:id/sync', managers, ah(async (req, res) => {
  const feed = await loadFeed(req.user, uuidParam(req.params.id));
  res.json({ sync: await ical.syncFeed(feed.feed_id) });
}));

// Disconnecting a channel cancels its future stays/blocks; past history is kept.
router.post('/ical-feeds/:id/remove', managers, ah(async (req, res) => {
  const feed = await loadFeed(req.user, uuidParam(req.params.id));
  await tx(async (db) => {
    await db.query(`DELETE FROM bookings WHERE ical_feed_id = $1 AND kind = 'block'`, [feed.feed_id]);
    await db.query(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Channel calendar disconnected'
        WHERE ical_feed_id = $1 AND status = 'confirmed' AND check_out >= ${TODAY}
          AND NOT EXISTS (SELECT 1 FROM booking_payments bp WHERE bp.booking_id = bookings.booking_id AND bp.voided_at IS NULL)`, [feed.feed_id]);
    await db.query('DELETE FROM ical_feeds WHERE feed_id = $1', [feed.feed_id]);
    await audit(db, req.user, 'ical.feed_removed', 'unit', feed.unit_id, { channel: feed.channel });
  });
  res.json({ ok: true });
}));

// Public export feed (mounted outside the auth middleware).
const publicRouter = express.Router();
publicRouter.get('/ical/:token.ics', ah(async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound('Calendar not found.');
  const unit = await one(
    `SELECT u.unit_id, u.unit_name, p.property_name FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.ical_token = $1 AND u.status = 'active'`, [token]);
  if (!unit) throw notFound('Calendar not found.');
  const { rows } = await query(
    `SELECT booking_id, kind, check_in, check_out FROM bookings
      WHERE unit_id = $1 AND status = 'confirmed' AND check_out >= ${TODAY} - 7 ORDER BY check_in`, [unit.unit_id]);
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(ical.buildCalendar(`${unit.property_name} ${unit.unit_name}`, rows));
}));

module.exports = router;
module.exports.publicRouter = publicRouter;
