'use strict';

// Calendar sync problems for the Home, Calendar and Listings warnings (D-73).
// Owners and managers only; managers see only the properties they are assigned to.

const express = require('express');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { ah } = require('../lib/http');
const { pool } = require('../db');
const { feedProblem, problemText, STALE_MS } = require('../lib/synchealth');

const router = express.Router();

// The host of a calendar link (e.g. "cal.example.org"), so two links on one listing can be told apart.
// Only the host goes out: the path and any token in the link stay on the server.
function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}

router.get('/sync-health', requireRole('owner', 'manager'), ah(async (req, res) => {
  const cutoff = new Date(Date.now() - STALE_MS);
  const params = [];
  const scope = propertyScope(req.user, params, 'p');
  // Archived listings and properties are left out (they still sync).
  const live = `u.status = 'active' AND p.status = 'active'`;
  const { rows: feeds } = await pool.query(
    `SELECT f.feed_id, f.unit_id, f.channel, f.url, f.last_synced_at, f.last_status, f.last_message, f.created_at,
            f.problem_since, u.unit_name
       FROM ical_feeds f
       JOIN units u ON u.unit_id = f.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND ${live}
      ORDER BY u.unit_name`, params);
  const { rows: overlaps } = await pool.query(
    `SELECT c.feed_id, c.unit_id, c.check_in, c.check_out, c.first_seen_at, f.channel, f.url, u.unit_name
       FROM ical_conflicts c
       JOIN ical_feeds f ON f.feed_id = c.feed_id
       JOIN units u ON u.unit_id = c.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE c.resolved_at IS NULL AND ${scope} AND ${live}
      ORDER BY c.check_in`, params);

  const problems = [];
  for (const f of feeds) {
    const kind = feedProblem(f, cutoff);
    if (!kind) continue;
    problems.push({
      kind,
      feed_id: f.feed_id,
      unit_id: f.unit_id,
      unit_name: f.unit_name,
      channel: f.channel,
      host: hostOf(f.url),
      since: f.problem_since || f.last_synced_at || f.created_at,
      ...problemText(f, kind),
    });
  }
  for (const c of overlaps) {
    problems.push({
      kind: 'overlap',
      feed_id: c.feed_id,
      unit_id: c.unit_id,
      unit_name: c.unit_name,
      channel: c.channel,
      host: hostOf(c.url),
      since: c.first_seen_at,
      message: 'Overlaps dates already taken in BalayHub, so it was not added.',
      detail: null,
      check_in: c.check_in,
      check_out: c.check_out,
    });
  }
  res.json({ problems });
}));

module.exports = router;
module.exports.hostOf = hostOf; // shared with GET /units/:id/channels (src/routes/stays.js)
