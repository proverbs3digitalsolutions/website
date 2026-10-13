'use strict';

// Web push notifications (new bookings, guest messages, check-in forms,
// cleaning done, payments). VAPID keys come from VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY, or are generated once and kept in the private storage folder.

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const config = require('../config');
const { query } = require('../db');

const TYPES = {
  new_booking: { label: 'New bookings', roles: ['owner', 'manager'] },
  guest_message: { label: 'Guest messages', roles: ['owner', 'manager'] },
  checkin_form: { label: 'Guest check-in forms', roles: ['owner', 'manager'] },
  payment: { label: 'Online payments', roles: ['owner', 'manager'] },
  cleaning: { label: 'Cleaning tasks', roles: ['owner', 'manager', 'staff', 'cleaner'] },
  mention: { label: 'Mentions in notes', roles: ['owner', 'manager'] },
  assignment: { label: 'Conversations assigned to you', roles: ['owner', 'manager'] },
  sync_problem: { label: 'Calendar sync problems', roles: ['owner', 'manager'] },
};

// May this person (a users row: role and notify_prefs) get a `type` notification about `propertyId`?
// No when they switched the type off, their role doesn't fit it, or they filtered out that property.
// Lives here (not in notify.js) because it needs TYPES and notify.js already imports this module.
function allowed(user, type, propertyId) {
  const t = TYPES[type];
  if (!t || !t.roles.includes(user.role)) return false;
  const prefs = user.notify_prefs || {};
  if (prefs[type] === false) return false;
  return !Array.isArray(prefs.property_ids) || prefs.property_ids.includes(propertyId);
}

let keys = null;
function vapid() {
  if (keys) return keys;
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    keys = { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  } else {
    const file = path.resolve(config.storageDir, '.vapid.json');
    try {
      keys = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const fresh = webpush.generateVAPIDKeys();
      try { fs.writeFileSync(file, JSON.stringify(fresh), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      keys = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  }
  const contact = config.salesContactEmail || ((/<([^>]+)>/.exec(config.mailFrom) || [])[1]) || 'admin@example.com';
  webpush.setVapidDetails(`mailto:${contact}`, keys.publicKey, keys.privateKey);
  return keys;
}

// Who should hear about something in a property: active members whose role
// fits and who can see that property. Their settings are checked by allowed().
async function recipients(orgId, type, propertyId, onlyRoles, onlyUser) {
  const roles = onlyRoles || TYPES[type].roles;
  const { rows } = await query(
    `SELECT s.*, u.role, u.notify_prefs FROM push_subscriptions s JOIN users u ON u.user_id = s.user_id
      WHERE u.organization_id = $1 AND u.account_status = 'active' AND u.role = ANY($2)
        AND (u.role = 'owner' OR $3::uuid IS NULL
             OR EXISTS (SELECT 1 FROM property_assignments pa WHERE pa.user_id = u.user_id AND pa.property_id = $3))
        AND ($4::uuid IS NULL OR u.user_id = $4)`,
    [orgId, roles, propertyId || null, onlyUser || null]);
  return rows;
}

// Send to everyone concerned. Never throws.
async function notify(orgId, type, { title, body, url, propertyId, roles, userId }) {
  try {
    const subs = (await recipients(orgId, type, propertyId, roles, userId)).filter((s) => allowed(s, type, propertyId));
    if (!subs.length) return 0;
    vapid();
    const payload = JSON.stringify({ title, body, url: url || '/#/home', tag: type });
    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600 * 12 });
        await query('UPDATE push_subscriptions SET last_sent_at = now() WHERE subscription_id = $1', [s.subscription_id]);
        sent += 1;
      } catch (err) {
        // The device unsubscribed or the browser was reset: forget it.
        if ([404, 410].includes(err.statusCode)) await query('DELETE FROM push_subscriptions WHERE subscription_id = $1', [s.subscription_id]);
        else console.error('[push] send failed:', err.statusCode || err.message);
      }
    }
    return sent;
  } catch (err) {
    console.error('[push]', err.message);
    return 0;
  }
}

// Property of a booking, for scoping.
async function propertyOfBooking(bookingId) {
  const { rows: [r] } = await query('SELECT u.property_id FROM bookings b JOIN units u USING (unit_id) WHERE b.booking_id = $1', [bookingId]);
  return r?.property_id || null;
}

module.exports = { TYPES, vapid, allowed, notify, propertyOfBooking, webpush };
