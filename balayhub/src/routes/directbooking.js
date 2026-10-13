'use strict';

// Direct booking: each host's public booking page, paid through the host's own
// PayMongo account (full payment or a 50% deposit). A booking is created only
// after BalayHub confirms the payment with PayMongo using the host's key.

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam, isValidDate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole, rateLimit } = require('../lib/auth');
const { loadUnit } = require('../lib/access');
const { planStatus } = require('../lib/plans');
const { quote, nightlyPrices } = require('../lib/pricing');
const { applyCode } = require('../lib/discounts');
const { addDays } = require('../lib/holidays');
const secretbox = require('../lib/secretbox');
const paymongo = require('../lib/paymongo');
const storage = require('../lib/storage');

const router = express.Router();
const publicRouter = express.Router();
const owners = requireRole('owner');
const managers = requireRole('owner', 'manager');

const HOLD_MINUTES = 30;
const MAX_DAYS_AHEAD = 540; // about 18 months
const MAX_OPEN_HOLDS = 2; // per visitor or email, across all hosts
const MAX_PHOTOS = 12;
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const bookingUrl = (slug) => `${config.appUrl}/#/book/${slug}`;

// ---------------------------------------------------------------- host settings
router.get('/direct-booking', owners, ah(async (req, res) => {
  const o = await one('SELECT name, booking_slug, booking_enabled, booking_intro, paymongo_key_hint FROM organizations WHERE organization_id = $1', [req.user.organization_id]);
  const { rows: listings } = await query(
    `SELECT u.unit_id, u.unit_name, p.property_name, u.bookable_online, u.nightly_rate,
            (SELECT COUNT(*)::int FROM files f WHERE f.related_record_type = 'listing' AND f.related_record_id = u.unit_id) AS photo_count
       FROM units u JOIN properties p USING (property_id)
      WHERE p.organization_id = $1 AND u.status = 'active' AND p.status = 'active' AND u.nightly_rate IS NOT NULL
      ORDER BY p.property_name, u.unit_name`, [req.user.organization_id]);
  res.json({
    test_mode: Boolean(o.paymongo_key_hint && o.paymongo_key_hint.startsWith('sk_test_')),
    slug: o.booking_slug || slugify(o.name),
    enabled: o.booking_enabled,
    intro: o.booking_intro,
    paymongo_connected: Boolean(o.paymongo_key_hint),
    paymongo_key_hint: o.paymongo_key_hint,
    url: o.booking_slug ? bookingUrl(o.booking_slug) : null,
    listings,
  });
}));

router.patch('/direct-booking', owners, ah(async (req, res) => {
  const body = validate(req.body, {
    enabled: { type: 'bool', label: 'Booking page' },
    slug: { type: 'string', max: 40, label: 'Page address' },
    intro: { type: 'text', max: 1500, label: 'Welcome text' },
    paymongo_secret_key: { type: 'string', max: 200, label: 'PayMongo secret key' },
  }, { partial: true });
  const sets = []; const params = [req.user.organization_id];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if ('slug' in body) {
    const slug = slugify(body.slug);
    if (slug.length < 3) throw validationError({ slug: 'Use at least 3 letters or numbers.' });
    if (['admin', 'api', 'demo', 'login', 'signup', 'settings'].includes(slug)) throw validationError({ slug: 'That address is reserved. Try another.' });
    const taken = await one('SELECT 1 FROM organizations WHERE lower(booking_slug) = $1 AND organization_id <> $2', [slug, req.user.organization_id]);
    if (taken) throw validationError({ slug: 'That address is already taken. Try another.' });
    set('booking_slug', slug);
  }
  if ('intro' in body) set('booking_intro', body.intro);
  if (body.paymongo_secret_key) {
    const key = body.paymongo_secret_key.trim();
    if (!/^sk_(test|live)_[A-Za-z0-9]{10,}$/.test(key)) throw validationError({ paymongo_secret_key: 'Paste the Secret key from PayMongo (it starts with sk_live_ or sk_test_).' });
    set('paymongo_key_enc', secretbox.encrypt(key));
    set('paymongo_key_hint', `${key.slice(0, 8)}…${key.slice(-4)}`);
  }
  if (req.body?.disconnect_paymongo === true) { set('paymongo_key_enc', null); set('paymongo_key_hint', null); }
  if ('enabled' in body) {
    if (body.enabled) {
      const o = await one('SELECT booking_slug, paymongo_key_hint FROM organizations WHERE organization_id = $1', [req.user.organization_id]);
      const willHaveKey = Boolean(o.paymongo_key_hint || body.paymongo_secret_key) && req.body?.disconnect_paymongo !== true;
      if (!willHaveKey) throw new HttpError(409, 'Connect your PayMongo account first, so guests can pay you.', { code: 'NO_PAYMONGO' });
      if (!o.booking_slug && !('slug' in body)) {
        let slug = slugify(req.user.organization_name) || 'stays';
        if (slug.length < 3) slug = `${slug}-stays`;
        const taken = await one('SELECT 1 FROM organizations WHERE lower(booking_slug) = $1', [slug]);
        set('booking_slug', taken ? `${slug}-${crypto.randomBytes(2).toString('hex')}` : slug);
      }
    }
    set('booking_enabled', body.enabled);
  }
  if (sets.length) {
    try {
      await query(`UPDATE organizations SET ${sets.join(', ')} WHERE organization_id = $1`, params);
    } catch (err) {
      if (err.code === '23505') throw validationError({ slug: 'That address is already taken. Try another.' });
      throw err;
    }
    await audit(null, req.user, 'direct_booking.settings_changed', 'organization', req.user.organization_id,
      { enabled: body.enabled, slug: body.slug, paymongo_key_changed: Boolean(body.paymongo_secret_key) || req.body?.disconnect_paymongo === true });
  }
  const o = await one('SELECT booking_slug FROM organizations WHERE organization_id = $1', [req.user.organization_id]);
  res.json({ ok: true, url: o.booking_slug ? bookingUrl(o.booking_slug) : null });
}));

