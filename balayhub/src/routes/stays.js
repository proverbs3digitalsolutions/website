'use strict';

// Short-term rentals: listings, reservations, guests, calendar, nightly rates,
// blocks, cleaning status, homepage stats and channel (iCal) sync.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { own } = require('../lib/pick');
const { validate, uuidParam, isValidDate, UUID_RE } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { changedKeys } = require('../lib/auditdiff');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadUnit } = require('../lib/access');
const ical = require('../lib/ical');
const { feedProblem, problemText, STALE_MS } = require('../lib/synchealth');
const { hostOf } = require('./synchealth');
const { leasedListings } = require('../lib/leases');
const { ensureTaskForBooking, syncOpenTasks } = require('../lib/housekeeping');
const { computePay } = require('../lib/cleanerpay');
const receipts = require('../lib/receipts');
const { FEE, PAID, REFUNDED, BALANCE } = require('../lib/balance');
// The amount owed changed: close the guest's open online-payment checkouts (lazy require: circular-safe).
const closeOpenCheckouts = (bookingId) => require('./balancepay').closeOpenCheckouts(bookingId);

const router = express.Router();
const managers = requireRole('owner', 'manager');

const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;
const CHANNELS = ['direct', 'airbnb', 'booking', 'agoda', 'vrbo', 'expedia', 'tripcom', 'other'];
const METHODS = ['cash', 'bank_transfer', 'gcash', 'maya', 'card', 'channel_payout', 'other'];
// Same ceiling as bulk price changes (bulk.js), so a typed extra zero is caught on one night too.
const MAX_PRICE = 1000000;

const today = async () => (await one(`SELECT ${TODAY} AS d`)).d;
const addDays = ical.addDays;
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

// Staff see reservations and receipts through allow-lists (matrix 6 and 6.2), so a column added to bookings later never reaches them.
// STAFF_RESERVATION_KEYS is the BOOKING_SELECT row without guest contact, VIP / do-not-rebook flags, rating, stay count, tokens,
// house rules and the booking source, plus guest_has_email (computed: whether there is an address to email a receipt to, never the address). STAFF_RECEIPT_KEYS is the receipt row without the guest's email and the payment's idempotency key.
const STAFF_RESERVATION_KEYS = ['accommodation_total', 'amount_paid', 'balance', 'block_reason', 'booking_id', 'cancel_reason', 'cancelled_at', 'channel',
  'channel_fee', 'channel_fee_ignored', 'check_in', 'check_out', 'checked_in_at', 'checked_out_at', 'cleaning_fee', 'confirmation_code', 'created_at',
  'created_by', 'external_uid', 'extras_total', 'group_id', 'guest_has_email', 'guest_id', 'guest_label', 'guest_name', 'ical_feed_id', 'kind', 'max_guests',
  'nights', 'num_guests', 'organization_id', 'other_fees', 'owner_block_by', 'property_id', 'property_name', 'status', 'total_amount', 'unit_id', 'unit_name',
  'updated_at'];
const STAFF_RECEIPT_KEYS = ['adjustments', 'amount', 'balance_after', 'booking_id', 'charges', 'check_in', 'check_out', 'confirmation_code', 'created_at',
  'extras_total', 'guest_id', 'guest_name', 'organization_id', 'payment_date', 'payment_id', 'payment_method', 'property_name', 'receipt_number',
  'receipt_sent_at', 'recorded_by', 'recorded_by_name', 'reference_number', 'total_amount', 'unit_name', 'void_reason', 'voided_at', 'voided_by', 'workspace_name'];

function redactGuest(user, g, allowed = STAFF_RESERVATION_KEYS) {
  if (!g || ['owner', 'manager'].includes(user.role)) return g;
  const row = Object.fromEntries(allowed.filter((k) => k in g).map((k) => [k, g[k]]));
  if (allowed.includes('guest_has_email')) row.guest_has_email = Boolean(g.guest_email);
  return { ...row, limited: true };
}

// A guest as staff and cleaners see them: the name and nothing else.
const staffGuest = (g) => ({ guest_id: g.guest_id, full_name: g.full_name, limited: true });

// A payment's idempotency key is an internal retry token: no response carries it.
const withoutIdemKey = ({ idempotency_key: idem, ...payment }) => payment;

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

// The do-not-rebook flag follows the guest's email (D-97): a flagged guest with the same email in this workspace counts too.
// ponytail: the EXISTS scans the workspace's guests per row (lower(btrim()) skips the email index); fine at 1-10 units.
const BOOKING_SELECT = `
  SELECT b.*, u.unit_name, u.max_guests, p.property_id, p.property_name,
         g.full_name AS guest_name, g.email AS guest_email, g.phone AS guest_phone, g.vip AS guest_vip,
         (g.do_not_rebook OR (g.email IS NOT NULL AND btrim(g.email) <> '' AND EXISTS (SELECT 1 FROM guests f WHERE f.organization_id = g.organization_id AND f.do_not_rebook AND lower(btrim(f.email)) = lower(btrim(g.email))))) AS guest_do_not_rebook,
         (SELECT COUNT(*)::int FROM bookings pb WHERE pb.guest_id = b.guest_id AND pb.status = 'confirmed' AND pb.kind = 'reservation' AND pb.check_in < b.check_in) AS previous_stays,
         (SELECT row_to_json(r) FROM (SELECT rating, cleanliness, comment, created_at FROM guest_reviews WHERE booking_id = b.booking_id) r) AS review,
         (b.check_out - b.check_in) AS nights,
         COALESCE((SELECT SUM(bp.amount) FROM booking_payments bp WHERE bp.booking_id = b.booking_id AND bp.voided_at IS NULL), 0)::numeric(12,2) AS amount_paid,
         ${REFUNDED}::numeric(12,2) AS amount_refunded,
         ${BALANCE} AS balance,
         (b.channel = 'direct' AND b.channel_fee > 0) AS channel_fee_ignored
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

// The first confirmed stay or block on the listing that these dates run into, other than exceptId.
async function findOverlap(unitId, checkIn, checkOut, exceptId) {
  return one(
    `SELECT b.kind, b.check_in, b.check_out, b.confirmation_code, COALESCE(g.full_name, b.guest_label) AS who
       FROM bookings b LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.unit_id = $1 AND b.status = 'confirmed' AND daterange(b.check_in, b.check_out) && daterange($2::date, $3::date)
        AND b.booking_id IS DISTINCT FROM $4 LIMIT 1`, [unitId, checkIn, checkOut, exceptId || null]);
}

// The sentence for a clash found by findOverlap (the quote and PATCH both say it).
function overlapMessage(clash) {
  // Readable dates; blocks are shown by their nights (last night = the day before the end date).
  const fmt = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const nights = (a, b) => (addDays(a, 1) === b ? `the night of ${fmt(a)}` : `the nights of ${fmt(a)} to ${fmt(addDays(b, -1))}`);
  const what = clash
    ? (clash.kind === 'block' ? `a block on ${nights(clash.check_in, clash.check_out)}` : `${clash.who || 'another guest'}'s stay ${fmt(clash.check_in)} – ${fmt(clash.check_out)} (${clash.confirmation_code})`)
    : 'another booking';
  return `These dates overlap ${what} on this listing.`;
}

const LEASED_MESSAGE = 'This unit has an active monthly lease over these dates, so it can\'t be booked for a short stay.';

async function overlapError(unitId, checkIn, checkOut, exceptId) {
  return new HttpError(409, overlapMessage(await findOverlap(unitId, checkIn, checkOut, exceptId)),
    { code: 'DATES_TAKEN', fields: { check_in: 'Dates not available', check_out: 'Dates not available' } });
}

// What PATCH /reservations/:id would refuse for these dates on this listing (a monthly lease, else an overlap), ignoring one stay. Null when free.
async function clashFor(unitId, checkIn, checkOut, exceptId) {
  if ((await leasedListings([unitId], checkIn, checkOut)).size) return { code: 'UNIT_LEASED', message: LEASED_MESSAGE };
  const clash = await findOverlap(unitId, checkIn, checkOut, exceptId);
  return clash ? { code: 'DATES_TAKEN', message: overlapMessage(clash) } : null;
}

const { quote, nightlyPrices } = require('../lib/pricing');

