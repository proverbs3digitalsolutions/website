'use strict';

// QA round 1, lane F7: the channels list gives each feed a plain problem message, with the raw
// channel text left in last_message for "Technical details". A new-booking alert is sent before
// the sync returns, and a failed alert cannot fail the sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const push = require('../src/lib/push');
const { pool } = require('../src/db');

const CHECK_LINK = "Check the link on the listing's Channels page.";
const STALE_MESSAGE = "The calendar hasn't updated for over 3 hours, so its bookings may be out of date.";
const today = manilaToday();
const d = (n) => ical.addDays(today, n);

let srv; let owner; let prop; let feedSeq = 0;
const originalNotify = push.notify;

async function addUnit(name) {
  const res = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '1800' });
  return res.data.unit.unit_id;
}

// A feed on a unit. `syncedHoursAgo` moves last_synced_at back; the default is a sync just now.
async function addFeed(unitId, { channel = 'airbnb', lastStatus = 'ok', lastMessage = null, syncedHoursAgo = 0 } = {}) {
  feedSeq += 1;
  const [row] = await sql(
    `INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status, last_message)
     SELECT p.organization_id, u.unit_id, $2::text, $3::text, now() - make_interval(hours => $4::int), $5::text, $6::text
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.unit_id = $1 RETURNING feed_id`,
    [unitId, channel, `https://www.airbnb.com/calendar/ical/f7-${feedSeq}.ics`, syncedHoursAgo, lastStatus, lastMessage]);
  return row.feed_id;
}

const ics = (events) => ['BEGIN:VCALENDAR', ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`,
  `DTSTART;VALUE=DATE:${e.s.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.e.replace(/-/g, '')}`, 'SUMMARY:Reserved', 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'f7-owner@example.com', 'F7 Channels Co');
  prop = (await owner.post('/api/properties', { property_name: 'Harbor Lofts', property_type: 'condominium', address: 'Pasay', city: 'Pasay', province: 'Metro Manila' })).data.property;
});
test.after(async () => {
  push.notify = originalNotify;
  await srv.close();
});

test('the channel list gives each feed a plain problem message and keeps the raw text in last_message', async () => {
  const unitId = await addUnit('Loft 1');
  const failing = await addFeed(unitId, { lastStatus: 'error', lastMessage: 'getaddrinfo ENOTFOUND qa-unreachable.invalid' });
  const healthy = await addFeed(unitId, { channel: 'booking', lastMessage: 'Synced: 0 new, 0 changed, 0 removed.' });
  const stale = await addFeed(unitId, { channel: 'agoda', lastMessage: 'Synced: 0 new, 0 changed, 0 removed.', syncedHoursAgo: 4 });

  const res = await owner.get(`/api/units/${unitId}/channels`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const byId = new Map(res.data.feeds.map((f) => [f.feed_id, f]));

  const bad = byId.get(failing);
  assert.equal(bad.problem_message, "Couldn't reach the calendar link. Check the link above, then press Sync now.");
  assert.ok(!bad.problem_message.includes('ENOTFOUND'));
  assert.equal(bad.last_message, 'getaddrinfo ENOTFOUND qa-unreachable.invalid');
  assert.equal(byId.get(healthy).problem_message, null);
  assert.equal(byId.get(stale).problem_message, STALE_MESSAGE);
});

test('the channel list refuses a stranger and a manager outside the listing', async () => {
  const unitId = await addUnit('Loft 2');
  const anon = await client(srv.base).get(`/api/units/${unitId}/channels`);
  assert.equal(anon.status, 401);
  const other = await ownerAccount(srv.base, 'f7-other@example.com', 'F7 Other Co');
  const cross = await other.get(`/api/units/${unitId}/channels`);
  assert.equal(cross.status, 404);
});

test('a new-booking alert is sent before the sync returns, and a failed alert cannot fail the sync', async () => {
  const alerts = [];
  push.notify = async (orgId, type, payload) => { alerts.push({ ...payload, type }); return 0; };
  const feedId = await addFeed(await addUnit('Loft 3'), { syncedHoursAgo: 1 });

  const r = await ical.syncFeed(feedId, { fetcher: async () => ics([{ uid: 'f7-new', s: d(5), e: d(7) }]) });
  assert.equal(r.ok, true);
  assert.equal(r.added, 1);
  // Sent by the time the sync returns, so nothing waits for it.
  const bookingAlerts = alerts.filter((a) => a.type === 'new_booking');
  assert.equal(bookingAlerts.length, 1, JSON.stringify(alerts));
  assert.equal(bookingAlerts[0].title, 'New Airbnb booking');
  assert.equal(bookingAlerts[0].propertyId, prop.property_id);

  push.notify = async () => { throw new Error('push service is down'); };
  const failFeed = await addFeed(await addUnit('Loft 4'), { syncedHoursAgo: 1 });
  const r2 = await ical.syncFeed(failFeed, { fetcher: async () => ics([{ uid: 'f7-fail', s: d(5), e: d(7) }]) });
  assert.equal(r2.ok, true, r2.message);
  assert.equal(r2.added, 1);
});

test('the sync hands its database connection back before it sends alerts', async () => {
  let checkedOutDuringAlert = null;
  push.notify = async () => { checkedOutDuringAlert = pool.totalCount - pool.idleCount; return 0; };
  const feedId = await addFeed(await addUnit('Loft 5'), { syncedHoursAgo: 1 });

  const r = await ical.syncFeed(feedId, { fetcher: async () => ics([{ uid: 'f7-conn', s: d(5), e: d(7) }]) });
  assert.equal(r.ok, true, r.message);
  // A slow alert must not hold a pool connection, or a burst of manual syncs can use up all 10.
  assert.equal(checkedOutDuringAlert, 0);
});
