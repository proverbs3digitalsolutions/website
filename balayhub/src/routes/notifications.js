'use strict';

// The top bar bell (D-90). Each person's own alerts, kept 90 days. Under /api/account/, so every
// role (cleaners too) and view-only workspaces keep it. Rows are always limited to the signed-in
// person, their role, their assigned properties and the alert types they have switched on.

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah } = require('../lib/http');
const feed = require('../lib/notifyfeed');

const router = express.Router();

const ID_RE = /^\d{1,18}$/;
const bad = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

// The scope WHERE for this person, from their saved settings as they are right now.
async function scopeFor(user, params) {
  const { notify_prefs: prefs } = await one('SELECT notify_prefs FROM users WHERE user_id = $1', [user.user_id]);
  return { prefs, where: feed.scopeSql(user, prefs, params) };
}

// Types of one category among those this person can see; an unknown category is a validation error.
function categoryTypes(visible, category) {
  if (!feed.CATEGORY_ORDER.includes(category)) return null;
  return visible.filter((t) => feed.CATEGORY[t] === category);
}

async function unreadCount(user) {
  const params = [];
  const { where } = await scopeFor(user, params);
  const { rows: [r] } = await query(`SELECT count(*)::int AS n FROM notifications n WHERE ${where} AND n.read_at IS NULL`, params);
  return r.n;
}

router.get('/account/notifications', ah(async (req, res) => {
  const { category = 'all', before, limit: rawLimit } = req.query;
  const fields = {};
  if (category !== 'all' && !feed.CATEGORY_ORDER.includes(category)) fields.category = 'Choose a notification category.';
  if (before !== undefined && !ID_RE.test(String(before))) fields.before = 'Invalid page marker.';
  const limit = rawLimit === undefined ? 30 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fields.limit = 'Choose 1 to 50 notifications per page.';
  if (Object.keys(fields).length) throw bad(fields);

  const params = [];
  const { prefs, where } = await scopeFor(req.user, params);
  const visible = feed.visibleTypes(req.user, prefs);
  let filter = '';
  if (category !== 'all') { params.push(categoryTypes(visible, category)); filter += ` AND n.type = ANY($${params.length})`; }
  if (before !== undefined) { params.push(String(before)); filter += ` AND n.notification_id < $${params.length}`; }
  params.push(limit + 1);
  const { rows } = await query(
    `SELECT n.notification_id, n.type, n.title, n.body, n.url, n.created_at, n.read_at FROM notifications n
      WHERE ${where}${filter} ORDER BY n.notification_id DESC LIMIT $${params.length}`, params);
  const page = rows.slice(0, limit);
  res.json({
    items: page.map((r) => ({
      id: String(r.notification_id), type: r.type, category: feed.CATEGORY[r.type], title: r.title, body: r.body,
      url: r.url, created_at: r.created_at.toISOString(), read: r.read_at !== null,
    })),
    unread: await unreadCount(req.user),
    categories: feed.CATEGORY_ORDER.filter((c) => visible.some((t) => feed.CATEGORY[t] === c)),
    next_before: rows.length > limit ? String(page[page.length - 1].notification_id) : null,
  });
}));

router.get('/account/notifications/count', ah(async (req, res) => {
  res.json({ unread: await unreadCount(req.user) });
}));

router.post('/account/notifications/read', ah(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { ids, all, category } = body;
  const chosen = [ids !== undefined, all !== undefined, category !== undefined].filter(Boolean).length;
  const choose = () => bad({ ids: 'Choose which notifications to mark as read.' });
  if (chosen !== 1) throw choose();

  const params = [];
  const { prefs, where } = await scopeFor(req.user, params);
  let filter = '';
  if (ids !== undefined) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== 'string' || !ID_RE.test(id))) throw choose();
    params.push(ids);
    filter = ` AND n.notification_id = ANY($${params.length}::bigint[])`;
  } else if (all !== undefined) {
    if (all !== true) throw choose();
  } else {
    const types = typeof category === 'string' ? categoryTypes(feed.visibleTypes(req.user, prefs), category) : null;
    if (!types) throw choose();
    params.push(types);
    filter = ` AND n.type = ANY($${params.length})`;
  }
  // Rows that are not this person's are simply not touched, so ids can't be probed.
  await query(`UPDATE notifications n SET read_at = now() WHERE ${where} AND n.read_at IS NULL${filter}`, params);
  res.json({ unread: await unreadCount(req.user) });
}));

module.exports = router;