// ---------------------------------------------------------------- listings
router.get('/listings', ah(async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  // ?tag= keeps only the listings with that tag (tags are stored lowercase).
  const tag = typeof req.query.tag === 'string' ? req.query.tag.trim().toLowerCase() : '';
  if (tag) params.push(tag);
  const tagWhere = tag ? ` AND $${params.length} = ANY(u.tags)` : '';
  const { rows } = await query(
    `SELECT u.unit_id, u.unit_name, u.unit_type, u.nightly_rate, u.cleaning_fee, u.max_guests, u.cleaning_status, u.bookable_online,
            u.tags, u.room_type,
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
      WHERE ${scope} AND u.status = 'active' AND p.status = 'active'${tagWhere}
      ORDER BY p.property_name, u.unit_name`, params);
  res.json({ listings: rows });
}));

router.post('/units/:id/cleaning', ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const { status } = validate(req.body, { status: { type: 'enum', values: ['clean', 'dirty'], required: true, label: 'Status' } });
  await tx(async (db) => {
    await db.query('UPDATE units SET cleaning_status = $2, cleaning_updated_at = now() WHERE unit_id = $1', [unit.unit_id, status]);
    if (status === 'clean') {
      // Marking the listing clean finishes its open cleaning tasks that are due, and sets their pay.
      // An unassigned one goes to whoever marked it, the same as a status change does.
      const { rows } = await db.query(
        `UPDATE cleaning_tasks SET status = 'done', completed_at = now(), completed_by = $2,
                assigned_to = CASE WHEN assigned_to IS NULL AND assignee_name IS NULL THEN $2 ELSE assigned_to END
          WHERE unit_id = $1 AND status IN ('todo', 'in_progress') AND due_date <= ${TODAY} RETURNING task_id`, [unit.unit_id, req.user.user_id]);
      for (const { task_id: taskId } of rows) await computePay(db, taskId);
    }
  });
  await audit(null, req.user, `cleaning.${status}`, 'unit', unit.unit_id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- guests
const guestSpec = {
  full_name: { type: 'string', required: true, max: 120, label: 'Guest name' },
  email: { type: 'email', label: 'Email' },
  phone: { type: 'phone', label: 'Mobile number' },
  notes: { type: 'text', max: 1000, label: 'Notes' },
  vip: { type: 'bool', label: 'VIP' },
  do_not_rebook: { type: 'bool', label: 'Do not rebook' },
};

// Filters: q, segment (vip | repeat | first | do_not_rebook | no_stays), stay
// (upcoming | in_house | none_upcoming), channel, property_id, last_from/last_to
// (latest stay), min_stays, rating (their reviews: 4 = 4★ and up, low = under 3★, none) and
// sort. Stay counts and amounts only cover the properties this person can see;
// staff and cleaners never get amounts or the "total spent" sort.
const GUEST_SORTS = {
  name: 'g.full_name',
  stays: 's.stays DESC, g.full_name',
  recent: 's.last_stay DESC NULLS LAST, g.full_name',
  next: 's.next_stay NULLS LAST, g.full_name',
  spent: 's.total_spent DESC NULLS LAST, g.full_name',
  added: 'g.created_at DESC',
};
router.get('/guests', ah(async (req, res) => {
  const qp = req.query;
  const staff = ['staff', 'cleaner'].includes(req.user.role);
  const params = [];
  const where = [guestScope(req.user, params)];
  if (staff) {
    // Names only, searchable by name: no flags, stays or ratings, so no other filter applies.
    if (qp.q) { params.push(`%${String(qp.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`); where.push(`g.full_name ILIKE $${params.length}`); }
    const { rows } = await query(`SELECT g.guest_id, g.full_name FROM guests g WHERE ${where.join(' AND ')} ORDER BY g.full_name LIMIT 500`, params);
    return res.json({ guests: rows.map(staffGuest) });
  }
  // Bookings counted for each guest: only in properties this person can see.
  const seen = req.user.role === 'owner' ? 'true' : `ux.property_id IN (SELECT property_id FROM property_assignments WHERE user_id = $${params.push(req.user.user_id)})`;
  if (qp.q) {
    params.push(`%${String(qp.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    const n = params.length;
    where.push(staff ? `g.full_name ILIKE $${n}` : `(g.full_name ILIKE $${n} OR g.email ILIKE $${n} OR g.phone ILIKE $${n})`);
  }
  const SEGMENTS = { vip: 'g.vip', do_not_rebook: 'g.do_not_rebook', repeat: 's.stays >= 2', first: 's.stays = 1', no_stays: 's.stays = 0' };
  if (own(SEGMENTS, qp.segment)) where.push(own(SEGMENTS, qp.segment));
  if (qp.stay === 'upcoming') where.push('s.next_stay IS NOT NULL');
  if (qp.stay === 'in_house') where.push('s.in_house');
  if (qp.stay === 'none_upcoming') where.push('s.next_stay IS NULL AND NOT s.in_house');
  // A stay matching channel / property, in what this person can see.
  const stayWhere = [];
  if (CHANNELS.includes(qp.channel)) { params.push(qp.channel); stayWhere.push(`b.channel = $${params.length}`); }
  if (qp.property_id) { params.push(uuidParam(qp.property_id)); stayWhere.push(`ux.property_id = $${params.length}`); }
  if (stayWhere.length) {
    where.push(`EXISTS (SELECT 1 FROM bookings b JOIN units ux ON ux.unit_id = b.unit_id
                         WHERE b.guest_id = g.guest_id AND b.kind = 'reservation' AND b.status = 'confirmed' AND ${seen} AND ${stayWhere.join(' AND ')})`);
  }
  if (isValidDate(qp.last_from)) { params.push(qp.last_from); where.push(`s.last_stay >= $${params.length}`); }
  if (isValidDate(qp.last_to)) { params.push(qp.last_to); where.push(`s.last_stay <= $${params.length}`); }
  if (/^\d{1,3}$/.test(String(qp.min_stays || ''))) { params.push(Number(qp.min_stays)); where.push(`s.stays >= $${params.length}`); }
  if (qp.rating === '4') where.push('rv.avg_rating >= 4');
  if (qp.rating === 'low') where.push('rv.avg_rating < 3');
  if (qp.rating === 'none') where.push('rv.avg_rating IS NULL');
  const order = (!staff || qp.sort !== 'spent') && own(GUEST_SORTS, qp.sort) ? own(GUEST_SORTS, qp.sort) : GUEST_SORTS.name;
  const { rows } = await query(
    `SELECT g.*, s.stays, s.last_stay, s.next_stay, s.in_house, s.total_spent, rv.avg_rating
       FROM guests g
       CROSS JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE b.status = 'confirmed') AS stays,
                MAX(b.check_in) FILTER (WHERE b.status = 'confirmed') AS last_stay,
                MIN(b.check_in) FILTER (WHERE b.status = 'confirmed' AND b.check_in > ${TODAY}) AS next_stay,
                COALESCE(bool_or(b.status = 'confirmed' AND b.check_in <= ${TODAY} AND b.check_out > ${TODAY}), false) AS in_house,
                COALESCE(SUM(b.total_amount) FILTER (WHERE b.status = 'confirmed'), 0)::numeric(12,2) AS total_spent
           FROM bookings b JOIN units ux ON ux.unit_id = b.unit_id
          WHERE b.guest_id = g.guest_id AND b.kind = 'reservation' AND ${seen}) s
       CROSS JOIN LATERAL (
         SELECT ROUND(AVG(r.rating), 1) AS avg_rating FROM guest_reviews r JOIN bookings rb ON rb.booking_id = r.booking_id JOIN units ux ON ux.unit_id = rb.unit_id
          WHERE r.guest_id = g.guest_id AND ${seen}) rv
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`, params);
  res.json({ guests: rows });
}));

async function loadGuest(user, id) {
  const params = [id];
  const g = await one(`SELECT g.* FROM guests g WHERE g.guest_id = $1 AND ${guestScope(user, params)}`, params);
  if (!g) throw notFound();
  return g;
}

router.get('/guests/:id', ah(async (req, res) => {
  const guest = await loadGuest(req.user, uuidParam(req.params.id));
  if (['staff', 'cleaner'].includes(req.user.role)) return res.json({ guest: staffGuest(guest), stays: [], reviews: [] });
  const params = [guest.guest_id];
  const { rows: stays } = await query(
    `${BOOKING_SELECT} WHERE b.guest_id = $1 AND ${propertyScope(req.user, params)} ORDER BY b.check_in DESC`, params);
  const rparams = [guest.guest_id];
  const { rows: reviews } = await query(
    `SELECT r.booking_id, r.rating, r.cleanliness, r.comment, r.created_at
       FROM guest_reviews r JOIN bookings b ON b.booking_id = r.booking_id JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE r.guest_id = $1 AND ${propertyScope(req.user, rparams)} ORDER BY r.created_at DESC`, rparams);
  res.json({ guest, stays, reviews });
}));

router.post('/guests', managers, ah(async (req, res) => {
  const body = validate(req.body, guestSpec);
  const { rows: [g] } = await query(
    `INSERT INTO guests (organization_id, full_name, email, phone, notes, vip, do_not_rebook, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.organization_id, body.full_name, body.email, body.phone, body.notes, Boolean(body.vip), Boolean(body.do_not_rebook), req.user.user_id]);
  await audit(null, req.user, 'guest.created', 'guest', g.guest_id);
  res.status(201).json({ guest: g });
}));

router.patch('/guests/:id', managers, ah(async (req, res) => {
  const guest = await loadGuest(req.user, uuidParam(req.params.id));
  const body = validate(req.body, guestSpec, { partial: true });
  const keys = changedKeys(guest, body);
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
  unpaid: { where: `b.status = 'confirmed' AND b.check_out >= ${TODAY} AND ${BALANCE} > 0`, order: 'b.check_in' },
  past: { where: `b.status = 'confirmed' AND b.check_out < ${TODAY}`, order: 'b.check_out DESC' },
  cancelled: { where: `b.status = 'cancelled'`, order: 'b.cancelled_at DESC NULLS LAST' },
  recent: { where: 'true', order: 'b.created_at DESC' },
  all: { where: 'true', order: 'b.check_in DESC' },
};

function reservationQuery(req) {
  const view = own(VIEWS, req.query.view) ? req.query.view : 'upcoming';
  const params = [];
  const where = [propertyScope(req.user, params), `b.kind = 'reservation'`, VIEWS[view].where];
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    const n = params.length;
    where.push(`(g.full_name ILIKE $${n} OR b.guest_label ILIKE $${n} OR b.confirmation_code ILIKE $${n} OR u.unit_name ILIKE $${n} OR p.property_name ILIKE $${n})`);
  }
  if (req.query.unit_id) { params.push(uuidParam(req.query.unit_id)); where.push(`b.unit_id = $${params.length}`); }
  if (CHANNELS.includes(req.query.channel)) { params.push(req.query.channel); where.push(`b.channel = $${params.length}`); }
  if (isValidDate(req.query.from)) { params.push(req.query.from); where.push(`b.check_in >= $${params.length}`); }
  if (isValidDate(req.query.to)) { params.push(req.query.to); where.push(`b.check_in <= $${params.length}`); }
  if (isValidDate(req.query.out_from)) { params.push(req.query.out_from); where.push(`b.check_out >= $${params.length}`); }
  if (isValidDate(req.query.out_to)) { params.push(req.query.out_to); where.push(`b.check_out <= $${params.length}`); }
  if (req.query.property_id) { params.push(uuidParam(req.query.property_id)); where.push(`p.property_id = $${params.length}`); }
  if (req.query.payment === 'paid') where.push(`${BALANCE} <= 0`);
  if (req.query.payment === 'unpaid') where.push(`b.status = 'confirmed' AND ${PAID} = 0 AND b.total_amount - ${FEE} > 0`);
  if (req.query.payment === 'partial') where.push(`b.status = 'confirmed' AND ${PAID} > 0 AND ${BALANCE} > 0`);
  // These reveal flags and stay history, which staff don't see.
  const guestFilter = ['staff', 'cleaner'].includes(req.user.role) ? null : req.query.guest;
  if (guestFilter === 'vip') where.push('g.vip');
  if (guestFilter === 'repeat') where.push(`EXISTS (SELECT 1 FROM bookings pb WHERE pb.guest_id = b.guest_id AND pb.booking_id <> b.booking_id AND pb.status = 'confirmed' AND pb.kind = 'reservation' AND pb.check_in < b.check_in)`);
  if (guestFilter === 'first') where.push(`NOT EXISTS (SELECT 1 FROM bookings pb WHERE pb.guest_id = b.guest_id AND pb.booking_id <> b.booking_id AND pb.status = 'confirmed' AND pb.kind = 'reservation' AND pb.check_in < b.check_in)`);
  if (/^\d{1,2}$/.test(String(req.query.min_nights || ''))) { params.push(Number(req.query.min_nights)); where.push(`b.check_out - b.check_in >= $${params.length}`); }
  if (/^\d{1,2}$/.test(String(req.query.min_guests || ''))) { params.push(Number(req.query.min_guests)); where.push(`b.num_guests >= $${params.length}`); }
  if (req.query.checkin_form === 'missing') where.push(`NOT EXISTS (SELECT 1 FROM guest_registrations r WHERE r.booking_id = b.booking_id AND r.submitted_at IS NOT NULL)`);
  if (req.query.checkin_form === 'done') where.push(`EXISTS (SELECT 1 FROM guest_registrations r WHERE r.booking_id = b.booking_id AND r.submitted_at IS NOT NULL)`);
  const SORTS = { checkin: 'b.check_in, b.created_at', checkin_desc: 'b.check_in DESC, b.created_at DESC', checkout: 'b.check_out', created: 'b.created_at DESC', total: 'b.total_amount DESC', balance: `${BALANCE} DESC` };
  const order = own(SORTS, req.query.sort) || VIEWS[view].order;
  return { view, sql: `${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 1000`, params };
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
  const head = ['Confirmation code', 'Check-in', 'Check-out', 'Nights', 'Listing', 'Property', 'Guest', 'Guests', 'Channel', 'Status', 'Total', 'Paid', 'Refunded', 'Balance'];
  const lines = [head, ...rows.map((r) => [r.confirmation_code, r.check_in, r.check_out, r.nights, r.unit_name, r.property_name,
    r.guest_name || r.guest_label, r.num_guests, r.channel, r.status, r.total_amount, r.amount_paid, r.amount_refunded, r.status === 'cancelled' ? '' : r.balance])];
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="balayhub-reservations-${view}.csv"`);
  res.send(`﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`);
}));

router.get('/reservations/quote', ah(async (req, res) => {
  const { check_in: ci, check_out: co } = req.query;
  // Without unit_id, a room type at a property: quote the listing a reservation would take now (free, not on a lease).
  const byType = !req.query.unit_id && req.query.room_type;
  const room = byType ? { property_id: uuidParam(req.query.property_id), room_type: String(req.query.room_type).slice(0, 40), check_in: ci, check_out: co } : null;
  const unit = byType ? null : await loadUnit(req.user, uuidParam(req.query.unit_id));
  validate({ check_in: ci, check_out: co }, { check_in: { type: 'date', required: true, label: 'Check-in' }, check_out: { type: 'date', required: true, label: 'Check-out' } });
  if (co <= ci) throw validationError({ check_out: 'Check-out must be after check-in.' });
  if (nightsBetween(ci, co) > 366) throw validationError({ check_out: 'Stays are limited to one year.' });
  const picked = byType ? await pickListing(req.user, room) : unit;
  const q = await quote(picked.unit_id, ci, co);
  // The stay being edited is left out of the clash check. Only this listing's stays are checked, so an id from anywhere else changes nothing.
  const exceptId = typeof req.query.exclude_booking_id === 'string' && UUID_RE.test(req.query.exclude_booking_id) ? req.query.exclude_booking_id.toLowerCase() : null;
  const clash = await clashFor(picked.unit_id, ci, co, exceptId);
  res.json({ ...q, clash, cleaning_fee: picked.cleaning_fee, max_guests: picked.max_guests, ...(byType && { unit_id: picked.unit_id, unit_name: picked.unit_name }) });
}));

router.get('/reservations/:id', ah(async (req, res) => {
  const booking = await loadBooking(req.user, uuidParam(req.params.id));
  const { rows: payments } = await query(
    `SELECT bp.*, u.full_name AS recorded_by_name FROM booking_payments bp LEFT JOIN users u ON u.user_id = bp.recorded_by
      WHERE bp.booking_id = $1 ORDER BY bp.payment_date DESC, bp.created_at DESC`, [booking.booking_id]);
  const group = booking.group_id ? await one('SELECT group_id, name FROM booking_groups WHERE group_id = $1', [booking.group_id]) : null;
  res.json({ reservation: { ...redactGuest(req.user, booking), group: group ? { group_id: group.group_id, name: group.name } : null }, payments: payments.map(withoutIdemKey) });
}));

// A room names a listing, or a room type at a property (the first free listing of that type is taken).
const roomSpec = {
  unit_id: { type: 'uuid', label: 'Listing' },
  room_type: { type: 'string', max: 40, label: 'Room type' },
  property_id: { type: 'uuid', label: 'Property' },
  check_in: { type: 'date', required: true, label: 'Check-in' },
  check_out: { type: 'date', required: true, label: 'Check-out' },
  // No max here: checkStay applies the listing's own limit first, then the general 50 for a listing with none.
  num_guests: { type: 'int', min: 1, label: 'Number of guests' },
  accommodation_total: { type: 'money', label: 'Accommodation total' },
  cleaning_fee: { type: 'money', label: 'Cleaning fee' },
};

const reservationSpec = {
  ...roomSpec,
  guest_id: { type: 'uuid', label: 'Guest' },
  guest_name: { type: 'string', max: 120, label: 'Guest name' },
  guest_phone: { type: 'phone', label: 'Guest mobile' },
  guest_email: { type: 'email', label: 'Guest email' },
  channel: { type: 'enum', values: CHANNELS, label: 'Booked through' },
  other_fees: { type: 'money', label: 'Other fees' },
  channel_fee: { type: 'money', label: 'Channel fee' },
  notes: { type: 'text', max: 1000, label: 'Notes' },
  source: { type: 'string', max: 20, label: 'Source' },
  send_confirmation: { type: 'bool', label: 'Email confirmation' },
};

const NO_RATE = 'This listing has no nightly rate for some of these nights. Enter the accommodation total.';
const sameNights = (a, b) => a.check_in < b.check_out && b.check_in < a.check_out;

function checkDates(body) {
  if (body.check_out <= body.check_in) throw validationError({ check_out: 'Check-out must be after check-in.' });
  if (nightsBetween(body.check_in, body.check_out) > 366) throw validationError({ check_out: 'Stays are limited to one year.' });
}

// For validate()'s `check` option: the order rule joins the other field errors in one 400.
const orderCheck = (b) => (b.check_in && b.check_out && b.check_out <= b.check_in ? { check_out: 'Check-out must be after check-in.' } : null);

function checkStay(body, unit) {
  checkDates(body);
  if (body.num_guests && unit.max_guests && body.num_guests > unit.max_guests) {
    throw validationError({ num_guests: `This listing allows up to ${unit.max_guests} guests.` });
  }
  if (body.num_guests > 50) throw validationError({ num_guests: 'Number of guests must be at most 50.' });
}

// The channel keeps a cut of the stay, so its fee can't be more than the stay total.
function checkChannelFee(b, extras = 0) {
  const c = (v) => Math.round(Number(v || 0) * 100);
  if (c(b.channel_fee) > c(b.accommodation_total) + c(b.cleaning_fee) + c(b.other_fees) + c(extras)) {
    throw validationError({ channel_fee: 'Channel fee can\'t be more than the stay total.' });
  }
}

// Where a hand-made booking came from (the D-61 list, migration 031, minus 'quote' which only quotes set). Direct bookings only.
const SOURCES = ['facebook', 'instagram', 'messenger', 'viber', 'tiktok', 'google', 'whatsapp', 'email', 'referral', 'other'];
function checkSource(channel, source) {
  if (!source) return;
  if (channel && channel !== 'direct') throw validationError({ source: 'Only direct bookings have a source.' });
  if (!SOURCES.includes(source)) throw validationError({ source: 'Choose where they booked from the list.' });
}

// A channel fee is what a platform or agent keeps, so it only exists on a booking that came through a channel.
function checkDirectFee(channel, fee) {
  if (channel === 'direct' && Number(fee || 0) > 0) {
    throw validationError({ channel_fee: 'Direct bookings have no channel fee. If a platform or agent took a cut, set Booked through to that channel or Other.' });
  }
}

// A stay names a listing or a room type at a property, not both and not neither.
function checkListingChoice(body) {
  if (body.unit_id) {
    if (body.room_type || body.property_id) throw validationError({ room_type: 'Choose a listing or a room type, not both.' });
    return;
  }
  const fields = {};
  if (!body.room_type) fields.room_type = 'Choose a listing or a room type.';
  if (!body.property_id) fields.property_id = 'Choose the property for this room type.';
  if (Object.keys(fields).length) throw validationError(fields);
}

// The listings, of those given, that already have a confirmed stay or block, or a monthly lease, on any of these nights.
async function busyListings(unitIds, checkIn, checkOut, db = { query }) {
  const { rows } = await db.query(
    `SELECT DISTINCT unit_id FROM bookings
      WHERE unit_id = ANY($1) AND status = 'confirmed' AND daterange(check_in, check_out) && daterange($2::date, $3::date)`,
    [unitIds, checkIn, checkOut]);
  const busy = new Set(rows.map((r) => r.unit_id));
  for (const id of await leasedListings(unitIds, checkIn, checkOut, db)) busy.add(id);
  return busy;
}

// Short stays only exist in a short-term or combined workspace, and never over a monthly lease.
function assertShortTerm(user) {
  if (user.business_type === 'long_term') {
    throw new HttpError(409, 'This workspace is set up for long-term rentals only, so short-term stays can\'t be added. Change the workspace type in Settings to take short-term bookings.', { code: 'LONG_TERM_ONLY' });
  }
}

async function assertStayAllowed(user, unitId, checkIn, checkOut, db) {
  assertShortTerm(user);
  if ((await leasedListings([unitId], checkIn, checkOut, db)).size) {
    throw new HttpError(409, LEASED_MESSAGE,
      { code: 'UNIT_LEASED', fields: { check_in: 'Unit is on a monthly lease', check_out: 'Unit is on a monthly lease' } });
  }
}

// Listings of a room type at a property, in the order a free one is taken (by name).
async function roomTypeListings(user, room, db = { query }) {
  const params = [room.property_id, room.room_type];
  const { rows } = await db.query(
    `SELECT u.unit_id FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE p.property_id = $1 AND lower(u.room_type) = lower($2) AND u.status = 'active' AND p.status = 'active'
        AND ${propertyScope(user, params)}
      ORDER BY u.unit_name, u.unit_id`, params);
  return rows.map((r) => r.unit_id);
}

const noFreeRoom = (room) => new HttpError(409, `No free ${room.room_type} at this property on these dates.`, { code: 'NO_FREE_ROOM' });

// A group asked for more rooms of a type than are free: say how many are, out of the rooms asked for in this call.
const notEnoughRooms = (room, rooms, ids, byId, busy) => {
  const free = ids.filter((x) => { const u = byId.get(x); return u && u.status === 'active' && u.property_status === 'active' && !busy.has(x); }).length;
  if (!free) return noFreeRoom(room);
  const asked = rooms.filter((x) => !x.unit_id && x.property_id === room.property_id && x.room_type.toLowerCase() === room.room_type.toLowerCase() && sameNights(x, room)).length;
  return new HttpError(409, `Only ${free} ${room.room_type} ${free === 1 ? 'room is' : 'rooms are'} free on these dates (you asked for ${asked}). Nothing was saved.`, { code: 'NO_FREE_ROOM' });
};

// A single reservation for a room type: the first free listing of that type.
async function pickListing(user, room) {
  checkDates(room);
  const ids = await roomTypeListings(user, room);
  const busy = await busyListings(ids, room.check_in, room.check_out);
  const free = ids.find((id) => !busy.has(id));
  if (!free) throw noFreeRoom(room);
  return loadUnit(user, free);
}

// The guest for a stay: the one named; else the repeat guest with the same email and first name; else a new guest.
async function resolveGuest(db, user, g) {
  if (g.guest_id) return g.guest_id;
  // Same email as a guest you've hosted before: it's them again (repeat stays add up).
  // Only a guest this user can already see, and whose first name matches what was typed.
  if (g.guest_email && g.guest_name) {
    const params = [g.guest_email, g.guest_name];
    const { rows: [prev] } = await db.query(
      `SELECT g.guest_id FROM guests g WHERE lower(g.email) = lower($1)
          AND lower(split_part(trim(g.full_name), ' ', 1)) = lower(split_part(trim($2), ' ', 1))
          AND ${guestScope(user, params)} ORDER BY g.created_at LIMIT 1`, params);
    if (prev) return prev.guest_id;
  }
  const { rows: [created] } = await db.query(
    `INSERT INTO guests (organization_id, full_name, email, phone, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING guest_id`,
    [user.organization_id, g.guest_name, g.guest_email, g.guest_phone, user.user_id]);
  return created.guest_id;
}

// One reservation row and its audit line, inside the caller's transaction. Guest and listing are already checked.
async function insertReservation(db, user, unit, body, { guestId, accommodation, groupId = null, action = 'reservation.created' }) {
  const { rows: [b] } = await db.query(
    `INSERT INTO bookings (organization_id, unit_id, kind, guest_id, channel, check_in, check_out, num_guests,
                           accommodation_total, cleaning_fee, other_fees, channel_fee, confirmation_code, notes, created_by, group_id, source)
     VALUES ($1,$2,'reservation',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING booking_id, confirmation_code`,
    [user.organization_id, unit.unit_id, guestId, body.channel || 'direct', body.check_in, body.check_out, body.num_guests,
      accommodation, body.cleaning_fee ?? unit.cleaning_fee ?? '0.00', body.other_fees || '0.00', body.channel_fee || '0.00',
      ical.randomCode('BH'), body.notes ?? null, user.user_id, groupId, body.source ?? null]);
  await audit(db, user, action, 'booking', b.booking_id, { code: b.confirmation_code, check_in: body.check_in, check_out: body.check_out, booking_id: b.booking_id, group_id: groupId });
  return b;
}

// The normal cancel path: used by the reservation cancel route and by removing a room from a group.
function assertCancellable(booking) {
  if (booking.status === 'cancelled') throw new HttpError(409, 'This reservation is already cancelled.', { code: 'CANCELLED' });
  if (booking.ical_feed_id) {
    throw new HttpError(409, 'This stay comes from a channel calendar. Cancel it on the channel; BalayHub updates on the next sync.', { code: 'CHANNEL_MANAGED' });
  }
}

async function cancelBooking(user, booking, reason, { db = { query }, action = 'reservation.cancelled' } = {}) {
  await db.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE booking_id = $1`,
    [booking.booking_id, reason]);
  await audit(db, user, action, 'booking', booking.booking_id, { reason, booking_id: booking.booking_id, group_id: booking.group_id ?? null });
}

router.post('/reservations', managers, ah(async (req, res) => {
  const body = validate(req.body, reservationSpec, { check: orderCheck });
  checkListingChoice(body);
  const unit = body.unit_id ? await loadUnit(req.user, body.unit_id) : await pickListing(req.user, body);
  if (unit.status !== 'active' || unit.property_status !== 'active') throw new HttpError(409, 'This listing is archived.', { code: 'ARCHIVED' });
  checkStay(body, unit);
  await assertStayAllowed(req.user, unit.unit_id, body.check_in, body.check_out);
  if (body.guest_id) await loadGuest(req.user, body.guest_id);
  else if (!body.guest_name) throw validationError({ guest_name: 'Enter the guest name or choose an existing guest.' });

  let accommodation = body.accommodation_total;
  if (accommodation === null) {
    const q = await quote(unit.unit_id, body.check_in, body.check_out);
    if (q.missing_rates) throw validationError({ accommodation_total: NO_RATE });
    accommodation = q.accommodation_total;
  }
  checkDirectFee(body.channel || 'direct', body.channel_fee);
  checkSource(body.channel || 'direct', body.source);
  checkChannelFee({ ...body, accommodation_total: accommodation, cleaning_fee: body.cleaning_fee ?? unit.cleaning_fee });
  try {
    const id = await tx(async (db) => {
      // Lock the unit row, then re-check for a lease: a lease created at the same instant waits for this booking.
      await db.query('SELECT 1 FROM units WHERE unit_id = $1 FOR UPDATE', [unit.unit_id]);
      await assertStayAllowed(req.user, unit.unit_id, body.check_in, body.check_out, db);
      const guestId = await resolveGuest(db, req.user, body);
      const b = await insertReservation(db, req.user, unit, body, { guestId, accommodation });
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
    unit_id: { ...reservationSpec.unit_id, required: true }, check_in: reservationSpec.check_in, check_out: reservationSpec.check_out,
    num_guests: reservationSpec.num_guests, channel: reservationSpec.channel, accommodation_total: reservationSpec.accommodation_total,
    cleaning_fee: reservationSpec.cleaning_fee, other_fees: reservationSpec.other_fees, channel_fee: reservationSpec.channel_fee, notes: reservationSpec.notes,
    source: reservationSpec.source,
  }, { partial: true, check: orderCheck });
  // A blank fee means 0, the same as unit edits. A blank accommodation total is refused: a blank there is more likely a slip than a free stay.
  if ('accommodation_total' in body && body.accommodation_total === null) {
    throw validationError({ accommodation_total: 'Accommodation total is required. Type 0 for a free stay.' });
  }
  for (const k of ['cleaning_fee', 'other_fees', 'channel_fee']) {
    if (k in body && body[k] === null) body[k] = '0.00';
  }
  for (const k of ['unit_id', 'check_in', 'check_out', 'channel']) {
    if (k in body && body[k] === null) delete body[k];
  }
  if (booking.ical_feed_id && (body.check_in || body.check_out || body.unit_id)) {
    throw new HttpError(409, 'Dates for this stay come from the channel calendar. Change them on the channel; BalayHub updates on the next sync.', { code: 'CHANNEL_MANAGED' });
  }
  const merged = { ...booking, ...body };
  const unit = await loadUnit(req.user, merged.unit_id);
  checkStay(merged, unit);
  // Only a move (other listing or other dates) is checked; notes, guests and fees stay editable.
  const moved = ['unit_id', 'check_in', 'check_out'].some((k) => k in body && String(body[k]) !== String(booking[k]));
  if (moved) {
    await assertStayAllowed(req.user, merged.unit_id, merged.check_in, merged.check_out);
  }
  // Only values that really change are written and audited (money compares by amount: '2000' is '2000.00').
  const MONEY = ['accommodation_total', 'cleaning_fee', 'other_fees', 'channel_fee'];
  const keys = Object.keys(body).filter((k) => (MONEY.includes(k) ? Number(body[k]) !== Number(booking[k]) : String(body[k]) !== String(booking[k])));
  if (!keys.length) return res.json({ reservation: booking, changed: false });
  if (keys.some((k) => MONEY.includes(k))) checkChannelFee(merged, booking.extras_total);
  // A fee set, or a stay moved to direct while it carries one, is refused. An old fee on a direct stay is left alone until the host clears it.
  if (keys.includes('channel') || keys.includes('channel_fee')) checkDirectFee(merged.channel, merged.channel_fee);
  if (keys.includes('source') || keys.includes('channel')) checkSource(merged.channel, merged.source);
  try {
    await tx(async (db) => {
      if (moved) {
        await db.query('SELECT 1 FROM units WHERE unit_id = $1 FOR UPDATE', [merged.unit_id]);
        await assertStayAllowed(req.user, merged.unit_id, merged.check_in, merged.check_out, db);
      }
      await db.query(`UPDATE bookings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE booking_id = $1`,
        [booking.booking_id, ...keys.map((k) => body[k])]);
      await audit(db, req.user, 'reservation.updated', 'booking', booking.booking_id, {
        before: Object.fromEntries(keys.map((k) => [k, booking[k]])), after: Object.fromEntries(keys.map((k) => [k, body[k]])) });
      await syncOpenTasks(booking.booking_id, db);
    });
  } catch (err) {
    if (err.constraint === 'bookings_no_overlap') throw await overlapError(merged.unit_id, merged.check_in, merged.check_out, booking.booking_id);
    throw err;
  }
  // Only changes to what's owed close the guest's open payment page (not notes etc.).
  if (keys.some((k) => ['unit_id', 'check_in', 'check_out', ...MONEY].includes(k))) {
    await closeOpenCheckouts(booking.booking_id);
  }
  res.json({ reservation: redactGuest(req.user, await loadBooking(req.user, booking.booking_id)), changed: true });
}));

router.post('/reservations/:id/cancel', managers, ah(async (req, res) => {
  const booking = await loadBooking(req.user, uuidParam(req.params.id));
  if (booking.kind !== 'reservation') throw notFound();
  assertCancellable(booking);
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 500, label: 'Reason' } });
  await cancelBooking(req.user, booking, reason);
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
  // A channel's payout is money a platform paid out, so it only exists on a booking that came through a channel.
  if (body.payment_method === 'channel_payout' && booking.channel === 'direct') {
    throw validationError({ payment_method: 'Channel payout is only for bookings made through a channel.' });
  }
  if (body.payment_date > await today()) throw validationError({ payment_date: 'Payment date cannot be in the future.' });
  const key = req.get('Idempotency-Key');
  if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(400, 'Invalid Idempotency-Key header.', { code: 'BAD_REQUEST' });
  const org = req.user.organization_id;
  const existing = key && await one('SELECT payment_id FROM booking_payments WHERE organization_id = $1 AND idempotency_key = $2', [org, key]);
  if (existing) return res.json({ duplicate: true, reservation: redactGuest(req.user, await loadBooking(req.user, booking.booking_id)) });
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
    return res.json({ duplicate: true, reservation: redactGuest(req.user, await loadBooking(req.user, booking.booking_id)) });
  }
  await closeOpenCheckouts(booking.booking_id);
  const receipt = body.send_receipt ? await receipts.sendReceipt(paymentId, req.user) : null;
  // The provider's error text is for owners and managers; everyone else gets a fixed sentence and the raw text goes to the log.
  if (receipt && !receipt.sent && !['owner', 'manager'].includes(req.user.role)) {
    console.warn(`Receipt email failed for payment ${paymentId}: ${receipt.error}`);
    receipt.error = 'The receipt could not be emailed. Ask an owner or manager to send it again.';
  }
  res.status(201).json({ reservation: redactGuest(req.user, await loadBooking(req.user, booking.booking_id)), payment_id: paymentId, receipt });
}));

