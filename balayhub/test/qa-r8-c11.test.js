'use strict';

// QA round 8, lane C11: a review filter for a unit or property this workspace does not have is ignored (#38, D-82).
// Also: a sort or status word that is a JavaScript property name (constructor, __proto__) is ignored, not a 500.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const ZERO = '00000000-0000-0000-0000-000000000000';
const reviewIds = (list) => list.map((r) => r.review_id);
const sorted = (list) => [...list].sort();

async function property(owner, name) {
  const r = await owner.post('/api/properties', { property_name: name, property_type: 'condominium', address: `${name} Tower, Bicutan Ave`, city: 'Taguig', province: 'Metro Manila' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.property;
}
async function unit(owner, p, name) {
  const r = await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.unit;
}
// A two-night stay that ended `nights` days ago, with a review. Returns the review id.
async function reviewed(owner, u, guest, nights, rating) {
  const r = await owner.post('/api/reservations', { unit_id: u.unit_id, check_in: d(-nights), check_out: d(-nights + 2), guest_name: guest });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [row] = await sql('INSERT INTO guest_reviews (organization_id, booking_id, rating) SELECT organization_id, booking_id, $2 FROM bookings WHERE booking_id = $1 RETURNING review_id', [r.data.reservation.booking_id, rating]);
  return row.review_id;
}

let srv; let host; let staff; let azure; let breeze; let azureUnit; let breezeUnit; let otherUnit; let otherProperty;
let rA1; let rA2; let rB1; let rO;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Review Filter Stays');
  azure = await property(host, 'Azure');
  breeze = await property(host, 'Breeze');
  azureUnit = await unit(host, azure, '1201');
  breezeUnit = await unit(host, breeze, 'Loft');
  rA1 = await reviewed(host, azureUnit, 'Ana Cruz', 10, 5);
  rA2 = await reviewed(host, azureUnit, 'Ben Reyes', 6, 2);
  rB1 = await reviewed(host, breezeUnit, 'Carla Lim', 3, 3);
  // A second workspace with its own unit and review.
  const other = await ownerAccount(srv.base, 'other@example.com', 'Other Review Stays');
  otherProperty = await property(other, 'Cebu');
  otherUnit = await unit(other, otherProperty, '1201');
  rO = await reviewed(other, otherUnit, 'Dan Uy', 10, 4);
  // Staff who can see Azure only.
  const inv = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [azure.property_id] });
  staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Nene Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); });

test('#38 a unit or property this workspace does not have is ignored: the list is the unfiltered one (D-82)', async () => {
  const everything = (await host.get('/api/reviews')).data;
  assert.equal(everything.matched, 3);
  for (const filter of [`unit_id=${ZERO}`, `property_id=${ZERO}`]) {
    const r = await host.get(`/api/reviews?${filter}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(sorted(reviewIds(r.data.reviews)), sorted(reviewIds(everything.reviews)), filter);
    assert.equal(r.data.matched, everything.matched, filter);
    assert.equal(r.data.matched_average, everything.matched_average, filter);
  }
});

test('#38 a unit or property of this workspace still filters the list', async () => {
  const ids = async (q) => sorted(reviewIds((await host.get(`/api/reviews?${q}`)).data.reviews));
  assert.deepEqual(await ids(`unit_id=${azureUnit.unit_id}`), sorted([rA1, rA2]));
  assert.deepEqual(await ids(`property_id=${breeze.property_id}`), [rB1]);
  assert.deepEqual(await ids(`property_id=${azure.property_id}`), sorted([rA1, rA2]));
});

test('#38 a unit or property from another workspace is ignored and never returns its reviews', async () => {
  const everything = (await host.get('/api/reviews')).data;
  for (const filter of [`unit_id=${otherUnit.unit_id}`, `property_id=${otherProperty.property_id}`]) {
    const r = await host.get(`/api/reviews?${filter}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.matched, everything.matched, filter);
    assert.ok(!reviewIds(r.data.reviews).includes(rO), filter);
  }
});

test('#38 staff filtering by a unit they cannot see get nothing, not the full list', async () => {
  assert.equal((await staff.get('/api/reviews')).data.count, 2);
  const hidden = await staff.get(`/api/reviews?unit_id=${breezeUnit.unit_id}`);
  assert.equal(hidden.status, 200, JSON.stringify(hidden.data));
  assert.equal(hidden.data.matched, 0);
  const shown = await staff.get(`/api/reviews?unit_id=${azureUnit.unit_id}`);
  assert.deepEqual(sorted(reviewIds(shown.data.reviews)), sorted([rA1, rA2]));
});

test('a sort or status word that is a JavaScript property name is ignored like any other bad value', async () => {
  const everything = (await host.get('/api/reviews')).data;
  for (const word of ['constructor', 'toString', '__proto__']) {
    const reviews = await host.get(`/api/reviews?sort=${word}`);
    assert.equal(reviews.status, 200, `reviews sort=${word}: ${JSON.stringify(reviews.data)}`);
    assert.deepEqual(reviewIds(reviews.data.reviews), reviewIds(everything.reviews), `reviews sort=${word}`);
    const status = await host.get(`/api/discount-codes?status=${word}`);
    assert.equal(status.status, 200, `discount-codes status=${word}: ${JSON.stringify(status.data)}`);
    const sort = await host.get(`/api/discount-codes?sort=${word}`);
    assert.equal(sort.status, 200, `discount-codes sort=${word}: ${JSON.stringify(sort.data)}`);
  }
});
