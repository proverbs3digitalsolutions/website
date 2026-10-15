'use strict';

// Pay the balance online: a private link per reservation where the guest pays
// what's still owed through the host's own PayMongo account. A payment is
// recorded only after BalayHub confirms it with PayMongo.

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { query, one, tx, pool } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { uuidParam } = require('../lib/validate');
const { requireRole, rateLimit } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { planStatus } = require('../lib/plans');
const secretbox = require('../lib/secretbox');
const paymongo = require('../lib/paymongo');
const { BALANCE } = require('../lib/balance');
const { fmtPeso } = require('../lib/messaging');
const { priceAddons, createAddonCharges, listAddonsForUnit } = require('../lib/addons');

const router = express.Router();
const publicRouter = express.Router();
const managers = requireRole('owner', 'manager');

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const METHOD_MAP = { gcash: 'gcash', paymaya: 'maya', maya: 'maya', card: 'card', grab_pay: 'other', qrph: 'other' };
const payLink = (token) => `${config.appUrl}/#/pay/${token}`;

const REUSE_MS = 30 * 60 * 1000;

async function ensurePayToken(bookingId) {
  const r = await one(`UPDATE bookings SET pay_token = COALESCE(pay_token, $2) WHERE booking_id = $1 RETURNING pay_token`,
    [bookingId, crypto.randomBytes(18).toString('base64url')]);
  return r?.pay_token || null;
}

// ---------------------------------------------------------------- host side
router.get('/reservations/:id/payment-link', managers, ah(async (req, res) => {
  const params = [uuidParam(req.params.id)];
  const b = await one(
    `SELECT b.booking_id, b.status, b.kind, ${BALANCE} AS balance, o.paymongo_key_hint, o.manual_payments_enabled
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(req.user, params)}`, params);
  if (!b) throw notFound();
  // The link also works with only manual payments (GCash, Maya, bank transfer) turned on.
  if (!b.paymongo_key_hint && !b.manual_payments_enabled) {
    return res.json({ available: false, reason: 'Connect PayMongo in Settings → Direct booking page, or turn on manual payments in Settings, to send payment links.' });
  }
  if (b.status !== 'confirmed' || Number(b.balance) <= 0) return res.json({ available: false, reason: 'Nothing left to pay on this reservation.' });
  res.json({ available: true, link: payLink(await ensurePayToken(b.booking_id)), balance: b.balance });
}));

// ---------------------------------------------------------------- guest side
// Per IP for loading pages and starting checkouts; the return page's status
// polling has its own per-link limit so a returning guest isn't locked out.
const payLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `pay|${req.ip}` });
publicRouter.use('/public/pay', (req, res, next) => (req.method === 'POST' && req.path.endsWith('/refresh') ? next() : payLimiter(req, res, next)));
const refreshLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, key: (req) => `payrefresh|${req.params.token}` });

// Whether this booking can be paid online right now (also gates the {{payment_link}} message variable).
function acceptsOnline(b) {
  return Boolean(b.paymongo_key_hint) && !planStatus(b).read_only && !b.is_demo && b.status === 'confirmed' && String(b.check_out) >= manilaToday();
}

// Why a manual payment (a GCash, Maya or bank transfer proof) can't be sent for this
// booking right now, or null if it can. Shared by the pay page and the proof upload.
function manualRefusal(b) {
  if (b.is_demo) return new HttpError(403, 'This is a demo.', { code: 'DEMO_READ_ONLY' });
  if (!b.manual_payments_enabled || planStatus(b).read_only) {
    return new HttpError(409, 'Payment by transfer is not available for this booking. Please contact your host.', { code: 'NOT_ACCEPTING' });
  }
  if (b.status !== 'confirmed') return new HttpError(409, 'This booking was cancelled, so no payment can be sent for it.', { code: 'CANCELLED' });
  if (Number(b.balance) <= 0) return new HttpError(409, 'This booking is already fully paid. Thank you!', { code: 'PAID' });
  if (String(b.check_out) < manilaToday()) {
    return new HttpError(409, 'This payment link has expired because the stay has ended. Please ask your host for a new one.', { code: 'EXPIRED' });
  }
  return null;
}

