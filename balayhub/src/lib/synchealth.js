'use strict';

// Calendar sync health (D-73). A channel feed is stale when it hasn't synced for
// 3 hours, and failing when its last sync errored. Overlaps are open rows in
// ical_conflicts (written by syncFeed). Owners and managers of the property get
// one alert per new problem; a problem that clears resets its alert.

const { pool } = require('../db');
const { planStatus } = require('./plans');
const notify = require('./notify');
const { CHANNEL_LABEL } = require('./ical');

const STALE_MS = 3 * 60 * 60 * 1000;
// Must be an entry in push.TYPES (push.js), or notify drops the alert.
const SYNC_TYPE = 'sync_problem';

// 'failing', 'stale' or null. A sync that only skipped overlaps is stored as 'error'
// with a "Synced:" message (see ical.js), so it is not a failing feed.
function feedProblem(f, cutoff) {
  if (f.last_status === 'error' && !String(f.last_message || '').startsWith('Synced:')) return 'failing';
  if (new Date(f.last_synced_at || f.created_at) < cutoff) return 'stale';
  return null;
}

// One message to each owner, and each manager assigned to the property. notify.js picks
// push or email per person and checks their settings; it never throws.
async function alertPeople(orgId, propertyId, payload) {
  const { rows: people } = await pool.query(
    `SELECT u.user_id FROM users u
      WHERE u.organization_id = $1 AND u.account_status = 'active'
        AND (u.role = 'owner' OR (u.role = 'manager' AND EXISTS (
              SELECT 1 FROM property_assignments pa WHERE pa.user_id = u.user_id AND pa.property_id = $2)))`,
    [orgId, propertyId]);
  for (const p of people) await notify.notifyUser(orgId, p.user_id, SYNC_TYPE, { ...payload, propertyId });
}

function feedAlert(f, problem) {
  const label = CHANNEL_LABEL[f.channel] || 'Channel';
  if (problem === 'stale') {
    return {
      title: `${label} calendar hasn't updated in BalayHub`,
      body: `${f.unit_name}: no sync for over 3 hours, so bookings from ${label} may be out of date. Check the calendar link in Listings.`,
      url: '/#/listings',
    };
  }
  return {
    title: `${label} calendar can't be read`,
    body: `${f.unit_name}: ${(f.last_message || 'the last sync failed').replace(/\.$/, '')}. Check the calendar link in Listings.`,
    url: '/#/listings',
  };
}

// Run every 15 minutes. Read-only workspaces (demo, ended trial, overdue plan) are skipped.
async function checkFeeds(now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_MS);
  // Archived listings and properties are not alerted (they still sync).
  const { rows: feeds } = await pool.query(
    `SELECT f.feed_id, f.organization_id, f.channel, f.last_synced_at, f.last_status, f.last_message, f.created_at,
            f.problem_since, f.alerted_at, u.unit_name, u.property_id,
            o.plan, o.is_demo, o.trial_ends_at, o.paid_until, o.deletion_scheduled_at
       FROM ical_feeds f
       JOIN units u ON u.unit_id = f.unit_id
       JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = f.organization_id
      WHERE u.status = 'active' AND p.status = 'active'`);
  for (const f of feeds) {
    if (planStatus(f).read_only) continue;
    const problem = feedProblem(f, cutoff);
    if (!problem) {
      if (f.problem_since || f.alerted_at) {
        await pool.query('UPDATE ical_feeds SET problem_since = NULL, alerted_at = NULL WHERE feed_id = $1', [f.feed_id]);
      }
      continue;
    }
    if (!f.problem_since) await pool.query('UPDATE ical_feeds SET problem_since = $2 WHERE feed_id = $1', [f.feed_id, now]);
    // Already told about this problem: alerted since it started.
    if (f.problem_since && f.alerted_at && f.alerted_at >= f.problem_since) continue;
    await alertPeople(f.organization_id, f.property_id, feedAlert(f, problem));
    await pool.query('UPDATE ical_feeds SET alerted_at = $2 WHERE feed_id = $1', [f.feed_id, now]);
  }
}

module.exports = { checkFeeds, alertPeople, feedProblem, STALE_MS };
