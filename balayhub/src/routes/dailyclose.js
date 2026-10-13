'use strict';

// Daily close (D-72). For one day, owners and managers see what is still open (arrivals and
// departures not done, cleanings not done, payments recorded, balances due within 2 days,
// payment proofs, open damage, calendar sync problems) and can close the day with a stored
// snapshot. Managers see only their assigned properties. A manager's close records those
// properties; an owner's close records none, which means the whole workspace.

const express = require('express');
const { requireRole } = require('../lib/auth');
const { isOwner, propertyScope } = require('../lib/access');
const { HttpError, ah } = require('../lib/http');
const { validate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { feedProblem, problemText, STALE_MS } = require('../lib/synchealth');
const { CHANNEL_LABEL } = require('../lib/ical');
const { query, tx } = require('../db');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const MAX_RANGE_DAYS = 92;
const CLEANING_STATUS = { todo: 'To do', in_progress: 'In progress' };
const PROOF_METHOD = { gcash: 'GCash', maya: 'Maya', bank_transfer: 'Bank transfer', other: 'Other' };

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const shiftDate = (ymd, days) => new Date(Date.parse(ymd) + days * 86400000).toISOString().slice(0, 10);

// A day can be closed up to tomorrow. Missing means today (Manila time).
function resolveDate(raw) {
  const date = raw || manilaToday();
  if (date > shiftDate(manilaToday(), 1)) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { date: 'Choose a date no later than tomorrow.' } });
  }
  return date;
}

const firstName = (name) => (name || 'Guest').trim().split(/\s+/)[0];
const item = (text, link, detail = null, amount = null) => ({ text, detail, link, amount });
const section = (key, title, items) => ({ key, title, count: items.length, items });

// Runs a query limited to what the caller may see. `build` gets the scope clause to put in WHERE.
function scopedRows(user, params, build) {
  const where = propertyScope(user, params);
  return query(build(where), params).then((r) => r.rows);
}

async function myPropertyIds(user) {
  const { rows } = await query(
    `SELECT pa.property_id::text AS property_id
       FROM property_assignments pa JOIN properties p ON p.property_id = pa.property_id
      WHERE pa.user_id = $1 AND p.organization_id = $2`, [user.user_id, user.organization_id],
  );
  return rows.map((r) => r.property_id);
}

// The caller's properties for a close. A manager with none is refused: an empty scope would read like a whole-workspace close.
async function assignedIds(user) {
  if (isOwner(user)) return [];
  const ids = await myPropertyIds(user);
  if (!ids.length) throw new HttpError(403, 'You are not assigned to any property.', { code: 'FORBIDDEN' });
  return ids;
}

