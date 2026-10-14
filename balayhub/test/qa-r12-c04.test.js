'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA round 12, lane C04. #2 the quote names the stay or lease that clashes, with the sentence PATCH gives
// (exclude_booking_id leaves out the stay being edited); #11 the public quote names the price rules that changed a night.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_01 node --test --test-concurrency=1 test/qa-r12-c04.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

let srv; let owner; let prop; let unit;
const d = (n) => ical.addDays(manilaToday(), n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qar12c04@example.com', 'QA R12 C04');
  prop = (await owner.post('/api/properties', { property_name: 'R12 Place', property_type: 'condominium', address: '1 Test St, Pasig', city: 'Pasig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'R12 Studio', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '0', max_guests: 4, room_type: 'studio', bookable_online: true, min_nights: 2,
  })).data.unit;
});
test.after(async () => { await srv.close(); });

test('#2 a quote for moved dates names the stay that clashes, with the PATCH sentence; the stay being edited is left out', async () => {
  await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ana A' });
  const b = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(12), check_out: d(14), guest_name: 'Ben B' })).data.reservation;
  const quoteFor = (ci, co, exclude) => owner.get(`/api/reservations/quote?unit_id=${unit.unit_id}&check_in=${ci}&check_out=${co}${exclude ? `&exclude_booking_id=${exclude}` : ''}`);

  // B moved to 11 to 14 runs into A (10 to 12): the quote answers 200 and names the clash.
  const moved = await quoteFor(d(11), d(14), b.booking_id);
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  const patch = await owner.patch(`/api/reservations/${b.booking_id}`, { check_in: d(11), check_out: d(14) });
  assert.equal(patch.status, 409, JSON.stringify(patch.data));
  assert.deepEqual(moved.data.clash, { code: 'DATES_TAKEN', message: patch.data.error });

  // Dates after B are free once B is left out.
  assert.equal((await quoteFor(d(14), d(16), b.booking_id)).data.clash, null);
  // Without leaving B out, B's own dates clash with B itself.
  assert.equal((await quoteFor(d(12), d(14))).data.clash.code, 'DATES_TAKEN');
});

test('#2 a quote over a monthly lease names the lease with the PATCH sentence', async () => {
  const leased = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'R12 Leased', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  const t = (await owner.post('/api/tenants', { full_name: 'Lease Tenant', phone: '09170000002' })).data.tenant;
  await sql(`INSERT INTO leases (organization_id, unit_id, tenant_id, start_date, end_date, monthly_rent, due_day, lease_status)
             SELECT p.organization_id, $1, $2, $3, $4, 9000, 1, 'active' FROM units u JOIN properties p USING (property_id) WHERE u.unit_id = $1`,
  [leased.unit_id, t.tenant_id, d(5), d(60)]);
  // A short stay after the lease, then moved into it: PATCH refuses with the lease sentence.
  const later = (await owner.post('/api/reservations', { unit_id: leased.unit_id, check_in: d(70), check_out: d(72), guest_name: 'After lease' })).data.reservation;
  const r = await owner.get(`/api/reservations/quote?unit_id=${leased.unit_id}&check_in=${d(10)}&check_out=${d(12)}&exclude_booking_id=${later.booking_id}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const patch = await owner.patch(`/api/reservations/${later.booking_id}`, { check_in: d(10), check_out: d(12) });
  assert.equal(patch.status, 409, JSON.stringify(patch.data));
  assert.deepEqual(r.data.clash, { code: 'UNIT_LEASED', message: patch.data.error });
});

test('#11 the public quote lists the price rules that changed a night, and nothing for a plain base price', async () => {
  assert.equal((await owner.post('/api/pricing/rules', { kind: 'far_out', days: 60, adjust_pct: 10 })).status, 201);
  assert.equal((await owner.post('/api/pricing/rules', { kind: 'last_minute', days: 7, adjust_pct: -20 })).status, 201);
  const page = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_c04KEY1234567890', enabled: true });
  assert.equal(page.status, 200, JSON.stringify(page.data));
  const slug = page.data.url.split('/#/book/')[1];
  const g = client(srv.base);
  const quote = (ci, co) => g.get(`/api/public/book/${slug}/units/${unit.unit_id}/quote?check_in=${ci}&check_out=${co}`);

  const early = await quote(d(90), d(92));
  assert.equal(early.status, 200, JSON.stringify(early.data));
  assert.equal(early.data.accommodation_total, '4400.00');
  assert.deepEqual(early.data.price_rules, ['Booked-early price']);
  const last = await quote(d(3), d(5));
  assert.equal(last.data.accommodation_total, '3200.00');
  assert.deepEqual(last.data.price_rules, ['Last-minute price']);
  // 30 days out is inside neither window: the base price, no rule named.
  const plain = await quote(d(30), d(32));
  assert.equal(plain.data.accommodation_total, '4000.00');
  assert.deepEqual(plain.data.price_rules, []);
});
