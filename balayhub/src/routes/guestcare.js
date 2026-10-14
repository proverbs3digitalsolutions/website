'use strict';

// Guest reviews (private, only the host sees them) and direct-booking discount codes.

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam, isValidDate, UUID_RE } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { changedKeys } = require('../lib/auditdiff');
const { requireRole, rateLimit } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { normalize, USES } = require('../lib/discounts');

const router = express.Router();
const publicRouter = express.Router();
const managers = requireRole('owner', 'manager');
// Workspace-wide settings (discount codes) are owner-only: managers may be
// limited to some properties (founder decision 2026-10-13).
const owners = requireRole('owner');
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
// A filter id that isn't a UUID is ignored (D-77), so an old or edited link still loads the list.
const uuidOrNull = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
// A unit or property filter counts only when this workspace has that row; any other id is ignored like a bad one (D-82).
async function inWorkspace(user, sql, id) {
  if (!id) return null;
  return (await one(sql, [id, user.organization_id])) ? id : null;
}

// Public review links (D-62): a name of 1–40 characters and an https address of at most 300.
const REVIEW_LINKS_MAX = 4;
const isHttps = (url) => { try { return new URL(url).protocol === 'https:'; } catch { return false; } };
function reviewLinkProblem(l) {
  const label = typeof l?.label === 'string' ? l.label.trim() : '';
  const url = typeof l?.url === 'string' ? l.url.trim() : '';
  if (label.length < 1 || label.length > 40) return 'Each link needs a name of 1 to 40 characters.';
  if (url.length > 300 || !isHttps(url)) return 'Each link needs an https:// address of at most 300 characters.';
  return null;
}
// Stored links are checked again on read, so a bad row never reaches a guest.
const storedReviewLinks = (raw) => (Array.isArray(raw)
  ? raw.filter((l) => !reviewLinkProblem(l)).slice(0, REVIEW_LINKS_MAX).map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
  : []);

// ---------------------------------------------------------------- guest review page
const reviewLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, key: (req) => `review|${req.ip}` });
publicRouter.use('/public/review', reviewLimiter);

