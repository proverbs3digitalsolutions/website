'use strict';

// Trial-end reminders (D-98). Nothing is charged automatically in Stage 1, so the host is emailed 3 days and
// 1 day before the trial ends. Once per workspace per `days` value; the record is an audit_logs row (pattern:
// ownerreminder.js), so no new table.

const config = require('../config');
const { query } = require('../db');
const mailer = require('./mailer');
const { audit } = require('./audit');
const { PLANS } = require('./plans');
const { fmtPeso } = require('./messaging');

const ACTION = 'billing.trial_reminder_sent';
const DAYS = [3, 1];

const manilaDate = (d) => new Date(new Date(d).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const longDate = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const brandName = (b) => (b ? b.charAt(0).toUpperCase() + b.slice(1) : '');

// Hourly job. Returns how many emails were sent. `now` is injectable for tests.
async function sendTrialReminders(now = new Date()) {
  if (!mailer.mailEnabled()) return { sent: 0 };
  const today = manilaDate(now);
  const { rows } = await query(
    `SELECT o.organization_id, o.name, o.trial_ends_at, o.card_brand, o.card_last4, o.renewal_plan, o.auto_renew
       FROM organizations o
      WHERE o.plan = 'trial' AND NOT o.is_demo AND o.deletion_scheduled_at IS NULL AND o.trial_ends_at IS NOT NULL
        AND (o.card_check IN ('passed', 'waived') OR (o.card_check IS NULL AND o.card_payment_method_id IS NOT NULL))`);
  let sent = 0;
  for (const ws of rows) {
    const days = dayDiff(manilaDate(ws.trial_ends_at), today);
    if (!DAYS.includes(days)) continue;
    try {
      if (await remind(ws, days)) sent += 1;
    } catch (err) {
      // One broken workspace must not hold up the others; the next hourly run tries again.
      console.error(`[trial-reminders] ${ws.name}: ${err.message}`);
    }
  }
  return { sent };
}

async function remind(ws, days) {
  const orgId = ws.organization_id;
  const auto = ws.auto_renew && Boolean(config.paymongoSubscriptions);
  // With automatic payment on, only the 3-day heads-up is sent.
  if (auto && days !== 3) return false;
  const done = await query(
    `SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = $2 AND details->>'days' = $3
        AND details->>'trial_ends_at' = $4`,
    [orgId, ACTION, String(days), new Date(ws.trial_ends_at).toISOString()]);
  if (done.rows.length) return false;
  const owner = (await query(
    `SELECT email, full_name FROM users WHERE organization_id = $1 AND role = 'owner' AND account_status = 'active'
      ORDER BY created_at LIMIT 1`, [orgId])).rows[0];
  if (!owner) return false;

  const planKey = PLANS[ws.renewal_plan] && PLANS[ws.renewal_plan].price ? ws.renewal_plan : 'growth';
  const plan = PLANS[planKey];
  const price = fmtPeso(plan.price);
  const ends = longDate(manilaDate(ws.trial_ends_at));
  const card = ws.card_last4 ? `${brandName(ws.card_brand) || 'Card'} ending ${ws.card_last4}`.replace(/^Card ending/, 'card ending') : '';
  const first = owner.full_name.trim().split(/\s+/)[0];
  const link = `${config.appUrl}/#/settings`;

  const mail = auto
    ? {
      subject: `Your BalayHub plan starts on ${ends}`,
      text: `Hi ${first},\n\nYour free trial for ${ws.name} ends on ${ends}. We'll charge ${price} for ${plan.name} to your ${card} that day, then every month until you cancel. To cancel or change plan, open Settings, Plan & billing: ${link}\n\nBalayHub`,
    }
    : {
      subject: `Your BalayHub trial ends on ${ends}`,
      text: `Hi ${first},\n\nYour free trial for ${ws.name} ends on ${ends}. To keep making changes, pay for ${plan.name} (${price} a month) in Settings, Plan & billing. `
        + `${card ? `Your ${card} is saved, so it takes one tap:` : 'Open it here:'}\n${link}\n\n`
        + `If you don't pay, your workspace becomes view-only. Your data is never deleted.\n\nBalayHub`,
    };
  const res = await mailer.sendMail({ to: owner.email, ...mail });
  if (!res.delivered) return false;
  await audit(null, { organization_id: orgId }, ACTION, 'organization', orgId, { days, trial_ends_at: new Date(ws.trial_ends_at).toISOString() });
  return true;
}

module.exports = { sendTrialReminders };
