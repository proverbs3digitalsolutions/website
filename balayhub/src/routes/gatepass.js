'use strict';

// Condo gate pass: many buildings require the guests' names (and IDs) before
// arrival. BalayHub emails the building admin a summary and a private link to
// a printable pass with the ID photos; the admin confirms receipt with a click.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam, EMAIL_RE } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole, rateLimit } = require('../lib/auth');
const { propertyScope, loadProperty } = require('../lib/access');
const { planStatus } = require('../lib/plans');

const router = express.Router();
const publicRouter = express.Router();
const managers = requireRole('owner', 'manager');
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const fmtDate = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (t) => {
  if (!t) return '';
  const [hh, mm] = String(t).split(':').map(Number);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
};
const passLink = (token) => `${config.appUrl}/#/gatepass/${token}`;

function parseEmails(v) {
  const list = String(v || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (list.length > 3 || list.some((x) => x.length > 254 || !EMAIL_RE.test(x))) return null;
  return list;
}

// ---------------------------------------------------------------- settings
router.get('/gatepass/settings', managers, ah(async (req, res) => {
  const params = [];
  const { rows } = await query(
    `SELECT p.property_id, p.property_name, p.city, p.admin_email, p.gatepass_enabled, p.gatepass_days_before, p.gatepass_attach_ids,
            p.gatepass_authorized_by, p.gatepass_notes,
            (SELECT COUNT(*)::int FROM units u WHERE u.property_id = p.property_id AND u.status = 'active' AND u.nightly_rate IS NOT NULL) AS listings
       FROM properties p WHERE p.status = 'active' AND ${propertyScope(req.user, params)} ORDER BY p.property_name`, params);
  res.json({ properties: rows.filter((p) => p.listings > 0) });
}));

router.patch('/properties/:id/gatepass', managers, ah(async (req, res) => {
  const p = await loadProperty(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    admin_email: { type: 'string', max: 800, label: 'Admin email' },
    gatepass_enabled: { type: 'bool', label: 'Send automatically' },
    gatepass_days_before: { type: 'int', min: 0, max: 7, label: 'Days before check-in' },
    gatepass_attach_ids: { type: 'bool', label: 'Attach IDs' },
    gatepass_authorized_by: { type: 'string', max: 120, label: 'Authorized by' },
    gatepass_notes: { type: 'text', max: 1000, label: 'Notes for the admin' },
  }, { partial: true });
  if ('admin_email' in body) {
    const list = parseEmails(body.admin_email);
    if (!list) throw validationError({ admin_email: 'Enter up to 3 valid email addresses, separated by commas.' });
    body.admin_email = list.join(', ') || null;
  }
  const merged = { ...p, ...body };
  if (merged.gatepass_enabled && !merged.admin_email) throw validationError({ admin_email: 'Enter the building admin\'s email first.' });
  const keys = Object.keys(body).filter((k) => body[k] !== undefined && (body[k] !== null || ['admin_email', 'gatepass_authorized_by', 'gatepass_notes'].includes(k)));
  if (keys.length) {
    await query(`UPDATE properties SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE property_id = $1`, [p.property_id, ...keys.map((k) => body[k])]);
    await audit(null, req.user, 'property.gatepass_updated', 'property', p.property_id, { fields: keys });
  }
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- building the pass
async function passData(bookingId) {
  const b = await one(
    `SELECT b.booking_id, b.organization_id, b.status, b.kind, b.check_in::text, b.check_out::text, b.num_guests, b.confirmation_code,
            COALESCE(g.full_name, b.guest_label) AS guest_name, u.unit_name, to_char(u.checkin_time, 'HH24:MI') AS checkin_time,
            to_char(u.checkout_time, 'HH24:MI') AS checkout_time, p.property_id, p.property_name, p.address, p.city,
            p.admin_email, p.gatepass_enabled, p.gatepass_days_before, p.gatepass_attach_ids, p.gatepass_authorized_by, p.gatepass_notes,
            o.name AS workspace_name, o.plan, o.trial_ends_at, o.paid_until, o.is_demo, o.deletion_scheduled_at,
            (SELECT json_build_object('name', full_name, 'email', email) FROM users WHERE organization_id = b.organization_id AND role = 'owner' ORDER BY created_at LIMIT 1) AS owner
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.booking_id = $1`, [bookingId]);
  if (!b) return null;
  b.registration = await one('SELECT * FROM guest_registrations WHERE booking_id = $1', [bookingId]);
  b.ids = b.registration ? (await query(
    `SELECT file_id, file_name, mime_type, storage_key FROM files WHERE related_record_type = 'registration' AND related_record_id = $1 ORDER BY uploaded_at`,
    [b.registration.registration_id])).rows : [];
  return b;
}

function guestNames(b) {
  const r = b.registration;
  return r ? [r.lead_name, ...(Array.isArray(r.guests) ? r.guests : [])].filter(Boolean) : [b.guest_name || 'Guest'];
}

function passText(b, token) {
  const r = b.registration;
  const names = guestNames(b);
  const host = b.gatepass_authorized_by || b.owner?.name || b.workspace_name;
  return [
    'Good day!',
    '',
    `Please allow entry for the following guest${names.length > 1 ? 's' : ''} of ${b.unit_name}, ${b.property_name}:`,
    '',
    ...names.map((n, i) => `  ${i + 1}. ${n}`),
    '',
    `Check-in:  ${fmtDate(b.check_in)}${b.checkin_time ? `, ${fmtTime(b.checkin_time)}` : ''}${r?.arrival_time ? ` (expected arrival ${fmtTime(r.arrival_time)})` : ''}`,
    `Check-out: ${fmtDate(b.check_out)}${b.checkout_time ? `, ${fmtTime(b.checkout_time)}` : ''}`,
    `Number of guests: ${names.length > 1 ? names.length : (b.num_guests || names.length)}`,
    r?.vehicle_plate ? `Vehicle plate: ${r.vehicle_plate}` : null,
    r?.phone ? `Guest mobile: ${r.phone}` : null,
    `Booking reference: ${b.confirmation_code}`,
    b.gatepass_notes ? `\n${b.gatepass_notes}` : null,
    '',
    `Gate pass${b.ids.length ? ' with guest IDs' : ''} (printable): ${passLink(token)}`,
    `Please click to confirm you received this: ${passLink(token)}?ack=1`,
    '',
    `Authorized by: ${host}`,
    b.owner?.email ? `Contact: ${b.owner.email}` : null,
    '',
    'Thank you!',
    `— Sent by BalayHub for ${b.workspace_name}`,
  ].filter((x) => x !== null).join('\n');
}

// Send (or re-send) the pass for a booking. Returns the gate_passes row.
async function sendPass(bookingId, { user = null } = {}) {
  const b = await passData(bookingId);
  if (!b || b.kind !== 'reservation') throw notFound();
  if (b.status !== 'confirmed') throw new HttpError(409, 'This reservation is cancelled.', { code: 'CANCELLED' });
  if (b.is_demo || planStatus(b).read_only) throw new HttpError(409, 'Gate passes can\'t be sent while the workspace is read-only.', { code: 'READ_ONLY' });
  const to = parseEmails(b.admin_email);
  if (!to?.length) throw new HttpError(409, 'Add the building admin\'s email first (Listings → Gate pass settings).', { code: 'NO_ADMIN_EMAIL' });
  const gp = await one(
    `INSERT INTO gate_passes (organization_id, booking_id, token) VALUES ($1,$2,$3)
     ON CONFLICT (booking_id) DO UPDATE SET booking_id = EXCLUDED.booking_id RETURNING *`,
    [b.organization_id, b.booking_id, crypto.randomBytes(18).toString('base64url')]);
  const attachments = b.gatepass_attach_ids ? b.ids.map((f) => ({ filename: f.file_name, path: path.resolve(config.storageDir, f.storage_key), contentType: f.mime_type }))
    .filter((a) => a.path.startsWith(path.resolve(config.storageDir) + path.sep) && fs.existsSync(a.path)) : undefined;
  const { sendMail } = require('../lib/mailer');
  const r = await sendMail({
    to: to.join(', '), replyTo: b.owner?.email || undefined,
    subject: `Guest gate pass: ${b.unit_name}, ${b.property_name} · ${fmtDate(b.check_in)} – ${fmtDate(b.check_out)}`,
    text: passText(b, gp.token), attachments,
  });
  const failed = r.notConfigured || r.error;
  const row = await one(
    `UPDATE gate_passes SET status = CASE WHEN $2 THEN 'failed' ELSE 'sent' END, sent_to = $3, sent_at = CASE WHEN $2 THEN sent_at ELSE now() END,
            send_count = send_count + CASE WHEN $2 THEN 0 ELSE 1 END, acknowledged_at = CASE WHEN $2 THEN acknowledged_at ELSE NULL END, last_error = $4
      WHERE gatepass_id = $1 RETURNING *`,
    [gp.gatepass_id, Boolean(failed), to.join(', '), failed ? (r.reason || 'Email is not set up on this server.') : null]);
  await query(`INSERT INTO audit_logs (organization_id, actor_user_id, action, record_type, record_id, details) VALUES ($1,$2,'gatepass.sent','booking',$3,$4)`,
    [b.organization_id, user?.user_id || null, b.booking_id, JSON.stringify({ to: to.join(', '), ok: !failed, ids: b.gatepass_attach_ids ? b.ids.length : 0 })]);
  if (failed && user) throw new HttpError(502, row.last_error, { code: 'NOT_SENT' });
  return row;
}

// ---------------------------------------------------------------- host: per reservation
async function loadReservation(user, id) {
  const params = [id];
  const b = await one(
    `SELECT b.booking_id, b.status, b.check_in::text, p.property_id, p.admin_email, p.gatepass_enabled, p.gatepass_days_before
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(user, params)}`, params);
  if (!b) throw notFound();
  return b;
}

router.get('/reservations/:id/gatepass', managers, ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  const gp = await one('SELECT status, sent_to, sent_at, send_count, acknowledged_at, last_error, token FROM gate_passes WHERE booking_id = $1', [b.booking_id]);
  res.json({
    admin_email: b.admin_email, auto: b.gatepass_enabled, send_on: addDays(b.check_in, -b.gatepass_days_before), property_id: b.property_id,
    pass: gp ? { ...gp, token: undefined, link: passLink(gp.token) } : null,
  });
}));

router.post('/reservations/:id/gatepass/send', managers, ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  const gp = await sendPass(b.booking_id, { user: req.user });
  res.json({ ok: true, sent_to: gp.sent_to });
}));

