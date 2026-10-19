'use strict';

// Card on file before the free trial (D-98). A new workspace pays ₱20 by card through a PayMongo Payment Intent that
// saves the card to a PayMongo customer; the 14-day trial starts when that payment succeeds. The card number goes
// from the browser straight to PayMongo: this file only ever sees PayMongo ids, the brand and the last 4 digits.
// A payment is trusted only after BalayHub re-reads the Payment Intent with the secret key.

const config = require('../config');
const { pool, tx, one, query } = require('../db');
const { PLANS, PUBLIC_PLANS } = require('./plans');
const { audit } = require('./audit');
const { HttpError } = require('./http');
const coupons = require('./coupons');
const paymongo = require('./paymongo');

const CARD_CHECK_C = coupons.MIN_CHARGE_C; // ₱20, fixed on the server
const CARD_CHECK_PESOS = coupons.toPesos(CARD_CHECK_C);
const STALE_HOURS = 24;

const sk = () => config.paymongoSecretKey;
const enabled = () => Boolean(config.paymongoSecretKey && config.paymongoPublicKey) && config.cardCheck !== 'off';

// The state a brand-new workspace starts in: gated, or null (today's behaviour: the trial starts at creation).
function initialState(user) {
  if (!enabled()) return null;
  if (user?.email_verified_at && config.platformAdmins.includes(String(user.email || '').toLowerCase())) return null;
  return 'required';
}

const status = (org) => (['required', 'passed', 'waived'].includes(org?.card_check) ? org.card_check : 'not_required');

const notRequired = (org) => new HttpError(409,
  org.card_check === 'passed' ? 'Your card is already confirmed.' : "Your workspace doesn't need a card check.",
  { code: 'CARD_CHECK_NOT_REQUIRED' });

const manilaDatePlus = (days) => new Date(Date.now() + 8 * 3600 * 1000 + days * 86400000).toISOString().slice(0, 10);

function declineMessage(code) {
  if (/three_d|3ds|authenticat/i.test(String(code || ''))) return "Your bank's check wasn't finished, so nothing was charged. Try again.";
  return 'Your card was declined. Try another card, or ask your bank.';
}

function nameParts(user) {
  const parts = String(user.full_name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || 'BalayHub';
  return { firstName, lastName: parts.slice(1).join(' ') || firstName, email: user.email, phone: user.phone || undefined };
}

// The 3-D Secure page must be https (a local http loopback is accepted outside production, for the harness).
function safeRedirect(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'https:') return true;
  return !config.isProd && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
}

const liveCheck = (db, orgId) => db.query(
  `SELECT * FROM billing_payments WHERE organization_id = $1 AND kind = 'card_check' AND status = 'pending'`, [orgId]).then((r) => r.rows[0]);

// Body of GET /billing/card-check.
async function view(user) {
  const org = await one('SELECT * FROM organizations WHERE organization_id = $1', [user.organization_id]);
  const st = status(org);
  let live = st === 'required' ? await liveCheck({ query }, org.organization_id) : null;
  // A payment that went through at the bank while this page failed to refresh is applied now, so a reload shows the truth.
  // Not more than once every 5 seconds per check: every page load would otherwise call PayMongo.
  if (live?.payment_intent_id && !(live.last_checked_at && Date.now() - new Date(live.last_checked_at).getTime() < 5000)) {
    try {
      if (await refresh(live.billing_id) === 'passed') return view(user);
    } catch { /* PayMongo unreachable: show it as still pending */ }
    live = await liveCheck({ query }, org.organization_id);
  }
  const out = {
    required: st === 'required',
    status: st,
    amount: CARD_CHECK_PESOS,
    trial_days: config.trialDays,
    trial_would_end: manilaDatePlus(config.trialDays),
    subscriptions: config.paymongoSubscriptions,
    plans: PUBLIC_PLANS.map((key) => ({ key, name: PLANS[key].name, price: PLANS[key].price })),
    renewal_plan: org.renewal_plan || 'growth',
    pending: live ? { billing_id: live.billing_id, status: 'pending' } : null,
  };
  if (st === 'required') {
    out.public_key = config.paymongoPublicKey;
    out.paymongo_api = config.paymongoBrowserApi;
  }
  return out;
}

