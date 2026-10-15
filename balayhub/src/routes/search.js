'use strict';

const express = require('express');
const { ah } = require('../lib/http');
const { rateLimit } = require('../lib/auth');
const { search } = require('../lib/search');

const router = express.Router();

// 60 searches a minute per person. Cleaners never get here: the default-deny cleaner guard answers first.
const limiter = rateLimit({ windowMs: 60_000, max: 60, key: (req) => `search|${req.user.user_id}` });

router.get('/search', limiter, ah(async (req, res) => {
  const raw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const q = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  res.json({ q, groups: q.length < 2 ? [] : await search(req.user, q) });
}));

module.exports = router;
