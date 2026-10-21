'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
require('./helpers');
const { pool } = require('../src/db');
const { migrate } = require('../scripts/migrate');
const sql = (text, params) => pool.query(text, params).then((r) => r.rows);
const config = require('../src/config');
const { outbox } = require('../src/lib/mailer');
const { sendTrialReminders } = require('../src/lib/trialreminder');

// Workspaces are inserted straight into a fresh database: the reminder job reads only the tables.
test.before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
});
test.after(async () => { await pool.end(); });

// Manila 12:00 on a day `d` days from today, as a timestamptz string: unambiguous Manila day.
const inDays = (d) => {
  const manila = new Date(Date.now() + 8 * 3600 * 1000 + d * 86400000);
  return `${manila.toISOString().slice(0, 10)}T12:00:00+08:00`;
};
const NOW = new Date();

let n = 0;
// Makes a workspace and sets its trial state directly.
async function ws(over = {}) {
  n += 1;
  const email = `rem${n}@example.com`;
  const [o] = await sql('INSERT INTO organizations (name) VALUES ($1) RETURNING organization_id', [`Reminder ${n}`]);
  await sql(`INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
             VALUES ('Maria Santos', $1, 'x', $2, 'owner', now())`, [email, o.organization_id]);
  const f = { plan: 'trial', trial_ends_at: inDays(3), card_check: 'passed', card_brand: 'visa', card_last4: '4242',
    renewal_plan: 'growth', is_demo: false, ...over };
  await sql(
    `UPDATE organizations SET plan = $2, trial_ends_at = $3, card_check = $4, card_checked_at = CASE WHEN $4 = 'passed' THEN now() END,
            card_brand = $5, card_last4 = $6, renewal_plan = $7, is_demo = $8, deletion_scheduled_at = $9, auto_renew = $10,
            auto_renew_consented_at = CASE WHEN $10 THEN now() END, card_payment_method_id = $11
      WHERE organization_id = $1`,
    [o.organization_id, f.plan, f.trial_ends_at, f.card_check, f.card_brand, f.card_last4, f.renewal_plan, f.is_demo,
      f.deletion_scheduled_at || null, !!f.auto_renew, f.pm || null]);
  return { email, orgId: o.organization_id };
}
const mailsTo = (email) => outbox.filter((m) => String(m.to).includes(email));

test('3 days left: one email with the card, plan and price, then none on rerun', async () => {
  const { email } = await ws();
  await sendTrialReminders(NOW);
  const m = mailsTo(email);
  assert.equal(m.length, 1);
  assert.match(m[0].subject, /^Your BalayHub trial ends on /);
  assert.match(m[0].text, /Growth/);
  assert.match(m[0].text, /₱999\.00/);
  assert.match(m[0].text, /Visa ending 4242/);
  assert.match(m[0].text, /Hi Maria,/);
  await sendTrialReminders(NOW);
  assert.equal(mailsTo(email).length, 1);
});

test('1 day left sends once; 2 days left sends none', async () => {
  const one = await ws({ trial_ends_at: inDays(1) });
  const two = await ws({ trial_ends_at: inDays(2) });
  await sendTrialReminders(NOW);
  await sendTrialReminders(NOW);
  assert.equal(mailsTo(one.email).length, 1);
  assert.equal(mailsTo(two.email).length, 0);
  const [a] = await sql(`SELECT details FROM audit_logs WHERE organization_id = $1 AND action = 'billing.trial_reminder_sent'`, [one.orgId]);
  assert.equal(a.details.days, 1);
});

test('the 3-day and 1-day emails are separate sends for the same trial', async () => {
  const { email, orgId } = await ws({ trial_ends_at: inDays(3) });
  await sendTrialReminders(NOW);
  await sql('UPDATE organizations SET trial_ends_at = $2 WHERE organization_id = $1', [orgId, inDays(1)]);
  await sendTrialReminders(NOW);
  assert.equal(mailsTo(email).length, 2);
});

test('waived and NULL-with-saved-card workspaces get reminders', async () => {
  const w = await ws({ card_check: 'waived', card_brand: null, card_last4: null });
  const legacy = await ws({ card_check: null, pm: 'pm_abcdef123' });
  await sendTrialReminders(NOW);
  assert.equal(mailsTo(w.email).length, 1);
  assert.doesNotMatch(mailsTo(w.email)[0].text, /ending/);
  assert.equal(mailsTo(legacy.email).length, 1);
});

test('demo, comped, deleting, gated, paid and card-less workspaces get none', async () => {
  const skipped = [
    await ws({ is_demo: true }),
    await ws({ plan: 'comped' }),
    await ws({ plan: 'growth' }),
    await ws({ deletion_scheduled_at: new Date(Date.now() + 86400000).toISOString() }),
    await ws({ card_check: 'required', trial_ends_at: null }),
    await ws({ card_check: null }),
  ];
  await sendTrialReminders(NOW);
  for (const s of skipped) assert.equal(mailsTo(s.email).length, 0, s.email);
});

test('automatic payment on: Stage 2 email at 3 days only, and only when Stage 2 is on', async () => {
  const three = await ws({ auto_renew: true });
  const one = await ws({ auto_renew: true, trial_ends_at: inDays(1) });
  const before = config.paymongoSubscriptions;
  config.paymongoSubscriptions = true;
  try {
    await sendTrialReminders(NOW);
  } finally { config.paymongoSubscriptions = before; }
  const m = mailsTo(three.email);
  assert.equal(m.length, 1);
  assert.match(m[0].subject, /^Your BalayHub plan starts on /);
  assert.match(m[0].text, /every month until you cancel/);
  assert.equal(mailsTo(one.email).length, 0);
});

test('mail disabled: nothing sent and nothing recorded', async () => {
  const { email, orgId } = await ws();
  const mailer = require('../src/lib/mailer');
  const orig = mailer.mailEnabled;
  mailer.mailEnabled = () => false;
  delete require.cache[require.resolve('../src/lib/trialreminder')];
  const fresh = require('../src/lib/trialreminder');
  try {
    await fresh.sendTrialReminders(NOW);
  } finally { mailer.mailEnabled = orig; }
  assert.equal(mailsTo(email).length, 0);
  const rows = await sql(`SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = 'billing.trial_reminder_sent'`, [orgId]);
  assert.equal(rows.length, 0);
});
