'use strict';

// Online plan payments through PayMongo hosted checkout (GCash, Maya, cards,
// GrabPay). A payment is only ever trusted after BalayHub asks PayMongo for the
// checkout's status with the secret key; webhooks just tell us when to ask.

const crypto = require('crypto');
const config = require('../config');
const { tx, one, query } = require('../db');
const { PLANS } = require('./plans');
const { audit } = require('./audit');

const API = 'https://api.paymongo.com/v1';
const MONTH_OPTIONS = { 1: 1, 3: 3, 12: 10 }; // months → months charged (12 months = 2 free)

const enabled = () => Boolean(config.paymongoSecretKey);

function price(plan, months) {
  const p = PLANS[plan];
  if (!p || !p.price || !MONTH_OPTIONS[months]) return null;
  return p.price * MONTH_OPTIONS[months];
}

const serviceError = (msg) => Object.assign(new Error(msg), { status: 502 });

async function paymongo(method, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.paymongoSecretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    console.error(`[billing] PayMongo ${method} ${path} unreachable: ${err.message}`);
    throw serviceError("Couldn't reach the payment service. Please try again in a moment.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail || `HTTP ${res.status}`;
    console.error(`[billing] PayMongo ${method} ${path} failed: ${detail}`);
    throw serviceError('The payment service could not start the checkout. Please try again in a moment.');
  }
  return data;
}

async function createCheckout(user, plan, months) {
  const amount = price(plan, months);
  const billing = await one(
    `INSERT INTO billing_payments (organization_id, plan, months, amount, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [user.organization_id, plan, months, amount, user.user_id]);
  const label = `BalayHub ${PLANS[plan].name} — ${months} month${months > 1 ? 's' : ''}`;
  let data;
  try {
    data = await paymongo('POST', '/checkout_sessions', {
    data: {
      attributes: {
        line_items: [{ currency: 'PHP', amount: Math.round(amount * 100), name: label, quantity: 1 }],
        payment_method_types: config.paymongoMethods,
        description: `${label} for ${user.organization_name}`,
        reference_number: billing.billing_id,
        send_email_receipt: true,
        show_description: true,
        show_line_items: true,
        success_url: `${config.appUrl}/#/settings?billing=${billing.billing_id}`,
        cancel_url: `${config.appUrl}/#/settings?billing_cancelled=1`,
        metadata: { billing_id: billing.billing_id, organization_id: user.organization_id },
      },
    },
    });
  } catch (err) {
    await query(`UPDATE billing_payments SET status = 'failed' WHERE billing_id = $1`, [billing.billing_id]);
    throw err;
  }
  const id = data?.data?.id;
  const url = data?.data?.attributes?.checkout_url;
  if (!id || !url) throw Object.assign(new Error('The payment service returned an unexpected response.'), { status: 502 });
  await query('UPDATE billing_payments SET checkout_id = $2, checkout_url = $3 WHERE billing_id = $1', [billing.billing_id, id, url]);
  await audit(null, user, 'billing.checkout_started', 'billing_payment', billing.billing_id, { plan, months, amount });
  return { billing_id: billing.billing_id, checkout_url: url };
}

const addMonths = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};
const dayBefore = (s) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const dayAfter = (s) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

// Apply a confirmed payment once: switch the plan and extend "paid until".
async function markPaid(billingId, { method } = {}) {
  return tx(async (db) => {
    const { rows: [b] } = await db.query('SELECT * FROM billing_payments WHERE billing_id = $1 FOR UPDATE', [billingId]);
    if (!b || b.status === 'paid') return false;
    const { rows: [org] } = await db.query('SELECT plan, paid_until FROM organizations WHERE organization_id = $1 FOR UPDATE', [b.organization_id]);
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const paidUntil = org.paid_until ? String(org.paid_until).slice(0, 10) : null;
    // Renewing early adds on to the current period; otherwise it starts today.
    const start = paidUntil && paidUntil >= today && org.plan !== 'trial' ? dayAfter(paidUntil) : today;
    const end = dayBefore(addMonths(start, b.months));
    await db.query(
      `UPDATE billing_payments SET status = 'paid', paid_at = now(), period_start = $2, period_end = $3, payment_method = $4 WHERE billing_id = $1`,
      [b.billing_id, start, end, method || null]);
    await db.query(`UPDATE organizations SET plan = $2, paid_until = $3 WHERE organization_id = $1`, [b.organization_id, b.plan, end]);
    await audit(db, { organization_id: b.organization_id, user_id: b.created_by }, 'billing.paid', 'billing_payment', b.billing_id,
      { plan: b.plan, months: b.months, amount: b.amount, paid_until: end });
    return true;
  });
}

// Ask PayMongo for the checkout's real status and apply it.
async function refresh(billingId) {
  const b = await one('SELECT * FROM billing_payments WHERE billing_id = $1', [billingId]);
  if (!b || b.status !== 'pending' || !b.checkout_id || !enabled()) return b?.status || null;
  const data = await paymongo('GET', `/checkout_sessions/${encodeURIComponent(b.checkout_id)}`);
  const a = data?.data?.attributes || {};
  const paidPayments = (a.payments || []).filter((p) => p?.attributes?.status === 'paid');
  const paid = paidPayments.length > 0 || a.payment_intent?.attributes?.status === 'succeeded';
  // We looked the checkout up by our own stored id, so it is ours; still check the amount (centavos).
  const expected = Math.round(Number(b.amount) * 100);
  const paidAmount = paidPayments.reduce((s, p) => s + Number(p.attributes.amount || 0), 0);
  const listed = (a.line_items || []).reduce((s, li) => s + Number(li.amount || 0) * Number(li.quantity || 1), 0);
  const amountOk = paidAmount >= expected || (paidAmount === 0 && listed === expected);
  if (paid && amountOk) {
    const method = a.payment_method_used || paidPayments[0]?.attributes?.source?.type || null;
    await markPaid(b.billing_id, { method });
    return 'paid';
  }
  if (paid && !amountOk) console.error(`[billing] amount mismatch on ${b.billing_id}: expected ${expected}, got ${paidAmount || listed}`);
  if (a.status === 'expired') {
    await query(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1 AND status = 'pending'`, [b.billing_id]);
    return 'expired';
  }
  return 'pending';
}

// PayMongo-Signature: "t=<timestamp>,te=<test sig>,li=<live sig>", where each
// signature is HMAC-SHA256(secret, "<t>.<raw body>") in hex.
function verifySignature(header, rawBody, livemode) {
  if (!config.paymongoWebhookSecret) return true; // optional; we re-check with PayMongo anyway
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=').map((x) => x.trim())));
  const sig = livemode ? parts.li : parts.te;
  if (!parts.t || !sig) return false;
  const expected = crypto.createHmac('sha256', config.paymongoWebhookSecret).update(`${parts.t}.${rawBody}`).digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// Scheduler: catch up on payments whose webhook never arrived.
async function reconcile() {
  if (!enabled()) return 0;
  await query(`UPDATE billing_payments SET status = 'expired' WHERE status = 'pending' AND created_at < now() - interval '2 days'`);
  const { rows } = await query(`SELECT billing_id FROM billing_payments WHERE status = 'pending' AND checkout_id IS NOT NULL ORDER BY created_at LIMIT 20`);
  let paid = 0;
  for (const r of rows) {
    try { if (await refresh(r.billing_id) === 'paid') paid += 1; } catch { /* try again next time */ }
  }
  return paid;
}

module.exports = { enabled, price, MONTH_OPTIONS, createCheckout, refresh, markPaid, verifySignature, reconcile, addMonths };
