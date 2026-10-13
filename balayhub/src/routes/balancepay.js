'use strict';

// Pay the balance online: a private link per reservation where the guest pays
// what's still owed through the host's own PayMongo account. A payment is
// recorded only after BalayHub confirms it with PayMongo.

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { uuidParam } = require('../lib/validate');
const { requireRole, rateLimit } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { planStatus } = require('../lib/plans');
const secretbox = require('../lib/secretbox');
const paymongo = require('../lib/paymongo');

const router = express.Router();
const publicRouter = express.Router();
const managers = requireRole('owner', 'manager');

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const METHOD_MAP = { gcash: 'gcash', paymaya: 'maya', maya: 'maya', card: 'card', grab_pay: 'other', qrph: 'other' };
const payLink = (token) => `${config.appUrl}/#/pay/${token}`;

const BALANCE = `(b.total_amount - COALESCE((SELECT SUM(x.amount) FROM booking_payments x WHERE x.booking_id = b.booking_id AND x.voided_at IS NULL), 0))::numeric(12,2)`;

async function ensurePayToken(bookingId) {
  const r = await one(`UPDATE bookings SET pay_token = COALESCE(pay_token, $2) WHERE booking_id = $1 RETURNING pay_token`,
    [bookingId, crypto.randomBytes(18).toString('base64url')]);
  return r?.pay_token || null;
}

// ---------------------------------------------------------------- host side
router.get('/reservations/:id/payment-link', managers, ah(async (req, res) => {
  const params = [uuidParam(req.params.id)];
  const b = await one(
    `SELECT b.booking_id, b.status, b.kind, ${BALANCE} AS balance, o.paymongo_key_hint
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(req.user, params)}`, params);
  if (!b) throw notFound();
  if (!b.paymongo_key_hint) return res.json({ available: false, reason: 'Connect PayMongo in Settings → Direct booking page to send payment links.' });
  if (b.status !== 'confirmed' || Number(b.balance) <= 0) return res.json({ available: false, reason: 'Nothing left to pay on this reservation.' });
  res.json({ available: true, link: payLink(await ensurePayToken(b.booking_id)), balance: b.balance });
}));

// ---------------------------------------------------------------- guest side
const payLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `pay|${req.ip}` });
publicRouter.use('/public/pay', payLimiter);

async function loadByToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw notFound('This payment link is not valid. Please ask your host for a new one.');
  const b = await one(
    `SELECT b.booking_id, b.organization_id, b.check_in, b.check_out, b.status, b.total_amount, b.confirmation_code, ${BALANCE} AS balance,
            u.unit_name, p.property_name, o.name AS host_name, o.paymongo_key_enc, o.paymongo_key_hint, o.plan, o.trial_ends_at, o.paid_until,
            o.is_demo, o.deletion_scheduled_at, COALESCE(g.full_name, b.guest_label) AS guest_name
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.pay_token = $1 AND b.kind = 'reservation'`, [token]);
  if (!b) throw notFound('This payment link is not valid. Please ask your host for a new one.');
  b.accepting = Boolean(b.paymongo_key_enc) && !planStatus(b).read_only && !b.is_demo && b.status === 'confirmed' && b.check_out >= manilaToday();
  b.test_mode = Boolean(b.paymongo_key_hint && b.paymongo_key_hint.startsWith('sk_test_'));
  return b;
}

publicRouter.get('/public/pay/:token', ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  res.json({
    host: b.host_name, listing: b.unit_name, property: b.property_name, check_in: b.check_in, check_out: b.check_out,
    code: b.confirmation_code, guest_first_name: String(b.guest_name || '').split(' ')[0] || null,
    total: b.total_amount, paid: (Number(b.total_amount) - Number(b.balance)).toFixed(2), balance: Number(b.balance) > 0 ? b.balance : '0.00',
    accepting: b.accepting, test_mode: b.test_mode, cancelled: b.status !== 'confirmed',
  });
}));

const checkoutLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: (req) => `paycheckout|${req.params.token}` });

