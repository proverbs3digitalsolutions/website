'use strict';

// Plan payments: start a PayMongo checkout, confirm it, payment history,
// and PayMongo's webhook.

const express = require('express');
const { query } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { requireRole, rateLimit } = require('../lib/auth');
const { PLANS, PUBLIC_PLANS } = require('../lib/plans');
const billing = require('../lib/billing');

const router = express.Router();
const owners = requireRole('owner');

router.get('/billing', owners, ah(async (req, res) => {
  const { rows: history } = await query(
    `SELECT billing_id, plan, months, amount, status, payment_method, paid_at, period_start, period_end, created_at
       FROM billing_payments WHERE organization_id = $1 AND (status = 'paid' OR (status = 'pending' AND checkout_id IS NOT NULL)) ORDER BY created_at DESC LIMIT 50`,
    [req.user.organization_id]);
  res.json({
    online: billing.enabled(),
    options: PUBLIC_PLANS.map((k) => ({
      key: k, name: PLANS[k].name, listings: PLANS[k].listings, ai: PLANS[k].ai,
      prices: Object.keys(billing.MONTH_OPTIONS).map((m) => ({ months: Number(m), amount: billing.price(k, Number(m)) })),
    })),
    history,
  });
}));

const checkoutLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, key: (req) => `checkout|${req.user.organization_id}` });

router.post('/billing/checkout', owners, checkoutLimiter, ah(async (req, res) => {
  if (req.user.plan === 'comped') throw new HttpError(409, 'Your workspace is on a complimentary plan, so there is nothing to pay.', { code: 'COMPED' });
  if (!billing.enabled()) throw new HttpError(409, 'Online payment is not set up yet. Please pay by GCash or bank transfer and contact us.', { code: 'BILLING_OFF' });
  const body = validate(req.body, {
    plan: { type: 'enum', values: PUBLIC_PLANS, required: true, label: 'Plan' },
    months: { type: 'enum', values: ['1', '3', '12'], required: true, label: 'Months' },
  });
  try {
    res.json(await billing.createCheckout(req.user, body.plan, Number(body.months)));
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
