'use strict';

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah } = require('../lib/http');
const { UUID_RE } = require('../lib/validate');
const { propertyScope } = require('../lib/access');
const { audit } = require('../lib/audit');
const push = require('../lib/push');

const router = express.Router();

// The device settings list keeps the types it always had. Mentions and assignments are set in
// My account (/account/notify-prefs) and are not shown here.
const DEVICE_TYPES = ['new_booking', 'guest_message', 'checkin_form', 'payment', 'cleaning'];

// Only browser push services, so the server never posts to arbitrary URLs.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/];
function isPushService(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

// The types a person can receive, given their role and the workspace type. Stay-only types
// are left out of a long-term workspace, which has no stays to tell anyone about.
const typesFor = (role, businessType) => Object.keys(push.TYPES).filter((key) => push.TYPES[key].roles.includes(role)
  && (businessType !== 'long_term' || push.TYPES[key].module !== 'stay'));

router.get('/push/settings', ah(async (req, res) => {
  const u = await one('SELECT notify_prefs FROM users WHERE user_id = $1', [req.user.user_id]);
  const { rows } = await query('SELECT device, created_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at', [req.user.user_id]);
  const shown = typesFor(req.user.role, req.user.business_type);
  const types = Object.entries(push.TYPES).filter(([key]) => DEVICE_TYPES.includes(key) && shown.includes(key))
    .map(([key, t]) => ({ key, label: t.label, on: u.notify_prefs[key] !== false }));
  res.json({ public_key: push.vapid().publicKey, devices: rows, types });
}));

router.post('/push/subscribe', ah(async (req, res) => {
  const s = req.body?.subscription;
  const endpoint = String(s?.endpoint || '');
  if (!/^https:\/\/[^\s]{10,800}$/.test(endpoint) || !isPushService(endpoint) || typeof s?.keys?.p256dh !== 'string' || typeof s?.keys?.auth !== 'string'
      || s.keys.p256dh.length > 200 || s.keys.auth.length > 100) {
    throw new HttpError(400, 'Invalid notification subscription.', { code: 'BAD_REQUEST' });
  }
  const device = String(req.body?.device || '').slice(0, 80) || null;
  // An endpoint belongs to one browser: re-link it to whoever is signed in now.
  await query(
    `INSERT INTO push_subscriptions (user_id, organization_id, endpoint, p256dh, auth, device) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, organization_id = $2, p256dh = $4, auth = $5, device = $6, created_at = now()`,
    [req.user.user_id, req.user.organization_id, endpoint, s.keys.p256dh, s.keys.auth, device]);
  res.json({ ok: true });
}));

router.post('/push/unsubscribe', ah(async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  await query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [req.user.user_id, endpoint]);
  res.json({ ok: true });
}));

router.patch('/push/settings', ah(async (req, res) => {
  const prefs = {};
  for (const key of Object.keys(push.TYPES)) if (typeof req.body?.[key] === 'boolean') prefs[key] = req.body[key];
  // Refuse a type this person can't receive (the same rule as /account/notify-prefs), saving nothing.
  const keys = typesFor(req.user.role, req.user.business_type);
  if (Object.keys(prefs).some((key) => !keys.includes(key))) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { types: 'Choose on or off for each notification you can receive.' } });
  }
  await query(`UPDATE users SET notify_prefs = notify_prefs || $2::jsonb WHERE user_id = $1`, [req.user.user_id, JSON.stringify(prefs)]);
  res.json({ ok: true });
}));

router.post('/push/test', ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM push_subscriptions WHERE user_id = $1', [req.user.user_id]);
  if (!rows.length) throw new HttpError(409, 'Turn on notifications on this device first.', { code: 'NO_DEVICE' });
  push.vapid();
  const payload = JSON.stringify({ title: 'BalayHub notifications are on ✅', body: 'You will be notified about new bookings and guest messages here.', url: '/#/home', tag: 'test' });
  let sent = 0;
  for (const s of rows) {
    try { await push.webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); sent += 1; } catch (err) {
      if ([404, 410].includes(err.statusCode)) await query('DELETE FROM push_subscriptions WHERE subscription_id = $1', [s.subscription_id]);
    }
  }
  res.json({ sent });
}));

// ---------------------------------------------------------------- notification settings (My account)
// Each person picks which notification types they get (only those their role can receive) and,
// for owners and managers, which properties (null = all). Stored in users.notify_prefs: a
// { type: boolean } map plus an optional property_ids list; no list means all properties.
async function visibleProperties(user) {
  const params = [];
  const { rows } = await query(
    `SELECT p.property_id, p.property_name FROM properties p WHERE ${propertyScope(user, params)} AND p.status = 'active' ORDER BY p.property_name`,
    params);
  return rows;
}

async function prefsView(user) {
  const { notify_prefs: prefs } = await one('SELECT notify_prefs FROM users WHERE user_id = $1', [user.user_id]);
  const properties = await visibleProperties(user);
  const visible = new Set(properties.map((p) => p.property_id));
  const keys = typesFor(user.role, user.business_type);
  return {
    types: Object.fromEntries(keys.map((key) => [key, prefs[key] !== false])),
    labels: Object.fromEntries(keys.map((key) => [key, push.TYPES[key].label])),
    property_ids: Array.isArray(prefs.property_ids) ? prefs.property_ids.filter((id) => visible.has(id)) : null,
    properties,
  };
}

router.get('/account/notify-prefs', ah(async (req, res) => {
  res.json(await prefsView(req.user));
}));

router.patch('/account/notify-prefs', ah(async (req, res) => {
  const user = req.user;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { types, property_ids: propertyIds } = body;
  const keys = typesFor(user.role, user.business_type);
  const fields = {};
  if (types !== undefined && (!types || typeof types !== 'object' || Array.isArray(types)
      || Object.entries(types).some(([key, on]) => !keys.includes(key) || typeof on !== 'boolean'))) {
    fields.types = 'Choose on or off for each notification you can receive.';
  }
  let chosen; // undefined: leave as it is; null: every property; otherwise only these
  if (propertyIds === null) {
    chosen = null;
  } else if (propertyIds !== undefined) {
    const list = Array.isArray(propertyIds) ? propertyIds.map((id) => String(id).toLowerCase()) : null;
    const visible = new Set((await visibleProperties(user)).map((p) => p.property_id));
    // An empty list would mute every property alert (push.allowed), so a choice is required; null means all.
    if (list && !list.length) fields.property_ids = 'Pick at least one property, or choose all properties.';
    else if (!list || list.some((id) => !UUID_RE.test(id) || !visible.has(id))) fields.property_ids = 'Choose properties you can see.';
    else chosen = [...new Set(list)];
  }
  if (Object.keys(fields).length) throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

  const { notify_prefs: current } = await one('SELECT notify_prefs FROM users WHERE user_id = $1', [user.user_id]);
  const prefs = { ...current, ...(types || {}) };
  if (chosen === null) delete prefs.property_ids;
  else if (chosen) prefs.property_ids = chosen;
  await query('UPDATE users SET notify_prefs = $2::jsonb WHERE user_id = $1', [user.user_id, JSON.stringify(prefs)]);
  await audit(null, user, 'user.notify_prefs_updated', 'user', user.user_id, { types: types || null, property_ids: chosen });
  res.json(await prefsView(user));
}));

module.exports = router;
