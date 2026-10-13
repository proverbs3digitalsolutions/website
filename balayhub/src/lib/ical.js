'use strict';

// iCal (RFC 5545) calendar sync with Airbnb, Booking.com, Agoda and others.
// Export: one private feed per listing. Import: fetch a channel's feed URL and
// mirror its events as reservations/blocks.

const https = require('https');
const dns = require('dns');
const net = require('net');
const crypto = require('crypto');
const { pool } = require('../db');
const { leasedListings } = require('./leases');

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;

// ---------------------------------------------------------------- export
const pad = (n) => String(n).padStart(2, '0');
const icalDate = (d) => String(d).slice(0, 10).replace(/-/g, '');
const stamp = (t = new Date()) =>
  `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;

// Guest names and contact details are never included: channels only need dates.
function buildCalendar(listingName, bookings) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BalayHub//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${String(listingName).replace(/[\r\n,;]/g, ' ').slice(0, 80)} (BalayHub)`,
  ];
  const now = stamp();
  for (const b of bookings) {
    lines.push('BEGIN:VEVENT',
      `UID:${b.booking_id}@balayhub`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icalDate(b.check_in)}`,
      `DTEND;VALUE=DATE:${icalDate(b.check_out)}`,
      `SUMMARY:${b.kind === 'block' ? 'Blocked' : 'Reserved'}`,
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

const newFeedToken = () => crypto.randomBytes(24).toString('base64url');

// ---------------------------------------------------------------- import: parsing
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseEvents(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).split(';')[0].toUpperCase();
    const value = line.slice(i + 1);
    if (name === 'UID') cur.uid = value.trim().slice(0, 300);
    else if (name === 'DTSTART') cur.start = parseDate(value);
    else if (name === 'DTEND') cur.end = parseDate(value);
    else if (name === 'SUMMARY') cur.summary = unescapeText(value).trim().slice(0, 200);
    else if (name === 'DESCRIPTION') cur.description = unescapeText(value).trim().slice(0, 1000);
    else if (name === 'STATUS') cur.status = value.trim().toUpperCase();
  }
  return events
    .filter((e) => e.uid && e.start && e.status !== 'CANCELLED')
    .map((e) => ({ ...e, end: e.end && e.end > e.start ? e.end : addDays(e.start, 1) }));
}

// Airbnb marks guest stays "Reserved" and host blocks "Not available".
// Other channels don't distinguish, so their events are treated as reservations.
function classify(event, channel) {
  if (channel === 'airbnb') return /reserved/i.test(event.summary || '') ? 'reservation' : 'block';
  return 'reservation';
}

function airbnbCode(event) {
  const m = /reservations\/details\/([A-Z0-9]{6,14})/i.exec(event.description || '');
  return m ? m[1].toUpperCase() : null;
}

// ---------------------------------------------------------------- import: safe fetching
const blocked = new net.BlockList();
for (const [addr, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2002::', 16]]) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}
function isPublicAddress(address, family) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !blocked.check(mapped[1], 'ipv4');
  return !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

// DNS lookup that refuses private/internal addresses, checked at connect time.
// Every resolved address must be public. Supports both callback shapes Node
// uses (single address, or `all: true` with autoSelectFamily).
function guardedLookup(hostname, options, callback) {
  const opts = typeof options === 'object' && options ? options : {};
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return callback(err);
    if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address, a.family))) {
      return callback(new Error('Calendar address points to a private network.'));
    }
    if (opts.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
}

function validateFeedUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) return null; // no raw IP addresses (v4 or [v6])
  return url;
}

function fetchText(rawUrl, redirects = 3) {
  return new Promise((resolve, reject) => {
    const url = validateFeedUrl(rawUrl);
    if (!url) { reject(new Error('Use the https:// calendar link from the channel.')); return; }
    const req = https.get(url, { lookup: guardedLookup, timeout: TIMEOUT_MS, headers: { 'User-Agent': 'BalayHub-Calendar-Sync/1.0', Accept: 'text/calendar, */*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(fetchText(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`The channel returned HTTP ${res.statusCode}. Check the link.`)); return; }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new Error('Calendar file is too large.')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('The channel took too long to respond.')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- import: sync
const CHANNEL_LABEL = { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', vrbo: 'Vrbo', expedia: 'Expedia', tripcom: 'Trip.com', other: 'Channel' };

function randomCode(prefix) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(7)) s += alphabet[b % alphabet.length];
  return `${prefix}-${s}`;
}

/**
 * Mirror one feed into bookings. Events that clash with an existing booking
 * are skipped and reported, never silently overwritten.
 */
async function syncFeed(feedId, { fetcher = fetchText } = {}) {
  const { rows: [feed] } = await pool.query('SELECT * FROM ical_feeds WHERE feed_id = $1', [feedId]);
  if (!feed) throw new Error('Feed not found');
  const label = CHANNEL_LABEL[feed.channel];
  let events;
  try {
    const text = await fetcher(feed.url);
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("That link didn't return a calendar file.");
    events = parseEvents(text);
  } catch (err) {
    const message = String(err.message || err).slice(0, 300);
    await pool.query(`UPDATE ical_feeds SET last_synced_at = now(), last_status = 'error', last_message = $2 WHERE feed_id = $1`, [feedId, message]);
    return { ok: false, message };
  }

  const { rows: [{ today }] } = await pool.query(`SELECT (now() AT TIME ZONE 'Asia/Manila')::date AS today`);
  const horizon = addDays(today, -60);
  events = events.filter((e) => e.end >= horizon);
  const counts = { added: 0, updated: 0, removed: 0, conflicts: [] };
  const newStays = []; // for a notification (not on a feed's first import)
  const freshOverlaps = []; // overlaps that are new, or back after being resolved: alerted once
  let result;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query('SELECT * FROM bookings WHERE ical_feed_id = $1', [feedId]);
    const byUid = new Map(existing.map((b) => [b.external_uid, b]));
    const { rows: priorConflicts } = await client.query('SELECT external_uid, resolved_at FROM ical_conflicts WHERE feed_id = $1', [feedId]);
    const openBefore = new Set(priorConflicts.filter((c) => !c.resolved_at).map((c) => c.external_uid));
    const overlaps = new Map(); // uid -> event skipped because its dates are taken in BalayHub
    const seen = new Set();
    for (const ev of events) {
      if (seen.has(ev.uid)) continue; // repeated UID (recurrence overrides): keep the first
      seen.add(ev.uid);
      const kind = classify(ev, feed.channel);
      const prev = byUid.get(ev.uid);
      await client.query('SAVEPOINT ev');
      try {
        if (prev) {
          const syncCancelled = prev.status === 'cancelled' && /^Removed from /.test(prev.cancel_reason || '');
          if (prev.status === 'cancelled' && !syncCancelled) {
            // Cancelled by the host in BalayHub: leave it cancelled.
          } else if (prev.check_in !== ev.start || prev.check_out !== ev.end || syncCancelled) {
            if (kind === 'reservation') await assertNotLeased(client, feed, ev);
            await client.query(
              `UPDATE bookings SET check_in = $2, check_out = $3, status = 'confirmed', cancelled_at = NULL, cancel_reason = NULL, updated_at = now()
                WHERE booking_id = $1`, [prev.booking_id, ev.start, ev.end]);
            counts.updated += 1;
          }
        } else {
          if (kind === 'reservation') await assertNotLeased(client, feed, ev);
          await client.query(
            `INSERT INTO bookings (organization_id, unit_id, kind, guest_label, channel, check_in, check_out, confirmation_code,
                                   block_reason, notes, ical_feed_id, external_uid)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [feed.organization_id, feed.unit_id, kind, kind === 'reservation' ? `${label} guest` : null, feed.channel,
              ev.start, ev.end, airbnbCode(ev) || randomCode(feed.channel.slice(0, 2).toUpperCase()),
              kind === 'block' ? `Blocked on ${label}` : null, ev.description || null, feedId, ev.uid]);
          counts.added += 1;
          if (kind === 'reservation' && feed.last_synced_at && ev.end >= today) newStays.push(ev);
        }
        await client.query('RELEASE SAVEPOINT ev');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT ev');
        if (['bookings_no_overlap', 'bookings_code_uq', 'bookings_feed_uid_uq'].includes(err.constraint)) {
          counts.conflicts.push(`${ev.start} to ${ev.end}`);
          if (err.constraint === 'bookings_no_overlap') {
            const fresh = !openBefore.has(ev.uid);
            overlaps.set(ev.uid, ev);
            await recordOverlap(client, feed, ev, fresh);
            if (fresh) freshOverlaps.push(ev);
          }
        } else throw err;
      }
    }
    // Overlaps the channel no longer reports (or that no longer clash) are resolved.
    await client.query(
      `UPDATE ical_conflicts SET resolved_at = now()
        WHERE feed_id = $1 AND resolved_at IS NULL AND external_uid <> ALL($2::text[])`,
      [feedId, [...overlaps.keys()]]);
    // Events that disappeared from the channel were cancelled or unblocked there.
    for (const b of existing) {
      if (seen.has(b.external_uid) || b.status !== 'confirmed' || b.check_out < today) continue;
      if (b.kind === 'block') {
        await client.query('DELETE FROM bookings WHERE booking_id = $1', [b.booking_id]);
      } else {
        await client.query(
          `UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE booking_id = $1`,
          [b.booking_id, `Removed from ${label} calendar`]);
      }
      counts.removed += 1;
    }
    const conflictNote = counts.conflicts.length
      ? ` ${counts.conflicts.length} stay(s) overlap bookings already in BalayHub and were skipped: ${counts.conflicts.slice(0, 5).join(', ')}.`
      : '';
    // A message starting "Synced:" with status 'error' means the sync worked but skipped overlaps.
    // synchealth.js relies on that prefix to tell overlaps apart from a failing feed.
    const message = `Synced: ${counts.added} new, ${counts.updated} changed, ${counts.removed} removed.${conflictNote}`;
    await client.query(
      `UPDATE ical_feeds SET last_synced_at = now(), last_status = $2, last_message = $3 WHERE feed_id = $1`,
      [feedId, counts.conflicts.length ? 'error' : 'ok', message]);
    await client.query('COMMIT');
    result = { ok: true, message, ...counts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const message = `Sync failed: ${String(err.message || err).slice(0, 250)}`;
    await pool.query(`UPDATE ical_feeds SET last_synced_at = now(), last_status = 'error', last_message = $2 WHERE feed_id = $1`, [feedId, message]).catch(() => {});
    console.error('[ical] sync error', feedId, err);
    return { ok: false, message };
  } finally {
    client.release();
  }
  // Sent after the connection is back in the pool, so a slow push service cannot hold it.
  // Both are still awaited, so they finish before the sync resolves.
  if (newStays.length) await notifyNewStays(feed, label, newStays).catch(() => {});
  if (freshOverlaps.length) await alertOverlaps(feed, label, freshOverlaps).catch(() => {});
  return result;
}

