'use strict';

process.env.SMTP_URL = 'test://';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA round 1, lane F1: lease guard on the public booking page and calendar import, season tie-break.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { nightlyPrices } = require('../src/lib/pricing');

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let leased; let free; let slug;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Lease Stays');
  await owner.patch('/api/workspace', { business_type: 'both' });
  const prop = (await owner.post('/api/properties', { property_name: 'Mixed', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  const mk = async (name) => (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000', max_guests: 4, bookable_online: true })).data.unit;
  leased = await mk('Leased');
  free = await mk('Free');
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true });
  slug = r.data.url.split('/#/book/')[1];
  const t = (await owner.post('/api/tenants', { full_name: 'Monthly Tenant', phone: '09170000001' })).data.tenant;
  await sql(`INSERT INTO leases (organization_id, unit_id, tenant_id, start_date, end_date, monthly_rent, due_day, lease_status)
             SELECT p.organization_id, $1, $2, $3, $4, 9000, 1, 'active' FROM units u JOIN properties p USING (property_id) WHERE u.unit_id = $1`,
  [leased.unit_id, t.tenant_id, d(5), d(40)]);
});
test.after(async () => { await srv.close(); });

test('public booking page: leased nights are taken, quote says unavailable, checkout is refused', async () => {
  const g = client(srv.base);
  const days = (await g.get(`/api/public/book/${slug}/units/${leased.unit_id}/availability?from=${d(3)}`)).data.days;
  const taken = (n) => days.find((x) => x.date === d(n)).taken;
  assert.equal(taken(4), false);
  assert.equal(taken(5), true);
  assert.equal(taken(40), true);
  assert.equal(taken(41), false);
  const q = (await g.get(`/api/public/book/${slug}/units/${leased.unit_id}/quote?check_in=${d(10)}&check_out=${d(12)}`)).data;
  assert.equal(q.available, false);
  const ok = (await g.get(`/api/public/book/${slug}/units/${free.unit_id}/quote?check_in=${d(10)}&check_out=${d(12)}`)).data;
  assert.equal(ok.available, true);
  const co = await g.post(`/api/public/book/${slug}/units/${leased.unit_id}/checkout`,
    { check_in: d(10), check_out: d(12), num_guests: 2, name: 'Juan', email: 'juan@example.com', phone: '09171234567', pay: 'full', consent: true });
  assert.equal(co.status, 409, JSON.stringify(co.data));
});

test('calendar import does not create a stay over a lease; it records an overlap', async () => {
  const [feed] = await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url)
    SELECT organization_id, unit_id, 'airbnb', 'https://example.com/a.ics' FROM units u JOIN properties p USING (property_id) WHERE u.unit_id = $1 RETURNING feed_id`, [leased.unit_id]);
  const dt = (x) => x.replace(/-/g, '');
  const text = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:lease-clash', `DTSTART;VALUE=DATE:${dt(d(10))}`, `DTEND;VALUE=DATE:${dt(d(12))}`,
    'SUMMARY:Reserved', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const r = await ical.syncFeed(feed.feed_id, { fetcher: async () => text });
  assert.equal(r.added, 0);
  assert.equal((await sql(`SELECT 1 FROM bookings WHERE ical_feed_id = $1`, [feed.feed_id])).length, 0);
  assert.equal((await sql(`SELECT 1 FROM ical_conflicts WHERE feed_id = $1 AND resolved_at IS NULL`, [feed.feed_id])).length, 1);
});

test('seasons that start on the same day: the later-created one wins, then season_id', async () => {
  const org = (await sql(`SELECT organization_id FROM units JOIN properties USING (property_id) WHERE unit_id = $1`, [free.unit_id]))[0].organization_id;
  const ins = (name, rate, created, id) => sql(
    `INSERT INTO seasons (season_id, organization_id, unit_id, name, start_date, end_date, nightly_rate, created_at)
     VALUES ($1,$2,$3,$4,'2031-05-01','2031-05-10',$5,$6)`, [id, org, free.unit_id, name, rate, created]);
  await ins('Old', 3000, '2030-01-01T00:00:00Z', '00000000-0000-4000-8000-000000000001');
  await ins('New', 4000, '2030-02-01T00:00:00Z', 'ffffffff-0000-4000-8000-000000000002');
  const price = async () => (await nightlyPrices(free.unit_id, '2031-05-02', '2031-05-03'))[0].label;
  assert.equal(await price(), 'New');
  await sql(`UPDATE seasons SET created_at = '2030-02-01T00:00:00Z' WHERE name = 'Old'`);
  assert.equal(await price(), 'Old', 'equal created_at: lowest season_id wins');
});
