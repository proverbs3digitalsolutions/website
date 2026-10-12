'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

let srv; let owner; let prop; let unit; let unit2;
const today = manilaToday();
const d = (n) => ical.addDays(today, n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Condo Staycations');
  prop = (await owner.post('/api/properties', { property_name: 'Azure Residences', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  const u = await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Tower 1 - 1201', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, checkin_time: '14:00', checkout_time: '11:00' });
  assert.equal(u.status, 201, JSON.stringify(u.data));
  unit = u.data.unit;
  unit2 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Tower 2 - 805', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
});
test.after(async () => { await srv.close(); });

test('new workspaces default to short-term and expose business type', async () => {
  const me = await owner.get('/api/auth/me');
  assert.equal(me.data.user.business_type, 'short_term');
  assert.equal((await owner.patch('/api/workspace', { business_type: 'both' })).status, 200);
  assert.equal((await owner.get('/api/auth/me')).data.user.business_type, 'both');
});

test('quote uses nightly rate with per-date overrides', async () => {
  let q = await owner.get(`/api/reservations/quote?unit_id=${unit.unit_id}&check_in=${d(10)}&check_out=${d(13)}`);
  assert.equal(q.data.accommodation_total, '7500.00');
  assert.equal((await owner.raw('PUT', '/api/rates', { unit_id: unit.unit_id, start_date: d(11), end_date: d(11), price: '4000' })).status, 200);
  q = await owner.get(`/api/reservations/quote?unit_id=${unit.unit_id}&check_in=${d(10)}&check_out=${d(13)}`);
  assert.equal(q.data.accommodation_total, '9000.00');
  await owner.raw('PUT', '/api/rates', { unit_id: unit.unit_id, start_date: d(11), end_date: d(11), price: '' });
  q = await owner.get(`/api/reservations/quote?unit_id=${unit.unit_id}&check_in=${d(10)}&check_out=${d(13)}`);
  assert.equal(q.data.accommodation_total, '7500.00');
});

let resA;
test('reservations: create with new guest, no double-booking, guest limit', async () => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(0), check_out: d(3), guest_name: 'Rafael Diaz', guest_phone: '09171112222', num_guests: 2, channel: 'direct' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  resA = r.data.reservation;
  assert.equal(resA.accommodation_total, '7500.00');
  assert.equal(resA.cleaning_fee, '500.00');
  assert.equal(resA.total_amount, '8000.00');
  assert.match(resA.confirmation_code, /^BH-/);

  const clash = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(2), check_out: d(4), guest_name: 'Other' });
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /Rafael Diaz/);
  // Same-day turnover is allowed.
  const turnover = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(3), check_out: d(5), guest_name: 'Emily Lind', accommodation_total: '6000', num_guests: 3 });
  assert.equal(turnover.status, 201);
  const tooMany = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(20), check_out: d(21), guest_name: 'Big Group', num_guests: 9 });
  assert.equal(tooMany.status, 400);
  const backwards = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(20), check_out: d(20), guest_name: 'X' });
  assert.equal(backwards.status, 400);
});

test('blocks prevent bookings and can be removed', async () => {
  const b = await owner.post('/api/blocks', { unit_id: unit.unit_id, start_date: d(7), end_date: d(8), reason: 'Owner use' });
  assert.equal(b.status, 201);
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(8), check_out: d(9), guest_name: 'Blocked Guest' });
  assert.equal(r.status, 409);
  assert.equal((await owner.post(`/api/blocks/${b.data.block_id}/remove`)).status, 200);
  const ok = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(8), check_out: d(9), guest_name: 'Now Free', accommodation_total: '2500' });
  assert.equal(ok.status, 201);
  const cancel = await owner.post(`/api/reservations/${ok.data.reservation.booking_id}/cancel`, { reason: 'Guest changed plans' });
  assert.equal(cancel.status, 200);
  const again = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(8), check_out: d(9), guest_name: 'Rebook', accommodation_total: '2500' });
  assert.equal(again.status, 201, 'cancelled stays free the dates');
});

