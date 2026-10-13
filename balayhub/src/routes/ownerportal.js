'use strict';

// Owner portal API (D-39 to D-44). Unit owners sign in with an emailed link and see only their
// own units. publicRouter mounts before requireWorkspace: its routes check the bh_owner cookie
// instead of a team session. router holds the host's invite and disable actions (workspace owner only).

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole, rateLimit, hashToken } = require('../lib/auth');
const { sendMail } = require('../lib/mailer');
const { addDays, randomCode } = require('../lib/ical');
const {
  issueSignInLink, createOwnerSession, destroyOwnerSession, requireOwnerSession,
} = require('../lib/ownerauth');

const publicRouter = express.Router();
const router = express.Router();
const ownersOnly = requireRole('owner');

// Sign-in attempts are limited per IP and per email (emails are normalised, so case doesn't matter).
const FIFTEEN_MIN = 15 * 60 * 1000;
const loginIpLimiter = rateLimit({ windowMs: FIFTEEN_MIN, max: 40, key: (req) => `owner-login|ip|${req.ip}` });
const loginEmailLimiter = rateLimit({
  windowMs: FIFTEEN_MIN, max: 5,
  key: (req) => `owner-login|mail|${String(req.body?.email || '').trim().toLowerCase()}`,
});
const sessionLimiter = rateLimit({ windowMs: FIFTEEN_MIN, max: 60, key: (req) => `owner-link|ip|${req.ip}` });
// Block creates and cancels share one limit per owner: 20 an hour.
// ponytail: in memory, per server process, like the other limits here. Two processes would count separately.
const blockLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: (req) => `owner-block|${req.portalOwner.owner_id}` });

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthParam = (v) => {
  if (typeof v !== 'string' || !MONTH_RE.test(v)) throw validationError({ month: 'Choose a month.' });
  return v;
};

// The owner's active units. Every owner query is limited to these.
const OWNED_UNITS_SQL = `SELECT u.unit_id FROM units u JOIN properties p ON p.property_id = u.property_id
                          WHERE u.owner_id = $1 AND u.status = 'active' AND p.status = 'active'`;

// Portal actions have no team user. Passing the organization keeps the audit row inside the workspace.
const portalActor = (o) => ({ organization_id: o.organization_id, user_id: null });

// Same 409 as the host's calendar, but it doesn't name the guest or the booking: owners never see other stays.
const overlapError = () => new HttpError(409, 'These dates overlap a stay or block on this unit.', {
  code: 'DATES_TAKEN', fields: { check_in: 'Dates not available', check_out: 'Dates not available' },
});

const EMPTY_TOTALS = { stays: 0, nights: 0, gross: '0.00', channel_fees: '0.00', refunds: '0.00', expenses: '0.00', net: '0.00' };

// ---------------------------------------------------------------- sign-in
// Always { sent: true } for a valid email, whether or not an owner matches, so the form can't be used to find owners.
publicRouter.post('/owner-portal/login', loginIpLimiter, loginEmailLimiter, ah(async (req, res) => {
  const { email } = validate(req.body, { email: { type: 'email', required: true, label: 'Email' } });
  // Reply first. The owner lookup and the mail run after it, so the reply comes back in the same time
  // whether or not an owner matches the email.
  res.json({ sent: true });
  setImmediate(async () => {
    try {
      const { rows } = await query(
        `SELECT o.owner_id, g.name AS workspace_name
           FROM unit_owners o JOIN organizations g ON g.organization_id = o.organization_id
          WHERE lower(o.email) = $1 AND o.portal_enabled AND o.archived_at IS NULL AND g.deletion_scheduled_at IS NULL
          ORDER BY g.name`, [email]);
      if (!rows.length) return;
      const lines = [];
      for (const o of rows) lines.push(`${o.workspace_name}: ${await issueSignInLink(o.owner_id)}`);
      await sendMail({
        to: email,
        subject: 'Your BalayHub owner portal sign-in link',
        text: `Hi,\n\nSign in to the owner portal with the link for each workspace below. Each link works once and expires in 30 minutes.\n\n${lines.join('\n')}\n\nIf you didn't ask for this, you can ignore this email.`,
      });
    } catch (err) {
      console.error('[owner-portal] sign-in email failed:', err.message);
    }
  });
}));

