'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { checkFeeds } = require('../src/lib/synchealth');
const push = require('../src/lib/push');

let srv; let owner; let manager; let staff; let prop; let prop2; let unit; let unit2; let unit3;
let ownerId; let managerId;
const today = manilaToday();
const d = (n) => ical.addDays(today, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Count what reaches the push layer (notify.notifyUser calls push.notify once per person it
// reaches). Spying there keeps push.allowed() in the path, so a missing push.TYPES entry shows up.
const alerts = [];
const originalNotify = push.notify;
function spyAlerts() {
  alerts.length = 0;
  push.notify = async (orgId, type, payload) => { alerts.push({ ...payload, type }); return 0; };
}
async function waitForAlerts(n) {
  for (let i = 0; i < 100 && alerts.length < n; i++) await sleep(20);
}

async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

let feedSeq = 0;
// A feed for a listing, with a unique URL. Returns feed_id.
async function addFeed(unitId, channel = 'airbnb') {
  feedSeq += 1;
  const [row] = await sql(
    `INSERT INTO ical_feeds (organization_id, unit_id, channel, url)
     SELECT p.organization_id, u.unit_id, $2::text, $3::text
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.unit_id = $1 RETURNING feed_id`,
    [unitId, channel, `https://www.airbnb.com/calendar/ical/${feedSeq}.ics`]);
  return row.feed_id;
}

const ics = (events) => ['BEGIN:VCALENDAR', ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`,
  `DTSTART;VALUE=DATE:${e.s.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.e.replace(/-/g, '')}`, 'SUMMARY:Reserved', 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

const problemsFor = async (c) => {
  const res = await c.get('/api/sync-health');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.problems;
};

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'sync-owner@example.com', 'Sync Test Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure Residences', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Tower 1 - 1201', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  unit2 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Tower 2 - 805', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
  prop2 = (await owner.post('/api/properties', { property_name: 'Sea Breeze', property_type: 'condominium', address: 'Pasay', city: 'Pasay', province: 'Metro Manila' })).data.property;
  unit3 = (await owner.post(`/api/properties/${prop2.property_id}/units`, { unit_name: 'Seaside 4', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
  manager = await invite('sync-manager@example.com', 'manager', [prop.property_id]);
  staff = await invite('sync-staff@example.com', 'staff', [prop.property_id]);
  ownerId = (await sql(`SELECT user_id FROM users WHERE email = 'sync-owner@example.com'`))[0].user_id;
  managerId = (await sql(`SELECT user_id FROM users WHERE email = 'sync-manager@example.com'`))[0].user_id;
});
test.after(async () => {
  push.notify = originalNotify;
  await srv.close();
});

test('an overlap is recorded once, alerts each person once, and resolves when the channel stops showing it', async () => {
  const feedId = await addFeed(unit2.unit_id);
  // Creating the direct booking sends its own owner push, so start counting alerts after it.
  await owner.post('/api/reservations', { unit_id: unit2.unit_id, check_in: d(30), check_out: d(32), guest_name: 'Direct Guest', accommodation_total: '3600' });
  spyAlerts();

  let r = await ical.syncFeed(feedId, { fetcher: async () => ics([{ uid: 'ov1', s: d(31), e: d(33) }]) });
  assert.equal(r.conflicts.length, 1);
  let rows = await sql('SELECT external_uid, check_in, check_out, alerted_at, resolved_at FROM ical_conflicts WHERE feed_id = $1', [feedId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].external_uid, 'ov1');
  assert.equal(rows[0].check_in, d(31));
  assert.equal(rows[0].check_out, d(33));
  assert.ok(rows[0].alerted_at);
  assert.equal(rows[0].resolved_at, null);

  // The overlap is in the health list, and the feed itself is not "failing": the sync worked.
  const ownerList = await problemsFor(owner);
  const overlap = ownerList.find((p) => p.feed_id === feedId);
  assert.equal(overlap.kind, 'overlap');
  assert.equal(overlap.unit_name, 'Tower 2 - 805');
  assert.equal(overlap.channel, 'airbnb');
  assert.equal(overlap.check_in, d(31));
  assert.equal(overlap.check_out, d(33));
  assert.equal(ownerList.filter((p) => p.feed_id === feedId).length, 1);

  // The owner and the manager of the property each get one alert.
  await waitForAlerts(2);
  assert.equal(alerts.length, 2, JSON.stringify(alerts.map((a) => [a.title, a.userId])));
  assert.deepEqual(alerts.map((a) => a.userId).sort(), [ownerId, managerId].sort());
  for (const a of alerts) {
    assert.match(a.title, /^Airbnb booking overlaps dates in BalayHub$/);
    assert.equal(a.url, '/#/listings');
    assert.equal(a.propertyId, prop.property_id);
  }

  // Same clash on the next sync: still one row, no second alert.
  const firstSeen = (await sql('SELECT first_seen_at FROM ical_conflicts WHERE feed_id = $1', [feedId]))[0].first_seen_at;
  r = await ical.syncFeed(feedId, { fetcher: async () => ics([{ uid: 'ov1', s: d(31), e: d(33) }]) });
  assert.equal(r.conflicts.length, 1);
  await sleep(200);
  assert.equal(alerts.length, 2, 'no second alert for the same problem');
  rows = await sql('SELECT first_seen_at FROM ical_conflicts WHERE feed_id = $1', [feedId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].first_seen_at.getTime(), firstSeen.getTime());

  // The channel drops the booking: the overlap is resolved and leaves the list.
  r = await ical.syncFeed(feedId, { fetcher: async () => ics([]) });
  assert.equal(r.ok, true);
  rows = await sql('SELECT resolved_at FROM ical_conflicts WHERE feed_id = $1', [feedId]);
  assert.ok(rows[0].resolved_at);
  assert.equal((await problemsFor(owner)).some((p) => p.feed_id === feedId), false);

  // It comes back: a new problem, so both people are alerted again.
  r = await ical.syncFeed(feedId, { fetcher: async () => ics([{ uid: 'ov1', s: d(31), e: d(33) }]) });
  assert.equal(r.conflicts.length, 1);
  await waitForAlerts(4);
  assert.equal(alerts.length, 4, JSON.stringify(alerts.map((a) => [a.title, a.userId])));
  rows = await sql('SELECT resolved_at FROM ical_conflicts WHERE feed_id = $1', [feedId]);
  assert.equal(rows[0].resolved_at, null);
});

test('stale and failing feeds: one alert per problem, cleared when healthy, scoped by property', async () => {
  spyAlerts();
  const staleFeed = await addFeed(unit3.unit_id, 'booking');
  await sql(`UPDATE ical_feeds SET created_at = now() - interval '4 hours' WHERE feed_id = $1`, [staleFeed]);
  const failingFeed = await addFeed(unit.unit_id);
  await sql(`UPDATE ical_feeds SET last_synced_at = now(), last_status = 'error', last_message = $2 WHERE feed_id = $1`,
    [failingFeed, 'The channel returned HTTP 404. Check the link.']);

  // Stale feed: its property has only the owner (one alert). Failing feed: owner and manager (two).
  await checkFeeds(new Date());
  assert.equal(alerts.length, 3, JSON.stringify(alerts.map((a) => [a.title, a.userId])));
  const failingAlerts = alerts.filter((a) => a.title === "Airbnb calendar can't be read");
  assert.deepEqual(failingAlerts.map((a) => a.userId).sort(), [ownerId, managerId].sort());
  const staleAlerts = alerts.filter((a) => a.title === "Booking.com calendar hasn't updated in BalayHub");
  assert.deepEqual(staleAlerts.map((a) => a.userId), [ownerId]);
  const flags = await sql('SELECT feed_id, problem_since, alerted_at FROM ical_feeds WHERE feed_id = ANY($1::uuid[])', [[staleFeed, failingFeed]]);
  for (const f of flags) {
    assert.ok(f.problem_since);
    assert.ok(f.alerted_at);
  }

  // Still the same problems: no new alerts.
  await checkFeeds(new Date());
  assert.equal(alerts.length, 3, 'one alert per problem');

  // The owner sees both, with the channel key and the reason for the failing feed.
  const ownerList = await problemsFor(owner);
  const stale = ownerList.find((p) => p.feed_id === staleFeed);
  const failing = ownerList.find((p) => p.feed_id === failingFeed);
  assert.equal(stale.kind, 'stale');
  assert.equal(stale.channel, 'booking');
  assert.equal(stale.unit_name, 'Seaside 4');
  assert.equal(failing.kind, 'failing');
  assert.equal(failing.message, 'The channel returned HTTP 404. Check the link.');
  assert.ok(!Number.isNaN(Date.parse(failing.since)), 'since is an ISO time');

  // A manager assigned to the first property sees only that property's feed.
  // (The open overlap left by the first test is on this property too, so it is listed.)
  const managerList = await problemsFor(manager);
  assert.deepEqual(managerList.map((p) => [p.kind, p.unit_name]).sort(), [['failing', 'Tower 1 - 1201'], ['overlap', 'Tower 2 - 805']]);

  // Staff are refused, and so is an anonymous caller.
  assert.equal((await staff.get('/api/sync-health')).status, 403);
  assert.equal((await client(srv.base).get('/api/sync-health')).status, 401);

  // The stale feed syncs again: the problem clears, and its alert with it.
  await sql('UPDATE ical_feeds SET last_synced_at = now() WHERE feed_id = $1', [staleFeed]);
  await checkFeeds(new Date());
  const cleared = (await sql('SELECT problem_since, alerted_at FROM ical_feeds WHERE feed_id = $1', [staleFeed]))[0];
  assert.equal(cleared.problem_since, null);
  assert.equal(cleared.alerted_at, null);
  assert.equal(alerts.length, 3);

  // It goes quiet again: a new problem, so a new alert to the owner.
  await sql(`UPDATE ical_feeds SET last_synced_at = now() - interval '4 hours' WHERE feed_id = $1`, [staleFeed]);
  await checkFeeds(new Date());
  assert.equal(alerts.length, 4);
});

test('demo and read-only workspaces are not alerted', async () => {
  spyAlerts();
  const demo = await ownerAccount(srv.base, 'sync-demo@example.com', 'Demo Co');
  const dp = (await demo.post('/api/properties', { property_name: 'Demo House', property_type: 'condominium', address: 'Makati', city: 'Makati', province: 'Metro Manila' })).data.property;
  const du = (await demo.post(`/api/properties/${dp.property_id}/units`, { unit_name: 'Demo 1', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const demoFeed = await addFeed(du.unit_id);
  await sql(`UPDATE ical_feeds SET created_at = now() - interval '4 hours' WHERE feed_id = $1`, [demoFeed]);
  await sql('UPDATE organizations SET is_demo = true WHERE organization_id = $1', [dp.organization_id]);

  const readOnly = await ownerAccount(srv.base, 'sync-lapsed@example.com', 'Lapsed Co');
  const lp = (await readOnly.post('/api/properties', { property_name: 'Lapsed House', property_type: 'condominium', address: 'Ortigas', city: 'Pasig', province: 'Metro Manila' })).data.property;
  const lu = (await readOnly.post(`/api/properties/${lp.property_id}/units`, { unit_name: 'Lapsed 1', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const lapsedFeed = await addFeed(lu.unit_id);
  await sql(`UPDATE ical_feeds SET created_at = now() - interval '4 hours' WHERE feed_id = $1`, [lapsedFeed]);
  await sql(`UPDATE organizations SET plan = 'starter', paid_until = '2020-01-01' WHERE organization_id = $1`, [lp.organization_id]);

  // Other tests' feeds are already alerted, so nothing new may be sent at all here.
  await checkFeeds(new Date());
  assert.equal(alerts.length, 0, JSON.stringify(alerts.map((a) => a.title)));
  const flags = await sql('SELECT feed_id, problem_since FROM ical_feeds WHERE feed_id = ANY($1::uuid[])', [[demoFeed, lapsedFeed]]);
  for (const f of flags) assert.equal(f.problem_since, null);

  // Other workspaces never see these listings in their health list (tenant isolation).
  assert.deepEqual((await problemsFor(demo)).map((p) => p.feed_id), [demoFeed]);
  assert.deepEqual((await problemsFor(readOnly)).map((p) => p.feed_id), [lapsedFeed]);
  assert.ok((await problemsFor(owner)).every((p) => p.feed_id !== demoFeed && p.feed_id !== lapsedFeed));
});

test('archived listings and properties are not alerted, listed or alerted about overlaps, but still sync', async () => {
  spyAlerts();
  // Control: an active listing with a stale feed is alerted as usual.
  const liveUnit = (await owner.post(`/api/properties/${prop2.property_id}/units`, { unit_name: 'Seaside 10', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
  const liveFeed = await addFeed(liveUnit.unit_id, 'agoda');
  const archivedUnit = (await owner.post(`/api/properties/${prop2.property_id}/units`, { unit_name: 'Seaside 11', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
  const archivedUnitFeed = await addFeed(archivedUnit.unit_id);
  const oldProp = (await owner.post('/api/properties', { property_name: 'Old Wing', property_type: 'condominium', address: 'Ortigas', city: 'Pasig', province: 'Metro Manila' })).data.property;
  const oldUnit = (await owner.post(`/api/properties/${oldProp.property_id}/units`, { unit_name: 'Old Wing 1', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const oldPropFeed = await addFeed(oldUnit.unit_id);
  for (const f of [liveFeed, archivedUnitFeed, oldPropFeed]) {
    await sql(`UPDATE ical_feeds SET created_at = now() - interval '4 hours' WHERE feed_id = $1`, [f]);
  }
  // An overlap on the listing that will be archived needs a stay there first.
  await owner.post('/api/reservations', { unit_id: archivedUnit.unit_id, check_in: d(60), check_out: d(62), guest_name: 'Old Guest', accommodation_total: '3600' });
  assert.equal((await owner.post(`/api/units/${archivedUnit.unit_id}/archive`)).status, 200);
  assert.equal((await owner.post(`/api/properties/${oldProp.property_id}/archive`)).status, 200);

  await checkFeeds(new Date());
  assert.equal(alerts.length, 1, JSON.stringify(alerts.map((a) => [a.title, a.body])));
  assert.equal(alerts[0].title, "Agoda calendar hasn't updated in BalayHub");
  assert.match(alerts[0].body, /^Seaside 10:/);
  const flags = await sql('SELECT feed_id, problem_since FROM ical_feeds WHERE feed_id = ANY($1::uuid[])', [[archivedUnitFeed, oldPropFeed]]);
  for (const f of flags) assert.equal(f.problem_since, null, 'archived feeds are not marked as problems');

  const listed = (await problemsFor(owner)).map((p) => p.feed_id);
  assert.ok(listed.includes(liveFeed));
  assert.ok(!listed.includes(archivedUnitFeed));
  assert.ok(!listed.includes(oldPropFeed));

  // The archived listing still syncs: its overlap is recorded, but nobody is alerted or told in the health list.
  const r = await ical.syncFeed(archivedUnitFeed, { fetcher: async () => ics([{ uid: 'arch1', s: d(61), e: d(63) }]) });
  assert.equal(r.conflicts.length, 1, 'the sync still skips the overlap');
  const recorded = await sql('SELECT resolved_at FROM ical_conflicts WHERE feed_id = $1', [archivedUnitFeed]);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].resolved_at, null);
  await sleep(200);
  assert.equal(alerts.length, 1, 'no overlap alert for an archived listing');
  assert.equal((await problemsFor(owner)).some((p) => p.feed_id === archivedUnitFeed), false);
});
