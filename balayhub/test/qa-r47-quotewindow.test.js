'use strict';
require('./helpers');
// QA round 47, QUOTEWINDOW (D-129): the host's own price preview (the New quote dates) prices any dates the host may quote, while
// the guest booking page keeps its 18-month window and 60-night limit. A manager still sees only the properties they look after.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { hashPassword } = require('../src/lib/auth');

const d = (n) => ical.addDays(manilaToday(), n);
const MANAGER_PASSWORD = 'manager-pass-1';
const WINDOW = 'Bookings open up to 18 months ahead. Please contact the host for later dates.';
const NIGHTS = 'For stays longer than 60 nights, please contact the host.';
let srv; let owner; let unitA; let unitB; let slug;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r47-quotewindow@example.com', 'QA r47 quote window');
  const orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'QA r47 quote window'`))[0].organization_id;
  const mk = async (name) => {
    const prop = (await owner.post('/api/properties', { property_name: name, property_type: 'condominium', address: `${name} St`, city: 'Pasay', province: 'Metro Manila' })).data.property;
    return (await owner.post(`/api/properties/${prop.property_id}/units`, {
      unit_name: `${name} 1`, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, bookable_online: true, min_nights: 1,
    })).data.unit;
  };
  unitA = await mk('QA r47 quote window A');
  unitB = await mk('QA r47 quote window B');
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
  // A manager who looks after property A only.
  const [{ property_id: propA }] = await sql('SELECT property_id FROM units WHERE unit_id = $1', [unitA.unit_id]);
  const [{ user_id: managerId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, 'qa-r47-quotewindow-manager@example.com', $2, 'QA r47 quote window manager', 'manager', now()) RETURNING user_id`,
    [orgId, await hashPassword(MANAGER_PASSWORD)]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [managerId, propA]);
});
test.after(async () => { await srv.close(); });

test('the host price preview prices dates more than 18 months ahead', async () => {
  const r = await owner.get(`/api/units/${unitA.unit_id}/price-preview?check_in=${d(600)}&check_out=${d(602)}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accommodation_total, '5000.00');
});

test('the host price preview prices a stay longer than 60 nights', async () => {
  const r = await owner.get(`/api/units/${unitA.unit_id}/price-preview?check_in=${d(10)}&check_out=${d(100)}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.nights, 90);
});

test('the host price preview prices a stay of exactly one year (366 nights)', async () => {
  const r = await owner.get(`/api/units/${unitA.unit_id}/price-preview?check_in=${d(10)}&check_out=${d(376)}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.nights, 366);
});

test('the host price preview refuses a stay longer than one year (367 nights)', async () => {
  const r = await owner.get(`/api/units/${unitA.unit_id}/price-preview?check_in=${d(10)}&check_out=${d(377)}`);
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.check_out, 'Stays are limited to one year.');
});

test('the host price preview still refuses a past check-in', async () => {
  const r = await owner.get(`/api/units/${unitA.unit_id}/price-preview?check_in=${d(-1)}&check_out=${d(2)}`);
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.check_in, 'Choose a date from today onwards.');
});

test('a manager gets the same host price for their own property and still gets 404 outside it', async () => {
  const mgr = client(srv.base);
  const login = await mgr.post('/api/auth/login', { email: 'qa-r47-quotewindow-manager@example.com', password: MANAGER_PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const own = await mgr.get(`/api/units/${unitA.unit_id}/price-preview?check_in=${d(600)}&check_out=${d(602)}`);
  assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.equal((await mgr.get(`/api/units/${unitB.unit_id}/price-preview?check_in=${d(600)}&check_out=${d(602)}`)).status, 404);
});

test('the guest booking page still refuses dates more than 18 months ahead and stays longer than 60 nights', async () => {
  const g = client(srv.base);
  const far = await g.get(`/api/public/book/${slug}/units/${unitA.unit_id}/quote?check_in=${d(600)}&check_out=${d(602)}`);
  assert.equal(far.status, 400, JSON.stringify(far.data));
  assert.equal(far.data.fields.check_in, WINDOW);
  const long = await g.get(`/api/public/book/${slug}/units/${unitA.unit_id}/quote?check_in=${d(10)}&check_out=${d(71)}`);
  assert.equal(long.status, 400, JSON.stringify(long.data));
  assert.equal(long.data.fields.check_out, NIGHTS);
  const ok = await g.get(`/api/public/book/${slug}/units/${unitA.unit_id}/quote?check_in=${d(5)}&check_out=${d(7)}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.total, '5500.00');
});
