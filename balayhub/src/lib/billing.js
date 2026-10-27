'use strict';

// Online plan payments through PayMongo hosted checkout (GCash, Maya, cards,
// GrabPay). A payment is only ever trusted after BalayHub asks PayMongo for the
// checkout's status with the secret key; webhooks just tell us when to ask.

const crypto = require('crypto');
const config = require('../config');
const { pool, tx, one, query } = require('../db');
const { PLANS, trialEndsAt } = require('./plans');
const { audit } = require('./audit');
const { HttpError } = require('./http');
const { fmtPeso } = require('./messaging');
const coupons = require('./coupons');
const cardcheck = require('./cardcheck');
const { toCentavos, toPesos } = coupons;

const MONTH_OPTIONS = { 1: 1, 3: 3, 12: 10 }; // months → months charged (12 months = 2 free)

// How long a one-tap charge may wait for the bank before a new one is allowed.
const PENDING_MINUTES = 15;

// A one-tap charge waits this long after any paid plan payment: a second press on the redrawn page is not a second month (D-122).
const JUST_PAID_SECONDS = 60;

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

// An unfinished charge that PayMongo has given up on: the bank step failed, or the intent was cancelled (either spelling).
const intentFailed = (iv) => ['cancelled', 'canceled', 'failed'].includes(iv.status) || (iv.status === 'awaiting_payment_method' && Boolean(iv.errorCode));