router.post('/booking-payments/:id/void', managers, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const p = await one('SELECT * FROM booking_payments WHERE payment_id = $1 AND organization_id = $2', [id, req.user.organization_id]);
  if (!p) throw notFound();
  await loadBooking(req.user, p.booking_id);
  if (p.voided_at) throw new HttpError(409, 'This payment is already voided.', { code: 'ALREADY_VOIDED' });
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 500, label: 'Reason' } });
  await tx(async (db) => {
    // Refunds can't exceed what was paid (section 2.5): after this void, the live payments must still cover the live refunds.
    await db.query('SELECT 1 FROM bookings WHERE booking_id = $1 FOR UPDATE', [p.booking_id]);
    const { rows: [t] } = await db.query(
      `SELECT (SELECT COALESCE(SUM(amount), 0) FROM booking_payments WHERE booking_id = $1 AND voided_at IS NULL AND payment_id <> $2) AS paid,
              (SELECT COALESCE(SUM(amount), 0) FROM booking_refunds WHERE booking_id = $1 AND voided_at IS NULL) AS refunded`, [p.booking_id, id]);
    if (Math.round(t.refunded * 100) > Math.round(t.paid * 100)) {
      throw new HttpError(409, 'Void the refund first, then this payment.', { code: 'REFUNDS_EXCEED_PAYMENTS' });
    }
    await db.query('UPDATE booking_payments SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE payment_id = $1 AND voided_at IS NULL', [id, req.user.user_id, reason]);
    await audit(db, req.user, 'reservation.payment_voided', 'booking_payment', id, { amount: p.amount, reason });
  });
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
  res.json({ receipt: redactGuest(req.user, withoutIdemKey(r), STAFF_RECEIPT_KEYS) });
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