async function loadByToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw notFound('This payment link is not valid. Please ask your host for a new one.');
  const b = await one(
    `SELECT b.booking_id, b.organization_id, b.unit_id, b.check_in, b.check_out, b.status, b.total_amount, b.confirmation_code, ${BALANCE} AS balance,
            b.accommodation_total, b.cleaning_fee, b.other_fees, b.extras_total, (b.check_out - b.check_in)::int AS nights,
            u.unit_name, p.property_name, o.name AS host_name, o.paymongo_key_enc, o.paymongo_key_hint, o.plan, o.trial_ends_at, o.paid_until,
            o.is_demo, o.deletion_scheduled_at, o.guest_language, o.manual_payments_enabled, o.manual_payment_instructions,
            COALESCE(g.full_name, b.guest_label) AS guest_name
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.pay_token = $1 AND b.kind = 'reservation'`, [token]);
  if (!b) throw notFound('This payment link is not valid. Please ask your host for a new one.');
  b.accepting = acceptsOnline(b) && Boolean(b.paymongo_key_enc);
  b.test_mode = Boolean(b.paymongo_key_hint && b.paymongo_key_hint.startsWith('sk_test_'));
  return b;
}

// The itemised bill the guest sees: the stay, fees, extra charges, payments so far.
// Sums are done in SQL so the centavos are exact.
async function billFor(b) {
  const [charges, payments, refunds, paid] = await Promise.all([
    // name_tl: the add-on's Taglish name through addon_id (null for other charges, or no Taglish name set).
    query(`SELECT c.description, c.quantity, c.unit_price, c.amount, a.name_tl FROM booking_charges c
             LEFT JOIN listing_addons a ON a.addon_id = c.addon_id
            WHERE c.booking_id = $1 AND c.voided_at IS NULL ORDER BY c.created_at`, [b.booking_id]),
    query(`SELECT amount, payment_date, payment_method FROM booking_payments
            WHERE booking_id = $1 AND voided_at IS NULL ORDER BY payment_date, created_at`, [b.booking_id]),
    // Only the amount and date: the reason and who recorded it stay with the host.
    query(`SELECT amount, refund_date FROM booking_refunds
            WHERE booking_id = $1 AND voided_at IS NULL ORDER BY refund_date, created_at`, [b.booking_id]),
    one(`SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS paid,
                (SELECT COALESCE(SUM(amount), 0) FROM booking_refunds WHERE booking_id = $1 AND voided_at IS NULL)::numeric(12,2) AS refunded
           FROM booking_payments WHERE booking_id = $1 AND voided_at IS NULL`, [b.booking_id]),
  ]);
  return {
    nights: b.nights, accommodation_total: b.accommodation_total, cleaning_fee: b.cleaning_fee, other_fees: b.other_fees,
    owed: b.status === 'confirmed', // a cancelled stay keeps its lines but owes nothing
    charges: charges.rows, extras_total: b.extras_total, total: b.total_amount,
    payments: payments.rows, paid: paid.paid, refunds: refunds.rows, refunded: paid.refunded,
    // Anything else already settled for this stay (e.g. through a booking platform), as one neutral line
    // so the bill adds up without showing the platform's commission.
    adjustments: Math.max(0, Number(b.total_amount) - Number(paid.paid) + Number(paid.refunded) - Number(b.balance)).toFixed(2),
  };
}

