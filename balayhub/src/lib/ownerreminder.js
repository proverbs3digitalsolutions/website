'use strict';

// Owner statements reminder (Phase 2, item 8). On the 3rd of the month (Manila) and later, last month's owner
// statements are drafted and the workspace owners are emailed that they are ready to review. Once per workspace
// per month. The record is an audit_logs row, so no new table.

const config = require('../config');
const { query, one } = require('../db');
const { sendMail, mailEnabled } = require('./mailer');
const { audit } = require('./audit');
const { planStatus } = require('./plans');

const ACTION = 'owner_statements.reminder_sent';

const manilaDate = (now) => new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// 'YYYY-MM' of the month before the given 'YYYY-MM'.
function previousMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Hourly job. Returns how many workspaces were emailed. `now` is injectable for tests.
async function sendStatementReminders(now = new Date()) {
  const today = manilaDate(now);
  // Without email there is nothing to send, so skip quietly.
  if (Number(today.slice(8)) < 3 || !mailEnabled()) return { sent: 0 };
  const month = previousMonth(today.slice(0, 7));
  const { rows: workspaces } = await query(
    `SELECT o.organization_id, o.name, o.plan, o.is_demo, o.trial_ends_at, o.paid_until, o.deletion_scheduled_at
       FROM organizations o
      WHERE NOT o.is_demo
        AND EXISTS (SELECT 1 FROM unit_owners uo JOIN units u ON u.owner_id = uo.owner_id
                     WHERE uo.organization_id = o.organization_id AND uo.archived_at IS NULL AND u.status = 'active')
        AND NOT EXISTS (SELECT 1 FROM audit_logs a
                         WHERE a.organization_id = o.organization_id AND a.action = $1 AND a.details->>'month' = $2)`,
    [ACTION, month]);
  let sent = 0;
  for (const ws of workspaces) {
    if (planStatus(ws).read_only) continue;
    try {
      if (await remindWorkspace(ws, month)) sent += 1;
    } catch (err) {
      // One broken workspace must not hold up the others; the next hourly run tries again.
      console.error(`[owner-statements-reminder] ${ws.name}: ${err.message}`);
    }
  }
  return { sent };
}

async function remindWorkspace(ws, month) {
  const orgId = ws.organization_id;
  const recipients = await query(
    `SELECT email FROM users WHERE organization_id = $1 AND role = 'owner' AND account_status = 'active'`, [orgId]);
  if (!recipients.rows.length) return false;
  const { n } = await one(
    `SELECT COUNT(*) AS n FROM unit_owners uo
      WHERE uo.organization_id = $1 AND uo.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM units u WHERE u.owner_id = uo.owner_id AND u.status = 'active')`, [orgId]);

  // Drafts only: nothing is published or sent to an owner here.
  await require('./statements').draftMonth(orgId, month);

  const label = monthName(month);
  const mail = await sendMail({
    to: recipients.rows.map((r) => r.email).join(', '),
    subject: `Owner statements for ${label} are ready to review (${n})`,
    text: `${n} owner statement${n === 1 ? ' is' : 's are'} ready to review for ${label}.\n\n`
      + `Review each one, then publish it to send it to the owner:\n${config.appUrl}/#/owners/statements?month=${month}`,
  });
  if (!mail.delivered) return false;
  await audit(null, { organization_id: orgId }, ACTION, 'organization', orgId, { month });
  return true;
}

module.exports = { sendStatementReminders };