test('payments: partial, idempotent, balance and unpaid view', async () => {
  const h = { 'Idempotency-Key': 'stay-pay-000001' };
  const p1 = await owner.post(`/api/reservations/${resA.booking_id}/payments`, { amount: '3000', payment_date: today, payment_method: 'gcash' }, h);
  assert.equal(p1.status, 201);
  assert.equal(p1.data.reservation.balance, '5000.00');
  const dup = await owner.post(`/api/reservations/${resA.booking_id}/payments`, { amount: '3000', payment_date: today, payment_method: 'gcash' }, h);
  assert.equal(dup.data.duplicate, true);
  const unpaid = await owner.get('/api/reservations?view=unpaid');
  assert.ok(unpaid.data.reservations.some((r) => r.booking_id === resA.booking_id));
  await owner.post(`/api/reservations/${resA.booking_id}/payments`, { amount: '5000', payment_date: today, payment_method: 'cash' });
  const after = await owner.get(`/api/reservations/${resA.booking_id}`);
  assert.equal(after.data.reservation.balance, '0.00');
  const unpaid2 = await owner.get('/api/reservations?view=unpaid');
  assert.ok(!unpaid2.data.reservations.some((r) => r.booking_id === resA.booking_id));
  const neg = await owner.post(`/api/reservations/${resA.booking_id}/payments`, { amount: '-1', payment_date: today, payment_method: 'cash' });
  assert.equal(neg.status, 400);
});

test('check-in / check-out marks the listing dirty; homepage overview counts it', async () => {
  let o = await owner.get('/api/stays/overview?range=today');
  assert.equal(o.data.arrivals.length, 1);
  assert.equal(o.data.staying.length, 1);
  assert.equal(o.data.guests_staying, 2);
  assert.equal((await owner.post(`/api/reservations/${resA.booking_id}/stay-status`, { action: 'check_out' })).status, 409);
  assert.equal((await owner.post(`/api/reservations/${resA.booking_id}/stay-status`, { action: 'check_in' })).status, 200);
  o = await owner.get('/api/stays/overview?range=today');
  assert.ok(o.data.arrivals[0].checked_in_at);
  assert.equal((await owner.post(`/api/reservations/${resA.booking_id}/stay-status`, { action: 'check_out' })).status, 200);
  const listings = await owner.get('/api/listings');
  assert.equal(listings.data.listings.find((l) => l.unit_id === unit.unit_id).cleaning_status, 'dirty');
  assert.equal((await owner.post(`/api/units/${unit.unit_id}/cleaning`, { status: 'clean' })).status, 200);
  const o7 = await owner.get('/api/stays/overview?range=7d');
  assert.equal(o7.data.turnovers.length, 1, 'Rafael out / Emily in on the same day');
});

test('calendar, trends and revenue', async () => {
  const cal = await owner.get(`/api/calendar?start=${today}&days=14`);
  assert.equal(cal.status, 200);
  assert.equal(cal.data.listings.length, 2);
  assert.ok(cal.data.bookings.some((b) => b.guest_name === 'Rafael Diaz'));
  const t = await owner.get('/api/stays/trends?days=7');
  assert.equal(t.data.series.length, 7);
  assert.equal(t.data.series[0].occupancy, 50, 'one of two listings occupied tonight');
  assert.equal(t.data.totals.check_ins, 2);
  const rev = await owner.get('/api/stays/revenue');
  assert.equal(rev.status, 200);
  assert.ok(Number(rev.data.current.total_revenue) > 0);
  assert.ok(rev.data.previous.month < rev.data.current.month);
});