// ---------------------------------------------------------------- group bookings
// One guest's rooms, booked together or not at all. Rooms reuse the reservation helpers above.
// Each group action writes one audit row per booking it touches, with booking_id and group_id in the details.

// Staff see groups and rooms without money, as they see reservations without guest contact details.
const seesMoney = (user) => !['staff', 'cleaner'].includes(user.role);
const MONEY_FIELDS = ['total', 'total_amount', 'amount_paid', 'balance', 'held'];
function hideMoney(user, row) {
  if (seesMoney(user)) return row;
  return Object.fromEntries(Object.entries(row).filter(([k]) => !MONEY_FIELDS.includes(k)));
}

// A group is shown only when every room in it is in this person's scope. Writes use the same rule.
function groupScope(user, params) {
  return `NOT EXISTS (SELECT 1 FROM bookings bx JOIN units ux ON ux.unit_id = bx.unit_id
                       JOIN properties px ON px.property_id = ux.property_id
                      WHERE bx.group_id = g.group_id AND NOT (${propertyScope(user, params, 'px')}))`;
}

async function loadGroup(user, id) {
  const params = [id, user.organization_id];
  const g = await one(`SELECT g.* FROM booking_groups g WHERE g.group_id = $1 AND g.organization_id = $2 AND ${groupScope(user, params)}`, params);
  if (!g) throw notFound();
  return g;
}