// ---------------------------------------------------------------- listing photos (host)
router.get('/units/:id/photos', ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const { rows } = await query(
    `SELECT file_id, file_name, sort_order FROM files WHERE related_record_type = 'listing' AND related_record_id = $1 ORDER BY sort_order, uploaded_at`, [unit.unit_id]);
  res.json({ photos: rows });
}));

router.post('/units/:id/photos', managers, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: config.maxUploadBytes }), ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const mime = String(req.get('Content-Type') || '').split(';')[0].trim();
  if (!storage.checkUpload(mime, req.body, { imagesOnly: true })) throw new HttpError(415, 'Upload a photo (JPG, PNG or WEBP) up to 10 MB.', { code: 'UNSUPPORTED_FILE' });
  const file = await tx(async (db) => {
    await db.query('SELECT unit_id FROM units WHERE unit_id = $1 FOR UPDATE', [unit.unit_id]);
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM files WHERE related_record_type = 'listing' AND related_record_id = $1`, [unit.unit_id]);
    if (n >= MAX_PHOTOS) throw new HttpError(409, `A listing can have up to ${MAX_PHOTOS} photos.`, { code: 'TOO_MANY' });
    const f = await storage.saveFile({
      organizationId: req.user.organization_id, recordType: 'listing', recordId: unit.unit_id, body: req.body, mime,
      fileName: `${unit.unit_name}-${n + 1}.${storage.ALLOWED[mime].ext}`, uploadedBy: req.user.user_id, db,
    });
    await db.query('UPDATE files SET sort_order = $2 WHERE file_id = $1', [f.file_id, n]);
    return f;
  });
  res.status(201).json({ photo: file });
}));

async function loadListingPhoto(user, id) {
  const f = await one(`SELECT * FROM files WHERE file_id = $1 AND organization_id = $2 AND related_record_type = 'listing'`, [id, user.organization_id]);
  if (!f) throw notFound();
  await loadUnit(user, f.related_record_id);
  return f;
}

router.post('/listing-photos/:id/remove', managers, ah(async (req, res) => {
  const f = await loadListingPhoto(req.user, uuidParam(req.params.id));
  await storage.deleteFile(f);
  res.json({ ok: true });
}));

router.post('/listing-photos/:id/cover', managers, ah(async (req, res) => {
  const f = await loadListingPhoto(req.user, uuidParam(req.params.id));
  await query(`UPDATE files SET sort_order = sort_order + 1 WHERE related_record_type = 'listing' AND related_record_id = $1`, [f.related_record_id]);
  await query('UPDATE files SET sort_order = 0 WHERE file_id = $1', [f.file_id]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- public booking page
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, key: (req) => `book|${req.ip}` });
const checkoutLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: (req) => `bookpay|${req.ip}` });
publicRouter.use('/public/book', publicLimiter);

async function loadHost(slug) {
  const o = await one(
    `SELECT organization_id, name, booking_slug, booking_enabled, booking_intro, paymongo_key_enc, paymongo_key_hint, plan, trial_ends_at, paid_until,
            is_demo, deletion_scheduled_at, guest_language
       FROM organizations WHERE lower(booking_slug) = lower($1)`, [String(slug || '').slice(0, 60)]);
  if (!o || (!o.booking_enabled && !o.is_demo)) throw notFound('This booking page is not available.');
  const st = planStatus(o);
  o.accepting = Boolean(o.paymongo_key_enc) && !st.read_only;
  o.test_mode = Boolean(o.paymongo_key_hint && o.paymongo_key_hint.startsWith('sk_test_'));
  return o;
}

const PUBLIC_UNIT = `
  SELECT u.unit_id, u.unit_name, u.description, u.max_guests, u.nightly_rate, u.cleaning_fee, u.min_nights, u.payment_option,
         u.balance_due_days, u.house_rules, to_char(u.checkin_time, 'HH24:MI') AS checkin_time, to_char(u.checkout_time, 'HH24:MI') AS checkout_time,
         p.property_name, p.city, p.province,
         COALESCE((SELECT json_agg(f.file_id ORDER BY f.sort_order, f.uploaded_at) FROM files f
                    WHERE f.related_record_type = 'listing' AND f.related_record_id = u.unit_id), '[]') AS photos
    FROM units u JOIN properties p USING (property_id)
   WHERE p.organization_id = $1 AND u.bookable_online AND u.status = 'active' AND p.status = 'active' AND u.nightly_rate IS NOT NULL`;

async function loadPublicUnit(host, unitId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(unitId))) throw notFound('This listing is not available.');
  const u = await one(`${PUBLIC_UNIT} AND u.unit_id = $2`, [host.organization_id, unitId]);
  if (!u) throw notFound('This listing is not available.');
  return u;
}

publicRouter.get('/public/book/:slug', ah(async (req, res) => {
  const host = await loadHost(req.params.slug);
  const { rows } = await query(`${PUBLIC_UNIT} ORDER BY p.property_name, u.unit_name`, [host.organization_id]);
  res.json({ host: { name: host.name, intro: host.booking_intro, accepting: host.accepting, demo: host.is_demo, test_mode: host.test_mode, guest_language: host.guest_language }, listings: rows });
}));

// Taken nights and prices for a date range (for the availability calendar).
publicRouter.get('/public/book/:slug/units/:unitId/availability', ah(async (req, res) => {
  const host = await loadHost(req.params.slug);
  const u = await loadPublicUnit(host, req.params.unitId);
  const from = isValidDate(req.query.from) && req.query.from >= manilaToday() ? req.query.from : manilaToday();
  const to = new Date(Date.parse(`${from}T00:00:00Z`) + 62 * 86400000).toISOString().slice(0, 10);
  const { rows } = await query(
    `SELECT d::date::text AS date,
            EXISTS (SELECT 1 FROM bookings b WHERE b.unit_id = $1 AND b.status = 'confirmed' AND d::date >= b.check_in AND d::date < b.check_out)
         OR EXISTS (SELECT 1 FROM direct_checkouts c WHERE c.unit_id = $1 AND c.status = 'pending' AND c.hold_until > now()
                      AND d::date >= c.check_in AND d::date < c.check_out) AS taken
       FROM generate_series($2::date, $3::date, interval '1 day') d
      ORDER BY d`, [u.unit_id, from, to]);
  const prices = new Map((await nightlyPrices(u.unit_id, from, addDays(to, 1))).map((n) => [n.night, n]));
  res.json({ from, to, days: rows.map((r) => ({ ...r, price: prices.get(r.date)?.price ?? null, holiday: prices.get(r.date)?.kind === 'holiday' ? prices.get(r.date).label : null })) });
}));

// `promo`: { orgId, code, email, strict } — strict (at checkout) rejects a bad code; otherwise it's reported.
async function priceStay(u, checkIn, checkOut, promo = {}) {
  if (!isValidDate(checkIn) || !isValidDate(checkOut) || checkOut <= checkIn) throw validationError({ check_out: 'Choose a check-out date after check-in.' });
  if (checkIn < manilaToday()) throw validationError({ check_in: 'Choose a date from today onwards.' });
  if (checkIn > new Date(Date.now() + 8 * 3600e3 + MAX_DAYS_AHEAD * 86400000).toISOString().slice(0, 10)) {
    throw validationError({ check_in: `Bookings open up to ${Math.round(MAX_DAYS_AHEAD / 30)} months ahead. Please contact the host for later dates.` });
  }
  const nights = nightsBetween(checkIn, checkOut);
  if (nights > 60) throw validationError({ check_out: 'For stays longer than 60 nights, please contact the host.' });
  const q = await quote(u.unit_id, checkIn, checkOut);
  if (nights < q.min_nights) {
    throw validationError({ check_out: `${q.min_nights_reason ? `During ${q.min_nights_reason}, this` : 'This'} place has a minimum stay of ${q.min_nights} nights.` });
  }
  let accommodation = Number(q.accommodation_total);
  let applied = null; let codeError = null;
  if (promo.code) {
    const r = await applyCode(promo.orgId, promo.code, { nights, accommodation, email: promo.email, name: promo.name }, { strict: Boolean(promo.strict) });
    if (r.error && promo.strict) throw validationError({ code: r.error });
    if (r.error) codeError = r.error;
    else if (r.code) { applied = r; accommodation = Math.round((accommodation - r.discount) * 100) / 100; }
  }
  const cleaning = Number(u.cleaning_fee || 0);
  const total = Math.round((accommodation + cleaning) * 100) / 100;
  const deposit = Math.round(total * 50) / 100;
  const due = new Date(Date.parse(`${checkIn}T00:00:00Z`) - u.balance_due_days * 86400000).toISOString().slice(0, 10);
  // A deposit only makes sense if the balance isn't already due.
  const depositAllowed = u.payment_option !== 'full' && due > manilaToday();
  return {
    nights, subtotal: q.subtotal, discount_label: q.discount_label, discount_amount: q.discount_amount,
    promo_code: applied?.code || null, promo_code_id: applied?.code_id || null, promo_label: applied?.label || null,
    promo_discount: applied ? applied.discount.toFixed(2) : '0.00', code_error: codeError,
    promo_note: applied?.returning_only && !promo.strict ? 'For returning guests: checked at payment against your previous stay.' : null,
    accommodation_total: accommodation.toFixed(2), cleaning_fee: cleaning.toFixed(2), total: total.toFixed(2), deposit: deposit.toFixed(2),
    balance_due_date: due, deposit_allowed: depositAllowed, full_allowed: u.payment_option !== 'deposit' || !depositAllowed,
  };
}

async function isFree(unitId, checkIn, checkOut, exceptRef, db) {
  const sql = `SELECT
      EXISTS (SELECT 1 FROM bookings b WHERE b.unit_id = $1 AND b.status = 'confirmed' AND daterange(b.check_in, b.check_out) && daterange($2::date, $3::date))
   OR EXISTS (SELECT 1 FROM direct_checkouts c WHERE c.unit_id = $1 AND c.status = 'pending' AND c.hold_until > now()
                AND c.checkout_ref IS DISTINCT FROM $4 AND daterange(c.check_in, c.check_out) && daterange($2::date, $3::date)) AS taken`;
  const params = [unitId, checkIn, checkOut, exceptRef || null];
  const row = db ? (await db.query(sql, params)).rows[0] : await one(sql, params);
  return !row.taken;
}

publicRouter.get('/public/book/:slug/units/:unitId/quote', ah(async (req, res) => {
  const host = await loadHost(req.params.slug);
  const u = await loadPublicUnit(host, req.params.unitId);
  const { promo_code_id: _id, ...p } = await priceStay(u, req.query.check_in, req.query.check_out,
    { orgId: host.organization_id, code: req.query.code ? String(req.query.code).slice(0, 40) : null });
  res.json({ ...p, available: await isFree(u.unit_id, req.query.check_in, req.query.check_out), payment_option: u.payment_option });
}));

publicRouter.post('/public/book/:slug/units/:unitId/checkout', checkoutLimiter, ah(async (req, res) => {
  const host = await loadHost(req.params.slug);
  if (host.is_demo) throw new HttpError(403, 'This is a demo booking page, so it can\'t take real bookings.', { code: 'DEMO_READ_ONLY' });
  if (!host.accepting) throw new HttpError(409, 'This host is not taking online bookings right now. Please contact them directly.', { code: 'NOT_ACCEPTING' });
  const u = await loadPublicUnit(host, req.params.unitId);
  const body = validate(req.body, {
    check_in: { type: 'date', required: true, label: 'Check-in' },
    check_out: { type: 'date', required: true, label: 'Check-out' },
    num_guests: { type: 'int', required: true, min: 1, max: 50, label: 'Guests' },
    name: { type: 'string', required: true, max: 120, label: 'Full name' },
    email: { type: 'email', required: true, label: 'Email' },
    phone: { type: 'phone', required: true, label: 'Mobile number' },
    notes: { type: 'text', max: 1000, label: 'Message to the host' },
    pay: { type: 'enum', values: ['full', 'deposit'], required: true, label: 'Payment' },
    code: { type: 'string', max: 40, label: 'Discount code' },
    consent: { type: 'bool', label: 'Consent' },
  });
  if (!body.consent) throw validationError({ consent: 'Please agree to continue.' });
  if (u.max_guests && body.num_guests > u.max_guests) throw validationError({ num_guests: `This place allows up to ${u.max_guests} guests.` });
  const price = await priceStay(u, body.check_in, body.check_out, { orgId: host.organization_id, code: body.code, email: body.email, name: body.name, strict: true });
  if ((body.pay === 'deposit' && !price.deposit_allowed) || (body.pay === 'full' && !price.full_allowed)) {
    throw validationError({ pay: body.pay === 'deposit' && u.payment_option !== 'full'
      ? 'Your stay is too soon for a deposit. Please pay in full.' : 'That payment option is not available for this place.' });
  }
  const dueNow = body.pay === 'deposit' ? price.deposit : price.total;
  if (Number(dueNow) < 100) throw validationError({ pay: 'The amount is too small to pay online. Please contact the host.' });

  // Hold the dates (one hold at a time per listing, so two guests can't pay for the same nights).
  const token = crypto.randomBytes(18).toString('base64url');
  const clientHash = crypto.createHash('sha256').update(`${req.ip}|${config.appUrl}`).digest('hex').slice(0, 32);
  const open = await one(
    `SELECT COUNT(*)::int AS n FROM direct_checkouts WHERE status = 'pending' AND hold_until > now() AND (client_hash = $1 OR lower(guest_email) = $2)`,
    [clientHash, body.email]);
  if (open.n >= MAX_OPEN_HOLDS) {
    throw new HttpError(429, 'You already have a booking waiting for payment. Please finish or cancel it first, or try again in 30 minutes.', { code: 'TOO_MANY_HOLDS' });
  }
  const hold = await tx(async (db) => {
    await db.query('SELECT unit_id FROM units WHERE unit_id = $1 FOR UPDATE', [u.unit_id]);
    if (!await isFree(u.unit_id, body.check_in, body.check_out, null, db)) {
      throw new HttpError(409, 'Sorry, those dates were just booked. Please choose other dates.', { code: 'DATES_TAKEN' });
    }
    // Hold the code too, so its last use can't be taken twice.
    if (price.promo_code_id) {
      const again = await applyCode(host.organization_id, body.code, { nights: price.nights, accommodation: Number(price.accommodation_total) + Number(price.promo_discount), email: body.email, name: body.name }, { db, lock: true });
      if (again.error || again.code_id !== price.promo_code_id) throw validationError({ code: again.error || 'This code is not valid.' });
    }
    const { rows: [c] } = await db.query(
      `INSERT INTO direct_checkouts (public_token, organization_id, unit_id, check_in, check_out, num_guests, guest_name, guest_email, guest_phone, notes,
                                     pay_type, accommodation_total, cleaning_fee, total_amount, amount_due_now, hold_until, consent_at,
                                     key_enc, client_hash, test_mode, discount_code_id, discount_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now() + make_interval(mins => $16), now(), $17, $18, $19, $20, $21) RETURNING *`,
      [token, host.organization_id, u.unit_id, body.check_in, body.check_out, body.num_guests, body.name, body.email, body.phone, body.notes,
        body.pay, price.accommodation_total, price.cleaning_fee, price.total, dueNow, HOLD_MINUTES,
        host.paymongo_key_enc, clientHash, host.test_mode, price.promo_code_id, price.promo_discount]);
    return c;
  });

  const key = secretbox.decrypt(host.paymongo_key_enc);
  const label = `${u.unit_name} · ${price.nights} night${price.nights > 1 ? 's' : ''} (${body.check_in} to ${body.check_out})${body.pay === 'deposit' ? ' · 50% deposit' : ''}`;
  try {
    if (!key) throw Object.assign(new Error('Online payment is not set up correctly for this host.'), { status: 502 });
    const data = await paymongo.request(key, 'POST', '/checkout_sessions', {
      data: {
        attributes: {
          line_items: [{ currency: 'PHP', amount: Math.round(Number(dueNow) * 100), name: label, quantity: 1 }],
          payment_method_types: config.paymongoMethods,
          description: `Booking at ${host.name}`,
          reference_number: hold.checkout_ref,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          billing: { name: body.name, email: body.email, phone: body.phone },
          success_url: `${config.appUrl}/#/book/${host.booking_slug}/done/${token}`,
          cancel_url: `${config.appUrl}/#/book/${host.booking_slug}/${u.unit_id}?cancelled=${token}`,
          metadata: { checkout_ref: hold.checkout_ref },
        },
      },
    });
    const id = data?.data?.id;
    const url = data?.data?.attributes?.checkout_url;
    if (!id || !url) throw Object.assign(new Error('The payment service returned an unexpected response.'), { status: 502 });
    await query('UPDATE direct_checkouts SET provider_checkout_id = $2 WHERE checkout_ref = $1', [hold.checkout_ref, id]);
    res.json({ checkout_url: url });
  } catch (err) {
    await query(`UPDATE direct_checkouts SET status = 'failed', hold_until = now() WHERE checkout_ref = $1`, [hold.checkout_ref]);
    throw new HttpError(502, err.status === 502 ? err.message : 'Online payment is not available right now. Please contact the host.', { code: 'PAYMENT_FAILED' });
  }
}));

