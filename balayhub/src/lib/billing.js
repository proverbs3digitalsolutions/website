'use strict';

// Online plan payments through PayMongo hosted checkout (GCash, Maya, cards,
// GrabPay). A payment is only ever trusted after BalayHub asks PayMongo for the
// checkout's status with the secret key; webhooks just tell us when to ask.

const crypto = require('crypto');
const config = require('../config');
const { pool, tx, one, query } = require('../db');
const { PLANS } = require('./plans');
const { audit } = require('./audit');
const { HttpError } = require('./http');
const { fmtPeso } = require('./messaging');
const coupons = require('./coupons');
const { toCentavos, toPesos } = coupons;

const MONTH_OPTIONS = { 1: 1, 3: 3, 12: 10 }; // months → months charged (12 months = 2 free)

const enabled = () => Boolean(config.paymongoSecretKey);

function price(plan, months) {
  const p = PLANS[plan];
  if (!p || !p.price || !MONTH_OPTIONS[months]) return null;
  return p.price * MONTH_OPTIONS[months];
}

const paymongoClient = require('./paymongo');
const paymongo = (method, path, body) => paymongoClient.request(config.paymongoSecretKey, method, path, body);

// Give up a checkout that never got a payment: mark it failed and give its coupon slot back. A paid row is left alone.
async function failCheckout(billingId, redemptionId) {
  await query(`UPDATE billing_payments SET status = 'failed' WHERE billing_id = $1 AND status = 'pending'`, [billingId]);
  await coupons.releaseIfUnused(pool, redemptionId);
}

// Start a PayMongo checkout, or activate the period with no payment when a coupon makes it free. The coupon code is
// optional: a workspace that already holds a coupon keeps its discount on later checkouts (see coupons.resolve).
async function createCheckout(user, plan, months, { couponCode } = {}) {
  // The workspace row is locked so two checkouts can't both take the last slot of a coupon.
  const { billing, q, redemptionId } = await tx(async (db) => {
    const { rows: [org] } = await db.query(
      'SELECT organization_id, plan, is_demo, trial_ends_at, paid_until FROM organizations WHERE organization_id = $1 FOR UPDATE',
      [user.organization_id]);
    const q = await coupons.resolve(db, { org, code: couponCode, plan, months });
    const ahead = couponAheadError(org, q);
    if (ahead) throw ahead;
    // A checkout that covers no months holds no coupon slot.
    const redemptionId = q.covered > 0
      ? await coupons.reserve(db, { org, userId: user.user_id, coupon: q.coupon, redemption: q.redemption })
      : null;
    const { rows: [billing] } = await db.query(
      `INSERT INTO billing_payments (organization_id, plan, months, amount, list_amount, discount_amount, coupon_redemption_id, coupon_months, provider, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [user.organization_id, plan, months, toPesos(q.amountC), toPesos(q.listC), toPesos(q.discountC), redemptionId, q.covered,
        q.free ? 'coupon' : 'paymongo', user.user_id]);
    return { billing, q, redemptionId };
  });
  if (q.free) {
    try {
      await markPaid(billing.billing_id, { method: 'coupon' });
    } catch (err) {
      await failCheckout(billing.billing_id, redemptionId);
      throw err;
    }
    const { rows: [org] } = await query('SELECT paid_until FROM organizations WHERE organization_id = $1', [user.organization_id]);
    return { billing_id: billing.billing_id, activated: true, plan, paid_until: org.paid_until };
  }
  const label = `BalayHub ${PLANS[plan].name} — ${months} month${months > 1 ? 's' : ''}`;
  const code = q.discountC > 0 ? q.coupon.code : null;
  let data;
  try {
    data = await paymongo('POST', '/checkout_sessions', {
    data: {
      attributes: {
        line_items: [{ currency: 'PHP', amount: q.amountC, name: code ? `${label} (coupon ${code})` : label, quantity: 1 }],
        payment_method_types: q.cardOnly ? ['card'] : config.paymongoMethods,
        description: `${label} for ${user.organization_name}${code ? ` · ${fmtPeso(toPesos(q.listC))} before coupon` : ''}`,
        reference_number: billing.billing_id,
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        success_url: `${config.appUrl}/#/settings?billing=${billing.billing_id}`,
        cancel_url: `${config.appUrl}/#/settings?billing_cancelled=1`,
        metadata: { billing_id: billing.billing_id, organization_id: user.organization_id, ...(code ? { coupon_code: code } : {}) },
      },
    },
    });
  } catch (err) {
    await failCheckout(billing.billing_id, redemptionId);
    throw err;
  }
  const id = data?.data?.id;
  const url = data?.data?.attributes?.checkout_url;
  if (!id || !url) {
    await failCheckout(billing.billing_id, redemptionId);
    throw Object.assign(new Error('The payment service returned an unexpected response.'), { status: 502 });
  }
  await query('UPDATE billing_payments SET checkout_id = $2, checkout_url = $3 WHERE billing_id = $1', [billing.billing_id, id, url]);
  await audit(null, user, 'billing.checkout_started', 'billing_payment', billing.billing_id, { plan, months, amount: toPesos(q.amountC) });
  return { billing_id: billing.billing_id, checkout_url: url };
}