test('iCal export hides guest names; import mirrors a channel calendar', async () => {
  const ch = await owner.get(`/api/units/${unit.unit_id}/channels`);
  const path = new URL(ch.data.export_url).pathname;
  const feed = await fetch(srv.base + path).then((r) => r.text());
  assert.match(feed, /BEGIN:VCALENDAR/);
  assert.match(feed, /SUMMARY:Reserved/);
  assert.doesNotMatch(feed, /Rafael/);
  assert.equal((await fetch(`${srv.base}/ical/nottherealtoken1234567890.ics`)).status, 404);

  const [{ feed_id: feedId }] = await sql(
    `INSERT INTO ical_feeds (organization_id, unit_id, channel, url) VALUES ($1,$2,'airbnb','https://www.airbnb.com/calendar/ical/1.ics') RETURNING feed_id`,
    [prop.organization_id, unit2.unit_id]);
  const ics = (events) => ['BEGIN:VCALENDAR', ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.s.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${e.e.replace(/-/g, '')}`, `SUMMARY:${e.sum}`, `DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HM${e.code}\\nPhone`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  let r = await ical.syncFeed(feedId, { fetcher: async () => ics([
    { uid: 'a1', s: d(1), e: d(4), sum: 'Reserved', code: 'ABCDEF12' },
    { uid: 'a2', s: d(10), e: d(12), sum: 'Airbnb (Not available)', code: 'X' },
  ]) });
  assert.equal(r.added, 2);
  const rows = await sql('SELECT kind, confirmation_code, guest_label FROM bookings WHERE ical_feed_id = $1 ORDER BY check_in', [feedId]);
  assert.deepEqual(rows.map((x) => x.kind), ['reservation', 'block']);
  assert.equal(rows[0].confirmation_code, 'HMABCDEF12');
  // Guest cancels on Airbnb: the event disappears; dates move on another.
  r = await ical.syncFeed(feedId, { fetcher: async () => ics([{ uid: 'a2', s: d(11), e: d(12), sum: 'Airbnb (Not available)', code: 'X' }]) });
  assert.equal(r.removed, 1);
  assert.equal(r.updated, 1);
  const st = await sql(`SELECT status FROM bookings WHERE ical_feed_id = $1 AND external_uid = 'a1'`, [feedId]);
  assert.equal(st[0].status, 'cancelled');
  // A clash with an existing direct booking is reported, not overwritten.
  await owner.post('/api/reservations', { unit_id: unit2.unit_id, check_in: d(30), check_out: d(32), guest_name: 'Direct Guest', accommodation_total: '3600' });
  r = await ical.syncFeed(feedId, { fetcher: async () => ics([{ uid: 'a3', s: d(31), e: d(33), sum: 'Reserved', code: 'ZZZZZZ99' }]) });
  assert.equal(r.conflicts.length, 1);
  const fe = await sql('SELECT last_status, last_message FROM ical_feeds WHERE feed_id = $1', [feedId]);
  assert.equal(fe[0].last_status, 'error');
  assert.match(fe[0].last_message, /overlap/);
});

test('calendar link validation blocks internal addresses', async () => {
  assert.equal(ical.validateFeedUrl('http://example.com/a.ics'), null);
  assert.equal(ical.validateFeedUrl('https://127.0.0.1/a.ics'), null);
  assert.equal(ical.validateFeedUrl('https://user:pw@example.com/a.ics'), null);
  assert.ok(ical.validateFeedUrl('https://www.airbnb.com/calendar/ical/1.ics'));
  assert.equal(ical.isPublicAddress('127.0.0.1', 4), false);
  assert.equal(ical.isPublicAddress('10.1.2.3', 4), false);
  assert.equal(ical.isPublicAddress('169.254.169.254', 4), false);
  assert.equal(ical.isPublicAddress('::1', 6), false);
  assert.equal(ical.isPublicAddress('8.8.8.8', 4), true);
  assert.equal(ical.isPublicAddress('::ffff:127.0.0.1', 6), false);
  const add = await owner.post('/api/ical-feeds', { unit_id: unit.unit_id, channel: 'airbnb', url: 'https://localhost/x.ics' });
  assert.equal(add.status, 201);
  assert.equal(add.data.sync.ok, false);
  assert.match(add.data.sync.message, /private network/);
  const bad = await owner.post('/api/ical-feeds', { unit_id: unit.unit_id, channel: 'airbnb', url: 'ftp://x' });
  assert.equal(bad.status, 400);
});

test('isolation and roles for stays', async () => {
  const other = await ownerAccount(srv.base, 'other-host@example.com', 'Other Host');
  assert.equal((await other.get(`/api/reservations/${resA.booking_id}`)).status, 404);
  assert.equal((await other.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(40), check_out: d(41), guest_name: 'X' })).status, 404);
  assert.equal((await other.get('/api/reservations?view=all')).data.reservations.length, 0);

  const inv = await owner.post('/api/team/invitations', { email: 'cleaner@example.com', role: 'staff', property_ids: [prop.property_id] });
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Cleaner', email: 'cleaner@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
  const list = await staff.get('/api/reservations?view=all');
  assert.ok(list.data.reservations.length > 0);
  assert.equal(list.data.reservations[0].guest_phone, undefined);
  assert.equal((await staff.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(50), check_out: d(51), guest_name: 'X' })).status, 403);
  assert.equal((await staff.post(`/api/units/${unit.unit_id}/cleaning`, { status: 'dirty' })).status, 200);
  assert.equal((await staff.raw('PUT', '/api/rates', { unit_id: unit.unit_id, start_date: today, end_date: today, price: '1' })).status, 403);
});

test('reservation CSV export', async () => {
  const r = await owner.get('/api/reservations/export?view=all');
  assert.equal(r.status, 200);
  assert.match(r.data, /Confirmation code,Check-in/);
  assert.match(r.data, /Rafael Diaz/);
});

// ---------------------------------------------------------------- review regressions
const dns = require('dns');

test('guarded DNS lookup works with Node 22 autoSelectFamily (all: true) and the single form', async () => {
  const real = dns.lookup;
  dns.lookup = (host, opts, cb) => cb(null, host === 'evil.test'
    ? [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.5', family: 4 }]
    : [{ address: '93.184.215.14', family: 4 }]);
  try {
    const all = await new Promise((res, rej) => ical.guardedLookup('public.test', { all: true }, (e, a) => (e ? rej(e) : res(a))));
    assert.deepEqual(all, [{ address: '93.184.215.14', family: 4 }]);
    const one = await new Promise((res, rej) => ical.guardedLookup('public.test', {}, (e, a, f) => (e ? rej(e) : res([a, f]))));
    assert.deepEqual(one, ['93.184.215.14', 4]);
    await assert.rejects(new Promise((res, rej) => ical.guardedLookup('evil.test', { all: true }, (e, a) => (e ? rej(e) : res(a)))), /private network/);
    // Through a real https request: must get past address selection (no ERR_INVALID_IP_ADDRESS).
    dns.lookup = (host, opts, cb) => cb(null, [{ address: '203.0.113.9', family: 4 }]);
    const err = await ical.fetchText('https://public.test/cal.ics').then(() => null, (e) => e);
    assert.ok(err, 'connection to a TEST-NET address should fail');
    assert.notEqual(err.code, 'ERR_INVALID_IP_ADDRESS', err.message);
    assert.doesNotMatch(err.message, /private network/);
  } finally {
    dns.lookup = real;
  }
});

test('IPv6 literal and NAT64/6to4 calendar addresses are rejected', () => {
  for (const u of ['https://[::1]/a.ics', 'https://[::ffff:127.0.0.1]/a.ics', 'https://[::ffff:7f00:1]/a.ics', 'https://[2001:db8::1]/a.ics']) {
    assert.equal(ical.validateFeedUrl(u), null, u);
  }
  assert.equal(ical.isPublicAddress('64:ff9b::a00:1', 6), false);
  assert.equal(ical.isPublicAddress('2002:a00:1::1', 6), false);
});

test('feeds with repeated UIDs import once; failures always update feed status', async () => {
  const unit3 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Tower 3 - 101', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const [{ feed_id: feedId }] = await sql(
    `INSERT INTO ical_feeds (organization_id, unit_id, channel, url) VALUES ($1,$2,'other','https://calendar.example.com/x.ics') RETURNING feed_id`,
    [prop.organization_id, unit3.unit_id]);
  const ev = (uid, s, e) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;VALUE=DATE:${s.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.replace(/-/g, '')}`, 'SUMMARY:Booked', 'END:VEVENT'];
  const r = await ical.syncFeed(feedId, { fetcher: async () => ['BEGIN:VCALENDAR', ...ev('dup', d(1), d(2)), ...ev('dup', d(5), d(6)), ...ev('ok', d(8), d(9)), 'END:VCALENDAR'].join('\r\n') });
  assert.equal(r.ok, true);
  assert.equal(r.added, 2);
  const failed = await ical.syncFeed(feedId, { fetcher: async () => { throw new Error('boom'); } });
  assert.equal(failed.ok, false);
  const [f] = await sql('SELECT last_status, last_message FROM ical_feeds WHERE feed_id = $1', [feedId]);
  assert.equal(f.last_status, 'error');
});