publicRouter.post('/public/pay/:token/checkout', checkoutLimiter, ah(async (req, res) => {
  const b = await loadByToken(req.params.token);
  if (!b.accepting) throw new HttpError(409, 'Online payment is not available for this booking. Please contact your host.', { code: 'NOT_ACCEPTING' });
  const amount = Number(b.balance);
  if (!(amount > 0)) throw new HttpError(409, 'This booking is already fully paid. Thank you!', { code: 'PAID' });
  if (amount < 100) throw new HttpError(409, 'The balance is too small to pay online. Please pay your host directly.', { code: 'TOO_SMALL' });
  // Reuse a recent unpaid checkout for the same amount; close older ones.
  const { rows: open } = await query(
    `SELECT * FROM balance_checkouts WHERE booking_id = $1 AND status = 'pending' ORDER BY created_at DESC`, [b.booking_id]);
  const reusable = open.find((c) => Number(c.amount) === amount && c.checkout_url && Date.now() - new Date(c.created_at) < 30 * 60 * 1000);
  if (reusable) return res.json({ checkout_url: reusable.checkout_url });
  for (const c of open) await closeCheckout(c.checkout_ref).catch(() => {});

  const key = secretbox.decrypt(b.paymongo_key_enc);
  if (!key) throw new HttpError(502, 'Online payment is not available right now. Please contact your host.', { code: 'PAYMENT_FAILED' });
  const c = await one(
    `INSERT INTO balance_checkouts (organization_id, booking_id, amount, key_enc, test_mode) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [b.organization_id, b.booking_id, amount.toFixed(2), b.paymongo_key_enc, b.test_mode]);
  try {
    const data = await paymongo.request(key, 'POST', '/checkout_sessions', {
      data: {
        attributes: {
          line_items: [{ currency: 'PHP', amount: Math.round(amount * 100), name: `Balance for ${b.unit_name} (${b.check_in} to ${b.check_out}) · ${b.confirmation_code}`, quantity: 1 }],
          payment_method_types: config.paymongoMethods,
          description: `Balance payment to ${b.host_name}`,
          reference_number: c.checkout_ref,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          success_url: `${config.appUrl}/#/pay/${req.params.token}?done=1`,
          cancel_url: `${config.appUrl}/#/pay/${req.params.token}`,
          metadata: { balance_checkout_ref: c.checkout_ref },
        },
      },
    });
    const id = data?.data?.id;
    const url = data?.data?.attributes?.checkout_url;
    if (!id || !url) throw new Error('unexpected response');
    await query('UPDATE balance_checkouts SET provider_checkout_id = $2, checkout_url = $3 WHERE checkout_ref = $1', [c.checkout_ref, id, url]);
    res.json({ checkout_url: url });
  } catch (err) {
    await query(`UPDATE balance_checkouts SET status = 'failed' WHERE checkout_ref = $1`, [c.checkout_ref]);
    throw new HttpError(502, err.status === 502 ? err.message : 'Online payment is not available right now. Please contact your host.', { code: 'PAYMENT_FAILED' });
  }
}));

// The guest's return: confirm any pending checkout for this booking with PayMongo.
publicRouter.post('/public/pay/:token/refresh', ah(async (req, res) => {
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
  const receipts = require('../lib/receipts');
  const messaging = require('../lib/messaging');
  await receipts.sendReceipt(paymentId, null);
  const bal = await one(`SELECT ${BALANCE} AS balance FROM bookings b WHERE b.booking_id = $1`, [c.booking_id]);
  const conv = await messaging.getOrCreateConversation(c.booking_id);
  await query(`INSERT INTO messages (conversation_id, organization_id, direction, from_name, body, status) VALUES ($1,$2,'note','BalayHub',$3,'note')`,
    [conv.conversation_id, conv.organization_id,
      `The guest paid ₱${Number(c.amount).toLocaleString('en-PH')} online.${Number(bal.balance) > 0 ? ` Remaining balance: ₱${Number(bal.balance).toLocaleString('en-PH')}.` : ' The booking is now fully paid.'}${Number(bal.balance) < 0 ? ' Note: this is more than the balance (another payment was recorded meanwhile); please refund the difference.' : ''}`]);
  await query(`UPDATE conversations SET unread = true, status = 'open', last_message_at = now() WHERE conversation_id = $1`, [conv.conversation_id]);
}

// Close a checkout at PayMongo so it can't be paid later (unless already paid).
async function closeCheckout(ref) {
  const c = await one('SELECT * FROM balance_checkouts WHERE checkout_ref = $1', [ref]);
  if (!c || c.status !== 'pending') return;
  const key = secretbox.decrypt(c.key_enc);
  if (key && c.provider_checkout_id) await paymongo.request(key, 'POST', `/checkout_sessions/${encodeURIComponent(c.provider_checkout_id)}/expire`).catch(() => {});
  const st = c.provider_checkout_id ? await refresh(ref).catch(() => 'pending') : 'pending';
  if (st === 'pending') await query(`UPDATE balance_checkouts SET status = 'expired' WHERE checkout_ref = $1 AND status = 'pending'`, [ref]);
}

// Scheduler: confirm payments whose guest didn't come back; close checkouts older than a day.
async function reconcileBalance() {
  const { rows } = await query(
    `SELECT checkout_ref, created_at < now() - interval '1 day' AS old, created_at < now() - interval '3 days' AS very_old
       FROM balance_checkouts WHERE status = 'pending' AND provider_checkout_id IS NOT NULL
      ORDER BY last_checked_at NULLS FIRST, created_at DESC LIMIT 40`);
  let paid = 0;
  for (const r of rows) {
    try {
      const st = await refresh(r.checkout_ref);
      if (st === 'paid') paid += 1;
      else if (st === 'pending' && r.old) await closeCheckout(r.checkout_ref);
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
      text: `Hi ${u.full_name},\n\nBalayHub could not confirm an online balance payment of ₱${Number(c.amount).toLocaleString('en-PH')} (reference ${c.provider_checkout_id}). Reason: ${reason}\n\nPlease check your PayMongo dashboard. If it was paid, record the payment on the reservation by hand.\n\n— BalayHub`,
    });
  }
}

module.exports = { router, publicRouter, ensurePayToken, payLink, reconcileBalance, refresh };