const fmtDay = (dd) => new Date(`${dd}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });

async function notifyNewStays(feed, label, stays) {
  const { notify } = require('./push');
  const { rows: [u] } = await pool.query('SELECT unit_name, property_id FROM units WHERE unit_id = $1', [feed.unit_id]);
  await notify(feed.organization_id, 'new_booking', {
    title: stays.length === 1 ? `New ${label} booking` : `${stays.length} new ${label} bookings`,
    body: stays.length === 1 ? `${u.unit_name}: ${fmtDay(stays[0].start)} – ${fmtDay(stays[0].end)}` : `${u.unit_name}: ${stays.map((x) => fmtDay(x.start)).join(', ')}`,
    url: '/#/reservations?view=recent',
    propertyId: u.property_id,
  });
}

// A stay can't be imported over an active monthly lease: it is skipped and recorded as an overlap, like a clash with another stay.
async function assertNotLeased(client, feed, ev) {
  if ((await leasedListings([feed.unit_id], ev.start, ev.end, client)).size) {
    throw Object.assign(new Error('Overlaps a monthly lease'), { constraint: 'bookings_no_overlap' });
  }
}

// An event skipped because its dates are taken in BalayHub (D-73). `fresh` marks a new problem, which gets an alert.
async function recordOverlap(client, feed, ev, fresh) {
  await client.query(
    `INSERT INTO ical_conflicts (organization_id, feed_id, unit_id, external_uid, check_in, check_out, alerted_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() END)
     ON CONFLICT (feed_id, external_uid) DO UPDATE SET check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
       last_seen_at = now(), resolved_at = NULL,
       alerted_at = CASE WHEN $7::boolean THEN now() ELSE ical_conflicts.alerted_at END`,
    [feed.organization_id, feed.feed_id, feed.unit_id, ev.uid, ev.start, ev.end, fresh]);
}

// One alert per new overlap, to the owners and the managers of the listing's property.
async function alertOverlaps(feed, label, events) {
  const { alertPeople } = require('./synchealth'); // lazy: synchealth.js requires this file
  const { rows: [u] } = await pool.query(
    `SELECT u.unit_name, u.property_id FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.unit_id = $1 AND u.status = 'active' AND p.status = 'active'`, [feed.unit_id]);
  if (!u) return; // archived listing or property: the overlap is still recorded, just not alerted
  for (const ev of events) {
    await alertPeople(feed.organization_id, u.property_id, {
      title: `${label} booking overlaps dates in BalayHub`,
      body: `${u.unit_name}: ${fmtDay(ev.start)} to ${fmtDay(ev.end)} was not added, because those dates are already taken. Check both bookings.`,
      url: '/#/listings',
    });
  }
}

async function syncAllFeeds() {
  const { rows } = await pool.query('SELECT feed_id FROM ical_feeds');
  for (const { feed_id: id } of rows) {
    try { await syncFeed(id); } catch (err) { console.error('[ical] sync failed', id, err.message); }
  }
}

module.exports = { guardedLookup, fetchText, buildCalendar, newFeedToken, parseEvents, classify, validateFeedUrl, isPublicAddress, syncFeed, syncAllFeeds, addDays, randomCode, CHANNEL_LABEL };