// ---------------------------------------------------------------- scheduler
// Send due passes. Waits for the guest's check-in form until the day before
// arrival, then sends with what the booking has; tells the host once if the
// form is still missing.
async function sendDuePasses() {
  const today = manilaToday();
  const { rows } = await query(
    `SELECT b.booking_id, b.check_in::text, (r.registration_id IS NOT NULL) AS has_form, gp.status AS pass_status, gp.missing_form_noted_at
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id
       LEFT JOIN guest_registrations r ON r.booking_id = b.booking_id
       LEFT JOIN gate_passes gp ON gp.booking_id = b.booking_id
      WHERE b.kind = 'reservation' AND b.status = 'confirmed' AND p.gatepass_enabled AND p.admin_email IS NOT NULL AND NOT o.is_demo
        AND b.check_in >= $1::date AND b.check_in - p.gatepass_days_before <= $1::date
        AND (gp.gatepass_id IS NULL OR (gp.status = 'failed' AND gp.send_count = 0 AND gp.created_at > now() - interval '1 day'))
      ORDER BY b.check_in LIMIT 50`, [today]);
  let sent = 0;
  for (const r of rows) {
    const lastChance = r.check_in <= addDays(today, 1);
    if (!r.has_form && !lastChance) continue;
    try {
      await sendPass(r.booking_id);
      sent += 1;
      if (!r.has_form && !r.missing_form_noted_at) {
        await query('UPDATE gate_passes SET missing_form_noted_at = now() WHERE booking_id = $1', [r.booking_id]);
        await noteToHost(r.booking_id, 'Gate pass sent to the building admin with the booking details only: the guest hasn\'t filled in the check-in form (names, IDs). Send it again from the reservation once they do.');
      }
    } catch (err) { console.error('[gatepass] send failed:', err.message); }
  }
  return sent;
}