// The proofs this guest sent that the host has not checked yet (D-80 #6): shown again after a reload,
// and counted against the balance so they can't add up to more than is owed (#7). Only this booking's.
async function pendingProofs(bookingId) {
  const { rows } = await query(
    `SELECT pp.proof_id, pp.amount, pp.method, pp.submitted_at AS sent_at,
            EXISTS (SELECT 1 FROM files f WHERE f.related_record_type = 'payment_proof' AND f.related_record_id = pp.proof_id) AS has_file
       FROM payment_proofs pp WHERE pp.booking_id = $1 AND pp.status = 'pending' ORDER BY pp.submitted_at`, [bookingId]);
  const total = await one(`SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total FROM payment_proofs WHERE booking_id = $1 AND status = 'pending'`, [bookingId]);
  return { pending: rows, pending_total: total.total };
}

publicRouter.get('/public/pay/:token', ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  const cancelled = b.status !== 'confirmed';
  const due = !cancelled && Number(b.balance) > 0 ? b.balance : '0.00';
  res.json({
    host: b.host_name, listing: b.unit_name, property: b.property_name, check_in: b.check_in, check_out: b.check_out,
    code: b.confirmation_code, guest_first_name: String(b.guest_name || '').split(' ')[0] || null,
    total: b.total_amount, paid: (Number(b.total_amount) - Number(b.balance)).toFixed(2), balance: due, balance_due: due,
    accepting: b.accepting, test_mode: b.test_mode, cancelled, guest_language: b.guest_language,
    bill: await billFor(b),
    // Only when the host turned manual payments on: their instructions, and whether a proof can be sent now.
    manual_payments: b.manual_payments_enabled ? { instructions: b.manual_payment_instructions, accepting: !manualRefusal(b), ...await pendingProofs(b.booking_id) } : null,
  });
}));

// ---------------------------------------------------------------- pre-arrival add-ons (D-59)
// Add-ons the guest can still buy: a confirmed stay up to and including check-in
// day, in a workspace that can take changes. The reason is returned otherwise.
function addonRefusal(b) {
  if (b.is_demo) return new HttpError(403, 'This is a demo.', { code: 'DEMO_READ_ONLY' });
  if (planStatus(b).read_only) return new HttpError(409, "Add-ons can't be booked for this stay right now. Please contact your host.", { code: 'NOT_ACCEPTING' });
  if (b.status !== 'confirmed') return new HttpError(409, 'This booking was cancelled, so add-ons cannot be booked on it.', { code: 'CANCELLED' });
  if (manilaToday() > String(b.check_in)) return new HttpError(409, 'Add-ons can only be booked up to check-in day.', { code: 'AFTER_CHECK_IN' });
  return null;
}

const addonsLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, key: (req) => `payaddons|${req.params.token}` });

// A purchase's idempotency key: the Idempotency-Key header, or request_key in the body. Optional; validated like refunds.js.
function requestKeyOf(req) {
  const key = req.get('Idempotency-Key') || req.body?.request_key;
  if (key === undefined || key === null || key === '') return null;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(400, 'Invalid Idempotency-Key header.', { code: 'BAD_REQUEST' });
  return key;
}

publicRouter.get('/public/pay/:token/addons', ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  const open = !addonRefusal(b);
  res.json({ addons: open ? await listAddonsForUnit(pool, b.organization_id, b.unit_id, 'before_arrival', b.booking_id) : [] });
}));