// Create (or reuse) the workspace's one pending card check and its Payment Intent.
async function start(user, { renewalPlan, consent } = {}) {
  if (!enabled()) throw new HttpError(409, 'Card checks are off right now. Please try again later.', { code: 'CARD_CHECK_OFF' });
  if (config.paymongoSubscriptions && consent !== true) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { consent: 'Tick the box to agree to automatic payment.' } });
  }
  // Money safety: before any new Payment Intent, settle the earlier one. It may already have been paid (the page failed
  // to refresh), so a second charge must not start. This runs before the lock below because markPassed takes the same lock.
  const prior = await liveCheck({ query }, user.organization_id);
  if (prior?.payment_intent_id) {
    let st;
    try { st = await refresh(prior.billing_id); } catch (err) {
      // 404: the intent is gone at PayMongo (test keys swapped for live keys), so it can never be paid: retire it.
      // A network failure, a 5xx or a rejected key says nothing about the intent: stay safe and charge nothing.
      if (err.httpStatus !== 404) {
        throw new HttpError(503, "We couldn't reach our payment provider to check your earlier payment, so nothing was charged. Please try again in a minute.", { code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
      }
      st = 'gone';
      await query(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1 AND status = 'pending'`, [prior.billing_id]);
    }
    if (st === 'passed') {
      return { billing_id: prior.billing_id, amount: CARD_CHECK_PESOS, status: 'passed', trial_ends_at: await trialEnd(user.organization_id) };
    }
    // A declined or cancelled intent was never charged: retire it so a fresh one is made below. The row is locked and
    // PayMongo re-read under the lock, so a second tab that is paying this same intent right now is not retired.
    // (Lock order row then workspace matches markPassed; this transaction never takes the workspace lock.)
    if (st === 'failed') {
      const retired = await tx(async (db) => {
        const { rows: [row] } = await db.query(`SELECT status FROM billing_payments WHERE billing_id = $1 FOR UPDATE`, [prior.billing_id]);
        if (row?.status !== 'pending') return 'moved';
        const iv = await paymongo.getPaymentIntent(sk(), prior.payment_intent_id);
        if (iv.status === 'awaiting_payment_method' && iv.errorCode) {
          await db.query(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1 AND status = 'pending'`, [prior.billing_id]);
          return 'expired';
        }
        return iv.status;
      }).catch(() => null);
      if (retired === null) {
        throw new HttpError(503, "We couldn't reach our payment provider to check your earlier payment, so nothing was charged. Please try again in a minute.", { code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
      }
      if (retired === 'succeeded' || retired === 'moved') {
        // Paid (or settled) in the meantime: let refresh apply it, and answer from the result.
        if (await refresh(prior.billing_id).catch(() => null) === 'passed') {
          return { billing_id: prior.billing_id, amount: CARD_CHECK_PESOS, status: 'passed', trial_ends_at: await trialEnd(user.organization_id) };
        }
      }
    }
  }
  // The PayMongo calls run inside the transaction holding the workspace lock on purpose: two parallel starts can't make
  // two intents, and a PayMongo error rolls the new row back.
  return tx(async (db) => {
    const { rows: [org] } = await db.query('SELECT * FROM organizations WHERE organization_id = $1 FOR UPDATE', [user.organization_id]);
    if (org.card_check !== 'required') throw notRequired(org);
    const auto = Boolean(config.paymongoSubscriptions && consent);
    await db.query(
      `UPDATE organizations SET renewal_plan = $2, auto_renew = $3,
         auto_renew_consented_at = CASE WHEN $3 THEN now() ELSE auto_renew_consented_at END WHERE organization_id = $1`,
      [org.organization_id, renewalPlan, auto]);
    const live = await liveCheck(db, org.organization_id);
    if (live) return { billing_id: live.billing_id, amount: CARD_CHECK_PESOS };
    let customerId = org.paymongo_customer_id;
    if (!customerId) {
      customerId = await paymongo.createCustomer(sk(), nameParts(user));
      await db.query('UPDATE organizations SET paymongo_customer_id = $2 WHERE organization_id = $1', [org.organization_id, customerId]);
    }
    const { rows: [b] } = await db.query(
      `INSERT INTO billing_payments (organization_id, kind, amount, list_amount, discount_amount, provider, created_by)
       VALUES ($1, 'card_check', $2, $2, 0, 'paymongo_intent', $3) RETURNING billing_id`,
      [org.organization_id, CARD_CHECK_PESOS, user.user_id]);
    const pi = await paymongo.createPaymentIntent(sk(), {
      amountC: CARD_CHECK_C, description: 'BalayHub card check', customerId,
      metadata: { billing_id: b.billing_id, organization_id: org.organization_id, kind: 'card_check' },
    });
    await db.query('UPDATE billing_payments SET payment_intent_id = $2 WHERE billing_id = $1', [b.billing_id, pi.id]);
    await audit(db, user, 'billing.card_check_started', 'billing_payment', b.billing_id, { renewal_plan: renewalPlan });
    return { billing_id: b.billing_id, amount: CARD_CHECK_PESOS };
  });
}

