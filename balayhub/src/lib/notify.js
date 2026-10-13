'use strict';

// Tell one person about something: a push to their devices, or an email when they
// have no device. Their settings (type on or off, which properties) are checked first.

const config = require('../config');
const { one } = require('../db');
const { sendMail } = require('./mailer');
const push = require('./push');

// The person, if they are an active member of the workspace who can see the property (owners see all).
async function recipient(orgId, userId, propertyId) {
  return one(
    `SELECT u.user_id, u.full_name, u.email, u.role, u.notify_prefs FROM users u
      WHERE u.user_id = $1 AND u.organization_id = $2 AND u.account_status = 'active'
        AND (u.role = 'owner' OR $3::uuid IS NULL
             OR EXISTS (SELECT 1 FROM property_assignments pa WHERE pa.user_id = u.user_id AND pa.property_id = $3))`,
    [userId, orgId, propertyId || null]);
}

// Never throws: a failed notification must not fail the action that caused it.
// Returns true when something was sent.
async function notifyUser(orgId, userId, type, { title, body, url, propertyId } = {}) {
  try {
    const user = await recipient(orgId, userId, propertyId);
    if (!user || !push.allowed(user, type, propertyId)) return false;
    const link = url || '/#/home';
    const pushed = await push.notify(orgId, type, { title, body, url: link, propertyId, userId: user.user_id });
    if (pushed) return true;
    // No device, or every device refused it: send an email instead.
    const sent = await sendMail({
      to: user.email,
      subject: title,
      text: [body, `Open BalayHub: ${config.appUrl}${link}`, 'You can change these notifications under My account.'].filter(Boolean).join('\n\n'),
    });
    return sent.delivered;
  } catch (err) {
    console.error('[notify]', err.message);
    return false;
  }
}

module.exports = { notifyUser };
