'use strict';

// Plan payments: start a PayMongo checkout, confirm it, payment history,
// and PayMongo's webhook.

const express = require('express');
const { query, pool } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { requireRole, rateLimit } = require('../lib/auth');
const { PLANS, PUBLIC_PLANS } = require('../lib/plans');
const billing = require('../lib/billing');
const coupons = require('../lib/coupons');

const router = express.Router();
const owners = requireRole('owner');

// The same message checkout has always given when online payment is off.
const billingOff = () => new HttpError(409, 'Online payment is not set up yet. Please pay by GCash or bank transfer and contact us.', { code: 'BILLING_OFF' });

// A coupon as the owner's box reads it (contract section 2.2). Money stays text, like every other amount.
const couponView = (c, monthsLeft) => ({
  code: c.code, name: c.name, kind: c.kind, percent_off: c.percent_off, amount_off: c.amount_off,
  duration: c.duration, duration_months: c.duration_months, months_left: monthsLeft, plans: c.plans, require_card: c.require_card,
});

router.get('/billing', owners, ah(async (req, res) => {
  const { rows: history } = await query(
    `SELECT b.billing_id, b.plan, b.months, b.amount, b.list_amount, b.discount_amount, b.provider, pc.code AS coupon_code,
            b.status, b.payment_method, b.paid_at, b.period_start, b.period_end, b.created_at
       FROM billing_payments b
       LEFT JOIN platform_coupon_redemptions r ON r.redemption_id = b.coupon_redemption_id
       LEFT JOIN platform_coupons pc ON pc.coupon_id = r.coupon_id
      WHERE b.organization_id = $1 AND (b.status = 'paid' OR (b.status = 'pending' AND b.checkout_id IS NOT NULL))
      ORDER BY b.created_at DESC LIMIT 50`,
    [req.user.organization_id]);
  const last = await coupons.lastRedemption(pool, req.user.organization_id);
  res.json({
    online: billing.enabled(),
    options: PUBLIC_PLANS.map((k) => ({
      key: k, name: PLANS[k].name, listings: PLANS[k].listings, ai: PLANS[k].ai,
      prices: Object.keys(billing.MONTH_OPTIONS).map((m) => ({ months: Number(m), amount: billing.price(k, Number(m)) })),
    })),
    coupon: last ? { ...couponView(last, last.months_total == null ? null : Math.max(0, last.months_total - last.months_used)), status: last.status } : null,
    history,
  });
}));

const checkoutLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, key: (req) => `checkout|${req.user.organization_id}` });
// Failed coupon codes are limited per workspace and per IP; successful checks don't count.
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, failedOnly: true, key: (req) => `coupon|${req.user.organization_id}` });
const codeIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, failedOnly: true, key: (req) => `couponip|${req.ip}` });
// A checkout without a code is not a code check, so it is not limited here.
const onlyWithCode = (limiter) => (req, res, next) => (req.body?.coupon_code ? limiter(req, res, next) : next());

// What a coupon would take off this plan and length, and why a code can't be used. Read only: nothing is reserved.
router.post('/billing/coupon/preview', owners, codeIpLimiter, codeLimiter, ah(async (req, res) => {
  const body = validate(req.body, {
    plan: { type: 'enum', values: PUBLIC_PLANS, required: true, label: 'Plan' },
    months: { type: 'enum', values: ['1', '3', '12'], required: true, label: 'Months' },
    code: { type: 'string', max: 64, label: 'Coupon code' },
  });
  // Checked before the code, so while online payment is off the reply never says whether a code exists.
  if (!billing.enabled()) throw billingOff();
  const { rows: [org] } = await query('SELECT organization_id, plan, is_demo, paid_until FROM organizations WHERE organization_id = $1', [req.user.organization_id]);
  const q = await coupons.resolve(pool, { org, code: body.code, plan: body.plan, months: body.months });
  // The same refusal checkout gives, so the preview and the checkout can't disagree.
  const ahead = billing.couponAheadError(org, q);
  if (ahead) throw ahead;
  res.json({
    coupon: q.coupon ? { ...couponView(q.coupon, q.monthsLeft), source: q.source } : null,
    plan: body.plan,
    months: Number(body.months),
    list_amount: coupons.toPesos(q.listC),
    discount_amount: coupons.toPesos(q.discountC),
    amount: coupons.toPesos(q.amountC),
    covered_months: q.covered,
    free: q.free,
    card_only: q.cardOnly,
    min_charge_applied: q.minChargeApplied,
    message: q.message,
  });
}));

router.post('/billing/checkout', owners, checkoutLimiter, onlyWithCode(codeIpLimiter), onlyWithCode(codeLimiter), ah(async (req, res) => {
  // With a code, a comped workspace hears the coupon reason from coupons.resolve instead.
  if (req.user.plan === 'comped' && !req.body?.coupon_code) throw new HttpError(409, 'Your workspace is on a complimentary plan, so there is nothing to pay.', { code: 'COMPED' });
  if (!billing.enabled()) throw billingOff();
  const body = validate(req.body, {
    plan: { type: 'enum', values: PUBLIC_PLANS, required: true, label: 'Plan' },
    months: { type: 'enum', values: ['1', '3', '12'], required: true, label: 'Months' },
    coupon_code: { type: 'string', max: 64, label: 'Coupon code' },
  });
  try {
    res.json(await billing.createCheckout(req.user, body.plan, Number(body.months), { couponCode: body.coupon_code }));
  } catch (err) {
    if (err.status === 502) throw new HttpError(502, err.message, { code: 'BILLING_FAILED' });
    throw err;
  }
}));

// After returning from PayMongo: ask PayMongo whether it was paid.
router.post('/billing/:id/refresh', owners, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { rows: [b] } = await query('SELECT billing_id FROM billing_payments WHERE billing_id = $1 AND organization_id = $2', [id, req.user.organization_id]);
  if (!b) throw notFound();
  let status;
  try { status = await billing.refresh(id); } catch { status = 'pending'; }
  res.json({ status });
}));

// PayMongo webhook (mounted outside /api's JSON parser: the signature covers the raw body).
async function webhook(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'bad json' }); }
  const attrs = event?.data?.attributes || {};
  if (!billing.verifySignature(req.get('Paymongo-Signature'), raw, Boolean(attrs.livemode))) {
    return res.status(401).json({ error: 'bad signature' });
  }
  if (attrs.type === 'checkout_session.payment.paid') {
    const session = attrs.data || {};
    const ref = session.attributes?.reference_number || session.attributes?.metadata?.billing_id;
    const { rows: [b] } = await query('SELECT billing_id FROM billing_payments WHERE checkout_id = $1 OR billing_id::text = $2 LIMIT 1',
      [String(session.id || ''), /^[0-9a-f-]{36}$/i.test(String(ref || '')) ? String(ref) : '00000000-0000-0000-0000-000000000000']);
    // Never trust the webhook body: confirm with PayMongo using our secret key.
    if (b) await billing.refresh(b.billing_id).catch((err) => console.error('[billing] webhook refresh failed:', err.message));
  }
  res.json({ ok: true });
}

module.exports = { router, webhook };