// The newest card saved on the PayMongo customer (R2), else the one the Payment Intent used.
async function savedCard(customerId, iv) {
  let methods = [];
  try { methods = (await paymongo.listCustomerPaymentMethods(sk(), customerId)).filter((m) => m.type === 'card'); } catch { /* fall back */ }
  const newest = methods.sort((a, b) => b.created_at - a.created_at)[0];
  return {
    pmId: newest?.id || iv.paymentMethodId,
    brand: newest?.brand || iv.brand,
    last4: newest?.last4 || iv.last4,
  };
}

// Apply a succeeded Payment Intent once. Returns true only for the call that started the trial / saved the card.
// With `client` it runs on that open transaction (attach() already holds the billing row lock there); otherwise it opens its own.
async function markPassed(billingId, iv, client) {
  const b = client
    ? (await client.query('SELECT * FROM billing_payments WHERE billing_id = $1', [billingId])).rows[0]
    : await one('SELECT * FROM billing_payments WHERE billing_id = $1', [billingId]);
  if (!b || b.kind !== 'card_check' || b.status === 'paid') return false;
  if (iv.status !== 'succeeded' || iv.amountC !== CARD_CHECK_C
    || iv.metadata?.organization_id !== b.organization_id || iv.metadata?.billing_id !== b.billing_id) {
    console.error(`[cardcheck] mismatch on ${billingId}: status ${iv.status}, amount ${iv.amountC}`);
    return false;
  }
  // On attach()'s transaction, read on that same connection: a second pool connection can stall when the pool is busy.
  const org0 = (await (client || pool).query('SELECT paymongo_customer_id FROM organizations WHERE organization_id = $1', [b.organization_id])).rows[0];
  const card = await savedCard(org0?.paymongo_customer_id, iv);
  const last4 = /^[0-9]{4}$/.test(card.last4 || '') ? card.last4 : null;
  const brand = card.brand ? String(card.brand).slice(0, 20) : null;
  const apply = async (db) => {
    const { rows: [row] } = await db.query('SELECT * FROM billing_payments WHERE billing_id = $1 FOR UPDATE', [billingId]);
    const { rows: [org] } = await db.query('SELECT card_check FROM organizations WHERE organization_id = $1 FOR UPDATE', [b.organization_id]);
    if (row && row.status !== 'paid' && org.card_check === 'passed') {
      console.error(`[cardcheck] card check intent succeeded on a workspace that already passed: org ${b.organization_id}, billing_id ${billingId}, pi ${iv.id} - refund by hand`);
    }
    if (!row || row.status === 'paid' || !['required', 'waived'].includes(org.card_check)) return false;
    const wasRequired = org.card_check === 'required';
    await db.query(
      `UPDATE billing_payments SET status = 'paid', paid_at = now(), payment_method = 'card' WHERE billing_id = $1`, [billingId]);
    // A workspace waived by an admin that pays anyway keeps 'waived' and its trial; the card is still saved.
    await db.query(
      `UPDATE organizations SET
         card_check = CASE WHEN $2 THEN 'passed' ELSE card_check END,
         card_checked_at = CASE WHEN $2 THEN now() ELSE card_checked_at END,
         trial_ends_at = COALESCE(trial_ends_at, now() + make_interval(days => $3)),
         card_payment_method_id = $4, card_brand = $5, card_last4 = $6
       WHERE organization_id = $1`,
      [b.organization_id, wasRequired, config.trialDays, card.pmId, brand, last4]);
    await audit(db, { organization_id: b.organization_id, user_id: b.created_by }, 'billing.card_check_passed', 'billing_payment', billingId, { brand, last4 });
    return true;
  };
  return client ? apply(client) : tx(apply);
}

