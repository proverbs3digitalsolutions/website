'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const realFetch = globalThis.fetch;
const sessions = new Map();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    const a = JSON.parse(opts.body).data.attributes;
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    sessions.set(id, { id, attributes: { ...a, checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } });
    return json({ data: sessions.get(id) });
  }
  const ex = /checkout_sessions\/(cs_\w+)\/expire$/.exec(u);
  if (ex && sessions.has(ex[1])) { sessions.get(ex[1]).attributes.status = 'expired'; return json({ data: sessions.get(ex[1]) }); }
  const m = /checkout_sessions\/(cs_\w+)$/.exec(u);
  if (m && sessions.has(m[1])) return json({ data: sessions.get(m[1]) });
  return json({ errors: [{ detail: 'not found' }] }, 404);
};
const last = () => [...sessions.values()].at(-1);
const pay = (s) => { s.attributes.payments = [{ attributes: { status: 'paid', amount: s.attributes.line_items[0].amount, source: { type: 'gcash' } } }]; };
const d = (n) => ical.addDays(manilaToday(), n);

let srv; let host; let unit; let slug;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Balik Stays');
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500', bookable_online: true, payment_option: 'full' })).data.unit;
  const r = await host.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true });
  slug = r.data.url.split('/#/book/')[1];
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

let reviewToken; let pastBooking;
test('repeat guests: same email is the same guest; VIP and do-not-rebook flags', async () => {
  pastBooking = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-10), check_out: d(-8), guest_name: 'Lia Santos', guest_email: 'lia@example.com' })).data.reservation;
  const again = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-5), check_out: d(-4), guest_name: 'Lia S.', guest_email: 'LIA@example.com' })).data.reservation;
  assert.equal(again.guest_id, pastBooking.guest_id, 'matched by email');
  const detail = (await host.get(`/api/reservations/${again.booking_id}`)).data.reservation;
  assert.equal(detail.previous_stays, 1);
  await host.patch(`/api/guests/${pastBooking.guest_id}`, { vip: true });
  const guests = (await host.get('/api/guests')).data.guests;
  assert.equal(guests.find((g) => g.guest_id === pastBooking.guest_id).vip, true);
  assert.equal(Number(guests.find((g) => g.guest_id === pastBooking.guest_id).stays), 2);
});

test('private review: link in the thank-you message, once per stay, shown to the host', async () => {
  const tpl = (await host.get('/api/message-templates')).data.templates.find((t) => t.system_key === 'thanks');
  const r = await host.get(`/api/message-templates/${tpl.template_id}/render?booking_id=${pastBooking.booking_id}`);
  assert.match(r.data.body, /Tell us privately .*\/#\/review\//);
  reviewToken = r.data.body.split('/#/review/')[1].split(/\s/)[0];
  const g = client(srv.base);
  const page = (await g.get(`/api/public/review/${reviewToken}`)).data;
  assert.equal(page.open, true);
  assert.equal(page.guest_first_name, 'Lia');
  assert.equal((await g.post(`/api/public/review/${reviewToken}`, { rating: 6 })).status, 400);
  assert.equal((await g.post(`/api/public/review/${reviewToken}`, { rating: 2, cleanliness: 3, comment: 'Aircon was noisy.' })).status, 201);
  assert.equal((await g.post(`/api/public/review/${reviewToken}`, { rating: 5 })).status, 409, 'once only');
  const rv = (await host.get('/api/reviews')).data;
  assert.equal(rv.count, 1);
  assert.equal(rv.reviews[0].comment, 'Aircon was noisy.');
  assert.equal((await host.get(`/api/reservations/${pastBooking.booking_id}`)).data.reservation.review.rating, 2);
  // The link disappears from messages once reviewed.
  const r2 = await host.get(`/api/message-templates/${tpl.template_id}/render?booking_id=${pastBooking.booking_id}`);
  assert.doesNotMatch(r2.data.body, /\/#\/review\//);
  // A future stay can't be reviewed yet.
  const future = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(30), check_out: d(31), guest_name: 'Later' })).data.reservation;
  const ft = (await sql('SELECT review_token FROM bookings WHERE booking_id = $1', [future.booking_id]))[0].review_token
    || (await host.get(`/api/message-templates/${tpl.template_id}/render?booking_id=${future.booking_id}`)).data.body.split('/#/review/')[1].split(/\s/)[0];
  assert.equal((await g.get(`/api/public/review/${ft}`)).data.open, false);
  assert.equal((await g.get('/api/public/review/not-a-real-token-123456')).status, 404);
});

