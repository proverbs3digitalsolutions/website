'use strict';

// Quotes: the host prices an inquiry (dates, guests, amounts, add-ons, discount) and sends a private
// link. The guest accepts the house rules and pays through the same PayMongo checkout as a direct
// booking. The dates are not held until the guest pays.

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole, rateLimit } = require('../lib/auth');
const { loadUnit, propertyScope } = require('../lib/access');
const { addDays } = require('../lib/holidays');
const { sendMail } = require('../lib/mailer');
const { quote } = require('../lib/pricing');
const direct = require('./directbooking');

const { cents, money, validationError, manilaToday, nightsBetween, priceStay, isFree, withHostState, parseSelections,
  priceAddonSelections, startCheckout, refreshCheckout, releaseCheckout } = direct;

const router = express.Router();
const publicRouter = express.Router();
const managers = requireRole('owner', 'manager');

const STATUSES = ['open', 'paid', 'expired', 'cancelled'];
const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, key: (req) => `quote|${req.ip}` });
const payLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: (req) => `quotepay|${req.ip}` });
publicRouter.use('/public/quote', publicLimiter);

const quoteUrl = (token) => `${config.appUrl}/#/quote/${token}`;
const peso = (v) => `₱${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayText = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
const notOpen = (what) => new HttpError(409, `Only an open quote can be ${what}.`, { code: 'QUOTE_NOT_OPEN' });
const expiredError = (q) => new HttpError(410, 'This offer has expired.', { code: 'QUOTE_EXPIRED', host: { name: q.host_name } });

// Open quotes past their expiry become expired. Runs on host reads and in the follow-up job.
async function expireDueQuotes(where = 'TRUE', params = []) {
  await query(`UPDATE booking_quotes SET status = 'expired' WHERE status = 'open' AND expires_at <= now() AND ${where}`, params);
}

// A quote with its listing, property, host and the booking it became (if paid).
const QUOTE_SQL = `
  SELECT q.*, u.unit_name, u.house_rules, u.deposit_pct, u.balance_due_days, p.property_name, p.city,
         o.name AS host_name, o.guest_language, o.is_demo, o.paymongo_key_enc, o.paymongo_key_hint,
         o.plan, o.trial_ends_at, o.paid_until, o.deletion_scheduled_at, b.confirmation_code AS booking_code
    FROM booking_quotes q
    JOIN units u ON u.unit_id = q.unit_id
    JOIN properties p ON p.property_id = u.property_id
    JOIN organizations o ON o.organization_id = q.organization_id
    LEFT JOIN bookings b ON b.booking_id = q.booking_id`;

// What the guest pays now: the whole quote, or the deposit on the stay plus the add-ons (paid up front).
function amountDueNow(q) {
  if (q.pay_type === 'full') return q.total_amount;
  const stay = cents(q.accommodation_total) - cents(q.discount_amount) + cents(q.cleaning_fee);
  return money(Math.round((stay * q.deposit_pct) / 100) + cents(q.addons_total));
}

const addonLines = (q) => (q.addons || []).map(({ name, quantity, amount }) => ({ name, quantity, amount }));

// The host's view of a quote. Owners and managers see the guest's contact details.
function hostJson(q) {
  return {
    quote_id: q.quote_id, url: quoteUrl(q.public_token), unit_id: q.unit_id, unit_name: q.unit_name, property_name: q.property_name,
    check_in: q.check_in, check_out: q.check_out, num_guests: q.num_guests,
    guest_name: q.guest_name, guest_email: q.guest_email, guest_phone: q.guest_phone,
    accommodation_total: q.accommodation_total, cleaning_fee: q.cleaning_fee, addons: addonLines(q), addons_total: q.addons_total,
    discount_amount: q.discount_amount, total_amount: q.total_amount, amount_due_now: amountDueNow(q),
    pay_type: q.pay_type, note: q.note, expires_at: q.expires_at, status: q.status, booking_id: q.booking_id,
  };
}

// The Taglish names of a quote's add-ons, read now from the add-on list. The quote keeps only the English
// name it was priced with, so this reads name_tl the same way the pay page does.
async function addonNamesTl(q) {
  const ids = (q.addons || []).map((a) => a.addon_id);
  if (!ids.length) return new Map();
  const { rows } = await query('SELECT addon_id, name_tl FROM listing_addons WHERE organization_id = $1 AND addon_id = ANY($2::uuid[])',
    [q.organization_id, ids]);
  return new Map(rows.map((r) => [r.addon_id, r.name_tl]));
}

// The guest's view of their own quote. Never other guests' data, and never a key.
function guestJson(q, namesTl) {
  return {
    status: q.status, check_in: q.check_in, check_out: q.check_out, num_guests: q.num_guests,
    guest_name: q.guest_name, guest_email: q.guest_email, guest_phone: q.guest_phone,
    accommodation_total: q.accommodation_total, cleaning_fee: q.cleaning_fee,
    addons: (q.addons || []).map(({ addon_id, name, quantity, amount }) => ({ name, name_tl: namesTl.get(addon_id) ?? null, quantity, amount })),
    addons_total: q.addons_total,
    discount_amount: q.discount_amount, total_amount: q.total_amount, amount_due_now: amountDueNow(q),
    pay_type: q.pay_type, note: q.note, expires_at: q.expires_at, booking_code: q.booking_code,
    host: { name: q.host_name, guest_language: q.guest_language },
    listing: { unit_name: q.unit_name, property_name: q.property_name, city: q.city, house_rules: q.house_rules },
  };
}

// A quote by its private token. An open quote past its expiry is expired first.
async function quoteByToken(token) {
  const t = String(token).slice(0, 60);
  await query(`UPDATE booking_quotes SET status = 'expired' WHERE public_token = $1 AND status = 'open' AND expires_at <= now()`, [t]);
  const q = await one(`${QUOTE_SQL} WHERE q.public_token = $1`, [t]);
  if (!q) throw notFound('This quote is not available.');
  return q;
}

// A quote a signed-in owner or manager may see (its property must be in their scope).
async function loadQuote(user, id) {
  await expireDueQuotes('quote_id = $1', [id]);
  const params = [id];
  const q = await one(`${QUOTE_SQL} WHERE q.quote_id = $1 AND ${propertyScope(user, params, 'p')}`, params);
  if (!q) throw notFound();
  return q;
}

// The offer email, in the workspace's guest language. Plain text.
function offerEmail(q) {
  const link = quoteUrl(q.public_token);
  const first = String(q.guest_name).trim().split(/\s+/)[0];
  const dates = `${dayText(q.check_in)} to ${dayText(q.check_out)}`;
  const expires = new Date(q.expires_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  const note = q.note ? `\n\nNote from ${q.host_name}:\n${q.note}` : '';
  if (q.guest_language === 'tl') {
    return {
      subject: `Quote mo mula kay ${q.host_name}`,
      text: `Hi ${first},\n\nIto ang quote mula kay ${q.host_name} para sa ${q.unit_name}, ${dates}, ${q.num_guests} guest.\n\nKabuuan: ${peso(q.total_amount)}\nBabayaran ngayon: ${peso(amountDueNow(q))}\n\nBuksan ang link para makita ang detalye at makapagbayad online. Hawak lang ang dates kapag nabayaran na.\n${link}\n\nValid hanggang ${expires}.${note}\n\n— BalayHub`,
    };
  }
  return {
    subject: `Your quote from ${q.host_name}`,
    text: `Hi ${first},\n\n${q.host_name} prepared this quote for ${q.unit_name}, ${dates}, for ${q.num_guests} guest${q.num_guests > 1 ? 's' : ''}.\n\nTotal: ${peso(q.total_amount)}\nDue now: ${peso(amountDueNow(q))}\n\nOpen the link to see the details and pay online. Your dates are held only once you pay.\n${link}\n\nThis quote is valid until ${expires}.${note}\n\n— BalayHub`,
  };
}

// ---------------------------------------------------------------- host (owners and managers)

// The price the pricing engine gives for a listing and dates, to start a quote from. missing_rates is true when a
// night has no nightly rate (the same flag /reservations/quote gives), so the screen never fills in a PHP 0 price.
router.get('/units/:id/price-preview', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const { check_in, check_out } = validate(req.query, {
    check_in: { type: 'date', required: true, label: 'Check-in' },
    check_out: { type: 'date', required: true, label: 'Check-out' },
  });
  const price = await priceStay(unit, check_in, check_out);
  const { missing_rates } = await quote(unit.unit_id, check_in, check_out);
  res.json({ ...price, missing_rates, available: await isFree(unit.unit_id, check_in, check_out) });
}));

router.get('/quotes', managers, ah(async (req, res) => {
  const { status } = validate(req.query, { status: { type: 'enum', values: STATUSES, label: 'Status' } });
  await expireDueQuotes('organization_id = $1', [req.user.organization_id]);
  const params = [];
  const where = [propertyScope(req.user, params, 'p')];
  if (status) { params.push(status); where.push(`q.status = $${params.length}`); }
  const { rows } = await query(`${QUOTE_SQL} WHERE ${where.join(' AND ')} ORDER BY q.created_at DESC LIMIT 200`, params);
  res.json({ quotes: rows.map(hostJson) });
}));

router.get('/quotes/:id', managers, ah(async (req, res) => {
  res.json({ quote: hostJson(await loadQuote(req.user, uuidParam(req.params.id))) });
}));

// Makes a quote. Checks that the dates are free now, but holds nothing until the guest pays.
router.post('/quotes', managers, ah(async (req, res) => {
  const hrs = req.body?.expires_in_hours;
  if (hrs !== undefined && hrs !== null && hrs !== '' && !(Number.isInteger(Number(hrs)) && Number(hrs) >= 1 && Number(hrs) <= 336)) {
    throw validationError({ expires_in_hours: 'Hours must be between 1 and 336 (14 days).' });
  }
  const body = validate(req.body, {
    unit_id: { type: 'uuid', required: true, label: 'Listing' },
    check_in: { type: 'date', required: true, label: 'Check-in' },
    check_out: { type: 'date', required: true, label: 'Check-out' },
    num_guests: { type: 'int', required: true, min: 1, max: 50, label: 'Guests' },
    guest_name: { type: 'string', required: true, max: 120, label: 'Guest name' },
    guest_email: { type: 'email', label: 'Guest email' },
    guest_phone: { type: 'phone', label: 'Guest mobile' },
    accommodation_total: { type: 'money', required: true, positive: true, label: 'Accommodation' },
    cleaning_fee: { type: 'money', label: 'Cleaning fee' },
    discount_amount: { type: 'money', label: 'Discount' },
    pay_type: { type: 'enum', values: ['full', 'deposit'], required: true, label: 'Payment' },
    expires_in_hours: { type: 'int', min: 1, max: 336, label: 'Hours' },
    note: { type: 'text', max: 1000, label: 'Note' },
  });
  if (body.check_out <= body.check_in) throw validationError({ check_out: 'Choose a check-out date after check-in.' });
  if (body.check_in < manilaToday()) throw validationError({ check_in: 'Choose a date from today onwards.' });
  if (cents(body.discount_amount) > cents(body.accommodation_total)) {
    throw validationError({ discount_amount: "The discount can't be more than the accommodation." });
  }
  if (body.pay_type === 'deposit' && cents(body.accommodation_total) - cents(body.discount_amount) <= 0) {
    throw validationError({ discount_amount: 'A deposit needs some accommodation left after the discount.' });
  }
  const unit = await loadUnit(req.user, body.unit_id);
  if (body.pay_type === 'deposit' && unit.payment_option === 'full') throw validationError({ pay_type: 'This listing takes full payment only.' });
  if (body.pay_type === 'full' && unit.payment_option === 'deposit') throw validationError({ pay_type: 'This listing takes a deposit only.' });

  const nights = nightsBetween(body.check_in, body.check_out);
  const addons = await priceAddonSelections({ orgId: req.user.organization_id, unitId: unit.unit_id, nights, guests: body.num_guests,
    selections: parseSelections(req.body?.addons), context: 'quote' });
  const total = cents(body.accommodation_total) + cents(body.cleaning_fee) + cents(addons.total) - cents(body.discount_amount);
  if (total <= 0) throw validationError({ discount_amount: 'The total must be more than zero. Check the discount.' });
  // Same formula the guest's checkout charges (amountDueNow), so the check matches what would be paid.
  const dueNow = amountDueNow({ pay_type: body.pay_type, total_amount: money(total), accommodation_total: body.accommodation_total,
    discount_amount: body.discount_amount, cleaning_fee: body.cleaning_fee, addons_total: addons.total, deposit_pct: unit.deposit_pct });
  if (Number(dueNow) < 100) throw validationError({ accommodation_total: 'The amount is too small to pay online. Please contact the host.' });
  if (!await isFree(unit.unit_id, body.check_in, body.check_out)) {
    throw new HttpError(409, 'Those dates are already booked. Choose other dates.', { code: 'DATES_TAKEN' });
  }

  const { rows: [q] } = await query(
    `INSERT INTO booking_quotes (organization_id, unit_id, public_token, check_in, check_out, num_guests, guest_name, guest_email, guest_phone,
                                 accommodation_total, cleaning_fee, addons, addons_total, discount_amount, total_amount, pay_type, note, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now() + make_interval(hours => $18), $19) RETURNING quote_id`,
    [req.user.organization_id, unit.unit_id, crypto.randomBytes(24).toString('base64url'), body.check_in, body.check_out, body.num_guests,
      body.guest_name, body.guest_email, body.guest_phone, money(cents(body.accommodation_total)), money(cents(body.cleaning_fee)),
      JSON.stringify(addons.items), addons.total, money(cents(body.discount_amount)), money(total), body.pay_type, body.note,
      body.expires_in_hours ?? 48, req.user.user_id]);
  await audit(null, req.user, 'quote.created', 'quote', q.quote_id, { unit_id: unit.unit_id, total_amount: money(total), pay_type: body.pay_type });
  res.status(201).json({ quote: hostJson(await loadQuote(req.user, q.quote_id)) });
}));

// Ends an open quote: its link stops working, and a payment page still open for it is ended too.
router.post('/quotes/:id/cancel', managers, ah(async (req, res) => {
  const q = await loadQuote(req.user, uuidParam(req.params.id));
  if (q.status !== 'open') throw notOpen('cancelled');
  const r = await query(`UPDATE booking_quotes SET status = 'cancelled', cancelled_at = now() WHERE quote_id = $1 AND status = 'open'`, [q.quote_id]);
  if (!r.rowCount) throw notOpen('cancelled');
  const pending = await query(`SELECT checkout_ref FROM direct_checkouts WHERE quote_id = $1 AND status = 'pending'`, [q.quote_id]);
  for (const p of pending.rows) await releaseCheckout(p.checkout_ref);
  await audit(null, req.user, 'quote.cancelled', 'quote', q.quote_id);
  res.json({ ok: true, quote: hostJson(await loadQuote(req.user, q.quote_id)) });
}));

// Emails the link to the guest. Needs an email address on the quote, and a host who can take online
// payments, since the guest pays through the host's PayMongo. Limits: 3 emails per quote and 30 per
// workspace per Manila day. Only delivered emails count. The workspace row lock makes the daily count
// safe against two sends at once.
const QUOTE_SENDS_PER_QUOTE = 3;
const QUOTE_SENDS_PER_DAY = 30;
const sendLimited = (message) => new HttpError(429, message, { code: 'RATE_LIMITED' });

router.post('/quotes/:id/send', managers, ah(async (req, res) => {
  const q = await loadQuote(req.user, uuidParam(req.params.id));
  if (q.status !== 'open') throw notOpen('sent');
  if (!q.guest_email) throw new HttpError(409, 'Add the guest email to send this quote, or copy the link and send it yourself.', { code: 'NO_EMAIL' });
  if (q.is_demo) throw new HttpError(403, "This is a demo, so it can't send quotes.", { code: 'DEMO_READ_ONLY' });
  withHostState(q);
  if (!q.accepting) throw new HttpError(409, "This quote can't be paid right now, so the link can't be sent. Connect PayMongo in Settings first.", { code: 'NOT_ACCEPTING' });
  const msg = offerEmail(q);
  await tx(async (db) => {
    await db.query('SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE', [q.organization_id]);
    const { rows: [day] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM audit_logs
        WHERE organization_id = $1 AND action = 'quote.sent'
          AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')`, [q.organization_id]);
    if (day.n >= QUOTE_SENDS_PER_DAY) {
      throw sendLimited(`This workspace has emailed ${QUOTE_SENDS_PER_DAY} quotes today. Try again tomorrow, or copy the link and send it yourself.`);
    }
    const { rowCount } = await db.query(
      'UPDATE booking_quotes SET sent_count = sent_count + 1, last_sent_at = now() WHERE quote_id = $1 AND sent_count < $2',
      [q.quote_id, QUOTE_SENDS_PER_QUOTE]);
    if (!rowCount) throw sendLimited(`This quote has already been emailed ${QUOTE_SENDS_PER_QUOTE} times. Copy the link and send it yourself.`);
    // ponytail: the workspace lock is held while the email sends. Fine at 30 a day; reserve the send first and email after if volume grows.
    const r = await sendMail({ to: q.guest_email, subject: msg.subject, text: msg.text });
    if (!r.delivered) throw new HttpError(502, 'The email could not be sent. Copy the link and send it another way.', { code: 'EMAIL_FAILED' });
    await audit(db, req.user, 'quote.sent', 'quote', q.quote_id);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- guest (private link)

