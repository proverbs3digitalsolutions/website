'use strict';

// QA round 1, bug #3: the calendar sync warning showed the raw network error ("getaddrinfo
// ENOTFOUND ...") in its tooltip, its screen-reader label and the owner's alert. Owners now get
// plain words in `message`, and the raw text is kept in `detail`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { checkFeeds } = require('../src/lib/synchealth');
const push = require('../src/lib/push');

const CHECK_LINK = "Check the link on the listing's Channels page.";
const STALE_MESSAGE = "The calendar hasn't updated for over 3 hours, so its bookings may be out of date.";

// One failing feed per kind of error that ical.js writes into last_message.
const CASES = [
  { raw: 'getaddrinfo ENOTFOUND qa-unreachable.invalid', message: `Couldn't reach the calendar link. ${CHECK_LINK}` },
  { raw: 'The channel returned HTTP 404. Check the link.', message: `The channel's calendar link returned an error. ${CHECK_LINK}` },
  { raw: "That link didn't return a calendar file.", message: `The link doesn't lead to a calendar file. ${CHECK_LINK}` },
  { raw: 'Calendar file is too large.', message: `The calendar file is too big for BalayHub to read. ${CHECK_LINK}` },
  { raw: 'The channel took too long to respond.', message: `The channel took too long to answer. ${CHECK_LINK}` },
  { raw: 'Sync failed: deadlock detected', message: "BalayHub couldn't save the bookings from this calendar. Try again later, or contact support if it keeps happening." },
];

let srv; let owner; let prop; let feedSeq = 0;
const originalNotify = push.notify;

async function addUnit(name) {
  const res = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '1800' });
  return res.data.unit.unit_id;
}

// A feed on a unit. `syncedHoursAgo` moves last_synced_at back; the default is a sync just now.
async function addFeed(unitId, { lastStatus = 'error', lastMessage = null, syncedHoursAgo = 0 } = {}) {
  feedSeq += 1;
  const [row] = await sql(
    `INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status, last_message)
     SELECT p.organization_id, u.unit_id, 'airbnb', $2::text, now() - make_interval(hours => $3::int), $4::text, $5::text
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.unit_id = $1 RETURNING feed_id`,
    [unitId, `https://www.airbnb.com/calendar/ical/l19-${feedSeq}.ics`, syncedHoursAgo, lastStatus, lastMessage]);
  return row.feed_id;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'synchealth-msg-owner@example.com', 'Sync Message Co');
  prop = (await owner.post('/api/properties', { property_name: 'Loft Building', property_type: 'condominium', address: 'Makati', city: 'Makati', province: 'Metro Manila' })).data.property;
});
test.after(async () => {
  push.notify = originalNotify;
  await srv.close();
});

test('each kind of sync problem says what is wrong in plain words, and keeps the raw error in detail', async () => {
  for (const [i, c] of CASES.entries()) {
    await addFeed(await addUnit(`Loft ${i + 1}`), { lastMessage: c.raw });
  }
  await addFeed(await addUnit('Loft 7'), { lastStatus: 'ok', lastMessage: 'Synced: 2 new, 0 changed, 0 removed.', syncedHoursAgo: 4 });
  // An overlap: a healthy feed with an open clash. It has no raw error, so detail is null.
  const overlapFeed = await addFeed(await addUnit('Loft 8'), { lastStatus: 'ok', lastMessage: 'Synced: 0 new, 0 changed, 0 removed.' });
  await sql(`INSERT INTO ical_conflicts (organization_id, feed_id, unit_id, external_uid, check_in, check_out)
    SELECT f.organization_id, f.feed_id, f.unit_id, 'l19-ov', CURRENT_DATE + 30, CURRENT_DATE + 32
      FROM ical_feeds f WHERE f.feed_id = $1`, [overlapFeed]);

  const res = await owner.get('/api/sync-health');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const byUnit = new Map(res.data.problems.map((p) => [p.unit_name, p]));

  for (const [i, c] of CASES.entries()) {
    const p = byUnit.get(`Loft ${i + 1}`);
    assert.equal(p.kind, 'failing', c.raw);
    assert.equal(p.message, c.message);
    assert.equal(p.detail, c.raw);
  }
  const stale = byUnit.get('Loft 7');
  assert.equal(stale.kind, 'stale');
  assert.equal(stale.message, STALE_MESSAGE);
  assert.equal(stale.detail, null);
  const overlap = byUnit.get('Loft 8');
  assert.equal(overlap.kind, 'overlap');
  assert.equal(overlap.message, 'Overlaps dates already taken in BalayHub, so it was not added.');
  assert.equal(overlap.detail, null);
});

test('the alert for a failing or stale feed uses the same plain words, with no raw error', async () => {
  const alerts = [];
  push.notify = async (orgId, type, payload) => { alerts.push({ ...payload, type }); return 0; };
  await addFeed(await addUnit('Loft 9'), { lastMessage: 'getaddrinfo ENOTFOUND qa-unreachable.invalid' });

  await checkFeeds(new Date());

  const failingAlerts = alerts.filter((a) => a.body.startsWith('Loft 9: '));
  assert.equal(failingAlerts.length, 1, JSON.stringify(alerts.map((a) => a.body)));
  assert.equal(failingAlerts[0].title, "Airbnb calendar can't be read");
  assert.equal(failingAlerts[0].body, `Loft 9: ${CASES[0].message}`);
  assert.ok(!failingAlerts[0].body.includes('ENOTFOUND'));

  // The stale feed from the test above is alerted with the same stale wording as the calendar.
  const staleAlerts = alerts.filter((a) => a.body.startsWith('Loft 7: '));
  assert.equal(staleAlerts.length, 1);
  assert.equal(staleAlerts[0].body, `Loft 7: ${STALE_MESSAGE}`);
});
