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
const cardcheck = require('../lib/cardcheck');
const config = require('../config');
const paymongoClient = require('../lib/paymongo');
const { audit } = require('../lib/audit');

const router = express.Router();
const owners = requireRole('owner');

// The same message checkout has always given when online payment is off.
const billingOff = () => new HttpError(409, 'Online payment is not set up yet. Please pay by GCash or bank transfer and contact us.', { code: 'BILLING_OFF' });

// A coupon as the owner's box reads it (contract section 2.2). Money stays text, like every other amount.
const couponView = (c, monthsLeft) => ({
  code: c.code, name: c.name, kind: c.kind, percent_off: c.percent_off, amount_off: c.amount_off,
  duration: c.duration, duration_months: c.duration_months, months_left: monthsLeft, plans: c.plans, require_card: c.require_card,
});

// Body of GET /billing (also the answer to PATCH /billing/renewal).
async function billingView(user) {
  const { rows: history } = await query(
    `SELECT b.billing_id, b.kind, b.plan, b.months, b.amount, b.list_amount, b.discount_amount, b.provider, pc.code AS coupon_code,
            b.status, b.payment_method, b.paid_at, b.period_start, b.period_end, b.created_at,
            CASE WHEN b.kind = 'card_check' THEN o.card_brand END AS card_brand,
            CASE WHEN b.kind = 'card_check' THEN o.card_last4 END AS card_last4
       FROM billing_payments b
       JOIN organizations o ON o.organization_id = b.organization_id
       LEFT JOIN platform_coupon_redemptions r ON r.redemption_id = b.coupon_redemption_id
       LEFT JOIN platform_coupons pc ON pc.coupon_id = r.coupon_id
      WHERE b.organization_id = $1 AND (b.status = 'paid' OR (b.status = 'pending' AND b.kind = 'plan' AND b.checkout_id IS NOT NULL))
      ORDER BY b.created_at DESC LIMIT 50`,
    [user.organization_id]);
  const last = await coupons.lastRedemption(pool, user.organization_id);
  const { rows: [org] } = await query(
    `SELECT plan, paid_until, trial_ends_at, card_payment_method_id, card_brand, card_last4, renewal_plan, auto_renew,
            auto_renew_consented_at, subscription_status FROM organizations WHERE organization_id = $1`, [user.organization_id]);
  return {
    online: billing.enabled(),
    card: org.card_payment_method_id ? { brand: org.card_brand, last4: org.card_last4 } : null,
    renewal_plan: org.renewal_plan || 'growth',
    saved_card_pay: Boolean(billing.enabled() && org.card_payment_method_id && billing.SAVED_CARD_PAY),
    subscriptions: config.paymongoSubscriptions,
    auto_renew: {
      on: org.auto_renew, status: org.subscription_status, consented_at: org.auto_renew_consented_at,
      next_charge_on: org.auto_renew ? billing.nextChargeOn(org) : null,
    },
    options: PUBLIC_PLANS.map((k) => ({
      key: k, name: PLANS[k].name, listings: PLANS[k].listings, ai: PLANS[k].ai,
      prices: Object.keys(billing.MONTH_OPTIONS).map((m) => ({ months: Number(m), amount: billing.price(k, Number(m)) })),
    })),
    coupon: last ? { ...couponView(last, last.months_total == null ? null : Math.max(0, last.months_total - last.months_used)), status: last.status } : null,
    history,
  };
}

router.get('/billing', owners, ah(async (req, res) => { res.json(await billingView(req.user)); }));

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