// The checklist sections for one day, scoped to the caller. Money stays as strings.
async function checklist(user, date) {
  const cutoff = new Date(Date.now() - STALE_MS);
  const [arrivals, departures, cleanings, payByMethod, payTotal, balances, proofs, damage, feeds, conflicts] = await Promise.all([
    scopedRows(user, [date], (where) => `
      SELECT b.booking_id, COALESCE(g.full_name, b.guest_label) AS guest_name, u.unit_name
        FROM bookings b
        JOIN units u ON u.unit_id = b.unit_id
        JOIN properties p ON p.property_id = u.property_id
        LEFT JOIN guests g ON g.guest_id = b.guest_id
       WHERE b.kind = 'reservation' AND b.status = 'confirmed' AND b.checked_in_at IS NULL
         AND b.check_in = $1::date AND ${where}
       ORDER BY u.unit_name`),
    scopedRows(user, [date], (where) => `
      SELECT b.booking_id, COALESCE(g.full_name, b.guest_label) AS guest_name, u.unit_name
        FROM bookings b
        JOIN units u ON u.unit_id = b.unit_id
        JOIN properties p ON p.property_id = u.property_id
        LEFT JOIN guests g ON g.guest_id = b.guest_id
       WHERE b.kind = 'reservation' AND b.status = 'confirmed' AND b.checked_out_at IS NULL
         AND b.check_out = $1::date AND ${where}
       ORDER BY u.unit_name`),
    scopedRows(user, [date], (where) => `
      SELECT t.task_id, t.status, u.unit_name, COALESCE(au.full_name, t.assignee_name) AS assignee
        FROM cleaning_tasks t
        JOIN units u ON u.unit_id = t.unit_id
        JOIN properties p ON p.property_id = u.property_id
        LEFT JOIN users au ON au.user_id = t.assigned_to
       WHERE t.status IN ('todo', 'in_progress') AND t.due_date <= $1::date AND ${where}
       ORDER BY t.due_date, u.unit_name`),
    scopedRows(user, [date], (where) => `
      SELECT bp.payment_method AS method, COUNT(*)::int AS count, SUM(bp.amount)::numeric(12,2)::text AS total
        FROM booking_payments bp
        JOIN bookings b ON b.booking_id = bp.booking_id
        JOIN units u ON u.unit_id = b.unit_id
        JOIN properties p ON p.property_id = u.property_id
       WHERE bp.payment_date = $1::date AND bp.voided_at IS NULL AND ${where}
       GROUP BY bp.payment_method
       ORDER BY bp.payment_method`),
    scopedRows(user, [date], (where) => `
      SELECT COALESCE(SUM(bp.amount), 0)::numeric(12,2)::text AS total
        FROM booking_payments bp
        JOIN bookings b ON b.booking_id = bp.booking_id
        JOIN units u ON u.unit_id = b.unit_id
        JOIN properties p ON p.property_id = u.property_id
       WHERE bp.payment_date = $1::date AND bp.voided_at IS NULL AND ${where}`),
    scopedRows(user, [date], (where) => `
      SELECT b.booking_id, COALESCE(g.full_name, b.guest_label) AS guest_name, u.unit_name, b.check_in, bal.balance::text AS balance,
             (b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL) AS staying
        FROM bookings b
        JOIN units u ON u.unit_id = b.unit_id
        JOIN properties p ON p.property_id = u.property_id
        LEFT JOIN guests g ON g.guest_id = b.guest_id
        CROSS JOIN LATERAL (
          SELECT (b.total_amount - b.channel_fee - COALESCE((SELECT SUM(bp.amount) FROM booking_payments bp
                   WHERE bp.booking_id = b.booking_id AND bp.voided_at IS NULL), 0))::numeric(12,2) AS balance
        ) bal
       WHERE b.kind = 'reservation' AND b.status = 'confirmed'
         AND (b.check_in BETWEEN $1::date AND $1::date + 2 OR (b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL))
         AND bal.balance > 0 AND ${where}
       ORDER BY b.check_in, u.unit_name`),
    scopedRows(user, [], (where) => `
      SELECT pp.booking_id, pp.amount::text AS amount, pp.method, pp.payer_name, u.unit_name
        FROM payment_proofs pp
        JOIN bookings b ON b.booking_id = pp.booking_id
        JOIN units u ON u.unit_id = b.unit_id
        JOIN properties p ON p.property_id = u.property_id
       WHERE pp.status = 'pending' AND ${where}
       ORDER BY pp.submitted_at`),
    scopedRows(user, [], (where) => `
      SELECT r.description, r.estimated_cost::text AS estimated_cost, r.booking_id, r.task_id, u.unit_name
        FROM damage_reports r
        JOIN units u ON u.unit_id = r.unit_id
        JOIN properties p ON p.property_id = u.property_id
       WHERE r.status = 'open' AND ${where}
       ORDER BY r.created_at`),
    // Archived listings and properties are left out, as in GET /sync-health (src/routes/synchealth.js).
    scopedRows(user, [], (where) => `
      SELECT f.channel, f.last_status, f.last_message, f.last_synced_at, f.created_at, u.unit_name
        FROM ical_feeds f
        JOIN units u ON u.unit_id = f.unit_id
        JOIN properties p ON p.property_id = u.property_id
       WHERE ${where} AND u.status = 'active' AND p.status = 'active'
       ORDER BY u.unit_name`),
    scopedRows(user, [], (where) => `
      SELECT f.channel, c.check_in, c.check_out, u.unit_name
        FROM ical_conflicts c
        JOIN ical_feeds f ON f.feed_id = c.feed_id
        JOIN units u ON u.unit_id = c.unit_id
        JOIN properties p ON p.property_id = u.property_id
       WHERE c.resolved_at IS NULL AND ${where} AND u.status = 'active' AND p.status = 'active'
       ORDER BY c.check_in`),
  ]);

  const paymentsCount = payByMethod.reduce((n, r) => n + r.count, 0);
  return [
    section('arrivals_pending', 'Arrivals not checked in', arrivals.map((r) =>
      item(`${firstName(r.guest_name)} · ${r.unit_name}`, `#/reservations/${r.booking_id}`))),
    section('departures_pending', 'Departures not checked out', departures.map((r) =>
      item(`${firstName(r.guest_name)} · ${r.unit_name}`, `#/reservations/${r.booking_id}`))),
    section('cleanings_open', 'Cleanings not done', cleanings.map((r) =>
      item(r.unit_name, `#/housekeeping/${r.task_id}`, `${CLEANING_STATUS[r.status]} · ${r.assignee || 'Not assigned'}`))),
    {
      key: 'payments_today', title: 'Payments recorded', count: paymentsCount, items: [],
      total: payTotal[0].total, by_method: payByMethod.map((r) => ({ method: r.method, count: r.count, total: r.total })),
    },
    section('balances_due', 'Balances due', balances.map((r) =>
      item(`${firstName(r.guest_name)} · ${r.unit_name}`, `#/reservations/${r.booking_id}`,
        r.staying ? 'Staying now' : `Check-in ${r.check_in}`, r.balance))),
    section('proofs_pending', 'Payment proofs to review', proofs.map((r) =>
      item(`${r.payer_name || 'Guest'} · ${r.unit_name}`, `#/reservations/${r.booking_id}`, PROOF_METHOD[r.method], r.amount))),
    section('damage_open', 'Open damage reports', damage.map((r) =>
      item(r.unit_name, r.task_id ? `#/housekeeping/${r.task_id}` : r.booking_id ? `#/reservations/${r.booking_id}` : '#/home',
        r.description, r.estimated_cost))),
    section('sync_problems', 'Calendar sync problems', [
      ...feeds.flatMap((r) => {
        const kind = feedProblem(r, cutoff);
        if (!kind) return [];
        return [item(`${r.unit_name} · ${CHANNEL_LABEL[r.channel] || 'Channel'}`, '#/calendar',
          problemText(r, kind).message)];
      }),
      ...conflicts.map((r) => item(`${r.unit_name} · ${CHANNEL_LABEL[r.channel] || 'Channel'}`, '#/calendar',
        `Overlapping dates ${r.check_in} to ${r.check_out}`)),
    ]),
  ];
}