test('channel stays cannot be cancelled by hand; sync-cancelled stays come back if they reappear', async () => {
  const [b] = await sql(`SELECT booking_id, ical_feed_id, external_uid, check_in, check_out FROM bookings WHERE external_uid = 'ok'`);
  const c = await owner.post(`/api/reservations/${b.booking_id}/cancel`, { reason: 'test' });
  assert.equal(c.status, 409);
  assert.equal(c.data.code, 'CHANNEL_MANAGED');
  // Host-cancelled (e.g. legacy data) stays cancelled after a sync.
  await sql(`UPDATE bookings SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Guest no-show' WHERE booking_id = $1`, [b.booking_id]);
  const ev = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:ok', `DTSTART;VALUE=DATE:${b.check_in.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${b.check_out.replace(/-/g, '')}`, 'SUMMARY:Booked', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  await ical.syncFeed(b.ical_feed_id, { fetcher: async () => ev });
  assert.equal((await sql('SELECT status FROM bookings WHERE booking_id = $1', [b.booking_id]))[0].status, 'cancelled');
  // Sync-cancelled stays are restored when the channel shows them again.
  await sql(`UPDATE bookings SET cancel_reason = 'Removed from Channel calendar' WHERE booking_id = $1`, [b.booking_id]);
  await ical.syncFeed(b.ical_feed_id, { fetcher: async () => ev });
  assert.equal((await sql('SELECT status FROM bookings WHERE booking_id = $1', [b.booking_id]))[0].status, 'confirmed');
});

test('no payments on cancelled reservations; invalid month falls back', async () => {
  const r = await owner.post('/api/reservations', { unit_id: unit2.unit_id, check_in: d(60), check_out: d(61), guest_name: 'Cancel Me', accommodation_total: '1800' });
  await owner.post(`/api/reservations/${r.data.reservation.booking_id}/cancel`, { reason: 'Changed plans' });
  const p = await owner.post(`/api/reservations/${r.data.reservation.booking_id}/payments`, { amount: '100', payment_date: today, payment_method: 'cash' });
  assert.equal(p.status, 409);
  const m = await owner.get('/api/stays/revenue?month=2026-13');
  assert.equal(m.status, 200);
});

test('archiving a listing keeps its past revenue', async () => {
  const before = (await owner.get('/api/stays/revenue')).data.current.total_revenue;
  await sql(`UPDATE units SET status = 'archived' WHERE unit_id = $1`, [unit.unit_id]);
  const after = (await owner.get('/api/stays/revenue')).data.current.total_revenue;
  await sql(`UPDATE units SET status = 'active' WHERE unit_id = $1`, [unit.unit_id]);
  assert.equal(after, before);
});