// A retry with the same key (a double tap, a dropped connection) gets the bill the first try made,
// and no new charges. Without a key each request buys again.
publicRouter.post('/public/pay/:token/addons', addonsLimiter, ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  const refused = addonRefusal(b);
  if (refused) throw refused;
  const selections = req.body?.selections;
  if (!Array.isArray(selections) || !selections.length) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { addons: 'Choose at least one add-on.' } });
  }
  const key = requestKeyOf(req);
  let bought = false;
  try {
    bought = await tx(async (db) => {
      // Read the stay under its row lock: a cancellation, or check-in day passing, meanwhile must still refuse.
      // The lock also makes a second tap with the same key wait, then see the first tap's charges below.
      const { rows: [now] } = await db.query(
        `SELECT status, check_in, organization_id, unit_id, num_guests, (check_out - check_in)::int AS nights
           FROM bookings WHERE booking_id = $1 FOR UPDATE`, [b.booking_id]);
      const late = addonRefusal({ ...b, ...now });
      if (late) throw late;
      // Includes charges the host has since voided: a retry must not put back what was bought once.
      if (key && (await db.query('SELECT 1 FROM booking_charges WHERE booking_id = $1 AND starts_with(request_key, $2)',
        [b.booking_id, `${key}:`])).rowCount) return false;
      const { items } = await priceAddons(db, {
        orgId: now.organization_id, unitId: now.unit_id, nights: now.nights, guests: now.num_guests, selections, context: 'before_arrival', bookingId: b.booking_id,
      });
      await createAddonCharges(db, b.booking_id, items, null, key);
      return true;
    });
  } catch (err) {
    // Two taps with one key got past each other and the second insert hit the unique key: the first tap's charges stand.
    if (err.constraint !== 'booking_charges_request_key_uq') throw err;
  }
  if (bought) await closeOpenCheckouts(b.booking_id); // the amount owed went up: an open pay session must not still work
  res.json({ ok: true, bill: await billFor(await loadByToken(req.params.token)) });
}));

const checkoutLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: (req) => `paycheckout|${req.params.token}` });

const isReusable = (c, amount) => Number(c.amount) === amount && c.checkout_url && Date.now() - new Date(c.created_at) < REUSE_MS;
// The guest's sentence when a payment can't start (the same as the quote and booking pages, D-85). The real reason goes to the server log.
const PAYMENT_UNAVAILABLE = "Online payment isn't available right now. Please try again in a few minutes, or contact the host.";