// ---- Card on file (D-98). The card number goes from the browser straight to PayMongo; only the payment method id
// ("pm_...") ever reaches these routes.
const cardStartLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: (req) => `cardstart|${req.user.organization_id}` });
const attachLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 8, failedOnly: true, key: (req) => `cardattach|${req.user.organization_id}` });
const attachIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, failedOnly: true, key: (req) => `cardattachip|${req.ip}` });
// Count every attach (3-D Secure and processing cards answer 200, which the failedOnly limiters give back).
const attachAllLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 20, key: (req) => `cardattachall|${req.user.organization_id}` });
// 60, not 30: Philippine mobile carriers share IPs. Declines still hit the failedOnly IP limiter (30) first.
const attachAllIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `cardattachallip|${req.ip}` });
// The confirm-card page polls every 3 s for 60 s (20 calls), well under.
const cardRefreshLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, key: (req) => `cardrefresh|${req.user.organization_id}` });
const planRefreshLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, key: (req) => `planrefresh|${req.user.organization_id}` });
const withBillingFailed = (err) => (err.status === 502 ? new HttpError(502, 'We couldn\'t reach the payment service. Nothing was charged. Please try again in a moment.', { code: 'BILLING_FAILED' }) : err);
// Stage 2 library, loaded only when needed. Does nothing for a workspace with no live subscription.
async function cancelSubscription(user, reason) {
  try { await require('../lib/subscriptions').cancelForOrg(user.organization_id, user, reason); } catch (err) { throw withBillingFailed(err); }
}
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

router.get('/billing/card-check', owners, ah(async (req, res) => {
  const v = await cardcheck.view(req.user);
  // cardcheck.view is not this lane's file, so the listing limit (for "Up to 2 listings") is added here.
  res.json({ ...v, plans: v.plans.map((p) => ({ ...p, listings: PLANS[p.key].listings })) });
}));

router.post('/billing/card-check/start', owners, cardStartLimiter, ah(async (req, res) => {
  const body = validate(req.body, {
    renewal_plan: { type: 'enum', values: PUBLIC_PLANS, required: true, label: 'Plan' },
    consent: { type: 'bool' },
  });
  try {
    res.json(await cardcheck.start(req.user, { renewalPlan: body.renewal_plan, consent: body.consent }));
  } catch (err) { throw withBillingFailed(err); }
}));

router.post('/billing/card-check/:id/attach', owners, attachAllIpLimiter, attachAllLimiter, attachIpLimiter, attachLimiter, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const pm = req.body?.payment_method_id;
  if (typeof pm !== 'string' || !/^pm_[A-Za-z0-9]{6,64}$/.test(pm)) throw validationError({ payment_method_id: 'Enter your card details again.' });
  let out;
  try { out = await cardcheck.attach(req.user, id, pm); } catch (err) { throw withBillingFailed(err); }
  // 402 for a declined card, so the failedOnly limiters count it.
  res.status(out.status === 'failed' ? 402 : 200).json(out);
}));

router.post('/billing/card-check/:id/refresh', owners, cardRefreshLimiter, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { rows: [b] } = await query(`SELECT billing_id FROM billing_payments WHERE billing_id = $1 AND organization_id = $2 AND kind = 'card_check'`, [id, req.user.organization_id]);
  if (!b) throw notFound();
  let status;
  try { status = await cardcheck.refresh(id); } catch { status = 'pending'; }
  const out = { status };
  if (status === 'passed') {
    const { rows: [o] } = await query('SELECT trial_ends_at FROM organizations WHERE organization_id = $1', [req.user.organization_id]);
    out.trial_ends_at = o.trial_ends_at ? new Date(o.trial_ends_at).toISOString() : null;
  } else if (status === 'failed') out.message = cardcheck.declineMessage();
  res.json(out);
}));

// One tap: charge the saved card for a plan (the same checks and limiters as /billing/checkout).
router.post('/billing/pay-saved', owners, checkoutLimiter, onlyWithCode(codeIpLimiter), onlyWithCode(codeLimiter), ah(async (req, res) => {
  if (req.user.plan === 'comped' && !req.body?.coupon_code) throw new HttpError(409, 'Your workspace is on a complimentary plan, so there is nothing to pay.', { code: 'COMPED' });
  if (!billing.enabled()) throw billingOff();
  const body = validate(req.body, {
    plan: { type: 'enum', values: PUBLIC_PLANS, required: true, label: 'Plan' },
    months: { type: 'enum', values: ['1', '3', '12'], required: true, label: 'Months' },
    coupon_code: { type: 'string', max: 64, label: 'Coupon code' },
  });
  try {
    res.json(await billing.paySaved(req.user, body.plan, Number(body.months), { couponCode: body.coupon_code }));
  } catch (err) { throw withBillingFailed(err); }
}));

