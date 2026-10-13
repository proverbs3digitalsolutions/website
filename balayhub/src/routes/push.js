'use strict';

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah } = require('../lib/http');
const push = require('../lib/push');

const router = express.Router();

// Only browser push services, so the server never posts to arbitrary URLs.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/];
function isPushService(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

router.get('/push/settings', ah(async (req, res) => {
  const u = await one('SELECT notify_prefs FROM users WHERE user_id = $1', [req.user.user_id]);
  const { rows } = await query('SELECT device, created_at FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at', [req.user.user_id]);
  const types = Object.entries(push.TYPES).filter(([, t]) => t.roles.includes(req.user.role))
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

module.exports = router;