async function trialEnd(orgId) {
  const o = await one('SELECT trial_ends_at FROM organizations WHERE organization_id = $1', [orgId]);
  return o?.trial_ends_at ? new Date(o.trial_ends_at).toISOString() : null;
}

async function markFailed(user, b, code) {
  await query('UPDATE billing_payments SET failure_code = $2 WHERE billing_id = $1', [b.billing_id, String(code || 'failed').slice(0, 64)]);
  await audit(null, user, 'billing.card_check_failed', 'billing_payment', b.billing_id, { code: code || 'failed' });
  return { status: 'failed', message: declineMessage(code) };
}

// Attach the browser-made payment method to this workspace's Payment Intent and report where it stands.
async function attach(user, billingId, paymentMethodId) {
  // The row is locked while PayMongo is called (bounded by its 20 s timeout), so two tabs can't both attach a card to the
  // same pending check. The outcome is recorded before the lock is released: a success is applied on this transaction
  // (markPassed, row then workspace), and a card handed to the bank is marked on the row (payment_method = 'attached'), so
  // a second tab never attaches a second card to the same Payment Intent.
  const { b, iv } = await tx(async (db) => {
    const { rows: [b] } = await db.query(
      `SELECT * FROM billing_payments WHERE billing_id = $1 AND organization_id = $2 AND kind = 'card_check' FOR UPDATE`, [billingId, user.organization_id]);
    if (!b) throw new HttpError(404, "This record doesn't exist or you don't have permission to view it.", { code: 'NOT_FOUND' });
    const { rows: [org] } = await db.query('SELECT card_check FROM organizations WHERE organization_id = $1', [user.organization_id]);
    if (b.status !== 'pending' || !b.payment_intent_id || !['required', 'waived'].includes(org.card_check)) throw notRequired(org);
    let iv;
    if (b.payment_method === 'attached') {
      // A card is already attached: report where that intent stands; only a bank that gave the intent back allows a new card.
      iv = await paymongo.getPaymentIntent(sk(), b.payment_intent_id);
    }
    if (!iv || iv.status === 'awaiting_payment_method') {
      iv = await paymongo.attachPaymentIntent(sk(), b.payment_intent_id, {
        paymentMethodId, returnUrl: `${config.appUrl}/#/confirm-card?check=${b.billing_id}`,
      });
      // A refused attach (4xx) may mean the intent already moved on: read the real state.
      if (iv.failed) {
        const real = await paymongo.getPaymentIntent(sk(), b.payment_intent_id);
        iv = real.status === 'awaiting_payment_method' && !real.errorCode ? { ...real, errorCode: iv.errorCode } : real;
      }
    }
    if (iv.status === 'succeeded') await markPassed(b.billing_id, iv, db);
    else if (['awaiting_next_action', 'processing'].includes(iv.status)) {
      await db.query(`UPDATE billing_payments SET payment_method = 'attached' WHERE billing_id = $1`, [b.billing_id]);
    }
    return { b, iv };
  });
  if (iv.status === 'succeeded') {
    const done = await one('SELECT status FROM billing_payments WHERE billing_id = $1', [b.billing_id]);
    return done.status === 'paid' ? { status: 'passed', trial_ends_at: await trialEnd(b.organization_id) } : { status: 'pending' };
  }
  if (iv.status === 'awaiting_next_action') {
    if (!iv.redirectUrl || !safeRedirect(iv.redirectUrl)) return markFailed(user, b, 'bad_redirect');
    return { status: 'action_required', redirect_url: iv.redirectUrl };
  }
  if (iv.status === 'processing') return { status: 'pending' };
  return markFailed(user, b, iv.errorCode);
}