publicRouter.post('/public/pay/:token/checkout', checkoutLimiter, ah(async (req, res) => {
  let b = await loadByToken(req.params.token);
  if (!b.accepting) throw new HttpError(409, 'Online payment is not available for this booking. Please contact your host.', { code: 'NOT_ACCEPTING' });
  const key = secretbox.decrypt(b.paymongo_key_enc);
  if (!key) throw new HttpError(502, PAYMENT_UNAVAILABLE, { code: 'PAYMENT_FAILED' });
  // Close older checkouts first (outside any transaction: this calls PayMongo and
  // may record a payment that came in), then work from the balance after that.
  const { rows: stale } = await query(`SELECT * FROM balance_checkouts WHERE booking_id = $1 AND status = 'pending'`, [b.booking_id]);
  const toClose = stale.filter((c) => !isReusable(c, Number(b.balance)));
  for (const c of toClose) await closeCheckout(c.checkout_ref).catch(() => {});
  if (toClose.length) b = await loadByToken(req.params.token);
  const amount = Number(b.balance);
  if (!(amount > 0)) throw new HttpError(409, 'This booking is already fully paid. Thank you!', { code: 'PAID' });
  if (amount < 100) throw new HttpError(409, 'The balance is too small to pay online. Please pay your host directly.', { code: 'TOO_SMALL' });
  // One checkout at a time per booking: the booking row lock makes a second
  // tab wait until the first has its PayMongo session, then reuse it. Nothing
  // inside takes a second database connection.
  const result = await tx(async (db) => {
    await db.query('SELECT booking_id FROM bookings WHERE booking_id = $1 FOR NO KEY UPDATE', [b.booking_id]);
    const { rows: [now] } = await db.query(`SELECT ${BALANCE} AS balance FROM bookings b WHERE b.booking_id = $1`, [b.booking_id]);
    if (Number(now.balance) !== amount) throw new HttpError(409, 'The amount due just changed. Please reload the page.', { code: 'CHANGED' });
    const { rows: open } = await db.query(
      `SELECT * FROM balance_checkouts WHERE booking_id = $1 AND status = 'pending' ORDER BY created_at DESC`, [b.booking_id]);
    const reusable = open.find((c) => isReusable(c, amount));
    if (reusable) return { url: reusable.checkout_url };
    // Another open checkout (e.g. started a moment ago in another tab): don't start a second one.
    if (open.length) throw new HttpError(409, 'A payment for this booking is already in progress. Please wait a minute and reload.', { code: 'IN_PROGRESS' });
    const { rows: [c] } = await db.query(
      `INSERT INTO balance_checkouts (organization_id, booking_id, amount, key_enc, test_mode) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [b.organization_id, b.booking_id, amount.toFixed(2), b.paymongo_key_enc, b.test_mode]);
    return { url: await startSession(key, b, c, req.params.token, db) };
  }).catch(async (err) => {
    // The transaction has rolled back and released its connection, so a key PayMongo refuses is cleared here, the same as the direct booking page.
    if (err.unauthorized) await query('UPDATE organizations SET paymongo_key_checked_at = NULL WHERE organization_id = $1', [b.organization_id]);
    throw err;
  });
  res.json({ checkout_url: result.url });
}));

async function startSession(key, b, c, token, db) {
  try {
    const data = await paymongo.request(key, 'POST', '/checkout_sessions', {
      data: {
        attributes: {
          line_items: [{ currency: 'PHP', amount: Math.round(Number(c.amount) * 100), name: `Balance for ${b.unit_name} (${b.check_in} to ${b.check_out}) · ${b.confirmation_code}`, quantity: 1 }],
          payment_method_types: config.paymongoMethods,
          description: `Balance payment to ${b.host_name}`,
          reference_number: c.checkout_ref,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          success_url: `${config.appUrl}/#/pay/${token}?done=1`,
          cancel_url: `${config.appUrl}/#/pay/${token}`,
          metadata: { balance_checkout_ref: c.checkout_ref },
        },
      },
    });
    const id = data?.data?.id;
    const url = data?.data?.attributes?.checkout_url;
    if (!id || !url) throw new Error('unexpected response');
    await db.query('UPDATE balance_checkouts SET provider_checkout_id = $2, checkout_url = $3 WHERE checkout_ref = $1', [c.checkout_ref, id, url]);
    return url;
  } catch (err) {
    // The transaction rolls back, removing the unstarted checkout row.
    console.error(`[balance] checkout ${c.checkout_ref} could not start online payment: ${err.message}`);
    // unauthorized (a key PayMongo refused) is carried past the rollback for the checkout route to act on.
    throw Object.assign(new HttpError(502, PAYMENT_UNAVAILABLE, { code: 'PAYMENT_FAILED' }), { unauthorized: err.unauthorized });
  }
}

// The guest's return: confirm any pending checkout for this booking with PayMongo.
publicRouter.post('/public/pay/:token/refresh', refreshLimiter, ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  const { rows } = await query(`SELECT checkout_ref FROM balance_checkouts WHERE booking_id = $1 AND status = 'pending' AND provider_checkout_id IS NOT NULL`, [b.booking_id]);
  let paid = false;
  for (const r of rows) { if (await refresh(r.checkout_ref).catch(() => null) === 'paid') paid = true; }
  const after = await one(`SELECT ${BALANCE} AS balance FROM bookings b WHERE b.booking_id = $1`, [b.booking_id]);
  res.json({ paid, balance: Number(after.balance) > 0 ? after.balance : '0.00', pending: rows.length > 0 && !paid });
}));