// One summary row per group: room count, dates, and money over the rooms still booked.
// `held` is what was paid on rooms no longer booked (a cancelled group's rooms), so cancelling never hides money taken.
const GROUP_ROWS = `
  SELECT g.group_id, g.name, g.cancelled_at, CASE WHEN g.cancelled_at IS NULL THEN 'active' ELSE 'cancelled' END AS status,
         gu.full_name AS guest_name, COUNT(b.booking_id) FILTER (WHERE b.status = 'confirmed')::int AS rooms, MIN(b.check_in) AS check_in, MAX(b.check_out) AS check_out,
         COALESCE(SUM(b.total_amount) FILTER (WHERE b.status = 'confirmed'), 0)::numeric(12,2) AS total,
         COALESCE(SUM(paid.amount) FILTER (WHERE b.status = 'confirmed'), 0)::numeric(12,2) AS amount_paid,
         COALESCE(SUM(b.total_amount - ${FEE} - paid.amount + refd.amount) FILTER (WHERE b.status = 'confirmed'), 0)::numeric(12,2) AS balance,
         COALESCE(SUM(paid.amount) FILTER (WHERE b.status <> 'confirmed'), 0)::numeric(12,2) AS held
    FROM booking_groups g
    LEFT JOIN guests gu ON gu.guest_id = g.guest_id
    LEFT JOIN bookings b ON b.group_id = g.group_id
    LEFT JOIN LATERAL (SELECT COALESCE(SUM(bp.amount), 0) AS amount FROM booking_payments bp
                        WHERE bp.booking_id = b.booking_id AND bp.voided_at IS NULL) paid ON true
    LEFT JOIN LATERAL (SELECT COALESCE(SUM(br.amount), 0) AS amount FROM booking_refunds br
                        WHERE br.booking_id = b.booking_id AND br.voided_at IS NULL) refd ON true`;

