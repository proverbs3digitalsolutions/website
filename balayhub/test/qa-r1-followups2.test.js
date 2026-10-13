'use strict';

process.env.SMTP_URL = 'test://';

// QA round 1, lane F4: the daily close refuses days that are not on the calendar, and its sync
// problems use the same plain wording as the sync-health screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');

let srv; let owner;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'f4-owner@example.com', 'F4 Stays');
});
test.after(async () => { await srv.close(); });

test('daily close refuses a date that is not a real calendar day', async () => {
  for (const date of ['2026-02-30', '2027-02-29']) {
    const g = await owner.get(`/api/daily-close?date=${date}`);
    assert.equal(g.status, 400, date);
    assert.ok(g.data.fields.date, date);
    const p = await owner.post('/api/daily-close', { date });
    assert.equal(p.status, 400, date);
    assert.ok(p.data.fields.date, date);
  }
});

test('daily close sync problems say the plain message, not a hard-coded sentence', async () => {
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'house', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1A', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status, last_message)
             SELECT p.organization_id, u.unit_id, 'airbnb', 'https://example.com/a.ics', now(), 'error', 'The channel returned HTTP 404. Check the link.'
               FROM units u JOIN properties p USING (property_id) WHERE u.unit_id = $1`, [unit.unit_id]);
  const body = (await owner.get('/api/daily-close')).data;
  const items = body.sections.find((s) => s.key === 'sync_problems').items;
  assert.equal(items.length, 1);
  assert.equal(items[0].detail, "The channel's calendar link returned an error. Check the link on the listing's Channels page.");
});