// Give up an abandoned one-tap charge (past the in-progress window): cancel it at PayMongo, then read it again. Only an
// intent PayMongo shows as dead (cancelled, or declined) is expired and gives its coupon slot back; one that is still
// processing, succeeded, waiting on the bank or unreadable stays pending, so a late payment can never land on a released coupon.
async function expirePending(b) {
  try { await paymongo('POST', `/payment_intents/${encodeURIComponent(b.payment_intent_id)}/cancel`); } catch { /* read it again below */ }
  let iv;
  try { iv = await paymongoClient.getPaymentIntent(config.paymongoSecretKey, b.payment_intent_id); } catch { return; }
  if (!intentFailed(iv)) { console.error(`[billing] intent for ${b.billing_id} still ${iv.status} after cancel`); return; }
  await query(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1 AND status = 'pending'`, [b.billing_id]);
  await coupons.releaseIfUnused(pool, b.coupon_redemption_id);
}

// Settle a workspace's open one-tap charges before anything is priced: ask PayMongo about each (a failed one is released by
// refresh), then expire the ones still waiting past the 15-minute window. Called before the workspace row is locked, since
// markPaid locks it too. Errors from PayMongo leave a row as it was.
async function settlePending(orgId, { force = false } = {}) {
  if (!enabled()) return false;
  let paid = false;
  const { rows } = await query(
    `SELECT * FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'pending' AND provider = 'paymongo_intent'
        AND payment_intent_id IS NOT NULL`, [orgId]);
  for (const b of rows) {
    let st = 'pending';
    try { st = await refresh(b.billing_id); } catch { /* try again on the next charge */ }
    if (st === 'paid') paid = true;
    if (st === 'pending' && (force || Date.now() - new Date(b.created_at).getTime() > PENDING_MINUTES * 60000)) await expirePending(b);
  }
  return paid;
}

// Before any new charge: ask PayMongo to end each open hosted checkout of the workspace, then read it again. One that
// PayMongo shows paid, expired or unreadable is settled by refresh; one still open keeps its row and blocks the charge.
async function settleHosted(orgId) {
  if (!enabled()) return false;
  let paid = false;
  const { rows } = await query(
    `SELECT billing_id, checkout_id FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'pending'
        AND provider = 'paymongo' AND checkout_id IS NOT NULL`, [orgId]);
  for (const b of rows) {
    try { await paymongo('POST', `/checkout_sessions/${encodeURIComponent(b.checkout_id)}/expire`); } catch { /* read it again below */ }
    try { if (await refresh(b.billing_id) === 'paid') paid = true; } catch { /* still open */ }
  }
  return paid;
}

const paymentReceived = () => new HttpError(409, 'That payment was just received. Check your plan before paying again.', { code: 'PAYMENT_RECEIVED' });
// The same refusal after a free activation (a ₱0 coupon row), which is not a payment received: it names what happened (D-115, D-132).
const freeActivated = () => new HttpError(409, 'Your free plan was just activated. Check your plan before paying again.', { code: 'PAYMENT_RECEIVED' });
const justDone = (row) => (row.provider === 'coupon' ? freeActivated() : paymentReceived());

// A workspace scheduled for deletion takes no plan payment: the money would be taken for a workspace the deletion job
// removes. The owner cancels the deletion first (D-116). The routes refuse earlier; this is the check under the lock.
const DELETING_PAY = 'This workspace is scheduled for deletion, so plan payments are turned off. Cancel the deletion first, then pay.';
const deletingRefusal = () => new HttpError(409, DELETING_PAY, { code: 'DELETION_SCHEDULED' });

// The first half of every charge: resolve the coupon, hold its slot and write the pending billing row. The workspace row
// is locked so two charges can't both take the last slot of a coupon. A free quote is recorded as provider 'coupon'.
async function prepareCharge(user, plan, months, { couponCode, provider, seenPaidUntil }) {
  // The page says which "paid until" it showed. If the workspace has moved on (paid in another tab), nothing new starts.
  // undefined = the caller sent none (an API caller): no check.
  const stale = (o) => seenPaidUntil !== undefined && (o.paid_until ? String(o.paid_until).slice(0, 10) : null) !== seenPaidUntil;
  if (stale(await one('SELECT paid_until FROM organizations WHERE organization_id = $1', [user.organization_id]))) throw paymentReceived();
  // No plan charge starts while another is open: a one-tap charge waiting at the bank is cancelled first, an open hosted
  // checkout is expired first, and either proceeds only if PayMongo shows the older one dead. If the older one turns out
  // paid, nothing new starts.
  const { rows: [{ t: startedAt }] } = await query('SELECT clock_timestamp() AS t');
  const paidIntent = await settlePending(user.organization_id, { force: provider === 'paymongo' });
  const paidHosted = await settleHosted(user.organization_id);
  if (paidIntent || paidHosted) throw paymentReceived();
  return tx(async (db) => {
    const { rows: [org] } = await db.query(
      'SELECT organization_id, plan, is_demo, trial_ends_at, paid_until, deletion_scheduled_at FROM organizations WHERE organization_id = $1 FOR UPDATE',
      [user.organization_id]);
    if (org.deletion_scheduled_at) throw deletingRefusal();
    // A refusal because another payment is open reads as "received" when a plan payment was marked paid a moment ago:
    // the other tab's payment just finished, so "try again" would mislead. Which requests are refused does not change.
    // A free activation (a ₱0 coupon row) is not a payment received: another tab's activation is caught by the stale check (D-115).
    const { rows: [justPaid] } = await db.query(
      `SELECT 1 FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'paid' AND provider <> 'coupon' AND paid_at > now() - interval '2 minutes'`, [user.organization_id]);
    const openError = (message) => (justPaid || stale(org) ? paymentReceived() : new HttpError(409, message, { code: 'PAYMENT_IN_PROGRESS' }));
    // A free activation is written pending and marked paid in its own transaction; until then it is an open payment too
    // (BIL-1, D-108). Bounded to 2 minutes so a row left pending by a crash never blocks for long.
    const { rows: [freeOpen] } = await db.query(
      `SELECT 1 FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'pending' AND provider = 'coupon'
          AND created_at > now() - interval '2 minutes'`, [user.organization_id]);
    if (freeOpen) throw openError('A payment is already in progress. Try again in a moment.');
    if (provider === 'paymongo_intent') {
      // A pay-saved charge that is still waiting (3-D Secure, processing) must not be followed by a second charge.
      const { rows: [busy] } = await db.query(
        `SELECT CEIL(EXTRACT(EPOCH FROM created_at + make_interval(mins => $2) - now()) / 60)::int AS mins FROM billing_payments
          WHERE organization_id = $1 AND kind = 'plan' AND status = 'pending' AND provider = 'paymongo_intent'
          ORDER BY created_at DESC LIMIT 1`, [user.organization_id, PENDING_MINUTES]);
      if (busy) {
        // Past the window the row is still open because PayMongo shows it open (or could not be read): no minutes to name.
        if (busy.mins <= 0) throw openError("We're still waiting for your bank to finish an earlier payment. Pay another way, or try again later.");
        throw openError(`A payment is already in progress. Try again in ${busy.mins} minute${busy.mins === 1 ? '' : 's'}.`);
      }
    }
    if (stale(org)) throw paymentReceived();
    // A one-tap charge right after a paid plan payment is the same press again (a double click or Enter on the redrawn
    // page), not a new month: refused under the lock for a minute. Paying ahead from a fresh page works after that (D-122).
    if (provider === 'paymongo_intent') {
      const { rows: [recent] } = await db.query(
        `SELECT provider FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'paid'
            AND paid_at > now() - make_interval(secs => $2) ORDER BY provider = 'coupon' LIMIT 1`, [user.organization_id, JUST_PAID_SECONDS]);
      if (recent) throw justDone(recent);
    }
    // A plan payment that landed after this request started (a webhook or another tab) also stops it.
    const { rows: [landed] } = await db.query(
      `SELECT provider FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'paid' AND paid_at > $2
        ORDER BY provider = 'coupon' LIMIT 1`, [user.organization_id, startedAt]);
    if (landed) throw justDone(landed);
    if (provider === 'paymongo') {
      const { rows: [openHosted] } = await db.query(
        `SELECT 1 FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'pending' AND provider = 'paymongo'`, [user.organization_id]);
      if (openHosted) throw openError('A payment is already open in another window. Finish it there, or try again later.');
      const { rows: [waiting] } = await db.query(
        `SELECT 1 FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'pending' AND provider = 'paymongo_intent'`, [user.organization_id]);
      if (waiting) throw openError('A payment is still waiting for your bank. Finish it there, or try again later.');
    } else if (provider === 'paymongo_intent') {
      const { rows: [open] } = await db.query(
        `SELECT 1 FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'pending' AND provider = 'paymongo'`, [user.organization_id]);
      if (open) throw openError('A payment is already open in another window. Finish it there, or try again later.');
    }
    const q = await coupons.resolve(db, { org, code: couponCode, plan, months });
    const ahead = couponAheadError(org, q);
    if (ahead) throw ahead;
    // A charge that covers no months holds no coupon slot.
    const redemptionId = q.covered > 0
      ? await coupons.reserve(db, { org, userId: user.user_id, coupon: q.coupon, redemption: q.redemption })
      : null;
    const { rows: [billing] } = await db.query(
      `INSERT INTO billing_payments (organization_id, plan, months, amount, list_amount, discount_amount, coupon_redemption_id, coupon_months, provider, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [user.organization_id, plan, months, toPesos(q.amountC), toPesos(q.listC), toPesos(q.discountC), redemptionId, q.covered,
        q.free ? 'coupon' : provider, user.user_id]);
    return { billing, q, redemptionId };
  });
}