async function groupRows(where, params) {
  const { rows } = await query(`${GROUP_ROWS} WHERE ${where.join(' AND ')}
    GROUP BY g.group_id, gu.full_name ORDER BY g.created_at DESC LIMIT 500`, params);
  return rows;
}

const roomView = (user, b) => hideMoney(user, {
  booking_id: b.booking_id, unit_name: b.unit_name, check_in: b.check_in, check_out: b.check_out, num_guests: b.num_guests,
  total_amount: b.total_amount, amount_paid: b.amount_paid, balance: b.balance, status: b.status,
});

async function groupRoomRows(user, groupId) {
  const params = [groupId];
  const { rows } = await query(`${BOOKING_SELECT} WHERE b.group_id = $1 AND ${propertyScope(user, params)} ORDER BY b.check_in, u.unit_name`, params);
  return rows;
}

// One room: a listing or a room type at a property, with its dates and guest count.
function cleanRoom(body) {
  const r = validate(body, roomSpec);
  // A group room's price is a real price: 0 would save a free night. Blank still means "use the listing's price".
  if (r.accommodation_total !== null && Number(r.accommodation_total) <= 0) {
    throw validationError({ accommodation_total: 'Accommodation total must be greater than zero. Leave it blank to use the listing\'s price.' });
  }
  checkListingChoice(r);
  checkDates(r);
  return r;
}

// Two to twenty rooms for a new group (one to twenty when adding to one). Field errors name the room, for example rooms.2.check_out.
function cleanRooms(list, min = 2) {
  if (!Array.isArray(list) || list.length < min || list.length > 20) {
    throw validationError({ rooms: min > 1 ? 'A group needs between 2 and 20 rooms.' : 'Add between 1 and 20 rooms at a time.' });
  }
  const fields = {};
  const rooms = list.map((r, i) => {
    try {
      return cleanRoom(r);
    } catch (err) {
      for (const [k, msg] of Object.entries(err.extra.fields)) fields[`rooms.${i}.${k}`] = msg;
      return null;
    }
  });
  if (Object.keys(fields).length) throw validationError(fields);
  return rooms;
}

// The group's guest: an existing guest (who must be visible to this user), or the details of a new one.
async function groupGuest(user, input) {
  const g = input && typeof input === 'object' ? input : {};
  if (g.guest_id) {
    const { guest_id: guestId } = validate(g, { guest_id: { type: 'uuid', required: true, label: 'Guest' } });
    await loadGuest(user, guestId);
    return { guest_id: guestId };
  }
  const f = validate(g, {
    full_name: { type: 'string', required: true, max: 120, label: 'Guest name' },
    phone: { type: 'phone', label: 'Guest mobile' },
    email: { type: 'email', label: 'Guest email' },
  });
  return { guest_name: f.full_name, guest_phone: f.phone, guest_email: f.email };
}