// The guest's offer. If a payment for it is still on its way, check that first, so a guest who just
// paid comes back to a confirmed booking.
publicRouter.get('/public/quote/:token', ah(async (req, res) => {
  let q = await quoteByToken(req.params.token);
  const pending = await one(
    `SELECT checkout_ref FROM direct_checkouts WHERE quote_id = $1 AND status = 'pending' AND provider_checkout_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`, [q.quote_id]);
  if (pending) {
    await refreshCheckout(pending.checkout_ref).catch(() => null);
    q = await quoteByToken(req.params.token);
  }
  if (q.status === 'expired') throw expiredError(q);
  res.json(guestJson(q, await addonNamesTl(q)));
}));

// The guest accepts and pays. Same hold and PayMongo checkout as a direct booking; confirmation marks
// the quote paid (see finalize in directbooking.js). A new attempt replaces an older unpaid one.
publicRouter.post('/public/quote/:token/checkout', payLimiter, ah(async (req, res) => {
  const q = await quoteByToken(req.params.token);
  if (q.status === 'expired') throw expiredError(q);
  if (q.status === 'paid') throw new HttpError(409, 'This quote is already paid.', { code: 'QUOTE_PAID' });
  if (q.status === 'cancelled') throw new HttpError(409, 'The host cancelled this quote. Please contact them if you have questions.', { code: 'QUOTE_CANCELLED' });
  if (q.is_demo) throw new HttpError(403, "This is a demo, so it can't take real bookings.", { code: 'DEMO_READ_ONLY' });
  withHostState(q);
  if (!q.accepting) throw new HttpError(409, 'This host is not taking online payments right now. Please contact them directly.', { code: 'NOT_ACCEPTING' });
  if (q.check_in < manilaToday()) throw new HttpError(409, 'The check-in date has passed. Please ask the host for a new quote.', { code: 'DATES_PASSED' });
  // Same privacy notice as the direct booking checkout. startCheckout stamps consent_at when the checkout is created.
  // Consent and house rules are checked with the other fields, so one 400 names every missing field.
  const rules = q.house_rules && q.house_rules.trim() ? q.house_rules : null;
  const agreed = validate(req.body, {
    accept_rules: { type: 'bool', label: 'House rules' },
    consent: { type: 'bool', label: 'Consent' },
  });
  const fields = {};
  if (!agreed.consent) fields.consent = 'Please agree to continue.';
  if (rules && !agreed.accept_rules) fields.accept_rules = 'Please read and agree to the house rules.';
  let body;
  try {
    body = validate(req.body, {
      name: { type: 'string', max: 120, required: !q.guest_name, label: 'Full name' },
      email: { type: 'email', required: !q.guest_email, label: 'Email' },
      phone: { type: 'phone', required: !q.guest_phone, label: 'Mobile number' },
    });
  } catch (err) {
    if (!err.extra?.fields) throw err;
    Object.assign(fields, err.extra.fields);
  }
  if (Object.keys(fields).length) throw validationError(fields);
  if (q.pay_type === 'deposit' && addDays(q.check_in, -q.balance_due_days) <= manilaToday()) {
    throw new HttpError(409, 'Your stay is too soon for a deposit. Please ask the host for a new quote.', { code: 'DEPOSIT_NOT_ALLOWED' });
  }

  // One payment page per quote: an older unpaid attempt is ended first. If it was paid meanwhile, the quote is already paid.
  const older = await query(`SELECT checkout_ref FROM direct_checkouts WHERE quote_id = $1 AND status = 'pending'`, [q.quote_id]);
  for (const o of older.rows) await releaseCheckout(o.checkout_ref);
  if ((await one('SELECT status FROM booking_quotes WHERE quote_id = $1', [q.quote_id])).status === 'paid') {
    throw new HttpError(409, 'This quote is already paid.', { code: 'QUOTE_PAID' });
  }

  const nights = nightsBetween(q.check_in, q.check_out);
  const stay = cents(q.accommodation_total) - cents(q.discount_amount) + cents(q.cleaning_fee);
  const url = await startCheckout({
    host: { organization_id: q.organization_id, name: q.host_name, paymongo_key_enc: q.paymongo_key_enc, test_mode: q.test_mode },
    token: crypto.randomBytes(18).toString('base64url'),
    ip: req.ip,
    label: `${q.unit_name} · ${nights} night${nights > 1 ? 's' : ''} (${q.check_in} to ${q.check_out}) · quote`,
    returnUrls: { success: quoteUrl(q.public_token), cancel: quoteUrl(q.public_token) },
    row: {
      unit_id: q.unit_id, check_in: q.check_in, check_out: q.check_out, num_guests: q.num_guests,
      name: body.name || q.guest_name, email: body.email || q.guest_email, phone: body.phone || q.guest_phone, notes: null,
      pay_type: q.pay_type, accommodation_total: money(cents(q.accommodation_total) - cents(q.discount_amount)),
      cleaning_fee: q.cleaning_fee, total_amount: money(stay), amount_due_now: amountDueNow(q),
      discount_code_id: null, discount_amount: q.discount_amount, addons: q.addons, addons_total: q.addons_total,
      rules_accepted_at: rules ? new Date() : null, rules_text: rules, source: 'quote', quote_id: q.quote_id,
    },
  });
  res.json({ checkout_url: url });
}));

module.exports = { router, publicRouter, expireDueQuotes };
