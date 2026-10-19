'use strict';

// Subscription plans. Prices are in pesos per month; change them here.
// Payment is collected outside the app for now (GCash / bank transfer) and the
// platform admin sets the plan and "paid until" date on the admin page.

const config = require('../config');

const PLANS = {
  trial: { name: 'Free trial', price: 0, listings: 10, ai: true },
  starter: { name: 'Starter', price: 499, listings: 2, ai: false },
  growth: { name: 'Growth', price: 999, listings: 5, ai: true },
  pro: { name: 'Pro', price: 1799, listings: 10, ai: true },
  comped: { name: 'Complimentary', price: 0, listings: 1000, ai: true },
};
const PUBLIC_PLANS = ['starter', 'growth', 'pro'];
const GRACE_DAYS = 7;

// Today in Manila as YYYY-MM-DD.
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// Where a workspace stands. `org` needs plan, trial_ends_at, paid_until, is_demo.
function planStatus(org) {
  const plan = PLANS[org.plan] ? org.plan : 'trial';
  const p = PLANS[plan];
  const out = { plan, name: p.name, price: p.price, listing_limit: p.listings, ai: p.ai, read_only: false, reason: null, is_demo: Boolean(org.is_demo) };
  if (org.is_demo) return { ...out, read_only: true, reason: 'demo' };
  if (org.deletion_scheduled_at) return { ...out, read_only: true, reason: 'deleting', deletion_scheduled_at: org.deletion_scheduled_at };
  // Card on file (D-98): the 14-day trial has not started until the owner confirms a card.
  if (plan === 'trial' && org.card_check === 'required') {
    return { ...out, read_only: true, reason: 'card_check', card_check_due: true, trial_ends_at: null, trial_days_left: config.trialDays };
  }
  if (plan === 'trial') {
    const ends = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
    out.trial_ends_at = ends;
    out.trial_days_left = ends ? Math.max(0, Math.ceil((ends - Date.now()) / 86400000)) : config.trialDays;
    if (ends && ends < new Date()) { out.read_only = true; out.reason = 'trial_ended'; }
  } else if (plan !== 'comped' && org.paid_until) {
    const paid = String(org.paid_until).slice(0, 10);
    out.paid_until = paid;
    const grace = new Date(`${paid}T00:00:00Z`);
    grace.setUTCDate(grace.getUTCDate() + GRACE_DAYS);
    const today = manilaToday();
    if (grace.toISOString().slice(0, 10) < today) { out.read_only = true; out.reason = 'payment_due'; } else if (paid < today) out.reason = 'grace';
  }
  return out;
}

const READ_ONLY_MSG = {
  demo: 'This is the demo workspace, so changes are turned off. Start a free trial to use BalayHub with your own listings.',
  trial_ended: 'Your free trial has ended. Your data is safe and you can still view and export it. Choose a plan in Settings to keep making changes.',
  deleting: 'This workspace is scheduled for deletion, so changes are turned off. The owner can cancel the deletion in Settings.',
  card_check: 'Confirm your payment card to start your free trial.',
  payment_due: 'Your plan payment is overdue. Your data is safe and you can still view it. Renew in Settings to keep making changes.',
};

module.exports = { PLANS, PUBLIC_PLANS, GRACE_DAYS, planStatus, READ_ONLY_MSG };