test('discount codes on the booking page: percent, returning guests only, limited uses', async () => {
  assert.equal((await host.post('/api/discount-codes', { code: 'X', percent_off: 10 })).status, 400);
  assert.equal((await host.post('/api/discount-codes', { code: 'BOTH', percent_off: 10, amount_off: '100' })).status, 400);
  assert.equal((await host.post('/api/discount-codes', { code: 'balik10', percent_off: 10, returning_only: true })).status, 201);
  assert.equal((await host.post('/api/discount-codes', { code: 'ONCE', amount_off: '500', max_uses: 1 })).status, 201);
  assert.equal((await host.post('/api/discount-codes', { code: 'ONCE', amount_off: '100' })).status, 400, 'duplicate');

  const g = client(srv.base);
  const base = `/api/public/book/${slug}/units/${unit.unit_id}`;
  const q0 = (await g.get(`${base}/quote?check_in=${d(10)}&check_out=${d(12)}`)).data;
  assert.equal(q0.total, '4500.00');
  const newGuest = (await g.get(`${base}/quote?check_in=${d(10)}&check_out=${d(12)}&code=balik10&email=new@example.com`)).data;
  assert.match(newGuest.code_error, /returning guests/);
  assert.equal(newGuest.total, '4500.00');
  const back = (await g.get(`${base}/quote?check_in=${d(10)}&check_out=${d(12)}&code=BALIK10&email=lia@example.com`)).data;
  assert.equal(back.promo_discount, '400.00'); // 10% of 4000 accommodation, not the cleaning fee
  assert.equal(back.total, '4100.00');
  assert.equal(back.promo_code_id, undefined, 'internal id not exposed');

  const form = (extra) => ({ check_in: d(10), check_out: d(12), num_guests: 2, name: 'Lia Santos', email: 'lia@example.com', phone: '09171234567', pay: 'full', consent: true, ...extra });
  assert.equal((await g.post(`${base}/checkout`, form({ code: 'BALIK10', email: 'stranger@example.com' }))).status, 400);
  const r = await g.post(`${base}/checkout`, form({ code: 'balik10' }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = last();
  assert.equal(s.attributes.line_items[0].amount, 410000);
  pay(s);
  const token = s.attributes.success_url.split('/done/')[1];
  assert.equal((await g.get(`/api/public/book/status/${token}`)).data.status, 'confirmed');
  const [b] = await sql(`SELECT b.accommodation_total, b.guest_id, b.notes FROM bookings b WHERE b.check_in = $1 AND b.unit_id = $2`, [d(10), unit.unit_id]);
  assert.equal(b.accommodation_total, '3600.00');
  assert.equal(b.guest_id, pastBooking.guest_id, 'online booking joined the returning guest');
  assert.match(b.notes, /Discount code BALIK10/);

  // Limited uses: one hold takes the only use.
  const c1 = await client(srv.base).post(`${base}/checkout`, form({ check_in: d(20), check_out: d(22), email: 'a@example.com', code: 'ONCE' }));
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  const c2 = await client(srv.base).post(`${base}/checkout`, form({ check_in: d(25), check_out: d(27), email: 'b@example.com', code: 'ONCE' }));
  assert.equal(c2.status, 400);
  assert.match(c2.data.fields.code, /fully used/);
  const codes = (await host.get('/api/discount-codes')).data.codes;
  assert.equal(codes.find((c) => c.code === 'BALIK10').uses, 1);
  assert.equal(codes.find((c) => c.code === 'BALIK10').total_discounted, '400.00');
  // Turned off: no longer accepted.
  await host.post(`/api/discount-codes/${codes.find((c) => c.code === 'BALIK10').code_id}/active`, { active: false });
  assert.match((await g.get(`${base}/quote?check_in=${d(30)}&check_out=${d(32)}&code=BALIK10&email=lia@example.com`)).data.code_error, /not valid/);
});

test('a do-not-rebook guest booking online is flagged to the host', async () => {
  await host.patch(`/api/guests/${pastBooking.guest_id}`, { do_not_rebook: true });
  const g = client(srv.base);
  const r = await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`,
    { check_in: d(40), check_out: d(41), num_guests: 1, name: 'Lia', email: 'lia@example.com', phone: '09171234567', pay: 'full', consent: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = last();
  pay(s);
  await g.get(`/api/public/book/status/${s.attributes.success_url.split('/done/')[1]}`);
  const [b] = await sql(`SELECT notes FROM bookings WHERE check_in = $1 AND unit_id = $2`, [d(40), unit.unit_id]);
  assert.match(b.notes, /Do not rebook/);
});