// The guest's return page: confirm with PayMongo, then create the reservation.
publicRouter.get('/public/book/status/:token', ah(async (req, res) => {
  const c = await one('SELECT checkout_ref FROM direct_checkouts WHERE public_token = $1', [String(req.params.token).slice(0, 60)]);
  if (!c) throw notFound('Booking not found.');
  const status = await refreshCheckout(c.checkout_ref).catch(() => null);
  const row = await one(
    `SELECT c.status, c.check_in, c.check_out, c.num_guests, c.guest_name, c.pay_type, c.total_amount, c.amount_due_now,
            u.unit_name, u.balance_due_days, p.property_name, o.name AS host_name, o.guest_language, b.confirmation_code, b.checkin_token
       FROM direct_checkouts c JOIN units u USING (unit_id) JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = c.organization_id LEFT JOIN bookings b ON b.booking_id = c.booking_id
      WHERE c.checkout_ref = $1`, [c.checkout_ref]);
  res.json({
    status: status || row.status,
    stay: {
      host: row.host_name, listing: row.unit_name, property: row.property_name, check_in: row.check_in, check_out: row.check_out,
      guests: row.num_guests, guest_name: row.guest_name, pay_type: row.pay_type, total: row.total_amount, paid: row.amount_due_now,
      balance: (Number(row.total_amount) - Number(row.amount_due_now)).toFixed(2), balance_due_days: row.balance_due_days,
      guest_language: row.guest_language, code: row.confirmation_code, checkin_link: row.checkin_token ? `${config.appUrl}/#/checkin/${row.checkin_token}` : null,
    },
  });
}));

