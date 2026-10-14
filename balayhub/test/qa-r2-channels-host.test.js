'use strict';

// QA round 2, lane R2 channel host: GET /units/:id/channels gives each feed the link's host, the same
// host GET /sync-health gives, so the Channels dialog can say which calendar a feed is. The route is
// owner and manager only (requireRole in src/routes/stays.js), so the full link stays with them.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');

let srv; let owner; let manager; let staff; let prop; let unit; let feedId;
const feedUrl = 'https://calendar.example.org/feeds/secret-token-123.ics';

async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r2channels@example.com', 'R2 Channels');
  prop = (await owner.post('/api/properties', { property_name: 'Channel House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Unit 1', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = await invite('r2channels-manager@example.com', 'manager', [prop.property_id]);
  staff = await invite('r2channels-staff@example.com', 'staff', [prop.property_id]);
  // Inserted directly, so no network fetch runs: the feed only needs a link to report on.
  const [row] = await sql(
    `INSERT INTO ical_feeds (organization_id, unit_id, channel, url)
     SELECT p.organization_id, u.unit_id, 'airbnb', $2::text
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.unit_id = $1 RETURNING feed_id`,
    [unit.unit_id, feedUrl]);
  feedId = row.feed_id;
});
test.after(async () => { await srv.close(); });

test('the owner sees each feed\'s host and its full link', async () => {
  const res = await owner.get(`/api/units/${unit.unit_id}/channels`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const feed = res.data.feeds.find((f) => f.feed_id === feedId);
  assert.equal(feed.host, 'calendar.example.org', 'the host is the same one GET /sync-health gives');
  assert.equal(feed.url, feedUrl);
});

test('the manager, who can reach the route, also sees the host and the full link', async () => {
  const res = await manager.get(`/api/units/${unit.unit_id}/channels`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const feed = res.data.feeds.find((f) => f.feed_id === feedId);
  assert.equal(feed.host, 'calendar.example.org');
  assert.equal(feed.url, feedUrl);
});

test('staff cannot reach the route, so the feed links and hosts are not returned to them', async () => {
  const res = await staff.get(`/api/units/${unit.unit_id}/channels`);
  assert.equal(res.status, 403, JSON.stringify(res.data));
  assert.equal(res.data.feeds, undefined);
});

test('GET /sync-health gives the same host for the same feed', async () => {
  // Make the feed look failing so it shows up in the health list.
  await sql(`UPDATE ical_feeds SET last_status = 'error', last_message = 'Not found', last_synced_at = now() WHERE feed_id = $1`, [feedId]);
  const health = await owner.get('/api/sync-health');
  assert.equal(health.status, 200, JSON.stringify(health.data));
  const problem = health.data.problems.find((p) => p.feed_id === feedId);
  assert.ok(problem, 'the failing feed is in the health list');
  assert.equal(problem.host, 'calendar.example.org');
});