async function noteToHost(bookingId, text) {
  const messaging = require('../lib/messaging');
  const conv = await messaging.getOrCreateConversation(bookingId);
  await query(`INSERT INTO messages (conversation_id, organization_id, direction, from_name, body, status) VALUES ($1,$2,'note','BalayHub',$3,'note')`,
    [conv.conversation_id, conv.organization_id, text]);
  await query(`UPDATE conversations SET unread = true, status = 'open', last_message_at = now() WHERE conversation_id = $1`, [conv.conversation_id]);
}

// ---------------------------------------------------------------- building admin (public, by private link)
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `gatepass|${req.ip}` });
publicRouter.use('/public/gatepass', adminLimiter);

// The link works until the day after check-out.
async function loadByToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw notFound('This gate pass link is not valid.');
  const gp = await one('SELECT * FROM gate_passes WHERE token = $1', [token]);
  if (!gp) throw notFound('This gate pass link is not valid.');
  const b = await passData(gp.booking_id);
  if (!b || b.status !== 'confirmed' || manilaToday() > addDays(b.check_out, 1)) throw notFound('This gate pass has expired.');
  return { gp, b };
}

publicRouter.get('/public/gatepass/:token', ah(async (req, res) => {
  const { gp, b } = await loadByToken(req.params.token);
  const r = b.registration;
  res.json({
    workspace: b.workspace_name, property: b.property_name, address: [b.address, b.city].filter(Boolean).join(', '), unit: b.unit_name,
    check_in: b.check_in, check_out: b.check_out, checkin_time: fmtTime(b.checkin_time), checkout_time: fmtTime(b.checkout_time),
    guests: guestNames(b), num_guests: b.num_guests, arrival_time: r?.arrival_time ? fmtTime(r.arrival_time) : null, vehicle_plate: r?.vehicle_plate || null,
    guest_phone: r?.phone || null, code: b.confirmation_code, notes: b.gatepass_notes,
    authorized_by: b.gatepass_authorized_by || b.owner?.name || b.workspace_name, contact: b.owner?.email || null,
    ids: b.ids.map((f, i) => ({ n: i + 1, url: `/api/public/gatepass/${req.params.token}/id/${f.file_id}` })),
    acknowledged_at: gp.acknowledged_at,
  });
}));

publicRouter.get('/public/gatepass/:token/id/:fileId', ah(async (req, res) => {
  const { b } = await loadByToken(req.params.token);
  const f = b.ids.find((x) => x.file_id === req.params.fileId);
  if (!f) throw notFound();
  const full = path.resolve(config.storageDir, f.storage_key);
  if (!full.startsWith(path.resolve(config.storageDir) + path.sep)) throw notFound();
  res.set('Content-Type', f.mime_type);
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', 'inline');
  fs.createReadStream(full).on('error', () => res.status(404).end()).pipe(res);
}));

publicRouter.post('/public/gatepass/:token/ack', ah(async (req, res) => {
  const { gp, b } = await loadByToken(req.params.token);
  if (!gp.acknowledged_at) {
    await query(`UPDATE gate_passes SET status = 'acknowledged', acknowledged_at = now() WHERE gatepass_id = $1`, [gp.gatepass_id]);
    await noteToHost(b.booking_id, `The building admin confirmed receiving the gate pass for ${b.unit_name} (${fmtDate(b.check_in)}).`).catch(() => {});
  }
  res.json({ ok: true });
}));

module.exports = { router, publicRouter, sendDuePasses, sendPass };