async function loadForReview(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw notFound('This review link is not valid.');
  const b = await one(
    `SELECT b.booking_id, b.organization_id, b.guest_id, b.check_in::text, b.check_out::text, b.status, u.unit_name, o.name AS host_name, o.is_demo, o.guest_language, o.review_links,
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
    reviewed: Boolean(b.reviewed_at), open: b.open, guest_language: b.guest_language,
    not_yet: b.status === 'confirmed' && manilaToday() < b.check_in,
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
  // Happy guests (4–5 stars) are invited to share on the host's public pages; 3 or less stay private.
  const shareLinks = body.rating >= 4 ? storedReviewLinks(b.review_links) : [];
  res.status(201).json(shareLinks.length ? { ok: true, share_links: shareLinks } : { ok: true });
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
// Filters: rating (1–5, "low" = 3 stars or less, "high" = 4 or more), listing,
// property, review date range, has a comment, search (guest or comment), sort.
const REVIEW_SORTS = { newest: 'r.created_at DESC', oldest: 'r.created_at', lowest: 'r.rating, r.created_at DESC', highest: 'r.rating DESC, r.created_at DESC', checkin: 'b.check_in DESC' };
router.get('/reviews', ah(async (req, res) => {
  const q = req.query;
  const params = [];
  const scope = propertyScope(req.user, params);
  const where = [scope];
  if (/^[1-5]$/.test(String(q.rating || ''))) { params.push(Number(q.rating)); where.push(`r.rating = $${params.length}`); }
  if (q.rating === 'low') where.push('r.rating <= 3');
  if (q.rating === 'high') where.push('r.rating >= 4');
  const unitId = await inWorkspace(req.user, 'SELECT 1 FROM units u JOIN properties p ON p.property_id = u.property_id WHERE u.unit_id = $1 AND p.organization_id = $2', uuidOrNull(q.unit_id));
  if (unitId) { params.push(unitId); where.push(`b.unit_id = $${params.length}`); }
  const propertyId = await inWorkspace(req.user, 'SELECT 1 FROM properties WHERE property_id = $1 AND organization_id = $2', uuidOrNull(q.property_id));
  if (propertyId) { params.push(propertyId); where.push(`p.property_id = $${params.length}`); }
  if (isValidDate(q.from)) { params.push(q.from); where.push(`(r.created_at AT TIME ZONE 'Asia/Manila')::date >= $${params.length}`); }
  if (isValidDate(q.to)) { params.push(q.to); where.push(`(r.created_at AT TIME ZONE 'Asia/Manila')::date <= $${params.length}`); }
  if (q.has_comment === '1') where.push(`COALESCE(btrim(r.comment), '') <> ''`);
  if (q.q) {
    params.push(`%${String(q.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(g.full_name ILIKE $${params.length} OR b.guest_label ILIKE $${params.length} OR r.comment ILIKE $${params.length} OR u.unit_name ILIKE $${params.length})`);
  }
  const from = `FROM guest_reviews r JOIN bookings b USING (booking_id) JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN guests g ON g.guest_id = b.guest_id`;
  const whereSql = where.join(' AND ');
  const { rows } = await query(
    `SELECT r.review_id, r.booking_id, r.rating, r.cleanliness, r.comment, r.created_at, b.check_in, b.check_out, u.unit_name, p.property_name,
            COALESCE(g.full_name, b.guest_label) AS guest_name
       ${from} WHERE ${whereSql} ORDER BY ${Object.hasOwn(REVIEW_SORTS, q.sort) ? REVIEW_SORTS[q.sort] : REVIEW_SORTS.newest} LIMIT 200`, params);
  // The headline average is always over every review you can see, filtered or not.
  const allParams = [];
  const all = await one(`SELECT COUNT(*)::int AS n, ROUND(AVG(r.rating), 1)::float AS avg ${from} WHERE ${propertyScope(req.user, allParams)}`, allParams);
  // Matched counts every review the filters keep, not just the 200 rows listed.
  const matched = await one(`SELECT COUNT(*)::int AS n, ROUND(AVG(r.rating), 1)::float AS avg ${from} WHERE ${whereSql}`, params);
  res.json({ reviews: rows, average: all.n ? all.avg : null, count: all.n, matched: matched.n, matched_average: matched.n ? matched.avg : null });
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

// Filters: status (active / scheduled / expired / used up / off), type
// (percent or amount), returning-guests-only, issued to a guest (yes / no), and search on the code or note.
router.get('/discount-codes', managers, ah(async (req, res) => {
  const q = req.query;
  const params = [req.user.organization_id, manilaToday()];
  const where = ['d.organization_id = $1'];
  const usedUp = `(d.max_uses IS NOT NULL AND ${USES} >= d.max_uses)`;
  const STATUS = {
    active: `d.active AND (d.valid_from IS NULL OR d.valid_from <= $2) AND (d.valid_until IS NULL OR d.valid_until >= $2) AND NOT ${usedUp}`,
    scheduled: 'd.active AND d.valid_from > $2',
    expired: 'd.valid_until < $2',
    used_up: usedUp,
    off: 'NOT d.active',
  };
  if (Object.hasOwn(STATUS, q.status)) where.push(`(${STATUS[q.status]})`);
  if (q.type === 'percent') where.push('d.percent_off IS NOT NULL');
  if (q.type === 'amount') where.push('d.amount_off IS NOT NULL');
  if (q.returning === '1') where.push('d.returning_only');
  // Issued = a personal returning-guest code (issued_to_booking_id is set); the rest were made by the host.
  if (q.issued === 'yes') where.push('d.issued_to_booking_id IS NOT NULL');
  if (q.issued === 'no') where.push('d.issued_to_booking_id IS NULL');
  if (q.q) { params.push(`%${String(q.q).slice(0, 60).replace(/[%_\\]/g, '\\$&')}%`); where.push(`(d.code ILIKE $${params.length} OR d.description ILIKE $${params.length})`); }
  const SORTS = { newest: 'd.created_at DESC', code: 'd.code', most_used: 'uses DESC, d.code', ending: 'd.valid_until NULLS LAST, d.code' };
  const { rows } = await query(
    `SELECT d.*, (d.issued_to_booking_id IS NOT NULL) AS issued, ${USES} AS uses,
            (SELECT COALESCE(SUM(c.discount_amount), 0) FROM direct_checkouts c WHERE c.discount_code_id = d.code_id AND c.status = 'confirmed') AS total_discounted,
            (d.valid_until IS NOT NULL AND d.valid_until < $2) AS expired, (d.valid_from IS NOT NULL AND d.valid_from > $2) AS scheduled, ${usedUp} AS used_up
       FROM discount_codes d WHERE ${where.join(' AND ')} ORDER BY ${Object.hasOwn(SORTS, q.sort) ? SORTS[q.sort] : 'd.active DESC, d.created_at DESC'}`, params);
  const total = q.status || q.type || q.returning || q.issued || q.q
    ? (await one('SELECT COUNT(*)::int AS n FROM discount_codes WHERE organization_id = $1', [req.user.organization_id])).n : rows.length;
  res.json({ codes: rows, total });
}));

router.post('/discount-codes', owners, ah(async (req, res) => {
  const body = validate(req.body, codeSpec);
  // Guests typing a code are forgiven a space; the owner's copy is refused so the code is saved exactly as shared.
  if (/\s/.test(body.code)) throw validationError({ code: `Codes can't contain spaces. Try ${body.code.toUpperCase().replace(/\s+/g, '-')}.` });
  const code = normalize(body.code);
  if (!/^[A-Z0-9-]{3,20}$/.test(code)) throw validationError({ code: 'Use 3–20 letters, numbers or dashes, e.g. BALIK10.' });
  if ((body.percent_off === null) === (body.amount_off === null || Number(body.amount_off) === 0)) {
    throw validationError({ percent_off: 'Set either a percent off or an amount off.' });
  }
  if (body.valid_from && body.valid_until && body.valid_until < body.valid_from) throw validationError({ valid_until: 'The end date must be after the start date.' });
  // Personal codes issued to returning guests don't count toward the owner's limit.
  const { n } = await one('SELECT COUNT(*)::int AS n FROM discount_codes WHERE organization_id = $1 AND active AND issued_to_booking_id IS NULL', [req.user.organization_id]);
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

router.post('/discount-codes/:id/active', owners, ah(async (req, res) => {
  const { active } = validate(req.body, { active: { type: 'bool', label: 'Active' } });
  const d = await one('UPDATE discount_codes SET active = $3 WHERE code_id = $1 AND organization_id = $2 RETURNING code', [uuidParam(req.params.id), req.user.organization_id, Boolean(active)]);
  if (!d) throw notFound();
  await audit(null, req.user, active ? 'discount_code.enabled' : 'discount_code.disabled', 'discount_code', req.params.id, { code: d.code });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- host: guest settings (D-62)
// Owners only. PATCH changes just the fields sent; returning_guest_pct: null turns the discount off.
async function guestSettings(orgId) {
  const o = await one('SELECT review_links, returning_guest_pct, abandoned_followup FROM organizations WHERE organization_id = $1', [orgId]);
  return { review_links: storedReviewLinks(o.review_links), returning_guest_pct: o.returning_guest_pct, abandoned_followup: o.abandoned_followup };
}

router.get('/workspace/guest-settings', owners, ah(async (req, res) => {
  res.json(await guestSettings(req.user.organization_id));
}));

router.patch('/workspace/guest-settings', owners, ah(async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const body = validate(b, {
    returning_guest_pct: { type: 'int', min: 1, max: 50, label: 'Returning-guest discount' },
    abandoned_followup: { type: 'bool', label: 'Abandoned-booking follow-up' },
  }, { partial: true });
  const sets = [];
  const params = [req.user.organization_id];
  const sent = {};
  const set = (column, value, cast = '') => {
    params.push(cast ? JSON.stringify(value) : value);
    sets.push(`${column} = $${params.length}${cast}`);
    sent[column] = value;
  };
  const current = await guestSettings(req.user.organization_id);
  if ('returning_guest_pct' in body) set('returning_guest_pct', body.returning_guest_pct);
  if ('abandoned_followup' in body) set('abandoned_followup', body.abandoned_followup);
  if (b.review_links !== undefined) {
    const links = b.review_links ?? [];
    if (!Array.isArray(links) || links.length > REVIEW_LINKS_MAX) throw validationError({ review_links: `Add up to ${REVIEW_LINKS_MAX} review links.` });
    const problem = links.map((l) => reviewLinkProblem(l)).find(Boolean);
    if (problem) throw validationError({ review_links: problem });
    set('review_links', links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })), '::jsonb');
  }
  if (sets.length) {
    await query(`UPDATE organizations SET ${sets.join(', ')} WHERE organization_id = $1`, params);
    // Which settings changed, never their values. Saving what is already stored writes no row.
    const fields = changedKeys(current, sent);
    if (fields.length) await audit(null, req.user, 'workspace.guest_settings_updated', 'organization', req.user.organization_id, { fields });
  }
  res.json(await guestSettings(req.user.organization_id));
}));

module.exports = { router, publicRouter };
