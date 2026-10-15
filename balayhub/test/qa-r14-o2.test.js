'use strict';

// QA round 14, lane O2 (Launchpad channels step). node --test --test-concurrency=1 test/qa-r14-o2.test.js
// The "Connect your Airbnb or Booking.com calendar" step links to the listing Home's "Connect calendar" card opens:
// the first active listing in the order GET /listings uses, as #/listings?channels=<unit id>. No listing: #/listings.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount } = require('./helpers');

let srv; let owner;
const channelsStep = async () => (await owner.get('/api/onboarding')).data.steps.find((x) => x.key === 'channels');

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'o2-owner@example.com', 'Launchpad Stays');
});
test.after(async () => { await srv.close(); });

test('with no listings, the channels step links to Listings', async () => {
  assert.equal((await channelsStep()).href, '#/listings');
});

test('with two listings, the channels step opens the listing Home\'s Connect calendar card opens', async () => {
  // Added in reverse order, so the sort (property name, then unit name) decides which listing comes first.
  const zenith = (await owner.post('/api/properties', { property_name: 'Zenith Tower', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  await owner.post(`/api/properties/${zenith.property_id}/units`, { unit_name: '0901', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 });
  const azure = (await owner.post('/api/properties', { property_name: 'Azure Residences', property_type: 'condominium', address: 'Lakeshore Dr', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const first = (await owner.post(`/api/properties/${azure.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 })).data.unit;

  const { listings } = (await owner.get('/api/listings')).data;
  assert.equal(listings.length, 2);
  assert.equal(listings[0].unit_id, first.unit_id, 'Home opens the first listing from GET /listings');
  assert.equal((await channelsStep()).href, `#/listings?channels=${first.unit_id}`);
});
