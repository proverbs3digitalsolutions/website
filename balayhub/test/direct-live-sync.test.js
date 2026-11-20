'use strict';

// D-135: before a direct checkout holds dates, the listing's channel calendars are read live.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

// Fake PayMongo: every checkout session starts fine.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    return json({ data: { id, attributes: { checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } } });
  }
  return json({ errors: [{ detail: 'not found' }] }, 404);
};

// Fake channel calendars, by feed URL.
const realFetchText = ical.fetchText;
const calendars = new Map();
let fetchCount = 0;
ical.fetchText = async (url) => {
  fetchCount += 1;
  const c = calendars.get(url);
  if (typeof c === 'function') return c();
  if (c === undefined) throw new Error('unknown feed');
  return c;
};
const ics = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0',
  ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.s.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${e.e.replace(/-/g, '')}`, 'SUMMARY:Reserved', 'END:VEVENT']),
  'END:VCALENDAR'].join('\r\n');

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let slug; let orgId; let unit; let slowUnit; let quietUnit;
const AIRBNB = 'https://www.airbnb.com/calendar/ical/live-1.ics';
const SLOW = 'https://www.airbnb.com/calendar/ical/slow-1.ics';

const guest = (over = {}) => ({
  check_in: d(40), check_out: d(43), num_guests: 2, name: 'Live Check Guest', email: `g${crypto.randomBytes(4).toString('hex')}@example.com`,
  phone: '09171234567', pay: 'full', consent: true, ...over,
});

test.before(async () => {
  srv = await startServer();
  const owner = await ownerAccount(srv.base, 'livesync@example.com', 'Balay Live Sync');
  const prop = (await owner.post('/api/properties', { property_name: 'Shore', property_type: 'condominium', address: 'Roxas Blvd', city: 'Pasay', province: 'Metro Manila' })).data.property;
  const mk = async (unit_name) => (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, bookable_online: true, min_nights: 1,
  })).data.unit;
  unit = await mk('Live 1');
  slowUnit = await mk('Slow 2');
  quietUnit = await mk('Quiet 3');
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Balay Live Sync'`))[0].organization_id;
  // Both feeds last synced well over a minute ago, so the live check reads them.
  for (const [u, url] of [[unit, AIRBNB], [slowUnit, SLOW]]) {
    await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status)
               VALUES ($1, $2, 'airbnb', $3, now() - interval '20 minutes', 'ok')`, [orgId, u.unit_id, url]);
  }
});
// All requests come from one address, so release earlier holds (max 2 unpaid per visitor).
test.beforeEach(async () => { if (srv) await sql(`UPDATE direct_checkouts SET hold_until = now() - interval '1 second'`); });
test.after(async () => { globalThis.fetch = realFetch; ical.fetchText = realFetchText; await srv.close(); });

test('an Airbnb booking made since the last sync stops the checkout before the guest pays', async () => {
  calendars.set(AIRBNB, ics([{ uid: 'fresh-airbnb-1', s: d(41), e: d(44) }]));
  const r = await client(srv.base).post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, guest());
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'DATES_TAKEN');
  const [b] = await sql(`SELECT check_in, check_out, channel FROM bookings WHERE unit_id = $1 AND external_uid = 'fresh-airbnb-1'`, [unit.unit_id]);
  assert.ok(b, 'the Airbnb stay is imported');
  assert.equal(b.channel, 'airbnb');
  const holds = await sql(`SELECT 1 FROM direct_checkouts WHERE unit_id = $1`, [unit.unit_id]);
  assert.equal(holds.length, 0, 'no hold and no payment page');
});

test('free dates still go through, and a feed just synced is not read again', async () => {
  const before = fetchCount;
  const r = await client(srv.base).post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, guest({ check_in: d(50), check_out: d(52) }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.checkout_url, /^https:\/\/checkout\.paymongo\.com\//);
  assert.equal(fetchCount, before, 'synced under a minute ago by the first test, so skipped');
});

test('a slow channel does not stop the guest: the checkout goes on after the time limit', async () => {
  const saved = ical.LIVE_CHECK_MS;
  ical.LIVE_CHECK_MS = 150;
  let release;
  calendars.set(SLOW, () => new Promise((resolve) => { release = () => resolve(ics([])); }));
  try {
    const started = Date.now();
    const r = await client(srv.base).post(`/api/public/book/${slug}/units/${slowUnit.unit_id}/checkout`, guest());
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(Date.now() - started < 3000, 'did not wait for the channel');
  } finally {
    ical.LIVE_CHECK_MS = saved;
    if (release) release();
    await new Promise((resolve) => setTimeout(resolve, 100)); // let the background sync finish
  }
});

test('a failing channel does not stop the guest either', async () => {
  await sql(`UPDATE ical_feeds SET last_synced_at = now() - interval '20 minutes' WHERE url = $1`, [AIRBNB]);
  calendars.set(AIRBNB, () => { throw new Error('The channel returned HTTP 500. Check the link.'); });
  const r = await client(srv.base).post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, guest({ check_in: d(60), check_out: d(62) }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('a listing with no channel calendars books as before', async () => {
  const r = await client(srv.base).post(`/api/public/book/${slug}/units/${quietUnit.unit_id}/checkout`, guest());
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
