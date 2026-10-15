'use strict';

// QA round 15, lane SV5 (src/routes/stays.js). #30: a calendar link that doesn't look like one asks before it is saved.
// A link whose path doesn't end in .ics and whose path or query has no "ical" answers 409 ICAL_NOT_CALENDAR
// until the request carries confirm_unusual_link: true. Booking.com's ical.html?t=... export is not asked about.
// Run: TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_19 node --test --test-concurrency=1 test/qa-r15-sv5.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const ical = require('../src/lib/ical');

const QUESTION = "This doesn't look like a calendar link (they usually end in .ics). Save it anyway?";
const PAGE_LINK = 'https://www.airbnb.com/rooms/12345';

let srv; let owner; let unit; let syncCalls = 0;
const realSync = ical.syncFeed;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host-sv5@example.com', 'Ridge Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Ridge House', property_type: 'condominium', address: 'Tagaytay', city: 'Tagaytay', province: 'Cavite' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Main house', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  // A saved link runs a first sync. Stub it so these tests never reach a real channel; the route calls it on the module object.
  ical.syncFeed = async () => { syncCalls += 1; return { ok: true, added: 0, updated: 0, removed: 0, conflicts: [] }; };
});
test.after(async () => { ical.syncFeed = realSync; await srv.close(); });

const addFeed = (url, extra = {}) => owner.post('/api/ical-feeds', { unit_id: unit.unit_id, channel: 'airbnb', url, ...extra });
const savedUrls = async () => (await sql('SELECT url FROM ical_feeds WHERE unit_id = $1', [unit.unit_id])).map((r) => r.url);

test('a page link asks first and saves nothing', async () => {
  syncCalls = 0;
  const asked = await addFeed(PAGE_LINK);
  assert.equal(asked.status, 409, JSON.stringify(asked.data));
  assert.equal(asked.data.code, 'ICAL_NOT_CALENDAR');
  assert.equal(asked.data.error, QUESTION);
  assert.equal((await savedUrls()).includes(PAGE_LINK), false);
  assert.equal(syncCalls, 0);
});

test('an explicit false or a non-boolean confirmation still asks', async () => {
  for (const [id, flag] of [['22222', false], ['33333', 'yes']]) {
    const url = `https://www.airbnb.com/rooms/${id}`;
    const no = await addFeed(url, { confirm_unusual_link: flag });
    assert.equal(no.status, 409, JSON.stringify(no.data));
    assert.equal(no.data.error, QUESTION);
    assert.equal((await savedUrls()).includes(url), false);
  }
});

test('the resend with confirm_unusual_link saves the link and syncs it', async () => {
  syncCalls = 0;
  const saved = await addFeed('https://www.airbnb.com/rooms/67890', { confirm_unusual_link: true });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.equal((await savedUrls()).includes('https://www.airbnb.com/rooms/67890'), true);
  assert.equal(syncCalls, 1);
});

test('a calendar file link saves with no question', async () => {
  const r = await addFeed('https://www.airbnb.com/calendar/ical/1.ics?s=x');
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

test('a Booking.com ical.html export saves with no question', async () => {
  const r = await addFeed('https://admin.booking.com/hotel/hoteladmin/ical.html?t=x');
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

test('the .ics ending and the word ical ignore letter case; ical in the query counts', async () => {
  assert.equal((await addFeed('https://www.example-channel.com/export/CAL.ICS')).status, 201);
  assert.equal((await addFeed('https://www.example-channel.com/feed?format=ICAL')).status, 201);
});

test('the word ical in the host alone does not count', async () => {
  const r = await addFeed('https://ical.example-channel.com/rooms/1');
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error, QUESTION);
});

test('another workspace gets 404 for the page link, never the question', async () => {
  const other = await ownerAccount(srv.base, 'other-sv5@example.com', 'Other Stays');
  const r = await other.post('/api/ical-feeds', { unit_id: unit.unit_id, channel: 'airbnb', url: PAGE_LINK });
  assert.equal(r.status, 404, JSON.stringify(r.data));
  assert.notEqual(r.data.code, 'ICAL_NOT_CALENDAR');
});
