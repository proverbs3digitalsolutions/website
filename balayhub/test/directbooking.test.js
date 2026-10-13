'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { outbox } = require('../src/lib/mailer');
const direct = require('../src/routes/directbooking');

// Fake PayMongo that remembers which secret key created each checkout.
const realFetch = globalThis.fetch;
const sessions = new Map();
const expired = new Set();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const key = Buffer.from(String(opts.headers.Authorization).replace('Basic ', ''), 'base64').toString().replace(/:$/, '');
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (!key.startsWith('sk_test_host')) return json({ errors: [{ detail: 'bad key' }] }, 401);
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    const a = JSON.parse(opts.body).data.attributes;
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    sessions.set(id, { key, data: { id, attributes: { ...a, checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } } });
    return json({ data: sessions.get(id).data });
  }
  const ex = /checkout_sessions\/(cs_\w+)\/expire$/.exec(u);
  if (ex && sessions.has(ex[1])) { expired.add(ex[1]); sessions.get(ex[1]).data.attributes.status = 'expired'; return json({ data: sessions.get(ex[1]).data }); }
  const m = /checkout_sessions\/(cs_\w+)$/.exec(u);
  if (m && sessions.has(m[1]) && sessions.get(m[1]).key === key) return json({ data: sessions.get(m[1]).data });
  return json({ errors: [{ detail: 'not found' }] }, 404);
};
const lastSession = () => [...sessions.values()].at(-1).data;
const pay = (id, centavos) => {
  const s = sessions.get(id).data;
  s.attributes.payments = [{ attributes: { status: 'paid', amount: centavos, source: { type: 'gcash' } } }];
  s.attributes.payment_method_used = 'gcash';
};

const d = (n) => ical.addDays(manilaToday(), n);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
let srv; let owner; let prop; let unit; let hidden; let slug;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Sunset Staycations');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4,
    description: 'Cozy studio with a balcony.', bookable_online: true, min_nights: 2,
  })).data.unit;
  hidden = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Private 1', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('host connects PayMongo (stored encrypted) and turns on the booking page', async () => {
  assert.equal((await owner.patch('/api/direct-booking', { enabled: true })).status, 409, 'needs PayMongo first');
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: 'pk_live_nope' })).status, 400);
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true, intro: 'Welcome!' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
  assert.equal(slug, 'sunset-staycations');
  const row = (await sql(`SELECT paymongo_key_enc, paymongo_key_hint FROM organizations WHERE name = 'Sunset Staycations'`))[0];
  assert.ok(!row.paymongo_key_enc.includes('hostKEY'), 'key is encrypted at rest');
  assert.equal(row.paymongo_key_hint, 'sk_test_…7890');
  const s = (await owner.get('/api/direct-booking')).data;
  assert.equal(s.paymongo_connected, true);
  assert.ok(!JSON.stringify(s).includes('hostKEY'), 'the key is never sent back');
  const other = await ownerAccount(srv.base, 'x@example.com', 'Other Co');
  assert.equal((await other.patch('/api/direct-booking', { slug: 'sunset-staycations' })).status, 400, 'slug taken');
});

test('listing photos: upload, cover, public only when listed', async () => {
  const up = await owner.raw('POST', `/api/units/${unit.unit_id}/photos`, PNG, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 201);
  const up2 = await owner.raw('POST', `/api/units/${unit.unit_id}/photos`, PNG, { 'Content-Type': 'image/png' });
  await owner.post(`/api/listing-photos/${up2.data.photo.file_id}/cover`);
  const photos = (await owner.get(`/api/units/${unit.unit_id}/photos`)).data.photos;
  assert.equal(photos[0].file_id, up2.data.photo.file_id);
  const guest = client(srv.base);
  assert.equal((await guest.raw('GET', `/api/public/listing-photos/${up.data.photo.file_id}`)).status, 200);
  const hp = await owner.raw('POST', `/api/units/${hidden.unit_id}/photos`, PNG, { 'Content-Type': 'image/png' });
  assert.equal((await guest.raw('GET', `/api/public/listing-photos/${hp.data.photo.file_id}`)).status, 404, 'unlisted listing photo is private');
  await owner.post(`/api/listing-photos/${up.data.photo.file_id}/remove`);
  assert.equal((await owner.get(`/api/units/${unit.unit_id}/photos`)).data.photos.length, 1);
});

test('public page shows only listed units; quote enforces minimum nights and computes the deposit', async () => {
  const g = client(srv.base);
  const page = await g.get(`/api/public/book/${slug}`);
  assert.equal(page.status, 200);
  assert.deepEqual(page.data.listings.map((l) => l.unit_name), ['Paris 1208']);
  assert.equal(page.data.host.accepting, true);
  assert.equal((await g.get(`/api/public/book/${slug}/units/${hidden.unit_id}/quote?check_in=${d(5)}&check_out=${d(7)}`)).status, 404);
  assert.equal((await g.get(`/api/public/book/${slug}/units/${unit.unit_id}/quote?check_in=${d(5)}&check_out=${d(6)}`)).status, 400, 'min 2 nights');
  const q = (await g.get(`/api/public/book/${slug}/units/${unit.unit_id}/quote?check_in=${d(5)}&check_out=${d(7)}`)).data;
  assert.equal(q.total, '5500.00');
  assert.equal(q.deposit, '2750.00');
  assert.equal(q.available, true);
  assert.equal(q.balance_due_date, d(2));
  assert.equal((await g.get('/api/public/book/no-such-host')).status, 404);
});