// Books rooms inside `db`, all or none. A room names a listing, or a room type (the first free listing is taken).
// Every listing involved is locked in one fixed order first, so two group bookings can't interleave.
// `picks` records what was booked, so a late clash can be reported with the rooms that are taken.
async function bookRooms(db, user, rooms, { guestId, groupId, picks, action }) {
  assertShortTerm(user);
  const explicit = rooms.filter((r) => r.unit_id);
  const listingsFor = [];
  for (const r of rooms) {
    if (r.unit_id) {
      listingsFor.push([r.unit_id]);
    } else {
      // A room type never takes a listing that another room in this group names for the same nights.
      const ids = await roomTypeListings(user, r, db);
      listingsFor.push(ids.filter((id) => !explicit.some((e) => e.unit_id === id && sameNights(e, r))));
    }
  }
  const lockParams = [[...new Set(listingsFor.flat())]];
  const scope = propertyScope(user, lockParams);
  const { rows: locked } = await db.query(
    `SELECT u.unit_id, u.unit_name, u.status, u.max_guests, u.cleaning_fee, p.status AS property_status
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.unit_id = ANY($1) AND ${scope} ORDER BY u.unit_id FOR UPDATE OF u`, lockParams);
  const byId = new Map(locked.map((u) => [u.unit_id, u]));
  const plan = [];
  const taken = [];
  for (const [i, r] of rooms.entries()) {
    const busy = await busyListings(listingsFor[i], r.check_in, r.check_out, db);
    const takenInGroup = (id) => picks.some((p) => p.unit_id === id && sameNights(p, r));
    let unit;
    if (r.unit_id) {
      unit = byId.get(r.unit_id);
      if (!unit) throw notFound();
      if (unit.status !== 'active' || unit.property_status !== 'active') throw new HttpError(409, 'This listing is archived.', { code: 'ARCHIVED' });
      if (takenInGroup(unit.unit_id)) throw validationError({ rooms: 'Two rooms in this group are the same listing on overlapping nights.' });
      if (busy.has(unit.unit_id)) {
        taken.push({ unit_name: unit.unit_name, check_in: r.check_in, check_out: r.check_out });
        continue;
      }
    } else {
      const id = listingsFor[i].find((x) => {
        const u = byId.get(x);
        return u && u.status === 'active' && u.property_status === 'active' && !busy.has(x) && !takenInGroup(x);
      });
      if (!id) throw notEnoughRooms(r, rooms, listingsFor[i], byId, busy);
      unit = byId.get(id);
    }
    try {
      checkStay(r, unit);
    } catch (err) {
      // The group form puts this room's field errors on its own row, so the room's place in `rooms` travels with them.
      if (err.status === 400 && err.extra?.fields) err.extra.room_index = i;
      throw err;
    }
    picks.push({ unit_id: unit.unit_id, unit_name: unit.unit_name, check_in: r.check_in, check_out: r.check_out });
    let accommodation = r.accommodation_total;
    if (accommodation === null) {
      const q = await quote(unit.unit_id, r.check_in, r.check_out, db);
      if (q.missing_rates) throw validationError({ accommodation_total: NO_RATE });
      accommodation = q.accommodation_total;
    }
    plan.push({ unit, room: r, accommodation });
  }
  if (taken.length) throw new HttpError(409, 'Some of these rooms are already booked for those nights. Nothing was saved.', { code: 'ROOMS_TAKEN', rooms: taken });
  const ids = [];
  for (const { unit, room, accommodation } of plan) {
    const b = await insertReservation(db, user, unit, room, { guestId, accommodation, groupId, action });
    ids.push(b.booking_id);
  }
  return ids;
}

// Runs a booking in one transaction. A clash found only at insert (another booking landed a moment earlier)
// rolls everything back and reports the rooms that are taken now.
async function bookInTx(picks, work) {
  try {
    return await tx(work);
  } catch (err) {
    if (err.constraint !== 'bookings_no_overlap') throw err;
    const rooms = [];
    for (const p of picks) {
      if ((await busyListings([p.unit_id], p.check_in, p.check_out)).size) rooms.push({ unit_name: p.unit_name, check_in: p.check_in, check_out: p.check_out });
    }
    throw new HttpError(409, 'Some of these rooms were just booked by someone else. Nothing was saved.', { code: 'ROOMS_TAKEN', rooms });
  }
}

router.get('/booking-groups', ah(async (req, res) => {
  const params = [req.user.organization_id];
  const where = ['g.organization_id = $1', groupScope(req.user, params)];
  if (req.query.status === 'active') where.push('g.cancelled_at IS NULL');
  if (req.query.status === 'cancelled') where.push('g.cancelled_at IS NOT NULL');
  const groups = await groupRows(where, params);
  res.json({ groups: groups.map((g) => hideMoney(req.user, g)) });
}));

router.get('/booking-groups/:id', ah(async (req, res) => {
  const group = await loadGroup(req.user, uuidParam(req.params.id));
  const [summary] = await groupRows(['g.group_id = $1'], [group.group_id]);
  const rooms = await groupRoomRows(req.user, group.group_id);
  const guest = await one('SELECT * FROM guests WHERE guest_id = $1', [group.guest_id]);
  res.json({
    group: { group_id: group.group_id, name: group.name, notes: group.notes, status: summary.status, cancelled_at: group.cancelled_at, created_at: group.created_at },
    guest: ['staff', 'cleaner'].includes(req.user.role) ? staffGuest(guest) : guest,
    rooms: rooms.map((b) => roomView(req.user, b)),
    totals: hideMoney(req.user, { rooms: summary.rooms, total: summary.total, amount_paid: summary.amount_paid, balance: summary.balance, held: summary.held }),
  });
}));

router.post('/booking-groups', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    name: { type: 'string', required: true, max: 120, label: 'Group name' },
    notes: { type: 'text', max: 1000, label: 'Notes' },
  });
  const rooms = cleanRooms(req.body.rooms);
  const guest = await groupGuest(req.user, req.body.guest);
  const picks = [];
  let guestId;
  const groupId = await bookInTx(picks, async (db) => {
    guestId = await resolveGuest(db, req.user, guest);
    const { rows: [g] } = await db.query(
      `INSERT INTO booking_groups (organization_id, name, guest_id, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING group_id`,
      [req.user.organization_id, body.name, guestId, body.notes, req.user.user_id]);
    await bookRooms(db, req.user, rooms, { guestId, groupId: g.group_id, picks, action: 'booking_group.created' });
    return g.group_id;
  });
  // The lead guest's do-not-rebook flag, worked out as BOOKING_SELECT does for a single reservation, so the form can warn.
  const lead = await one(
    `SELECT g.full_name, (g.do_not_rebook OR (g.email IS NOT NULL AND btrim(g.email) <> '' AND EXISTS (SELECT 1 FROM guests f WHERE f.organization_id = g.organization_id AND f.do_not_rebook AND lower(btrim(f.email)) = lower(btrim(g.email))))) AS flagged
       FROM guests g WHERE g.guest_id = $1 AND g.organization_id = $2`, [guestId, req.user.organization_id]);
  res.status(201).json({
    group: (await groupRows(['g.group_id = $1'], [groupId]))[0], guest_do_not_rebook: lead.flagged, guest_name: lead.full_name,
  });
}));

router.patch('/booking-groups/:id', managers, ah(async (req, res) => {
  const group = await loadGroup(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    name: { type: 'string', required: true, max: 120, label: 'Group name' },
    notes: { type: 'text', max: 1000, label: 'Notes' },
  }, { partial: true });
  const keys = changedKeys(group, body);
  if (keys.length) {
    await tx(async (db) => {
      await db.query(`UPDATE booking_groups SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE group_id = $1`,
        [group.group_id, ...keys.map((k) => body[k])]);
      // The name and notes belong to the group, so one row; each room's timeline picks it up through its group id.
      await audit(db, req.user, 'booking_group.updated', 'booking_group', group.group_id, { group_id: group.group_id, fields: keys });
    });
  }
  res.json({ group: (await groupRows(['g.group_id = $1'], [group.group_id]))[0] });
}));