publicRouter.post('/owner-portal/session', sessionLimiter, ah(async (req, res) => {
  const { token } = validate(req.body, { token: { type: 'string', required: true, max: 200, label: 'Sign-in link' } });
  // Marks the link used in the same step that checks it, so one link can't be exchanged twice.
  const row = await one(
    `UPDATE owner_login_tokens t SET used_at = now()
       FROM unit_owners o JOIN organizations g ON g.organization_id = o.organization_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
        AND o.owner_id = t.owner_id AND o.portal_enabled AND o.archived_at IS NULL AND g.deletion_scheduled_at IS NULL
      RETURNING t.owner_id, o.organization_id`, [hashToken(token)]);
  if (!row) throw new HttpError(400, 'This sign-in link is invalid or has expired. Ask for a new link.', { code: 'INVALID_LINK' });
  await createOwnerSession(req, res, row.owner_id, row.organization_id);
  res.json({ ok: true });
}));

publicRouter.post('/owner-portal/logout', ah(async (req, res) => {
  await destroyOwnerSession(req, res);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- home and money
publicRouter.get('/owner-portal/me', requireOwnerSession, ah(async (req, res) => {
  const o = req.portalOwner;
  const { rows: units } = await query(
    `SELECT u.unit_id, u.unit_name, p.property_name
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.owner_id = $1 AND u.status = 'active' AND p.status = 'active'
      ORDER BY p.property_name, u.unit_name`, [o.owner_id]);
  res.json({ owner: { full_name: o.full_name, email: o.email }, workspace_name: o.workspace_name, units });
}));

// Published statements only. Drafts are never visible to owners.
publicRouter.get('/owner-portal/statements', requireOwnerSession, ah(async (req, res) => {
  const o = req.portalOwner;
  const { rows } = await query(
    `SELECT s.month, s.published_at, s.snapshot->'totals'->>'payout' AS payout,
            (SELECT COALESCE(SUM(p.amount), 0)::numeric(12,2) FROM owner_payouts p
              WHERE p.owner_id = s.owner_id AND p.month = s.month AND p.voided_at IS NULL) AS paid
       FROM owner_statements s
      WHERE s.owner_id = $1 AND s.organization_id = $2 AND s.status = 'published'
      ORDER BY s.month DESC`, [o.owner_id, o.organization_id]);
  res.json({
    statements: rows.map((r) => ({
      month: r.month, month_label: monthLabel(r.month), payout: r.payout, published_at: r.published_at, paid: r.paid,
    })),
  });
}));

// The frozen copy from publish (owner_statements.snapshot), plus that month's payouts.
publicRouter.get('/owner-portal/statements/:month', requireOwnerSession, ah(async (req, res) => {
  const o = req.portalOwner;
  const month = monthParam(req.params.month);
  const s = await one(
    `SELECT snapshot, published_at FROM owner_statements
      WHERE owner_id = $1 AND organization_id = $2 AND month = $3 AND status = 'published'`,
    [o.owner_id, o.organization_id, month]);
  if (!s) throw notFound();
  const { rows: payouts } = await query(
    `SELECT payout_id, amount, paid_on, method, reference_number, note FROM owner_payouts
      WHERE owner_id = $1 AND month = $2 AND voided_at IS NULL ORDER BY paid_on, created_at`, [o.owner_id, month]);
  const { paid } = await one(
    `SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS paid FROM owner_payouts
      WHERE owner_id = $1 AND month = $2 AND voided_at IS NULL`, [o.owner_id, month]);
  res.json({
    statement: { ...s.snapshot, month_label: monthLabel(month) },
    published_at: s.published_at, payouts, paid,
  });
}));

publicRouter.get('/owner-portal/payouts', requireOwnerSession, ah(async (req, res) => {
  const { rows } = await query(
    `SELECT payout_id, month, amount, paid_on, method, reference_number, note FROM owner_payouts
      WHERE owner_id = $1 AND voided_at IS NULL ORDER BY paid_on DESC, created_at DESC`, [req.portalOwner.owner_id]);
  res.json({ payouts: rows });
}));

publicRouter.get('/owner-portal/reserve', requireOwnerSession, ah(async (req, res) => {
  const o = req.portalOwner;
  const { rows: entries } = await query(
    `SELECT entry_id, kind, amount, entry_date, note FROM owner_reserve_entries
      WHERE owner_id = $1 AND voided_at IS NULL ORDER BY entry_date, created_at`, [o.owner_id]);
  const { balance } = await one(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount ELSE -amount END), 0)::numeric(12,2) AS balance
       FROM owner_reserve_entries WHERE owner_id = $1 AND voided_at IS NULL`, [o.owner_id]);
  const owner = await one('SELECT reserve_target, reserve_monthly FROM unit_owners WHERE owner_id = $1', [o.owner_id]);
  res.json({ balance, target: owner.reserve_target, monthly: owner.reserve_monthly, entries });
}));

// ---------------------------------------------------------------- bookings and activity
// Guests appear by first name only. No contact details, notes, confirmation codes or payments.
publicRouter.get('/owner-portal/bookings', requireOwnerSession, ah(async (req, res) => {
  const o = req.portalOwner;
  const q = validate(req.query, { from: { type: 'date', label: 'From' }, to: { type: 'date', label: 'To' } });
  const today = manilaToday();
  const from = q.from || addDays(today, -30);
  const to = q.to || addDays(today, 90);
  if (from > to) throw validationError({ to: 'Choose an end date after the start date.' });
  if (nightsBetween(from, to) > 400) throw validationError({ to: 'Choose a range of 400 days or less.' });
  const { rows } = await query(
    `SELECT b.booking_id, b.unit_id, u.unit_name, b.kind, b.status, b.channel, b.check_in, b.check_out,
            (b.check_out - b.check_in) AS nights,
            b.owner_block_by = $1 AS mine,
            CASE WHEN b.kind = 'reservation' THEN split_part(COALESCE(g.full_name, b.guest_label, 'Guest'), ' ', 1) END AS guest_first_name,
            CASE WHEN b.kind = 'reservation' THEN b.total_amount END AS gross,
            CASE WHEN b.kind = 'reservation' THEN b.channel_fee END AS channel_fee,
            CASE WHEN b.kind = 'block' THEN COALESCE(CASE WHEN b.owner_block_by = $1 THEN b.block_reason END, 'Blocked') END AS label
       FROM bookings b
       JOIN units u ON u.unit_id = b.unit_id
       LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.unit_id IN (${OWNED_UNITS_SQL}) AND b.check_in <= $2 AND b.check_out > $3
      ORDER BY b.check_in, u.unit_name, b.booking_id`, [o.owner_id, to, from]);
  res.json({ from, to, bookings: rows });
}));

// Newest first. Each item is built from the owner's own units, statements and payouts.
publicRouter.get('/owner-portal/activity', requireOwnerSession, ah(async (req, res) => {
  const o = req.portalOwner;
  const limit = validate(req.query, { limit: { type: 'int', min: 1, max: 100, label: 'Limit' } }).limit || 30;
  const guestFirst = "split_part(COALESCE(g.full_name, b.guest_label, 'Guest'), ' ', 1)";
  const { rows } = await query(
    `WITH owned AS (
       SELECT u.unit_id, u.unit_name FROM units u JOIN properties p ON p.property_id = u.property_id
        WHERE u.owner_id = $1 AND u.status = 'active' AND p.status = 'active')
     SELECT feed.at, feed.kind, feed.title, feed.unit_name FROM (
       SELECT b.checked_in_at AS at, 'check_in' AS kind, ${guestFirst} || ' checked in' AS title, ow.unit_name
         FROM bookings b JOIN owned ow ON ow.unit_id = b.unit_id LEFT JOIN guests g ON g.guest_id = b.guest_id
        WHERE b.kind = 'reservation' AND b.checked_in_at IS NOT NULL
       UNION ALL
       SELECT b.checked_out_at, 'check_out', ${guestFirst} || ' checked out', ow.unit_name
         FROM bookings b JOIN owned ow ON ow.unit_id = b.unit_id LEFT JOIN guests g ON g.guest_id = b.guest_id
        WHERE b.kind = 'reservation' AND b.checked_out_at IS NOT NULL
       UNION ALL
       SELECT t.completed_at, 'cleaning', 'Cleaning completed', ow.unit_name
         FROM cleaning_tasks t JOIN owned ow ON ow.unit_id = t.unit_id
        WHERE t.status = 'done' AND t.completed_at IS NOT NULL
       UNION ALL
       SELECT m.created_at, 'maintenance', 'Maintenance: ' || m.title || ' (' || replace(m.status, '_', ' ') || ')', ow.unit_name
         FROM maintenance_requests m JOIN owned ow ON ow.unit_id = m.unit_id
       UNION ALL
       SELECT e.created_at, 'expense',
              'Expense: ' || COALESCE(e.description, e.category) || ' (₱' || to_char(e.amount, 'FM999,999,999,990.00') || ')', ow.unit_name
         FROM expenses e JOIN owned ow ON ow.unit_id = e.unit_id
        WHERE e.voided_at IS NULL
       UNION ALL
       SELECT s.published_at, 'statement', 'Statement ready for ' || to_char(to_date(s.month, 'YYYY-MM'), 'FMMonth YYYY'), NULL
         FROM owner_statements s
        WHERE s.owner_id = $1 AND s.status = 'published'
       UNION ALL
       SELECT p.created_at, 'payout', 'Payout of ₱' || to_char(p.amount, 'FM999,999,999,990.00') || ' recorded', NULL
         FROM owner_payouts p
        WHERE p.owner_id = $1 AND p.voided_at IS NULL
     ) feed
     WHERE feed.at IS NOT NULL
     ORDER BY feed.at DESC
     LIMIT $2`, [o.owner_id, limit]);
  res.json({ activity: rows });
}));

// Profit and loss for the owner's units only. Loaded on first use.
// D-41: a month with a published statement shows that frozen copy, so this page agrees with the statement.
// Other months are worked out live.
publicRouter.get('/owner-portal/pnl', requireOwnerSession, ah(async (req, res) => {
  const o = req.portalOwner;
  const month = req.query.month === undefined ? manilaToday().slice(0, 7) : monthParam(req.query.month);
  const { rows: units } = await query(OWNED_UNITS_SQL, [o.owner_id]);
  // An empty list must not reach unitPnl, where it could read as "no filter".
  if (!units.length) return res.json({ month, source: 'live', rows: [], totals: EMPTY_TOTALS });
  const stmt = await one(
    `SELECT snapshot, published_at FROM owner_statements WHERE owner_id = $1 AND organization_id = $2 AND month = $3 AND status = 'published'`,
    [o.owner_id, o.organization_id, month]);
  if (stmt) return res.json({ month, source: 'published', published_at: stmt.published_at, ...await publishedPnl(o, stmt.snapshot) });
  const unitIds = units.map((u) => u.unit_id);
  const { unitPnl } = require('../lib/pnl');
  const pnl = await unitPnl(o.organization_id, month, { unitIds });
  const mine = new Set(unitIds);
  res.json({ month, source: 'live', rows: pnl.rows.filter((r) => mine.has(r.unit_id)), totals: pnl.totals });
}));

// P&L rows from a statement snapshot, in the same shape unitPnl gives. The snapshot has refunds as one total
// (not per unit), so they get their own row. Its expenses name the unit but not its id, so ids come from the expense rows.
async function publishedPnl(o, snap) {
  const cents = (v) => Math.round(Number(v || 0) * 100);
  const money = (c) => (c / 100).toFixed(2);
  const ids = (snap.expenses || []).map((e) => e.expense_id);
  const { rows: ex } = await query('SELECT expense_id, unit_id FROM expenses WHERE expense_id = ANY($1::uuid[]) AND organization_id = $2', [ids, o.organization_id]);
  const unitOf = new Map(ex.map((e) => [e.expense_id, e.unit_id]));
  const zero = () => ({ stays: 0, nights: 0, gross: 0, channel: 0, refunds: 0, expenses: 0 });
  const byUnit = new Map(snap.units.map((u) => [u.unit_id, { meta: { unit_id: u.unit_id, unit_name: u.unit_name, property_name: u.property_name }, a: zero() }]));
  for (const s of snap.stays || []) {
    const a = byUnit.get(s.unit_id)?.a;
    if (!a) continue;
    a.stays += 1; a.nights += Number(s.nights); a.gross += cents(s.total_amount); a.channel += cents(s.channel_fee);
  }
  for (const e of snap.expenses || []) {
    const a = byUnit.get(unitOf.get(e.expense_id))?.a;
    if (a) a.expenses += cents(e.amount);
  }
  const lines = [...byUnit.values()];
  if (cents(snap.refunded)) lines.push({ meta: { unit_id: null, unit_name: 'Refunds (all units)', property_name: null }, a: { ...zero(), refunds: cents(snap.refunded) } });
  const out = ({ meta, a }) => ({ ...meta, stays: a.stays, nights: a.nights, gross: money(a.gross), channel_fees: money(a.channel), refunds: money(a.refunds), expenses: money(a.expenses), net: money(a.gross - a.channel - a.refunds - a.expenses) });
  const total = zero();
  for (const { a } of lines) for (const k of Object.keys(total)) total[k] += a[k];
  return { rows: lines.map(out), totals: out({ meta: {}, a: total }) };
}

// ---------------------------------------------------------------- receipts
// Only receipts of expenses on the owner's unit that appear in one of their published statements.
publicRouter.get('/owner-portal/receipts/:fileId', requireOwnerSession, ah(async (req, res) => {
  const o = req.portalOwner;
  const fileId = uuidParam(req.params.fileId);
  const file = await one(
    `SELECT f.storage_key, f.file_name, f.mime_type
       FROM files f
       JOIN expenses e ON e.expense_id = f.related_record_id AND e.organization_id = f.organization_id
       JOIN units u ON u.unit_id = e.unit_id
      WHERE f.file_id = $1 AND f.related_record_type = 'expense' AND f.organization_id = $2
        AND u.owner_id = $3
        AND EXISTS (SELECT 1 FROM owner_statements s
                     WHERE s.owner_id = $3 AND s.status = 'published'
                       AND s.snapshot->'expenses' @> jsonb_build_array(jsonb_build_object('expense_id', e.expense_id::text)))`,
    [fileId, o.organization_id, o.owner_id]);
  if (!file) throw notFound();
  const full = path.resolve(config.storageDir, file.storage_key);
  if (!full.startsWith(path.resolve(config.storageDir) + path.sep)) throw notFound();
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, no-store');
  // filename is an ASCII fallback (headers can't carry other characters). filename* is the real name, UTF-8
  // encoded (RFC 6266). encodeURIComponent leaves ' ( ) * alone, and RFC 5987 doesn't allow those, so escape them too.
  const ascii = file.file_name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const utf8 = encodeURIComponent(file.file_name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  res.set('Content-Disposition', `inline; filename="${ascii}"; filename*=UTF-8''${utf8}`);
  fs.createReadStream(full).on('error', () => res.status(404).end()).pipe(res);
}));

// ---------------------------------------------------------------- blocks
// Owner writes skip planGuard (owner-portal paths are exempt there), so view-only is checked here.
// A demo workspace gets the same 403 planGuard gives the host.
function requirePortalWritable(req, res, next) {
  const s = req.portalOwner.plan_status;
  if (!s.read_only) return next();
  if (s.reason === 'demo') {
    return next(new HttpError(403, 'This is a demo workspace, so you can\'t block or unblock dates.', { code: 'DEMO_READ_ONLY' }));
  }
  return next(new HttpError(402, 'This workspace is view-only right now, so you can\'t block or unblock dates. Please contact your property manager.', { code: 'PLAN_READ_ONLY' }));
}

publicRouter.post('/owner-portal/blocks', requireOwnerSession, requirePortalWritable, blockLimiter, ah(async (req, res) => {
  const o = req.portalOwner;
  const body = validate(req.body, {
    unit_id: { type: 'uuid', required: true, label: 'Unit' },
    check_in: { type: 'date', required: true, label: 'First night' },
    check_out: { type: 'date', required: true, label: 'Check-out day' },
    reason: { type: 'string', max: 200, label: 'Reason' },
  });
  const unit = await one(
    `SELECT u.unit_id, u.unit_name, p.property_name
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.unit_id = $1 AND u.owner_id = $2 AND p.organization_id = $3 AND u.status = 'active' AND p.status = 'active'`,
    [body.unit_id, o.owner_id, o.organization_id]);
  if (!unit) throw notFound();
  const fields = {};
  if (body.check_in < manilaToday()) fields.check_in = 'Blocks cannot start in the past.';
  else if (body.check_out <= body.check_in) fields.check_out = 'Check-out must be after the first night.';
  else if (nightsBetween(body.check_in, body.check_out) > 60) fields.check_out = 'Owner blocks are limited to 60 nights.';
  if (Object.keys(fields).length) throw validationError(fields);

  const reason = body.reason || 'Owner stay';
  let blockId;
  try {
    const { rows: [b] } = await query(
      `INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, block_reason, confirmation_code, owner_block_by)
       VALUES ($1, $2, 'block', $3, $4, $5, $6, $7) RETURNING booking_id`,
      [o.organization_id, unit.unit_id, body.check_in, body.check_out, reason, randomCode('BL'), o.owner_id]);
    blockId = b.booking_id;
  } catch (err) {
    if (err.constraint === 'bookings_no_overlap') throw overlapError();
    throw err;
  }
  await audit(null, portalActor(o), 'owner_portal.block_created', 'booking', blockId,
    { owner_id: o.owner_id, unit_id: unit.unit_id, check_in: body.check_in, check_out: body.check_out });

  const range = `${dayLabel(body.check_in)} to ${dayLabel(body.check_out)}`;
  const { rows: hosts } = await query(
    `SELECT email FROM users WHERE organization_id = $1 AND role = 'owner' AND account_status = 'active'`, [o.organization_id]);
  for (const h of hosts) {
    await sendMail({
      to: h.email,
      subject: `${o.full_name} blocked ${unit.unit_name} from ${range}`,
      text: `${o.full_name} blocked ${unit.property_name}, ${unit.unit_name}, from ${range} (check-out day).\nReason: ${reason}`,
    });
  }
  res.status(201).json({ block_id: blockId });
}));

// Only the owner's own blocks, and only before they start.
publicRouter.post('/owner-portal/blocks/:id/cancel', requireOwnerSession, requirePortalWritable, blockLimiter, ah(async (req, res) => {
  const o = req.portalOwner;
  const id = uuidParam(req.params.id);
  const b = await one(
    `SELECT booking_id, status, check_in FROM bookings
      WHERE booking_id = $1 AND owner_block_by = $2 AND kind = 'block'`, [id, o.owner_id]);
  if (!b) throw notFound();
  if (b.status !== 'confirmed') throw new HttpError(409, 'This block is already cancelled.', { code: 'ALREADY_CANCELLED' });
  if (b.check_in <= manilaToday()) {
    throw new HttpError(409, 'This block has already started, so it can\'t be cancelled here. Contact your property manager.', { code: 'BLOCK_STARTED' });
  }
  await query(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Cancelled by owner'
      WHERE booking_id = $1 AND status = 'confirmed'`, [id]);
  await audit(null, portalActor(o), 'owner_portal.block_cancelled', 'booking', id, { owner_id: o.owner_id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- host: invite and disable
// Turns portal access on and emails a sign-in link. Needs the owner's email.
router.post('/unit-owners/:id/portal-invite', ownersOnly, ah(async (req, res) => {
  const o = await one(
    `SELECT o.owner_id, o.full_name, o.email, g.name AS workspace_name
       FROM unit_owners o JOIN organizations g ON g.organization_id = o.organization_id
      WHERE o.owner_id = $1 AND o.organization_id = $2 AND o.archived_at IS NULL`,
    [uuidParam(req.params.id), req.user.organization_id]);
  if (!o) throw notFound();
  if (!o.email) throw new HttpError(409, "Add the owner's email first.", { code: 'NO_EMAIL' });
  await query('UPDATE unit_owners SET portal_enabled = true, portal_invited_at = now() WHERE owner_id = $1', [o.owner_id]);
  const link = await issueSignInLink(o.owner_id);
  const mail = await sendMail({
    to: o.email,
    subject: `Your owner portal for ${o.workspace_name}`,
    text: `Hi ${o.full_name.split(' ')[0]},\n\n${o.workspace_name} has invited you to the BalayHub owner portal. There you can see your monthly statements, bookings, payouts and repairs reserve.\n\nSign in here:\n${link}\n\nThe link works once and expires in 30 minutes. To get a new one, open the owner sign-in page and enter your email.`,
  });
  await audit(null, req.user, 'owner_portal.invited', 'unit_owner', o.owner_id, { sent: Boolean(mail.delivered) });
  res.json({ ok: true, sent: Boolean(mail.delivered) });
}));

// Turns portal access off and signs the owner out everywhere.
router.post('/unit-owners/:id/portal-disable', ownersOnly, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const o = await one('SELECT owner_id FROM unit_owners WHERE owner_id = $1 AND organization_id = $2', [id, req.user.organization_id]);
  if (!o) throw notFound();
  await tx(async (db) => {
    await db.query('UPDATE unit_owners SET portal_enabled = false WHERE owner_id = $1', [id]);
    await db.query('DELETE FROM owner_sessions WHERE owner_id = $1', [id]);
    await db.query('DELETE FROM owner_login_tokens WHERE owner_id = $1 AND used_at IS NULL', [id]);
    await audit(db, req.user, 'owner_portal.disabled', 'unit_owner', id, {});
  });
  res.json({ ok: true });
}));

module.exports = { publicRouter, router };
