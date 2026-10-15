'use strict';

// Top bar bookmarks (D-90). Personal saved pages, up to 20 per person, kept on the
// server so they follow the person across devices. Under /api/account/, so every
// role (cleaners too) and view-only workspaces keep them.

const express = require('express');
const { query, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { uuidParam } = require('../lib/validate');

const router = express.Router();

const MAX_BOOKMARKS = 20;
const PATH_RE = /^#\/[A-Za-z0-9._~/?=&%-]{1,300}$/;
const COLS = 'bookmark_id, path, label, created_at';

router.get('/account/bookmarks', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT ${COLS} FROM bookmarks WHERE user_id = $1 ORDER BY created_at, bookmark_id`, [req.user.user_id]);
  res.json({ bookmarks: rows });
}));

router.post('/account/bookmarks', ah(async (req, res) => {
  const body = req.body || {};
  const path = typeof body.path === 'string' ? body.path.trim() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const fields = {};
  if (!PATH_RE.test(path) || path.includes('//')) fields.path = "This page can't be bookmarked.";
  if (label.length < 1 || label.length > 80) fields.label = 'Give the bookmark a name, up to 80 characters.';
  if (Object.keys(fields).length) throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

  const { row, inserted } = await tx(async (db) => {
    // Lock the person first so two quick saves can't both pass the count.
    await db.query('SELECT 1 FROM users WHERE user_id = $1 FOR UPDATE', [req.user.user_id]);
    const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM bookmarks WHERE user_id = $1', [req.user.user_id]);
    if (n >= MAX_BOOKMARKS) {
      const { rows: [exists] } = await db.query('SELECT 1 AS x FROM bookmarks WHERE user_id = $1 AND path = $2', [req.user.user_id, path]);
      if (!exists) throw new HttpError(409, 'You can keep up to 20 bookmarks. Remove one to add another.', { code: 'BOOKMARK_LIMIT' });
    }
    const { rows: [r] } = await db.query(
      `INSERT INTO bookmarks (organization_id, user_id, path, label) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, path) DO UPDATE SET label = EXCLUDED.label
       RETURNING ${COLS}, (xmax = 0) AS inserted`,
      [req.user.organization_id, req.user.user_id, path, label]);
    const { inserted: ins, ...bookmark } = r;
    return { row: bookmark, inserted: ins };
  });
  res.status(inserted ? 201 : 200).json({ bookmark: row });
}));

router.post('/account/bookmarks/:id/remove', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { rowCount } = await query('DELETE FROM bookmarks WHERE bookmark_id = $1 AND user_id = $2', [id, req.user.user_id]);
  if (!rowCount) throw notFound();
  res.json({ ok: true });
}));

module.exports = router;