router.post('/booking-groups/:id/rooms', managers, ah(async (req, res) => {
  const group = await loadGroup(req.user, uuidParam(req.params.id));
  // One room as a plain body (older clients), or `rooms: [...]` to add several at once, all or nothing.
  const many = Array.isArray(req.body?.rooms);
  const rooms = many ? cleanRooms(req.body.rooms, 1) : [cleanRoom(req.body)];
  const picks = [];
  let bookingIds;
  try {
    bookingIds = await bookInTx(picks, async (db) => {
      // The group row is locked first, as the cancel path does, so no room is added while the group is being cancelled.
      const { rows: [locked] } = await db.query('SELECT cancelled_at FROM booking_groups WHERE group_id = $1 FOR UPDATE', [group.group_id]);
      if (locked.cancelled_at) throw new HttpError(409, 'This group is cancelled. Rooms cannot be added.', { code: 'CANCELLED' });
      return bookRooms(db, req.user, rooms, { guestId: group.guest_id, groupId: group.group_id, picks, action: 'booking_group.room_added' });
    });
  } catch (err) {
    if (many && err.status === 409 && !/Nothing was saved/.test(err.message)) err.message += ' Nothing was saved.';
    throw err;
  }
  res.status(201).json({ booking_id: bookingIds[0], booking_ids: bookingIds, group: (await groupRows(['g.group_id = $1'], [group.group_id]))[0] });
}));

// Removing a room is the normal cancel path for that booking. If no confirmed room is left, the group is cancelled too.
router.post('/booking-groups/:id/rooms/:bookingId/remove', managers, ah(async (req, res) => {
  const group = await loadGroup(req.user, uuidParam(req.params.id));
  const booking = await loadBooking(req.user, uuidParam(req.params.bookingId));
  if (booking.group_id !== group.group_id) throw notFound();
  assertCancellable(booking);
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 500, label: 'Reason' } });
  await tx(async (db) => {
    // Locking the group row first means two rooms removed at once can't each see the other one still booked.
    await db.query('SELECT 1 FROM booking_groups WHERE group_id = $1 FOR UPDATE', [group.group_id]);
    // A second tap may have cancelled this room while this request waited for the lock. Re-check it now.
    const { rows: [current] } = await db.query('SELECT status FROM bookings WHERE booking_id = $1 FOR UPDATE', [booking.booking_id]);
    if (current.status !== 'confirmed') throw new HttpError(409, 'This reservation is already cancelled.', { code: 'CANCELLED' });
    await cancelBooking(req.user, booking, reason, { db, action: 'booking_group.room_removed' });
    const { rows: [left] } = await db.query(`SELECT COUNT(*)::int AS n FROM bookings WHERE group_id = $1 AND status = 'confirmed'`, [group.group_id]);
    if (!left.n) await db.query('UPDATE booking_groups SET cancelled_at = now() WHERE group_id = $1 AND cancelled_at IS NULL', [group.group_id]);
  });
  await closeOpenCheckouts(booking.booking_id);
  res.json({ ok: true });
}));

router.post('/booking-groups/:id/cancel', managers, ah(async (req, res) => {
  const group = await loadGroup(req.user, uuidParam(req.params.id));
  const { reason } = validate(req.body, { reason: { type: 'string', max: 500, label: 'Reason' } });
  const cancelled = await tx(async (db) => {
    // Locking the group row means two cancels at once cancel each room only once.
    const { rows: [locked] } = await db.query('SELECT cancelled_at FROM booking_groups WHERE group_id = $1 FOR UPDATE', [group.group_id]);
    if (locked.cancelled_at) throw new HttpError(409, 'This group is already cancelled.', { code: 'CANCELLED' });
    const { rows } = await db.query(`${BOOKING_SELECT} WHERE b.group_id = $1 AND b.status = 'confirmed'`, [group.group_id]);
    for (const b of rows) {
      assertCancellable(b);
      await cancelBooking(req.user, b, reason, { db, action: 'booking_group.cancelled' });
    }
    await db.query('UPDATE booking_groups SET cancelled_at = now() WHERE group_id = $1', [group.group_id]);
    return rows;
  });
  for (const b of cancelled) await closeOpenCheckouts(b.booking_id);
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
  // Each night's price after weekend, holiday and season rules.
  const prices = [];
  for (const l of listings) {
    for (const n of await nightlyPrices(l.unit_id, start, end)) prices.push({ unit_id: l.unit_id, date: n.night, price: n.price, kind: n.kind, label: n.label });
  }
  res.json({ start, days, today: await today(), listings, bookings, rates, prices });
}));

router.put('/rates', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    unit_id: { type: 'uuid', required: true, label: 'Listing' },
    start_date: { type: 'date', required: true, label: 'From' },
    end_date: { type: 'date', required: true, label: 'To' },
    price: { type: 'money', positive: true, label: 'Nightly price' },
  });
  const unit = await loadUnit(req.user, body.unit_id);
  if (body.end_date < body.start_date) throw validationError({ end_date: 'Must be on or after the start date.' });
  if (nightsBetween(body.start_date, body.end_date) > 366) throw validationError({ end_date: 'Up to one year at a time.' });
  if (body.price !== null && Number(body.price) > MAX_PRICE) {
    throw validationError({ price: `A nightly price can't be more than ₱${MAX_PRICE.toLocaleString('en-PH')}.` });
  }
  // A blank price clears the set prices in the range; the count says how many were there.
  let cleared = 0;
  await tx(async (db) => {
    if (body.price === null) {
      const r = await db.query('DELETE FROM nightly_rates WHERE unit_id = $1 AND rate_date BETWEEN $2 AND $3', [unit.unit_id, body.start_date, body.end_date]);
      cleared = r.rowCount;
    } else {
      await db.query(
        `INSERT INTO nightly_rates (unit_id, rate_date, price)
         SELECT $1, d::date, $4 FROM generate_series($2::date, $3::date, interval '1 day') d
         ON CONFLICT (unit_id, rate_date) DO UPDATE SET price = EXCLUDED.price`,
        [unit.unit_id, body.start_date, body.end_date, body.price]);
    }
    await audit(db, req.user, 'rates.updated', 'unit', unit.unit_id, body);
  });
  res.json({ ok: true, cleared });
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
// across the nights of each stay; cleaning, other fees and extra charges count on check-in
// (the same definition as stay reports).
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
            (SELECT COALESCE(SUM(cleaning_fee + other_fees + extras_total), 0) FROM res, bounds WHERE check_in >= bounds.s AND check_in < bounds.e) AS fees,
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
    'SELECT feed_id, channel, url, last_synced_at, last_status, last_message, created_at FROM ical_feeds WHERE unit_id = $1 ORDER BY created_at', [unit.unit_id]);
  // problem_message is the plain owner-facing sentence, or null when the feed is fine. last_message keeps the raw text.
  const cutoff = new Date(Date.now() - STALE_MS);
  const withProblems = feeds.map((f) => {
    const problem = feedProblem(f, cutoff);
    return { ...f, host: hostOf(f.url), problem_message: problem ? problemText(f, problem).message : null };
  });
  res.json({ export_url: `${require('../config').appUrl}/ical/${token}.ics`, feeds: withProblems });
}));

router.post('/units/:id/channels/rotate', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  await query('UPDATE units SET ical_token = $2 WHERE unit_id = $1', [unit.unit_id, ical.newFeedToken()]);
  await audit(null, req.user, 'ical.export_rotated', 'unit', unit.unit_id);
  res.json({ ok: true });
}));

// Calendar links end in .ics; Booking.com's export is ical.html?t=..., so "ical" in the path or query counts too.
const looksLikeCalendar = (url) => /\.ics$/i.test(url.pathname) || /ical/i.test(url.pathname + url.search);

router.post('/ical-feeds', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    unit_id: { type: 'uuid', required: true, label: 'Listing' },
    channel: { type: 'enum', values: ['airbnb', 'booking', 'agoda', 'vrbo', 'expedia', 'tripcom', 'other'], required: true, label: 'Channel' },
    url: { type: 'string', required: true, max: 1000, label: 'Calendar link' },
    confirm_unusual_link: { type: 'bool' },
  });
  const unit = await loadUnit(req.user, body.unit_id);
  const url = ical.validateFeedUrl(body.url);
  if (!url) throw validationError({ url: 'Paste the full https:// calendar (iCal) link from the channel.' });
  // Asks once: the person resends with confirm_unusual_link when the link is what they meant.
  if (!looksLikeCalendar(url) && !body.confirm_unusual_link) {
    throw new HttpError(409, "This doesn't look like a calendar link (they usually end in .ics). Save it anyway?", { code: 'ICAL_NOT_CALENDAR' });
  }
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

module.exports.guestScope = guestScope;
