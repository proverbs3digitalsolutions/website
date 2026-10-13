'use strict';

// Guest reviews (private, only the host sees them) and direct-booking discount codes.

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole, rateLimit } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { normalize, USES } = require('../lib/discounts');

const router = express.Router();
const publicRouter = express.Router();
const managers = requireRole('owner', 'manager');
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// ---------------------------------------------------------------- guest review page
const reviewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, key: (req) => `review|${req.ip}` });
publicRouter.use('/public/review', reviewLimiter);

async function loadForReview(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw notFound('This review link is not valid.');
  const b = await one(
    `SELECT b.booking_id, b.organization_id, b.guest_id, b.check_in::text, b.check_out::text, b.status, u.unit_name, o.name AS host_name, o.is_demo,
            split_part(COALESCE(g.full_name, b.guest_label, ''), ' ', 1) AS guest_first_name,
            r.rating, r.created_at AS reviewed_at
       FROM bookings b JOIN units u USING (unit_id) JOIN organizations o ON o.organization_id = b.organization_id
       LEFT JOIN guests g ON g.guest_id = b.guest_id LEFT JOIN guest_reviews r ON r.booking_id = b.booking_id
      WHERE b.review_token = $1 AND b.kind = 'reservation'`, [token]);
  if (!b) throw notFound('This review link is not valid.');
  const today = manilaToday();
  b.open = b.status === 'confirmed' && !b.reviewed_at && !b.is_demo && today >= b.check_in && daysBetween(b.check_out, today) <= 60;
  return b;
}

publicRouter.get('/public/review/:token', ah(async (req, res) => {
  const b = await loadForReview(req.params.token);
  res.json({
    host: b.host_name, listing: b.unit_name, check_in: b.check_in, check_out: b.check_out, guest_first_name: b.guest_first_name || null,
    reviewed: Boolean(b.reviewed_at), open: b.open,
  });
}));

publicRouter.post('/public/review/:token', ah(async (req, res) => {
  const b = await loadForReview(req.params.token);
  if (b.reviewed_at) throw new HttpError(409, 'Thank you, we already have your feedback for this stay.', { code: 'ALREADY_REVIEWED' });
  if (!b.open) throw new HttpError(409, 'This stay can\'t be reviewed right now.', { code: 'CLOSED' });
  const body = validate(req.body, {
    rating: { type: 'int', required: true, min: 1, max: 5, label: 'Rating' },
    cleanliness: { type: 'int', min: 1, max: 5, label: 'Cleanliness' },
    comment: { type: 'text', max: 2000, label: 'Comment' },
  });
  try {
    await query(
      `INSERT INTO guest_reviews (organization_id, booking_id, guest_id, rating, cleanliness, comment) VALUES ($1,$2,$3,$4,$5,$6)`,
      [b.organization_id, b.booking_id, b.guest_id, body.rating, body.cleanliness, body.comment]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Thank you, we already have your feedback for this stay.', { code: 'ALREADY_REVIEWED' });
    throw err;
  }
  afterReview(b, body).catch((err) => console.error('[review] after-review steps failed:', err.message));
  res.status(201).json({ ok: true });
}));

async function afterReview(b, r) {
  const messaging = require('../lib/messaging');
  const conv = await messaging.getOrCreateConversation(b.booking_id);
  const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
  await query(`INSERT INTO messages (conversation_id, organization_id, direction, from_name, body, status) VALUES ($1,$2,'note','BalayHub',$3,'note')`,
    [conv.conversation_id, conv.organization_id,
      `Private review from the guest: ${stars} (${r.rating}/5)${r.cleanliness ? `, cleanliness ${r.cleanliness}/5` : ''}${r.comment ? `\n“${r.comment}”` : ''}`]);
  await query(`UPDATE conversations SET unread = true, last_message_at = now() WHERE conversation_id = $1`, [conv.conversation_id]);
  if (r.rating <= 3) {
    const { notify, propertyOfBooking } = require('../lib/push');
    await notify(b.organization_id, 'guest_message', {
      title: `${b.guest_first_name || 'A guest'} rated their stay ${r.rating}/5`, body: r.comment ? r.comment.slice(0, 120) : 'Tap to read.',
      url: `/#/reservations/${b.booking_id}`, propertyId: await propertyOfBooking(b.booking_id),
    });
  }
}

// ---------------------------------------------------------------- host: reviews
router.get('/reviews', ah(async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `SELECT r.review_id, r.booking_id, r.rating, r.cleanliness, r.comment, r.created_at, b.check_in, b.check_out, u.unit_name,
            COALESCE(g.full_name, b.guest_label) AS guest_name
       FROM guest_reviews r JOIN bookings b USING (booking_id) JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE ${scope} ORDER BY r.created_at DESC LIMIT 200`, params);
  const avg = rows.length ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / rows.length) * 10) / 10 : null;
  res.json({ reviews: rows, average: avg, count: rows.length });
}));