// What a close stores: each section's count, plus the payment totals at close time.
function snapshotOf(sections) {
  const counts = Object.fromEntries(sections.map((s) => [s.key, s.count]));
  const pay = sections.find((s) => s.key === 'payments_today');
  return { counts, payments: { total: pay.total, by_method: pay.by_method } };
}

const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join();

// The stored close for a day. A manager sees it only when it is the whole workspace or covers one of
// their properties (the same rule as GET /daily-closes), and sees the summary only for a close that
// covers exactly their properties. `mine` is the caller's property ids (see assignedIds).
async function closedFor(user, date, mine) {
  const { rows: [row] } = await query(
    `SELECT c.close_date, c.closed_at, c.note, c.summary, c.property_ids::text[] AS property_ids, u.full_name AS closed_by_name
       FROM daily_closes c LEFT JOIN users u ON u.user_id = c.closed_by
      WHERE c.organization_id = $1 AND c.close_date = $2::date`, [user.organization_id, date],
  );
  if (!row) return null;
  const canSeeClose = isOwner(user) || row.property_ids.length === 0 || row.property_ids.some((id) => mine.includes(id));
  if (!canSeeClose) return null;
  const canSeeSummary = isOwner(user) || (row.property_ids.length > 0 && sameSet(row.property_ids, mine));
  return {
    close_date: row.close_date, closed_at: row.closed_at, closed_by_name: row.closed_by_name, note: row.note,
    summary: canSeeSummary ? row.summary : null,
  };
}