const form = (extra = {}) => ({ check_in: d(5), check_out: d(7), num_guests: 2, name: 'Juan Dela Cruz', email: 'juan@example.com', phone: '09171234567', pay: 'deposit', consent: true, ...extra });

let token;
test('guest pays a 50% deposit with the host\'s own key; dates are held; booking is created once', async () => {
  const g = client(srv.base);
  assert.equal((await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ consent: false }))).status, 400);
  assert.equal((await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ num_guests: 9 }))).status, 400);
  const r = await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form());
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = lastSession();
  assert.equal(s.attributes.line_items[0].amount, 275000);
  token = s.attributes.success_url.split('/done/')[1];
  // The same dates are held for the next guest.
  const r2 = await client(srv.base).post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ email: 'other@example.com' }));
  assert.equal(r2.status, 409);
  const avail = (await g.get(`/api/public/book/${slug}/units/${unit.unit_id}/availability?from=${d(4)}`)).data.days;
  assert.equal(avail.find((x) => x.date === d(5)).taken, true);
  assert.equal(avail.find((x) => x.date === d(7)).taken, false);

  assert.equal((await g.get(`/api/public/book/status/${token}`)).data.status, 'pending');
  outbox.length = 0;
  pay(s.id, 275000);
  const st = await g.get(`/api/public/book/status/${token}`);
  assert.equal(st.data.status, 'confirmed');
  assert.match(st.data.stay.code, /^BH-/);
  assert.equal(st.data.stay.balance, '2750.00');
  assert.ok(st.data.stay.checkin_link.includes('/#/checkin/'));
  assert.equal((await g.get(`/api/public/book/status/${token}`)).data.status, 'confirmed', 'idempotent');

  const b = await sql(`SELECT b.*, (SELECT COUNT(*)::int FROM booking_payments p WHERE p.booking_id = b.booking_id) AS pays FROM bookings b WHERE b.notes LIKE '%Booked online%'`);
  assert.equal(b.length, 1);
  assert.match(b[0].notes, /^TEST MODE booking/, 'test-key bookings are clearly labelled');
  assert.equal(b[0].channel, 'direct');
  assert.equal(b[0].pays, 1);
  assert.equal(b[0].total_amount, '5500.00');
  const p = (await sql('SELECT amount, payment_method, receipt_number FROM booking_payments WHERE booking_id = $1', [b[0].booking_id]))[0];
  assert.deepEqual([p.amount, p.payment_method], ['2750.00', 'gcash']);
  assert.ok(p.receipt_number);
  assert.ok(outbox.some((m) => m.to === 'juan@example.com' && /confirmed/.test(m.subject)), 'confirmation emailed');
  assert.ok(outbox.some((m) => m.to === 'juan@example.com' && /Receipt/.test(m.subject)), 'receipt emailed');
  const inbox = (await owner.get('/api/inbox?view=unread')).data.conversations;
  assert.ok(inbox.some((c) => /New direct booking/.test(c.last_body)));
});

test('payment option is enforced; wrong amount is not accepted', async () => {
  await owner.patch(`/api/units/${unit.unit_id}`, { payment_option: 'full' });
  const g = client(srv.base);
  assert.equal((await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(20), check_out: d(22), pay: 'deposit' }))).status, 400);
  const r = await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(20), check_out: d(22), pay: 'full' }));
  assert.equal(r.status, 200);
  const s = lastSession();
  pay(s.id, 100);
  assert.equal((await g.get(`/api/public/book/status/${s.attributes.success_url.split('/done/')[1]}`)).data.status, 'pending');
  await owner.patch(`/api/units/${unit.unit_id}`, { payment_option: 'either' });
});

test('paid but dates taken meanwhile: no double booking, host is emailed', async () => {
  const g = client(srv.base);
  const r = await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(30), check_out: d(32), pay: 'full' }));
  const s = lastSession();
  // A channel booking lands on the same nights before the guest finishes paying.
  await sql(`UPDATE direct_checkouts SET hold_until = now() - interval '1 minute' WHERE provider_checkout_id = $1`, [s.id]);
  assert.equal((await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(31), check_out: d(33), guest_name: 'Airbnb guest' })).status, 201);
  outbox.length = 0;
  pay(s.id, 550000);
  const st = await g.get(`/api/public/book/status/${s.attributes.success_url.split('/done/')[1]}`);
  assert.equal(st.data.status, 'conflict');
  assert.ok(outbox.some((m) => m.to === 'host@example.com' && /Action needed/.test(m.subject)));
  assert.ok(r);
});