// ---------------------------------------------------------------- confirming
async function refresh(ref) {
  const c = await one('SELECT * FROM balance_checkouts WHERE checkout_ref = $1', [ref]);
  if (!c || !['pending', 'expired'].includes(c.status) || !c.provider_checkout_id) return c?.status || null;
  await query('UPDATE balance_checkouts SET last_checked_at = now() WHERE checkout_ref = $1', [ref]);
  const key = secretbox.decrypt(c.key_enc);
  if (!key) throw new Error('The PayMongo key for this checkout cannot be read.');
  const s = await paymongo.checkoutStatus(key, c.provider_checkout_id);
  const expected = Math.round(Number(c.amount) * 100);
  if (s.paid && (s.paidAmount >= expected || (s.paidAmount === 0 && s.listed === expected))) return markPaid(ref, s.method);
  if (s.paid) {
    // Money arrived but not the amount asked for: never drop it silently.
    const { rows: [f] } = await query(`UPDATE balance_checkouts SET status = 'failed' WHERE checkout_ref = $1 AND status IN ('pending','expired') RETURNING *`, [ref]);
    if (f) await alertHost(f, `PayMongo shows ${fmtPeso(s.paidAmount / 100)} paid instead of ${fmtPeso(c.amount)}.`).catch(() => {});
    return 'failed';
  }
  if (s.expired) {
    await query(`UPDATE balance_checkouts SET status = 'expired' WHERE checkout_ref = $1 AND status = 'pending'`, [ref]);
    return 'expired';
  }
  return c.status;
}

async function markPaid(ref, method) {
  const done = await tx(async (db) => {
    const { rows: [c] } = await db.query('SELECT * FROM balance_checkouts WHERE checkout_ref = $1 FOR UPDATE', [ref]);
    if (!c || c.status === 'paid') return null;
    const { rows: [bk] } = await db.query('SELECT status FROM bookings WHERE booking_id = $1', [c.booking_id]);
    c.booking_status = bk?.status;
    const receipts = require('../lib/receipts');
    const receiptNo = await receipts.nextReceiptNumber(db, c.organization_id);
    const { rows: [p] } = await db.query(
      `INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, reference_number, notes, recorded_by, receipt_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8) RETURNING payment_id`,
      [c.organization_id, c.booking_id, c.amount, manilaToday(), METHOD_MAP[method] || 'other', c.provider_checkout_id,
        c.test_mode ? 'TEST MODE balance payment (PayMongo test key, not real money)' : 'Balance paid online through PayMongo', receiptNo]);
    await db.query(`UPDATE balance_checkouts SET status = 'paid', paid_at = now(), payment_id = $2, payment_method = $3 WHERE checkout_ref = $1`, [ref, p.payment_id, method]);
    await db.query(`INSERT INTO audit_logs (organization_id, action, record_type, record_id, details) VALUES ($1,'reservation.balance_paid_online','booking_payment',$2,$3)`,
      [c.organization_id, p.payment_id, JSON.stringify({ amount: c.amount, booking_id: c.booking_id })]);
    return { c, paymentId: p.payment_id };
  });
  if (done) await afterPaid(done).catch((err) => console.error('[balance] after-payment steps failed:', err.message));
  return 'paid';
}

async function afterPaid({ c, paymentId }) {
  const { notify, propertyOfBooking } = require('../lib/push');
  notify(c.organization_id, 'payment', {
    title: `Balance paid online · ${fmtPeso(c.amount)}`, body: 'Tap to open the reservation.',
    url: `/#/reservations/${c.booking_id}`, propertyId: await propertyOfBooking(c.booking_id),
  }).catch(() => {});
  const receipts = require('../lib/receipts');
  const messaging = require('../lib/messaging');
  await receipts.sendReceipt(paymentId, null);
  const bal = await one(`SELECT ${BALANCE} AS balance FROM bookings b WHERE b.booking_id = $1`, [c.booking_id]);
  const conv = await messaging.getOrCreateConversation(c.booking_id);
  await query(`INSERT INTO messages (conversation_id, organization_id, direction, from_name, body, status) VALUES ($1,$2,'note','BalayHub',$3,'note')`,
    [conv.conversation_id, conv.organization_id,
      `The guest paid ${fmtPeso(c.amount)} online.${Number(bal.balance) > 0 ? ` Remaining balance: ${fmtPeso(bal.balance)}.` : ' The booking is now fully paid.'}${Number(bal.balance) < 0 ? ' Note: this is more than the balance (another payment was recorded meanwhile); please refund the difference.' : ''}${c.booking_status !== 'confirmed' ? ' ⚠ This reservation is cancelled. Please refund the guest from your PayMongo dashboard or rebook them.' : ''}`]);
  await query(`UPDATE conversations SET unread = true, status = 'open', last_message_at = now() WHERE conversation_id = $1`, [conv.conversation_id]);
}