// ---------------------------------------------------------------- host: discount codes
const codeSpec = {
  code: { type: 'string', required: true, max: 20, label: 'Code' },
  description: { type: 'string', max: 120, label: 'Description' },
  percent_off: { type: 'int', min: 1, max: 90, label: 'Percent off' },
  amount_off: { type: 'money', label: 'Amount off' },
  min_nights: { type: 'int', min: 1, max: 60, label: 'Minimum nights' },
  valid_from: { type: 'date', label: 'Valid from' },
  valid_until: { type: 'date', label: 'Valid until' },
  max_uses: { type: 'int', min: 1, max: 100000, label: 'Maximum uses' },
  returning_only: { type: 'bool', label: 'Returning guests only' },
};

router.get('/discount-codes', managers, ah(async (req, res) => {
  const { rows } = await query(
    `SELECT d.*, ${USES} AS uses,
            (SELECT COALESCE(SUM(c.discount_amount), 0) FROM direct_checkouts c WHERE c.discount_code_id = d.code_id AND c.status = 'confirmed') AS total_discounted
       FROM discount_codes d WHERE d.organization_id = $1 ORDER BY d.active DESC, d.created_at DESC`, [req.user.organization_id]);
  res.json({ codes: rows });
}));

router.post('/discount-codes', managers, ah(async (req, res) => {
  const body = validate(req.body, codeSpec);
  const code = normalize(body.code);
  if (!/^[A-Z0-9-]{3,20}$/.test(code)) throw validationError({ code: 'Use 3–20 letters, numbers or dashes, e.g. BALIK10.' });
  if ((body.percent_off === null) === (body.amount_off === null || Number(body.amount_off) === 0)) {
    throw validationError({ percent_off: 'Set either a percent off or an amount off.' });
  }
  if (body.valid_from && body.valid_until && body.valid_until < body.valid_from) throw validationError({ valid_until: 'The end date must be after the start date.' });
  const { n } = await one('SELECT COUNT(*)::int AS n FROM discount_codes WHERE organization_id = $1 AND active', [req.user.organization_id]);
  if (n >= 50) throw new HttpError(409, 'You can have up to 50 active codes. Turn some off first.', { code: 'LIMIT' });
  try {
    const d = await one(
      `INSERT INTO discount_codes (organization_id, code, description, percent_off, amount_off, min_nights, valid_from, valid_until, max_uses, returning_only, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::smallint, 1),$7,$8,$9,$10,$11) RETURNING code_id`,
      [req.user.organization_id, code, body.description, body.percent_off, body.percent_off === null ? body.amount_off : null, body.min_nights,
        body.valid_from, body.valid_until, body.max_uses, Boolean(body.returning_only), req.user.user_id]);
    await audit(null, req.user, 'discount_code.created', 'discount_code', d.code_id, { code });
    res.status(201).json({ code_id: d.code_id });
  } catch (err) {
    if (err.code === '23505') throw validationError({ code: 'You already have a code with that name.' });
    throw err;
  }
}));

router.post('/discount-codes/:id/active', managers, ah(async (req, res) => {
  const { active } = validate(req.body, { active: { type: 'bool', label: 'Active' } });
  const d = await one('UPDATE discount_codes SET active = $3 WHERE code_id = $1 AND organization_id = $2 RETURNING code', [uuidParam(req.params.id), req.user.organization_id, Boolean(active)]);
  if (!d) throw notFound();
  await audit(null, req.user, active ? 'discount_code.enabled' : 'discount_code.disabled', 'discount_code', req.params.id, { code: d.code });
  res.json({ ok: true });
}));

module.exports = { router, publicRouter };