// The guest pressed cancel on PayMongo: release the dates right away.
publicRouter.post('/public/book/cancel/:token', ah(async (req, res) => {
  const c = await one('SELECT checkout_ref FROM direct_checkouts WHERE public_token = $1', [String(req.params.token).slice(0, 60)]);
  if (!c) throw notFound('Booking not found.');
  // Never release a checkout that was actually paid.
  const st = await refreshCheckout(c.checkout_ref).catch(() => null);
  if (st === 'confirmed' || st === 'conflict') return res.json({ status: st });
  await releaseCheckout(c.checkout_ref);
  res.json({ status: 'expired' });
}));

// Photos of listings shown on a booking page.
publicRouter.get('/public/listing-photos/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const f = await one(
    `SELECT f.* FROM files f JOIN units u ON u.unit_id = f.related_record_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = p.organization_id
      WHERE f.file_id = $1 AND f.related_record_type = 'listing' AND f.organization_id = p.organization_id
        AND u.bookable_online AND u.status = 'active' AND p.status = 'active' AND (o.booking_enabled OR o.is_demo)`, [id]);
  if (!f) throw notFound();
  const path = require('path');
  const full = path.resolve(config.storageDir, f.storage_key);
  if (!full.startsWith(path.resolve(config.storageDir) + path.sep)) throw notFound();
  res.set('Content-Type', f.mime_type);
  res.set('Cache-Control', 'public, max-age=86400');
  require('fs').createReadStream(full).on('error', () => res.status(404).end()).pipe(res);
}));