const addMonths = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};
const lastDayOfMonth = (s) => { const [y, m] = s.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
// Last day of an n-month period starting on `start` (e.g. Oct 13 → Nov 12; Jan 31 → Feb 28; Mar 1 → Mar 31).
function periodEnd(start, n) {
  const prev = dayBefore(start);
  const end = addMonths(prev, n);
  return prev === lastDayOfMonth(prev) ? lastDayOfMonth(end) : end;
}
const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const dayBefore = (s) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const dayAfter = (s) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// A discounted checkout waits until the workspace is at most this many days paid ahead. Otherwise coupon checkouts
// stack paid time far ahead, and a later plan change converts that time into another plan at the old price.
const AHEAD_LIMIT_DAYS = 45;
// The error a discounted checkout gets while paid too far ahead, or null. `org` needs paid_until; `quote` is the
// answer from coupons.resolve (discountC). The route's coupon preview calls this too, so the two can't disagree.
function couponAheadError(org, quote) {
  if (quote.discountC <= 0 || !org.paid_until) return null;
  if (String(org.paid_until).slice(0, 10) <= addDays(manilaToday(), AHEAD_LIMIT_DAYS)) return null;
  return new HttpError(409, 'Your plan is already paid ahead. Your coupon applies at your next renewal.', { code: 'COUPON_AHEAD' });
}

// Apply a confirmed payment once: switch the plan and extend "paid until".
async function markPaid(billingId, { method } = {}) {
  return tx(async (db) => {
    const { rows: [b] } = await db.query('SELECT * FROM billing_payments WHERE billing_id = $1 FOR UPDATE', [billingId]);
    if (!b || b.status === 'paid') return false;
    const { rows: [org] } = await db.query('SELECT plan, paid_until, trial_ends_at FROM organizations WHERE organization_id = $1 FOR UPDATE', [b.organization_id]);
    const today = manilaToday();
    const paidUntil = org.paid_until ? String(org.paid_until).slice(0, 10) : null;
    let start = today;
    let bonusDays = 0;
    if (org.plan === 'trial' && org.trial_ends_at && new Date(org.trial_ends_at) > new Date()) {
      // Paying during the trial keeps the remaining trial days.
      start = new Date(new Date(org.trial_ends_at).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    } else if (paidUntil && paidUntil >= today && PLANS[org.plan]?.price) {
      if (org.plan === b.plan) {
        start = dayAfter(paidUntil); // renewing early adds on to the current period
      } else {
        // Changing plan: the new plan starts today, and the unused days of the old
        // plan are converted at the two plans' prices.
        const remaining = daysBetween(today, paidUntil) + 1;
        bonusDays = Math.floor((remaining * PLANS[org.plan].price) / PLANS[b.plan].price);
      }
    }
    const end = addDays(periodEnd(start, b.months), bonusDays);
    await db.query(
      `UPDATE billing_payments SET status = 'paid', paid_at = now(), period_start = $2, period_end = $3, payment_method = $4 WHERE billing_id = $1`,
      [b.billing_id, start, end, method || null]);
    await db.query(`UPDATE organizations SET plan = $2, paid_until = $3 WHERE organization_id = $1`, [b.organization_id, b.plan, end]);
    await coupons.applyPaid(db, b);
    await audit(db, { organization_id: b.organization_id, user_id: b.created_by }, 'billing.paid', 'billing_payment', b.billing_id,
      { plan: b.plan, months: b.months, amount: b.amount, paid_until: end });
    return true;
  });
}

// Ask PayMongo for the checkout's real status and apply it.
async function refresh(billingId) {
  const b = await one('SELECT * FROM billing_payments WHERE billing_id = $1', [billingId]);
  // Expired rows are checked too: a payment can complete just before expiry.
  if (!b || !['pending', 'expired'].includes(b.status) || !b.checkout_id || !enabled()) return b?.status || null;
  await query('UPDATE billing_payments SET last_checked_at = now() WHERE billing_id = $1', [b.billing_id]);
  const data = await paymongo('GET', `/checkout_sessions/${encodeURIComponent(b.checkout_id)}`);
  const a = data?.data?.attributes || {};
  const paidPayments = (a.payments || []).filter((p) => p?.attributes?.status === 'paid');
  const paid = paidPayments.length > 0 || a.payment_intent?.attributes?.status === 'succeeded';
  // We looked the checkout up by our own stored id, so it is ours; still check the amount (centavos).
  const expected = toCentavos(b.amount);
  const paidAmount = paidPayments.reduce((s, p) => s + Number(p.attributes.amount || 0), 0);
  const listed = (a.line_items || []).reduce((s, li) => s + Number(li.amount || 0) * Number(li.quantity || 1), 0);
  const amountOk = paidAmount >= expected || (paidAmount === 0 && listed === expected);
  if (paid && amountOk) {
    const method = a.payment_method_used || paidPayments[0]?.attributes?.source?.type || null;
    await markPaid(b.billing_id, { method });
    return 'paid';
  }
  if (paid && !amountOk) console.error(`[billing] amount mismatch on ${b.billing_id}: expected ${expected}, got ${paidAmount || listed}`);
  if (a.status === 'expired' || b.status === 'expired') {
    await query(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1 AND status = 'pending'`, [b.billing_id]);
    await coupons.releaseIfUnused(pool, b.coupon_redemption_id);
    return 'expired';
  }
  return 'pending';
}

// PayMongo-Signature: "t=<timestamp>,te=<test sig>,li=<live sig>", where each
// signature is HMAC-SHA256(secret, "<t>.<raw body>") in hex.
function verifySignature(header, rawBody, livemode) {
  // Without the signing secret, webhooks are ignored; the 10-minute check still applies payments.
  if (!config.paymongoWebhookSecret) return false;
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=').map((x) => x.trim())));
  const sig = livemode ? parts.li : parts.te;
  if (!parts.t || !sig) return false;
  // Reject very old signatures (PayMongo retries within about a day).
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 3 * 86400) return false;
  const expected = crypto.createHmac('sha256', config.paymongoWebhookSecret).update(`${parts.t}.${rawBody}`).digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// Scheduler: catch up on payments whose webhook never arrived.
async function reconcile() {
  if (!enabled()) return 0;
  // Least recently checked first, so abandoned checkouts can't starve new ones.
  const { rows } = await query(
    `SELECT billing_id FROM billing_payments WHERE status = 'pending' AND checkout_id IS NOT NULL
      ORDER BY last_checked_at NULLS FIRST, created_at DESC LIMIT 20`);
  let paid = 0;
  for (const r of rows) {
    try { if (await refresh(r.billing_id) === 'paid') paid += 1; } catch { /* try again next time */ }
  }
  // Give up on checkouts older than 2 days, after one last check each.
  const { rows: old } = await query(
    `SELECT billing_id FROM billing_payments WHERE status = 'pending' AND created_at < now() - interval '2 days' LIMIT 20`);
  for (const r of old) {
    let st = 'pending';
    try { st = await refresh(r.billing_id); } catch { continue; }
    if (st === 'paid') paid += 1;
    else await query(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1 AND status = 'pending'`, [r.billing_id]);
  }
  // Coupon slots held for two days by checkouts that never got a payment go back to the coupon.
  await query(
    `UPDATE platform_coupon_redemptions r SET status = 'released', released_at = now()
      WHERE r.status = 'pending' AND r.created_at < now() - interval '2 days'
        AND NOT EXISTS (SELECT 1 FROM billing_payments b WHERE b.coupon_redemption_id = r.redemption_id AND b.status IN ('paid', 'pending'))`);
  return paid;
}

module.exports = { periodEnd, enabled, price, MONTH_OPTIONS, createCheckout, refresh, markPaid, verifySignature, reconcile, addMonths, couponAheadError };