test('reconcile confirms without the guest returning; ended trial and demo cannot take bookings', async () => {
  const g = client(srv.base);
  await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(40), check_out: d(42), pay: 'full' }));
  const s = lastSession();
  pay(s.id, 550000);
  assert.equal(await direct.reconcileDirect(), 1);

  await sql(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE name = 'Sunset Staycations'`);
  assert.equal((await g.get(`/api/public/book/${slug}`)).data.host.accepting, false);
  assert.equal((await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(50), check_out: d(52), pay: 'full' }))).status, 409);
  await sql(`UPDATE organizations SET trial_ends_at = now() + interval '10 days' WHERE name = 'Sunset Staycations'`);

  const demo = client(srv.base);
  await demo.post('/api/auth/demo');
  const demoPage = await client(srv.base).get('/api/public/book/demo');
  assert.equal(demoPage.status, 200);
  const du = demoPage.data.listings[0];
  assert.equal((await client(srv.base).post(`/api/public/book/demo/units/${du.unit_id}/checkout`, form({ check_in: d(55), check_out: d(57), pay: 'full' }))).status, 403);
});

test('turning the page off hides it', async () => {
  await owner.patch('/api/direct-booking', { enabled: false });
  assert.equal((await client(srv.base).get(`/api/public/book/${slug}`)).status, 404);
});

test('review fixes: hold limits per visitor, cancel releases dates, late payment loses to a valid hold, deposits only when the balance is not yet due, far-future dates refused', async () => {
  await owner.patch('/api/direct-booking', { enabled: true });
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  const g = client(srv.base);
  // Max 2 open holds per visitor.
  assert.equal((await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(60), check_out: d(62), pay: 'full', email: 'a1@example.com' }))).status, 200);
  const sA = lastSession();
  assert.equal((await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(70), check_out: d(72), pay: 'full', email: 'a2@example.com' }))).status, 200);
  const third = await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(80), check_out: d(82), pay: 'full', email: 'a3@example.com' }));
  assert.equal(third.status, 429);
  // Cancelling on PayMongo releases the dates immediately.
  const tokA = sA.attributes.cancel_url.split('cancelled=')[1];
  assert.equal((await g.post(`/api/public/book/cancel/${tokA}`)).data.status, 'expired');
  const avail = (await g.get(`/api/public/book/${slug}/units/${unit.unit_id}/availability?from=${d(59)}`)).data.days;
  assert.equal(avail.find((x) => x.date === d(60)).taken, false);
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);

  // Guest A's hold lapses; guest B holds the same nights; A pays late → A gets "conflict", B keeps the dates.
  const ga = client(srv.base);
  await ga.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(90), check_out: d(92), pay: 'full', email: 'late@example.com' }));
  const late = lastSession();
  await sql(`UPDATE direct_checkouts SET hold_until = now() - interval '1 minute', client_hash = 'x' WHERE provider_checkout_id = $1`, [late.id]);
  const gb = client(srv.base);
  const rb = await gb.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(90), check_out: d(92), pay: 'full', email: 'ontime@example.com' }));
  assert.equal(rb.status, 200, JSON.stringify(rb.data));
  const ontime = lastSession();
  pay(late.id, 550000);
  assert.equal((await ga.get(`/api/public/book/status/${late.attributes.success_url.split('/done/')[1]}`)).data.status, 'conflict');
  pay(ontime.id, 550000);
  assert.equal((await gb.get(`/api/public/book/status/${ontime.attributes.success_url.split('/done/')[1]}`)).data.status, 'confirmed');

  // Deposit not allowed when check-in is within the balance-due window.
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  const q = (await g.get(`/api/public/book/${slug}/units/${unit.unit_id}/quote?check_in=${d(1)}&check_out=${d(3)}`)).data;
  assert.equal(q.deposit_allowed, false);
  assert.equal((await client(srv.base).post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(1), check_out: d(3), pay: 'deposit', email: 'soon@example.com' }))).status, 400);
  assert.equal((await g.get(`/api/public/book/${slug}/units/${unit.unit_id}/quote?check_in=${d(700)}&check_out=${d(702)}`)).status, 400);
});

test('review fixes: a changed host key does not lose a pending payment; lapsed holds are expired at PayMongo', async () => {
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  const g = client(srv.base);
  await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(100), check_out: d(102), pay: 'full', email: 'key@example.com' }));
  const s = lastSession();
  // Host replaces the key with a different (also valid) one before the guest's payment is confirmed.
  await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostOTHER9876543210' });
  pay(s.id, 550000);
  assert.equal(await direct.reconcileDirect() >= 1, true);
  assert.equal((await sql('SELECT status FROM direct_checkouts WHERE provider_checkout_id = $1', [s.id]))[0].status, 'confirmed');
  // A lapsed, unpaid hold is expired at PayMongo so it can't be paid later.
  await g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, form({ check_in: d(110), check_out: d(112), pay: 'full', email: 'lapse@example.com' }));
  const s2 = lastSession();
  await sql(`UPDATE direct_checkouts SET hold_until = now() - interval '1 minute' WHERE provider_checkout_id = $1`, [s2.id]);
  await direct.reconcileDirect();
  assert.equal((await sql('SELECT status FROM direct_checkouts WHERE provider_checkout_id = $1', [s2.id]))[0].status, 'expired');
  assert.ok(expired.has(s2.id), 'PayMongo session expired');
});