// ---------------------------------------------------------------- confirming payments
async function refreshCheckout(ref) {
  const c = await one(
    `SELECT c.*, o.paymongo_key_enc AS org_key_enc FROM direct_checkouts c JOIN organizations o USING (organization_id) WHERE c.checkout_ref = $1`, [ref]);
  if (!c || !['pending', 'expired'].includes(c.status) || !c.provider_checkout_id) return c?.status || null;
  await query('UPDATE direct_checkouts SET last_checked_at = now() WHERE checkout_ref = $1', [ref]);
  // Use the key this checkout was created with (the host may have changed it since).
  const key = secretbox.decrypt(c.key_enc || c.org_key_enc);
  if (!key) throw Object.assign(new Error('The PayMongo key for this checkout cannot be read.'), { unreadable: true });
  const s = await paymongo.checkoutStatus(key, c.provider_checkout_id);
  const expected = Math.round(Number(c.amount_due_now) * 100);
  const amountOk = s.paidAmount >= expected || (s.paidAmount === 0 && s.listed === expected);
  if (s.paid && amountOk) return finalize(ref, s.method);
  if (s.expired) {
    await query(`UPDATE direct_checkouts SET status = 'expired' WHERE checkout_ref = $1 AND status = 'pending'`, [ref]);
    return 'expired';
  }
  return c.status;
}

