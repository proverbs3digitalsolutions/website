'use strict';

// Stage 2 of card on file (D-98): PayMongo Subscriptions charge the saved card every month. Switched off unless
// PAYMONGO_SUBSCRIPTIONS=on. Endpoint shapes are unconfirmed (research R4), so every one of them lives in this file.
// Webhook bodies are never trusted: each event only tells us what to re-read from PayMongo with the secret key.

const config = require('../config');
const { pool, tx, query } = require('../db');
const { audit } = require('./audit');
const { sendMail } = require('./mailer');
const { PLANS } = require('./plans');
const coupons = require('./coupons');
const paymongo = require('./paymongo');
const { toPesos } = coupons;

const call = (method, path, body) => paymongo.request(config.paymongoSecretKey, method, path, body);
// billing.js requires this module lazily, so read it when called.
const billing = () => require('./billing');

const enabled = () => Boolean(config.paymongoSubscriptions) && billing().enabled();
const listC = (plan) => Math.round(billing().price(plan, 1) * 100);
const manilaDay = (offsetDays = 0) => new Date(Date.now() + 8 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const nice = (d) => new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const STATUS = { active: 'active', past_due: 'past_due', unpaid: 'unpaid', cancelled: 'cancelled', canceled: 'cancelled', incomplete: 'incomplete' };

// The PayMongo plan for a BalayHub plan at a price, created once and cached in paymongo_plans.
async function ensurePlan(planKey, amountC) {
  const find = () => query('SELECT paymongo_plan_id FROM paymongo_plans WHERE plan_key = $1 AND amount_c = $2', [planKey, amountC]);
  const { rows: [hit] } = await find();
  if (hit) return hit.paymongo_plan_id;
  const data = await call('POST', '/subscriptions/plans', {
    data: { attributes: { name: `BalayHub ${PLANS[planKey].name} (${toPesos(amountC)})`, amount: amountC, currency: 'PHP', interval: 'monthly', interval_count: 1 } },
  });
  const id = data?.data?.id;
  if (!id) throw Object.assign(new Error('The payment service returned an unexpected response.'), { status: 502 });
  // Two workers may race: the first row wins, the other reads it back.
  await query('INSERT INTO paymongo_plans (plan_key, amount_c, paymongo_plan_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [planKey, amountC, id]);
  return (await find()).rows[0].paymongo_plan_id;
}

const ownerOf = async (orgId) => (await query(
  `SELECT user_id, organization_id, full_name, email FROM users WHERE organization_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1`, [orgId])).rows[0];

async function cancelForOrg(orgId, actorUser, reason) {
  const { rows: [o] } = await query('SELECT paymongo_subscription_id AS sid, subscription_status AS st FROM organizations WHERE organization_id = $1', [orgId]);
  if (!o?.sid || o.st === 'cancelled') return false;
  await call('POST', `/subscriptions/${encodeURIComponent(o.sid)}/cancel`);
  await query(`UPDATE organizations SET subscription_status = 'cancelled' WHERE organization_id = $1`, [orgId]);
  await audit(null, actorUser || { organization_id: orgId }, 'billing.subscription_cancelled', 'organization', orgId, { reason: reason || null });
  return true;
}

// What the subscription should charge each month, or null when this workspace is not subscribed now.
// A free coupon month is activated here with no charge (the workspace is not due again until it is used).
async function monthlyAmount(org, owner) {
  const q = await coupons.resolve(pool, { org, code: null, plan: org.renewal_plan, months: 1 });
  if (q.covered > 0 && q.free) {
    await billing().createCheckout(owner, org.renewal_plan, 1, {});
    return null;
  }
  if (q.covered > 0 && q.coupon.duration !== 'forever') return null; // limited months: paid by hand until used
  return q.covered > 0 ? q.amountC : q.listC;
}

async function startOne(orgId) {
  const { rows: [org] } = await query('SELECT * FROM organizations WHERE organization_id = $1', [orgId]);
  const owner = await ownerOf(orgId);
  if (!owner) return false;
  owner.organization_name = org.name;
  const amountC = await monthlyAmount(org, owner);
  if (!amountC) return false;
  return tx(async (db) => {
    const { rows: [o] } = await db.query('SELECT * FROM organizations WHERE organization_id = $1 FOR UPDATE', [orgId]);
    if (o.paymongo_subscription_id && o.subscription_status !== 'cancelled') return false; // another run got here first
    // Settings may have changed since the unlocked read: automatic payment off, card removed, deletion scheduled.
    if (!o.auto_renew || !o.card_payment_method_id || !o.paymongo_customer_id || o.deletion_scheduled_at) return false;
    const planId = await ensurePlan(o.renewal_plan, amountC);
    const data = await call('POST', '/subscriptions', { data: { attributes: { customer_id: o.paymongo_customer_id, plan_id: planId, payment_method_id: o.card_payment_method_id } } });
    const id = data?.data?.id;
    if (!id) throw Object.assign(new Error('The payment service returned an unexpected response.'), { status: 502 });
    await db.query(`UPDATE organizations SET paymongo_subscription_id = $2, subscription_status = 'incomplete' WHERE organization_id = $1`, [orgId, id]);
    await audit(db, owner, 'billing.subscription_started', 'organization', orgId, { plan: o.renewal_plan, amount: toPesos(amountC) });
    return true;
  });
}

// Scheduler job (hourly). Returns how many subscriptions were created.
async function startDue() {
  if (!billing().enabled()) return 0;
  // A subscription must not outlive a workspace that is being deleted, so this runs even with the Subscriptions switch off.
  const { rows: going } = await query(
    `SELECT organization_id FROM organizations WHERE deletion_scheduled_at IS NOT NULL AND paymongo_subscription_id IS NOT NULL AND subscription_status IS DISTINCT FROM 'cancelled'`);
  for (const g of going) {
    try { await cancelForOrg(g.organization_id, null, 'workspace deletion'); } catch (err) { console.error(`[subscriptions] cancel ${g.organization_id}: ${err.message}`); }
  }
  if (!enabled()) return 0;
  const { rows: due } = await query(
    `SELECT organization_id FROM organizations
      WHERE auto_renew AND card_payment_method_id IS NOT NULL AND paymongo_customer_id IS NOT NULL AND renewal_plan IS NOT NULL
        AND (paymongo_subscription_id IS NULL OR subscription_status = 'cancelled')
        AND NOT is_demo AND plan <> 'comped' AND deletion_scheduled_at IS NULL
        AND ((plan = 'trial' AND trial_ends_at <= now() + interval '1 hour') OR paid_until <= $1::date)
      ORDER BY organization_id LIMIT 50`, [manilaDay(1)]);
  let started = 0;
  for (const d of due) {
    try { if (await startOne(d.organization_id)) started += 1; } catch (err) { console.error(`[subscriptions] start ${d.organization_id}: ${err.message}`); }
  }
  return started;
}

async function setStatus(orgId, status, why) {
  const { rowCount } = await query(
    `UPDATE organizations SET subscription_status = $2 WHERE organization_id = $1 AND subscription_status IS DISTINCT FROM $2`, [orgId, status]);
  if (!rowCount || !['past_due', 'unpaid'].includes(status)) return;
  await audit(null, { organization_id: orgId }, 'billing.subscription_payment_failed', 'organization', orgId, { status, event: why });
  const owner = await ownerOf(orgId);
  if (!owner) return;
  await sendMail({
    to: owner.email,
    subject: "Your BalayHub card payment didn't go through",
    text: `Hi ${owner.full_name.split(' ')[0]},\n\nYour card payment on ${nice(manilaDay())} didn't go through. Pay now to keep making changes: ${config.appUrl}/#/settings\n\nBalayHub\n`,
  });
}

async function invoicePaid(invoiceId) {
  const inv = (await call('GET', `/subscriptions/invoices/${encodeURIComponent(invoiceId)}`))?.data?.attributes || {};
  if (inv.status !== 'paid') return;
  const { rows: [org] } = await query('SELECT * FROM organizations WHERE paymongo_subscription_id = $1', [inv.subscription_id]);
  if (!org) return console.error(`[subscriptions] invoice ${invoiceId}: unknown subscription`);
  // The amount must be the price of the PayMongo plan this subscription was created on.
  const sub = (await call('GET', `/subscriptions/${encodeURIComponent(inv.subscription_id)}`))?.data?.attributes || {};
  const { rows: [plan] } = await query('SELECT plan_key, amount_c FROM paymongo_plans WHERE paymongo_plan_id = $1', [sub.plan_id]);
  if (!plan || plan.plan_key !== org.renewal_plan || Number(inv.amount) !== plan.amount_c) {
    return console.error(`[subscriptions] amount mismatch on invoice ${invoiceId}: got ${inv.amount}, plan ${plan?.amount_c}`);
  }
  const list = listC(plan.plan_key);
  const owner = await ownerOf(org.organization_id);
  // Unique invoice_id: a replay finds the same row. markPaid does nothing for a row that is already paid.
  await query(
    `INSERT INTO billing_payments (organization_id, kind, plan, months, amount, list_amount, discount_amount, provider, invoice_id, created_by)
     VALUES ($1, 'plan', $2, 1, $3, $4, $5, 'paymongo_subscription', $6, $7) ON CONFLICT (invoice_id) DO NOTHING`,
    [org.organization_id, plan.plan_key, toPesos(plan.amount_c), toPesos(Math.max(list, plan.amount_c)), toPesos(Math.max(0, list - plan.amount_c)), invoiceId, owner?.user_id || null]);
  const { rows: [b] } = await query('SELECT billing_id FROM billing_payments WHERE invoice_id = $1', [invoiceId]);
  await billing().markPaid(b.billing_id, { method: 'card' });
  await query(`UPDATE organizations SET subscription_status = 'active' WHERE organization_id = $1`, [org.organization_id]);
}

// Webhook entry for subscription.* events.
async function handleEvent(event) {
  if (!enabled()) return;
  const a = event?.data?.attributes || {};
  const id = a.data?.id;
  if (!id || typeof a.type !== 'string') return;
  if (a.type === 'subscription.invoice.paid') return invoicePaid(id);
  if (a.type === 'subscription.invoice.payment_failed') {
    const inv = (await call('GET', `/subscriptions/invoices/${encodeURIComponent(id)}`))?.data?.attributes || {};
    if (inv.status === 'paid') return;
    const { rows: [org] } = await query('SELECT organization_id FROM organizations WHERE paymongo_subscription_id = $1', [inv.subscription_id]);
    return org && setStatus(org.organization_id, 'past_due', a.type);
  }
  if (['subscription.activated', 'subscription.past_due', 'subscription.unpaid'].includes(a.type)) {
    const { rows: [org] } = await query('SELECT organization_id FROM organizations WHERE paymongo_subscription_id = $1', [id]);
    if (!org) return;
    const status = STATUS[(await call('GET', `/subscriptions/${encodeURIComponent(id)}`))?.data?.attributes?.status];
    if (status) await setStatus(org.organization_id, status, a.type);
  }
}

module.exports = { enabled, ensurePlan, startOne, startDue, handleEvent, cancelForOrg };