// A coupon made the period free: apply it with no payment.
async function activateFree(user, billing, redemptionId, plan) {
  try {
    await markPaid(billing.billing_id, { method: 'coupon' });
  } catch (err) {
    await failCheckout(billing.billing_id, redemptionId);
    throw err;
  }
  const { rows: [org] } = await query('SELECT paid_until FROM organizations WHERE organization_id = $1', [user.organization_id]);
  return { billing_id: billing.billing_id, activated: true, plan, paid_until: org.paid_until };
}

// Start a PayMongo checkout, or activate the period with no payment when a coupon makes it free. The coupon code is
// optional: a workspace that already holds a coupon keeps its discount on later checkouts (see coupons.resolve).
async function createCheckout(user, plan, months, { couponCode, seenPaidUntil } = {}) {
  const { billing, q, redemptionId } = await prepareCharge(user, plan, months, { couponCode, provider: 'paymongo', seenPaidUntil });
  if (q.free) return activateFree(user, billing, redemptionId, plan);
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

// R3 switch: set to false if PayMongo cannot charge a saved card from a Payment Intent.
const SAVED_CARD_PAY = true;
const noSavedCard = () => new HttpError(409, 'There is no saved card. Pay another way.', { code: 'SAVED_CARD_NONE' });

// Stage 1 one-tap pay: charge the saved card through a card-only Payment Intent with the host present (the bank may ask
// for 3-D Secure). Same coupon rules as createCheckout. A card that can't be charged answers 402 SAVED_CARD_FAILED.
async function paySaved(user, plan, months, { couponCode, seenPaidUntil } = {}) {
  const org = await one('SELECT card_payment_method_id FROM organizations WHERE organization_id = $1', [user.organization_id]);
  if (!SAVED_CARD_PAY || !org?.card_payment_method_id) throw noSavedCard();
  const { billing, q, redemptionId } = await prepareCharge(user, plan, months, { couponCode, provider: 'paymongo_intent', seenPaidUntil });
  if (q.free) return activateFree(user, billing, redemptionId, plan);
  const id = billing.billing_id;
  const label = `BalayHub ${PLANS[plan].name} — ${months} month${months > 1 ? 's' : ''}`;
  let iv;
  try {
    const pi = await paymongoClient.createPaymentIntent(config.paymongoSecretKey, {
      amountC: q.amountC,
      description: `${label} for ${user.organization_name}`,
      metadata: { billing_id: id, organization_id: user.organization_id, kind: 'plan' },
    });
    await query('UPDATE billing_payments SET payment_intent_id = $2 WHERE billing_id = $1', [id, pi.id]);
    iv = await paymongoClient.attachPaymentIntent(config.paymongoSecretKey, pi.id, {
      paymentMethodId: org.card_payment_method_id, returnUrl: `${config.appUrl}/#/settings?billing=${id}`,
    });
  } catch (err) {
    await failCheckout(id, redemptionId);
    throw err;
  }
  await audit(null, user, 'billing.pay_saved_started', 'billing_payment', id, { plan, months, amount: toPesos(q.amountC) });
  if (iv.status === 'succeeded') {
    if (await refresh(id) === 'paid') {
      const { rows: [o] } = await query('SELECT paid_until FROM organizations WHERE organization_id = $1', [user.organization_id]);
      return { billing_id: id, status: 'paid', paid_until: o.paid_until };
    }
    return { billing_id: id, status: 'pending' };
  }
  if (iv.status === 'awaiting_next_action' && iv.redirectUrl && cardcheck.safeRedirect(iv.redirectUrl)) return { billing_id: id, status: 'action_required', redirect_url: iv.redirectUrl };
  if (iv.status === 'processing') return { billing_id: id, status: 'pending' };
  await failCheckout(id, redemptionId);
  throw new HttpError(402, "Your saved card couldn't be charged. Pay another way, or use a different card.", { code: 'SAVED_CARD_FAILED' });
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

// Days left on the old plan become days on the new one: paid days at the price ratio, free days at most day for day.
// paidDays may be fractional (a day half paid by a coupon counts 0.5); the 1e-9 absorbs float noise before the floor.
function convertDays({ paidDays, freeDays, oldPrice, newPrice }) {
  return Math.floor((paidDays * oldPrice) / newPrice + 1e-9) + Math.floor(freeDays * Math.min(1, oldPrice / newPrice) + 1e-9);
}

// Apply a confirmed payment once: switch the plan and extend "paid until".
async function markPaid(billingId, { method } = {}) {
  return tx(async (db) => {
    const { rows: [b] } = await db.query('SELECT * FROM billing_payments WHERE billing_id = $1 FOR UPDATE', [billingId]);
    if (!b || b.status === 'paid') return false;
    const { rows: [org] } = await db.query('SELECT plan, paid_until, trial_ends_at, created_at, card_brand, card_last4 FROM organizations WHERE organization_id = $1 FOR UPDATE', [b.organization_id]);
    const today = manilaToday();
    const paidUntil = org.paid_until ? String(org.paid_until).slice(0, 10) : null;
    let start = today;
    let bonusDays = 0;
    const trialEnd = org.plan === 'trial' ? trialEndsAt(org) : null;
    if (trialEnd && trialEnd > new Date()) {
      // Paying during the trial keeps the remaining trial days.
      start = new Date(trialEnd.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    } else if (paidUntil && paidUntil >= today && PLANS[org.plan]?.price) {
      if (org.plan === b.plan) {
        start = dayAfter(paidUntil); // renewing early adds on to the current period
      } else {
        // Changing plan: the new plan starts today, and the unused days of the old
        // plan are converted at the two plans' prices.
        // Only days someone paid for convert at the price ratio; free days (coupon, trial) never grow. period_end is inclusive.
        // A day counts by the share actually paid, min(1, amount / list_amount) of the row covering it (highest row wins;
        // no list_amount means full price), so a half-price period is worth half its days.
        const remaining = daysBetween(today, paidUntil) + 1;
        const { rows: [{ n }] } = await db.query(
          `SELECT COALESCE(SUM(share), 0)::float8 AS n FROM (
             SELECT MAX(LEAST(1, p.amount / COALESCE(p.list_amount, p.amount))) AS share
               FROM generate_series($2::date, $3::date, '1 day') d
               JOIN billing_payments p ON d BETWEEN p.period_start AND p.period_end
              WHERE p.organization_id = $1 AND p.kind = 'plan' AND p.status = 'paid' AND p.amount > 0 AND p.billing_id <> $4
              GROUP BY d) s`,
          [b.organization_id, today, paidUntil, b.billing_id]);
        bonusDays = convertDays({ paidDays: n, freeDays: remaining - n, oldPrice: PLANS[org.plan].price, newPrice: PLANS[b.plan].price });
      }
    }
    const end = addDays(periodEnd(start, b.months), bonusDays);
    await db.query(
      `UPDATE billing_payments SET status = 'paid', paid_at = now(), period_start = $2, period_end = $3, payment_method = $4, card_brand = $5, card_last4 = $6 WHERE billing_id = $1`,
      [b.billing_id, start, end, method || null, ...(b.provider === 'paymongo_intent' ? [org.card_brand, org.card_last4] : [null, null])]);
    await db.query(`UPDATE organizations SET plan = $2, paid_until = $3 WHERE organization_id = $1`, [b.organization_id, b.plan, end]);
    const redemptionId = await coupons.reclaim(db, b);
    if (redemptionId !== b.coupon_redemption_id) await db.query('UPDATE billing_payments SET coupon_redemption_id = $2 WHERE billing_id = $1', [b.billing_id, redemptionId]);
    await coupons.applyPaid(db, { ...b, coupon_redemption_id: redemptionId });
    await audit(db, { organization_id: b.organization_id, user_id: b.created_by }, 'billing.paid', 'billing_payment', b.billing_id,
      { plan: b.plan, months: b.months, amount: b.amount, paid_until: end });
    return true;
  });
}

// A one-tap (Payment Intent) charge: paid only when the intent succeeded for this amount and names this row.
async function refreshIntent(b) {
  const iv = await paymongoClient.getPaymentIntent(config.paymongoSecretKey, b.payment_intent_id);
  const expected = toCentavos(b.amount);
  if (iv.status === 'succeeded') {
    if (iv.amountC === expected && iv.metadata?.billing_id === b.billing_id && iv.metadata?.organization_id === b.organization_id) {
      await markPaid(b.billing_id, { method: 'card' });
      return 'paid';
    }
    console.error(`[billing] intent mismatch on ${b.billing_id}: expected ${expected}, got ${iv.amountC}`);
  } else if (b.status !== 'expired' && intentFailed(iv)) {
    await failCheckout(b.billing_id, b.coupon_redemption_id);
    return 'failed';
  }
  return b.status === 'expired' ? 'expired' : 'pending';
}

// Ask PayMongo for the real status of a charge and apply it. Card checks are cardcheck's job.
async function refresh(billingId) {
  const b = await one('SELECT * FROM billing_payments WHERE billing_id = $1', [billingId]);
  if (b?.kind === 'card_check') return cardcheck.refresh(billingId);
  // Expired rows are checked too: a payment can complete just before expiry.
  if (!b || !['pending', 'expired'].includes(b.status) || !(b.checkout_id || b.payment_intent_id) || !enabled()) return b?.status || null;
  await query('UPDATE billing_payments SET last_checked_at = now() WHERE billing_id = $1', [b.billing_id]);
  if (b.payment_intent_id) return refreshIntent(b);
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
    `SELECT billing_id FROM billing_payments WHERE status = 'pending' AND kind = 'plan' AND (checkout_id IS NOT NULL OR payment_intent_id IS NOT NULL)
      ORDER BY last_checked_at NULLS FIRST, created_at DESC LIMIT 20`);
  let paid = 0;
  for (const r of rows) {
    try { if (await refresh(r.billing_id) === 'paid') paid += 1; } catch { /* try again next time */ }
  }
  // Give up on checkouts older than 2 days, after one last check each.
  const { rows: old } = await query(
    `SELECT * FROM billing_payments WHERE status = 'pending' AND kind = 'plan' AND created_at < now() - interval '2 days'
      ORDER BY last_checked_at NULLS FIRST LIMIT 20`);
  for (const r of old) {
    let st = 'pending';
    try { st = await refresh(r.billing_id); } catch { continue; }
    if (st === 'paid') paid += 1;
    // A one-tap charge is expired only when PayMongo shows it dead; one still open or unreadable keeps its row and coupon.
    else if (r.payment_intent_id) { if (st === 'pending') await expirePending(r); }
    else await query(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1 AND status = 'pending'`, [r.billing_id]);
  }
  // Coupon slots held for two days by checkouts that never got a payment go back to the coupon.
  await query(
    `UPDATE platform_coupon_redemptions r SET status = 'released', released_at = now()
      WHERE r.status = 'pending' AND r.created_at < now() - interval '2 days'
        AND NOT EXISTS (SELECT 1 FROM billing_payments b WHERE b.coupon_redemption_id = r.redemption_id AND b.status IN ('paid', 'pending'))`);
  await cardcheck.reconcile();
  return paid;
}

// Day automatic payment would next charge: the day after the paid period (or the trial) ends. Manila date text.
function nextChargeOn(org) {
  const last = org.plan !== 'trial' && org.paid_until ? String(org.paid_until).slice(0, 10)
    : org.trial_ends_at ? new Date(new Date(org.trial_ends_at).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10) : null;
  return last ? dayAfter(last) : null;
}

module.exports = { convertDays, SAVED_CARD_PAY, PENDING_MINUTES, JUST_PAID_SECONDS, paySaved, settlePending, nextChargeOn, periodEnd, enabled, price, MONTH_OPTIONS, createCheckout, refresh, markPaid, verifySignature, reconcile, addMonths, couponAheadError, DELETING_PAY };