const METHOD_MAP = { gcash: 'gcash', paymaya: 'maya', maya: 'maya', card: 'card', grab_pay: 'other', qrph: 'other' };

// Turn a paid checkout into a confirmed reservation with its payment (once).
async function finalize(ref, method) {
  const result = await tx(async (db) => {
    const { rows: [c] } = await db.query('SELECT * FROM direct_checkouts WHERE checkout_ref = $1 FOR UPDATE', [ref]);
    if (!c || c.status === 'confirmed' || c.status === 'conflict') return { status: c?.status };
    // Paid after its hold ran out while another guest holds the same nights: that guest keeps them.
    const { rows: [rival] } = await db.query(
      `SELECT 1 FROM direct_checkouts o WHERE o.unit_id = $1 AND o.checkout_ref <> $2 AND o.status = 'pending' AND o.hold_until > now()
          AND daterange(o.check_in, o.check_out) && daterange($3::date, $4::date) AND $5::timestamptz < now()`,
      [c.unit_id, c.checkout_ref, c.check_in, c.check_out, c.hold_until]);
    if (rival) {
      await db.query(`UPDATE direct_checkouts SET status = 'conflict', payment_method = $2, confirmed_at = now() WHERE checkout_ref = $1`, [ref, method]);
      return { status: 'conflict', c, ownerId: null };
    }
    const { rows: [owner] } = await db.query(
      `SELECT user_id FROM users WHERE organization_id = $1 AND role = 'owner' AND account_status = 'active' ORDER BY created_at LIMIT 1`,
      [c.organization_id]);
    const recorder = owner?.user_id || null;
    await db.query('SAVEPOINT book');
    try {
      // A returning guest (same email) keeps one guest record, so repeat stays add up.
      let { rows: [g] } = await db.query(
        `SELECT guest_id, do_not_rebook, vip FROM guests WHERE organization_id = $1 AND lower(email) = lower($2)
            AND lower(split_part(trim(full_name), ' ', 1)) = lower(split_part(trim($3), ' ', 1)) ORDER BY created_at LIMIT 1`,
        [c.organization_id, c.guest_email, c.guest_name]);
      if (g) await db.query('UPDATE guests SET phone = COALESCE(phone, $2) WHERE guest_id = $1', [g.guest_id, c.guest_phone]);
      else {
        ({ rows: [g] } = await db.query(
          `INSERT INTO guests (organization_id, full_name, email, phone, notes) VALUES ($1,$2,$3,$4,$5) RETURNING guest_id, do_not_rebook, vip`,
          [c.organization_id, c.guest_name, c.guest_email, c.guest_phone, 'Booked online']));
      }
      const { rows: [promo] } = c.discount_code_id ? await db.query('SELECT code FROM discount_codes WHERE code_id = $1', [c.discount_code_id]) : { rows: [] };
      const code = `BH-${crypto.randomBytes(5).toString('base64url').replace(/[^A-Za-z0-9]/g, 'X').slice(0, 7).toUpperCase()}`;
      const { rows: [b] } = await db.query(
        `INSERT INTO bookings (organization_id, unit_id, kind, guest_id, channel, check_in, check_out, num_guests, accommodation_total, cleaning_fee,
                               confirmation_code, notes)
         VALUES ($1,$2,'reservation',$3,'direct',$4,$5,$6,$7,$8,$9,$10) RETURNING booking_id`,
        [c.organization_id, c.unit_id, g.guest_id, c.check_in, c.check_out, c.num_guests, c.accommodation_total, c.cleaning_fee, code,
          [c.test_mode ? 'TEST MODE booking (PayMongo test key, no real payment).' : null,
            `Booked online (${c.pay_type === 'deposit' ? '50% deposit paid' : 'paid in full'}).`,
            promo ? `Discount code ${promo.code}: −₱${Number(c.discount_amount).toLocaleString('en-PH')} (already taken off the accommodation).` : null,
            g.do_not_rebook ? '⚠ This guest is marked "Do not rebook" in Guests.' : null,
            c.notes ? `Guest's message: ${c.notes}` : null].filter(Boolean).join('\n')]);
      const receipts = require('../lib/receipts');
      const receiptNo = await receipts.nextReceiptNumber(db, c.organization_id);
      await db.query(
        `INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, receipt_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [c.organization_id, b.booking_id, c.amount_due_now, manilaToday(), METHOD_MAP[method] || 'other', c.provider_checkout_id,
          c.test_mode ? 'TEST MODE payment (PayMongo test key, not real money)' : 'Paid online through PayMongo', recorder, receiptNo]);
      await db.query(`UPDATE direct_checkouts SET status = 'confirmed', booking_id = $2, payment_method = $3, confirmed_at = now() WHERE checkout_ref = $1`,
        [ref, b.booking_id, method]);
      await db.query(
        `INSERT INTO audit_logs (organization_id, action, record_type, record_id, details) VALUES ($1,'reservation.booked_online','booking',$2,$3)`,
        [c.organization_id, b.booking_id, JSON.stringify({ amount: c.amount_due_now, pay_type: c.pay_type })]);
      return { status: 'confirmed', bookingId: b.booking_id, ownerId: recorder, c, flagged: g.do_not_rebook };
    } catch (err) {
      if (err.constraint !== 'bookings_no_overlap') throw err;
      // Paid, but the dates were taken meanwhile (e.g. an Airbnb booking synced in).
      await db.query('ROLLBACK TO SAVEPOINT book');
      await db.query(`UPDATE direct_checkouts SET status = 'conflict', payment_method = $2, confirmed_at = now() WHERE checkout_ref = $1`, [ref, method]);
      return { status: 'conflict', c, ownerId: recorder };
    }
  });
  if (result.status === 'confirmed') await afterBooking(result).catch((err) => console.error('[direct] after-booking steps failed:', err.message));
  if (result.status === 'conflict') await alertConflict(result.c).catch(() => {});
  return result.status;
}

async function afterBooking({ bookingId, ownerId, c, flagged }) {
  const { notify, propertyOfBooking } = require('../lib/push');
  notify(c.organization_id, 'new_booking', {
    title: `New direct booking · ₱${Number(c.amount_due_now).toLocaleString('en-PH')} paid`,
    body: `${c.guest_name}, ${c.check_in} – ${c.check_out}`,
    url: `/#/reservations/${bookingId}`, propertyId: await propertyOfBooking(bookingId),
  }).catch(() => {});
  const receipts = require('../lib/receipts');
  const messaging = require('../lib/messaging');
  const owner = ownerId ? await one('SELECT * FROM users WHERE user_id = $1', [ownerId]) : null;
  // Same automatic steps as a manual reservation: confirmation (with check-in link) and receipt.
  await receipts.sendConfirmation(bookingId, owner);
  const pay = await one('SELECT payment_id FROM booking_payments WHERE booking_id = $1', [bookingId]);
  if (pay) await receipts.sendReceipt(pay.payment_id, owner);
  const conv = await messaging.getOrCreateConversation(bookingId);
  await query(
    `INSERT INTO messages (conversation_id, organization_id, direction, from_name, body, status) VALUES ($1,$2,'note','BalayHub',$3,'note')`,
    [conv.conversation_id, conv.organization_id,
      `New direct booking: ${c.guest_name}, ${c.check_in} to ${c.check_out}, ${c.num_guests} guest(s). Paid ₱${Number(c.amount_due_now).toLocaleString('en-PH')} online${c.pay_type === 'deposit' ? ` (50% deposit; balance ₱${(Number(c.total_amount) - Number(c.amount_due_now)).toLocaleString('en-PH')} due before check-in)` : ' (in full)'}.${flagged ? ' ⚠ This guest is marked "Do not rebook" in Guests.' : ''}`]);
  await query(`UPDATE conversations SET unread = true, status = 'open', last_message_at = now() WHERE conversation_id = $1`, [conv.conversation_id]);
}

async function alertConflict(c) {
  const { sendMail } = require('../lib/mailer');
  const { rows } = await query(`SELECT email, full_name FROM users WHERE organization_id = $1 AND role = 'owner' AND account_status = 'active'`, [c.organization_id]);
  for (const u of rows) {
    await sendMail({
      to: u.email,
      subject: `Action needed: online payment received but the dates are no longer free`,
      text: `Hi ${u.full_name},\n\n${c.guest_name} (${c.guest_email}, ${c.guest_phone}) paid ₱${Number(c.amount_due_now).toLocaleString('en-PH')} online for ${c.check_in} to ${c.check_out}, but those dates were booked elsewhere before the payment finished (for example a channel booking that synced in).\n\nPlease contact the guest to offer other dates or refund them from your PayMongo dashboard (payment reference: ${c.provider_checkout_id}).\n\n— BalayHub`,
    });
  }
}

// Expire a checkout at PayMongo (so it can't be paid later) and free its dates.
async function releaseCheckout(ref) {
  const c = await one(`SELECT c.*, o.paymongo_key_enc AS org_key_enc FROM direct_checkouts c JOIN organizations o USING (organization_id) WHERE c.checkout_ref = $1`, [ref]);
  if (!c || c.status !== 'pending') return;
  const key = secretbox.decrypt(c.key_enc || c.org_key_enc);
  if (key && c.provider_checkout_id) {
    await paymongo.request(key, 'POST', `/checkout_sessions/${encodeURIComponent(c.provider_checkout_id)}/expire`).catch(() => {});
  }
  // Marked expired only once PayMongo says so (the check does that); if it got
  // paid meanwhile, the check confirms it. On an error it stays pending and the
  // next reconcile tries again. The hold on the dates ends either way.
  const st = await refreshCheckout(ref).catch(() => 'pending');
  if (st === 'pending') await query(`UPDATE direct_checkouts SET hold_until = LEAST(hold_until, now()) WHERE checkout_ref = $1 AND status = 'pending'`, [ref]);
  return st;
}

// Scheduler: confirm paid checkouts whose guest never came back, and close
// checkouts whose 30-minute hold has run out so they can't be paid later.
async function reconcileDirect() {
  const { rows } = await query(
    `SELECT checkout_ref, hold_until < now() AS lapsed, created_at < now() - interval '2 days' AS old FROM direct_checkouts
      WHERE status = 'pending' AND provider_checkout_id IS NOT NULL
      ORDER BY last_checked_at NULLS FIRST, created_at DESC LIMIT 40`);
  let confirmed = 0;
  for (const r of rows) {
    try {
      const st = await refreshCheckout(r.checkout_ref);
      if (st === 'confirmed') { confirmed += 1; continue; }
      if (st === 'pending' && r.lapsed && await releaseCheckout(r.checkout_ref) === 'pending' && r.old) {
        throw new Error('PayMongo has not closed this checkout.');
      }
    } catch (err) {
      // The payment can't be checked (e.g. the key can't be read). Never assume it wasn't
      // paid: after 2 days, stop trying and ask the host to check PayMongo.
      if (r.old) await giveUp(r.checkout_ref, err.message);
    }
  }
  return confirmed;
}

async function giveUp(ref, reason) {
  const { rows: [c] } = await query(`UPDATE direct_checkouts SET status = 'failed' WHERE checkout_ref = $1 AND status = 'pending' RETURNING *`, [ref]);
  if (!c) return;
  const { sendMail } = require('../lib/mailer');
  const { rows } = await query(`SELECT email, full_name FROM users WHERE organization_id = $1 AND role = 'owner'`, [c.organization_id]);
  for (const u of rows) {
    await sendMail({
      to: u.email,
      subject: 'Please check a direct booking payment in PayMongo',
      text: `Hi ${u.full_name},\n\nBalayHub could not confirm whether ${c.guest_name} (${c.guest_email}, ${c.guest_phone}) paid for ${c.check_in} to ${c.check_out} (₱${Number(c.amount_due_now).toLocaleString('en-PH')}). Reason: ${reason}\n\nPlease look for payment reference ${c.provider_checkout_id} in your PayMongo dashboard. If it was paid, add the reservation in BalayHub by hand.\n\n— BalayHub`,
    }).catch(() => {});
  }
}

module.exports = { router, publicRouter, reconcileDirect, refreshCheckout, releaseCheckout, finalize, slugify };