router.get('/daily-close', managers, ah(async (req, res) => {
  const { date: raw } = validate(req.query, { date: { type: 'date', label: 'Date' } });
  const date = resolveDate(raw);
  const mine = await assignedIds(req.user);
  res.json({ date, sections: await checklist(req.user, date), closed: await closedFor(req.user, date, mine) });
}));

router.post('/daily-close', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    date: { type: 'date', required: true, label: 'Date' },
    note: { type: 'text', max: 1000, label: 'Note' },
  });
  const date = resolveDate(body.date);
  const user = req.user;
  const propertyIds = await assignedIds(user);
  const summary = snapshotOf(await checklist(user, date));
  const saved = await tx(async (db) => {
    // A manager may replace an existing close only when that close covers properties they manage
    // (the WHERE on the conflict). Otherwise no row comes back and the close is refused.
    const { rows: [r] } = await db.query(
      `INSERT INTO daily_closes (organization_id, close_date, property_ids, summary, note, closed_by, closed_at, updated_at)
       VALUES ($1, $2::date, $3::uuid[], $4::jsonb, $5, $6, now(), now())
       ON CONFLICT (organization_id, close_date) DO UPDATE
         SET property_ids = EXCLUDED.property_ids, summary = EXCLUDED.summary, note = EXCLUDED.note,
             closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at, updated_at = now()
         WHERE $7::boolean OR (cardinality(daily_closes.property_ids) > 0 AND daily_closes.property_ids <@ $3::uuid[])
       RETURNING close_id, close_date, closed_at, note, summary`,
      [user.organization_id, date, propertyIds, JSON.stringify(summary), body.note, user.user_id, isOwner(user)],
    );
    if (!r) throw new HttpError(409, 'This day was already closed for more properties than you manage. Only an owner can change that close.', { code: 'ALREADY_CLOSED' });
    await audit(db, user, 'daily_close.saved', 'daily_close', r.close_id, { date, property_ids: propertyIds, counts: summary.counts });
    return r;
  });
  res.json({
    closed: { close_date: saved.close_date, closed_at: saved.closed_at, closed_by_name: user.full_name, note: saved.note, summary: saved.summary },
  });
}));

router.get('/daily-closes', managers, ah(async (req, res) => {
  const { from, to } = validate(req.query, {
    from: { type: 'date', required: true, label: 'From' },
    to: { type: 'date', required: true, label: 'To' },
  });
  const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (days < 1 || days > MAX_RANGE_DAYS) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { to: `Choose an end date on or after the start, within ${MAX_RANGE_DAYS} days.` } });
  }
  const params = [req.user.organization_id, from, to];
  let visible = '';
  if (!isOwner(req.user)) {
    params.push(await myPropertyIds(req.user));
    visible = "AND (c.property_ids = '{}' OR c.property_ids && $4::uuid[])";
  }
  const { rows } = await query(
    `SELECT c.close_date, c.closed_at, u.full_name AS closed_by_name, c.note
       FROM daily_closes c LEFT JOIN users u ON u.user_id = c.closed_by
      WHERE c.organization_id = $1 AND c.close_date BETWEEN $2::date AND $3::date ${visible}
      ORDER BY c.close_date DESC`, params,
  );
  res.json({ closes: rows });
}));

module.exports = router;
