'use strict';

// Guest check-in (registration) form. Each reservation has a private link the
// host sends to the guest; the guest fills in everyone's names, arrival time,
// vehicle plate and uploads ID photos (often required by condo admins).
// ID photos are deleted automatically some days after check-out.

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole, rateLimit } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const storage = require('../lib/storage');

const router = express.Router();
const publicRouter = express.Router();
const managers = requireRole('owner', 'manager');

const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;
const MAX_IDS = 12;
const newToken = () => crypto.randomBytes(18).toString('base64url');
const checkinLink = (token) => `${config.appUrl}/#/checkin/${token}`;

// The booking's check-in token, created on first use.
async function ensureToken(bookingId) {
  const row = await one(
    `UPDATE bookings SET checkin_token = COALESCE(checkin_token, $2) WHERE booking_id = $1 RETURNING checkin_token`, [bookingId, newToken()]);
  return row?.checkin_token || null;
}

async function loadReservation(user, id) {
  const params = [id];
  const row = await one(
    `SELECT b.*, u.unit_name, p.property_name FROM bookings b JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

// ---------------------------------------------------------------- host side
router.get('/reservations/:id/checkin', managers, ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  const token = await ensureToken(b.booking_id);
  const registration = await one('SELECT * FROM guest_registrations WHERE booking_id = $1', [b.booking_id]);
  const files = registration ? (await query(
    `SELECT file_id, file_name, mime_type, uploaded_at FROM files WHERE related_record_type = 'registration' AND related_record_id = $1 ORDER BY uploaded_at`,
    [registration.registration_id])).rows : [];
  res.json({ link: checkinLink(token), registration, files });
}));

router.post('/reservations/:id/checkin/new-link', managers, ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  const { checkin_token: token } = await one('UPDATE bookings SET checkin_token = $2 WHERE booking_id = $1 RETURNING checkin_token', [b.booking_id, newToken()]);
  await audit(null, req.user, 'checkin.link_replaced', 'booking', b.booking_id);
  res.json({ link: checkinLink(token) });
}));

// ---------------------------------------------------------------- guest side (public, by private link)
const guestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `checkin|${req.ip}` });
publicRouter.use('/public/checkin', guestLimiter);

async function loadByToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw notFound('This check-in link is not valid. Please ask your host for a new one.');
  const b = await one(
    `SELECT b.booking_id, b.organization_id, b.check_in, b.check_out, b.num_guests, b.status, b.confirmation_code,
            u.unit_name, u.max_guests, to_char(u.checkin_time, 'HH24:MI') AS checkin_time, to_char(u.checkout_time, 'HH24:MI') AS checkout_time,
            p.property_name, p.city, o.name AS workspace_name, o.is_demo,
            COALESCE(g.full_name, b.guest_label) AS guest_name,
            (b.status <> 'confirmed' OR b.check_out < ${TODAY}) AS closed
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.checkin_token = $1 AND b.kind = 'reservation'`, [token]);
  if (!b) throw notFound('This check-in link is not valid. Please ask your host for a new one.');
  return b;
}

publicRouter.get('/public/checkin/:token', ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  const r = await one('SELECT * FROM guest_registrations WHERE booking_id = $1', [b.booking_id]);
  const ids = r ? (await one(`SELECT COUNT(*)::int AS n FROM files WHERE related_record_type = 'registration' AND related_record_id = $1`, [r.registration_id])).n : 0;
  res.json({
    stay: {
      workspace_name: b.workspace_name, listing: b.unit_name, property: b.property_name, city: b.city,
      check_in: b.check_in, check_out: b.check_out, checkin_time: b.checkin_time, checkout_time: b.checkout_time,
      guests_allowed: b.max_guests || 20, num_guests: b.num_guests, code: b.confirmation_code,
      guest_first_name: String(b.guest_name || '').split(' ')[0] || null, closed: b.closed,
      id_retention_days: config.guestIdRetentionDays,
    },
    // The guest's own answers so they can review and edit them (ID photos are never sent back).
    registration: r && {
      lead_name: r.lead_name, phone: r.phone, email: r.email, guests: r.guests, arrival_time: r.arrival_time,
      vehicle_plate: r.vehicle_plate, notes: r.notes, submitted_at: r.submitted_at, id_count: ids,
    },
  });
}));

publicRouter.post('/public/checkin/:token', express.json({ limit: '50kb' }), ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  if (b.closed) throw new HttpError(409, 'This stay has ended or was cancelled, so the form is closed.', { code: 'CLOSED' });
  if (b.is_demo) throw new HttpError(403, 'This is a demo.', { code: 'DEMO_READ_ONLY' });
  const body = validate(req.body, {
    lead_name: { type: 'string', required: true, max: 120, label: 'Your full name' },
    phone: { type: 'phone', required: true, label: 'Mobile number' },
    email: { type: 'email', label: 'Email' },
    arrival_time: { type: 'time', label: 'Arrival time' },
    vehicle_plate: { type: 'string', max: 20, label: 'Plate number' },
    notes: { type: 'text', max: 1000, label: 'Notes' },
    consent: { type: 'bool', label: 'Consent' },
  });
  if (!body.consent) throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { consent: 'Please agree so your host can register you with the building.' } });
  const raw = Array.isArray(req.body.guests) ? req.body.guests : [];
  const guests = raw.map((g) => (typeof g === 'string' ? g.trim().slice(0, 120) : '')).filter(Boolean);
  if (guests.length + 1 > (b.max_guests || 20)) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { guests: `This unit allows up to ${b.max_guests} guests in total.` } });
  }
  const plate = body.vehicle_plate ? body.vehicle_plate.toUpperCase() : null;
  const existed = await one('SELECT registration_id FROM guest_registrations WHERE booking_id = $1', [b.booking_id]);
  const r = await one(
    `INSERT INTO guest_registrations (organization_id, booking_id, lead_name, phone, email, guests, arrival_time, vehicle_plate, notes, consent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (booking_id) DO UPDATE SET lead_name = $3, phone = $4, email = $5, guests = $6, arrival_time = $7, vehicle_plate = $8,
       notes = $9, consent_at = now(), updated_at = now()
     RETURNING registration_id`,
    [b.organization_id, b.booking_id, body.lead_name, body.phone, body.email, JSON.stringify(guests), body.arrival_time, plate, body.notes]);
  // Let the host know in the guest's inbox thread.
  await noteToHost(b.booking_id, existed ? 'The guest updated their check-in form.' : `The guest completed the check-in form (${guests.length + 1} guest${guests.length ? 's' : ''}${plate ? `, car ${plate}` : ''}${body.arrival_time ? `, arriving ${body.arrival_time}` : ''}).`);
  res.json({ ok: true, registration_id: r.registration_id });
}));

publicRouter.post('/public/checkin/:token/id', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: config.maxUploadBytes }), ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  if (b.closed) throw new HttpError(409, 'This stay has ended or was cancelled, so the form is closed.', { code: 'CLOSED' });
  if (b.is_demo) throw new HttpError(403, 'This is a demo.', { code: 'DEMO_READ_ONLY' });
  const r = await one('SELECT registration_id FROM guest_registrations WHERE booking_id = $1', [b.booking_id]);
  if (!r) throw new HttpError(409, 'Please save the form first, then add the ID photos.', { code: 'NO_FORM' });
  const mime = String(req.get('Content-Type') || '').split(';')[0].trim();
  if (!storage.checkUpload(mime, req.body, { imagesOnly: true })) throw new HttpError(415, 'Upload a photo (JPG, PNG or WEBP) up to 10 MB.', { code: 'UNSUPPORTED_FILE' });
  const { n } = await one(`SELECT COUNT(*)::int AS n FROM files WHERE related_record_type = 'registration' AND related_record_id = $1`, [r.registration_id]);
  if (n >= MAX_IDS) throw new HttpError(409, `You can upload up to ${MAX_IDS} ID photos.`, { code: 'TOO_MANY' });
  const file = await storage.saveFile({
    organizationId: b.organization_id, recordType: 'registration', recordId: r.registration_id, body: req.body, mime,
    fileName: `guest-id-${n + 1}.${storage.ALLOWED[mime].ext}`,
  });
  res.status(201).json({ ok: true, id_count: n + 1, file_id: file.file_id });
}));

async function noteToHost(bookingId, text) {
  try {
    const messaging = require('../lib/messaging');
    const conv = await messaging.getOrCreateConversation(bookingId);
    await query(
      `INSERT INTO messages (conversation_id, organization_id, direction, from_name, body, status) VALUES ($1,$2,'note','BalayHub',$3,'note')`,
      [conv.conversation_id, conv.organization_id, text]);
    await query(`UPDATE conversations SET unread = true, status = 'open', snoozed_until = NULL, last_message_at = now() WHERE conversation_id = $1`, [conv.conversation_id]);
  } catch (err) { console.error('[checkin] note failed:', err.message); }
}

// Scheduler: delete guest ID photos some days after check-out (privacy).
async function purgeOldIds() {
  const days = config.guestIdRetentionDays;
  const { rows } = await query(
    `SELECT r.registration_id FROM guest_registrations r JOIN bookings b USING (booking_id)
      WHERE r.ids_purged_at IS NULL AND (b.check_out < ${TODAY} - $1::int OR b.status = 'cancelled')`, [days]);
  for (const r of rows) {
    const { rows: files } = await query(`SELECT * FROM files WHERE related_record_type = 'registration' AND related_record_id = $1`, [r.registration_id]);
    for (const f of files) await storage.deleteFile(f);
    await query('UPDATE guest_registrations SET ids_purged_at = now() WHERE registration_id = $1', [r.registration_id]);
  }
  return rows.length;
}

module.exports = { router, publicRouter, purgeOldIds, ensureToken, checkinLink };