// Close a checkout at PayMongo so it can't be paid later. It is marked expired
// only once PayMongo itself says so; if it got paid meanwhile, it's recorded.
// Returns the checkout's status afterwards.
async function closeCheckout(ref) {
  const c = await one('SELECT * FROM balance_checkouts WHERE checkout_ref = $1', [ref]);
  if (!c || c.status !== 'pending') return c?.status || null;
  if (!c.provider_checkout_id) return 'pending'; // still being started by another request
  const key = secretbox.decrypt(c.key_enc);
  if (key) await paymongo.request(key, 'POST', `/checkout_sessions/${encodeURIComponent(c.provider_checkout_id)}/expire`).catch(() => {});
  return refresh(ref).catch(() => 'pending');
}

// Close the guest's open checkouts after the amount owed changes (a payment
// recorded or voided, the booking edited or cancelled), so a stale session
// can't be paid. Never throws.
async function closeOpenCheckouts(bookingId) {
  const { rows } = await query(`SELECT checkout_ref FROM balance_checkouts WHERE booking_id = $1 AND status = 'pending'`, [bookingId]).catch(() => ({ rows: [] }));
  for (const r of rows) await closeCheckout(r.checkout_ref).catch(() => {});
}

// Scheduler: confirm payments whose guest didn't come back; close checkouts
// once they're past the reuse window; recheck recently expired ones in case a
// payment landed as they closed.
async function reconcileBalance() {
  const { rows } = await query(
    `SELECT checkout_ref, status, created_at < now() - interval '1 hour' AS old, created_at < now() - interval '3 days' AS very_old
       FROM balance_checkouts
      WHERE provider_checkout_id IS NOT NULL
        AND (status = 'pending' OR (status = 'expired' AND created_at > now() - interval '7 days'
                                    AND (last_checked_at IS NULL OR last_checked_at < now() - interval '1 hour')))
      ORDER BY (status = 'pending') DESC, last_checked_at NULLS FIRST, created_at DESC LIMIT 40`);
  let paid = 0;
  for (const r of rows) {
    try {
      let st = await refresh(r.checkout_ref);
      if (st === 'pending' && r.old) st = await closeCheckout(r.checkout_ref);
      if (st === 'paid') paid += 1;
      else if (st === 'pending' && r.very_old) throw new Error('PayMongo has not closed this checkout.');
    } catch (err) {
      if (r.very_old) {
        // Can't check it: never assume it wasn't paid. Ask the host to look in PayMongo.
        const { rows: [c] } = await query(`UPDATE balance_checkouts SET status = 'failed' WHERE checkout_ref = $1 AND status = 'pending' RETURNING *`, [r.checkout_ref]);
        if (c) await alertHost(c, err.message).catch(() => {});
      }
    }
  }
  return paid;
}

async function alertHost(c, reason) {
  const { sendMail } = require('../lib/mailer');
  const { rows } = await query(`SELECT email, full_name FROM users WHERE organization_id = $1 AND role = 'owner'`, [c.organization_id]);
  for (const u of rows) {
    await sendMail({
      to: u.email,
      subject: 'Please check a balance payment in PayMongo',
      text: `Hi ${u.full_name},\n\nBalayHub could not confirm an online balance payment of ${fmtPeso(c.amount)} (reference ${c.provider_checkout_id}). Reason: ${reason}\n\nPlease check your PayMongo dashboard. If it was paid, record the payment on the reservation by hand.\n\n— BalayHub`,
    });
  }
}

module.exports = {
  router, publicRouter, ensurePayToken, payLink, reconcileBalance, refresh, closeOpenCheckouts, acceptsOnline,
  BALANCE, loadByToken, manualRefusal,
};