// Re-read the Payment Intent and apply it: 'passed' | 'pending' | 'failed' | 'expired'.
async function refresh(billingId) {
  const b = await one(`SELECT * FROM billing_payments WHERE billing_id = $1 AND kind = 'card_check'`, [billingId]);
  if (!b) return 'pending';
  if (b.status === 'paid') return 'passed';
  if (!['pending', 'expired'].includes(b.status) || !b.payment_intent_id) return b.status === 'failed' ? 'failed' : 'expired';
  await query('UPDATE billing_payments SET last_checked_at = now() WHERE billing_id = $1', [b.billing_id]);
  const iv = await paymongo.getPaymentIntent(sk(), b.payment_intent_id);
  if (iv.status === 'succeeded') {
    await markPassed(b.billing_id, iv);
    const done = await one('SELECT status FROM billing_payments WHERE billing_id = $1', [b.billing_id]);
    return done.status === 'paid' ? 'passed' : 'pending';
  }
  if (b.status === 'expired') return 'expired';
  return iv.status === 'awaiting_payment_method' && iv.errorCode ? 'failed' : 'pending';
}

// Admin "Skip card check": the trial starts now and the workspace is never gated.
async function waive(orgId, adminUser) {
  return tx(async (db) => {
    const { rows: [org] } = await db.query('SELECT * FROM organizations WHERE organization_id = $1 FOR UPDATE', [orgId]);
    if (!org) throw new HttpError(404, "This record doesn't exist or you don't have permission to view it.", { code: 'NOT_FOUND' });
    if (org.card_check !== 'required') throw notRequired(org);
    const { rows: [o] } = await db.query(
      `UPDATE organizations SET card_check = 'waived', card_checked_at = now(),
         trial_ends_at = COALESCE(trial_ends_at, now() + make_interval(days => $2)) WHERE organization_id = $1 RETURNING trial_ends_at`,
      [orgId, config.trialDays]);
    await audit(db, { organization_id: orgId, user_id: adminUser?.user_id }, 'platform.card_check_waived', 'organization', orgId);
    return { trial_ends_at: new Date(o.trial_ends_at).toISOString() };
  });
}

// Scheduler: catch up on card checks whose webhook never arrived, then expire the stale ones.
async function reconcile() {
  if (!sk()) return 0;
  const { rows } = await query(
    `SELECT billing_id FROM billing_payments WHERE kind = 'card_check' AND status = 'pending' AND payment_intent_id IS NOT NULL
      ORDER BY last_checked_at NULLS FIRST, created_at DESC LIMIT 20`);
  let passed = 0;
  for (const r of rows) {
    try { if (await refresh(r.billing_id) === 'passed') passed += 1; } catch { /* try again next time */ }
  }
  const { rows: old } = await query(
    `SELECT billing_id FROM billing_payments WHERE kind = 'card_check' AND status = 'pending'
        AND created_at < now() - make_interval(hours => $1) LIMIT 20`, [STALE_HOURS]);
  for (const r of old) {
    let st;
    try { st = await refresh(r.billing_id); } catch (err) { if (err.httpStatus !== 404) continue; }
    if (st === 'passed') passed += 1;
    else await query(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1 AND status = 'pending'`, [r.billing_id]);
  }
  return passed;
}

module.exports = { safeRedirect, CARD_CHECK_C, enabled, initialState, status, view, start, attach, refresh, markPassed, waive, reconcile, declineMessage };