// Plan after the trial, and automatic payment on or off. Turning it off also cancels a live PayMongo subscription.
router.patch('/billing/renewal', owners, ah(async (req, res) => {
  const body = validate(req.body, {
    renewal_plan: { type: 'enum', values: PUBLIC_PLANS, label: 'Plan' },
    auto_renew: { type: 'bool' },
    consent: { type: 'bool' },
  });
  const sent = (k) => req.body && Object.prototype.hasOwnProperty.call(req.body, k);
  const { rows: [org] } = await query('SELECT card_payment_method_id, renewal_plan, paymongo_subscription_id FROM organizations WHERE organization_id = $1', [req.user.organization_id]);
  if (sent('auto_renew') && body.auto_renew) {
    if (!config.paymongoSubscriptions) throw new HttpError(409, 'Automatic payment is not available yet.', { code: 'SUBSCRIPTIONS_OFF' });
    if (!org.card_payment_method_id) throw new HttpError(409, 'There is no saved card. Pay another way.', { code: 'SAVED_CARD_NONE' });
    if (!body.consent) throw validationError({ consent: 'Tick the box to agree to automatic payment.' });
  }
  const planChanged = sent('renewal_plan') && body.renewal_plan && body.renewal_plan !== org.renewal_plan;
  const turnOff = sent('auto_renew') && !body.auto_renew;
  // A live subscription is on the old plan or the old choice: cancel it first (the job starts a new one at paid_until).
  if (turnOff || (planChanged && org.paymongo_subscription_id)) await cancelSubscription(req.user, turnOff ? 'automatic payment turned off' : 'plan changed');
  const sets = []; const vals = [req.user.organization_id];
  const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (sent('renewal_plan') && body.renewal_plan) set('renewal_plan', body.renewal_plan);
  if (sent('auto_renew')) {
    set('auto_renew', body.auto_renew);
    if (body.auto_renew) sets.push('auto_renew_consented_at = now()');
  }
  if (sets.length) await query(`UPDATE organizations SET ${sets.join(', ')} WHERE organization_id = $1`, vals);
  await audit(null, req.user, 'billing.renewal_changed', 'organization', req.user.organization_id,
    { renewal_plan: body.renewal_plan || null, auto_renew: sent('auto_renew') ? body.auto_renew : null });
  res.json(await billingView(req.user));
}));

// Forget the saved card (and stop automatic payment). The trial or plan stays.
router.delete('/billing/card', owners, ah(async (req, res) => {
  const orgId = req.user.organization_id;
  const { rows: [org] } = await query('SELECT paymongo_customer_id, card_payment_method_id, paymongo_subscription_id FROM organizations WHERE organization_id = $1', [orgId]);
  await cancelSubscription(req.user, 'card removed');
  await query(`UPDATE organizations SET card_payment_method_id = NULL, card_brand = NULL, card_last4 = NULL, auto_renew = false WHERE organization_id = $1`, [orgId]);
  if (org.card_payment_method_id && org.paymongo_customer_id) {
    await paymongoClient.detachPaymentMethod(config.paymongoSecretKey, org.paymongo_customer_id, org.card_payment_method_id);
  }
  await audit(null, req.user, 'billing.card_removed', 'organization', orgId, {});
  res.json({ ok: true });
}));

// After returning from PayMongo: ask PayMongo whether it was paid.
router.post('/billing/:id/refresh', owners, planRefreshLimiter, ah(async (req, res) => {
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
  if (attrs.type === 'payment.paid' || attrs.type === 'payment.failed') {
    const piId = attrs.data?.attributes?.payment_intent_id;
    if (typeof piId === 'string') {
      const { rows: [b] } = await query('SELECT billing_id FROM billing_payments WHERE payment_intent_id = $1', [piId]);
      // Never trust the webhook body: billing.refresh re-reads the Payment Intent (card checks go to cardcheck.refresh).
      if (b) await billing.refresh(b.billing_id).catch((err) => console.error('[billing] webhook refresh failed:', err.message));
    }
  }
  if (typeof attrs.type === 'string' && attrs.type.startsWith('subscription.') && config.paymongoSubscriptions) {
    await require('../lib/subscriptions').handleEvent(event).catch((err) => console.error('[billing] subscription event failed:', err.message));
  }
  res.json({ ok: true });
}

module.exports = { router, webhook };
