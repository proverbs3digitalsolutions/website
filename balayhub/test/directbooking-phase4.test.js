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

// Fake PayMongo that remembers which secret key created each checkout (same shape as directbooking.test.js).
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
const RULES = 'No parties. Quiet hours after 10pm.';
let srv; let owner; let orgId; let slug; let unit; let plain; let airport; let breakfast; let hidden; let onlyPlain;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'p4host@example.com', 'Balay Phase Four');
  const prop = (await owner.post('/api/properties', { property_name: 'Harbor', property_type: 'condominium', address: 'Roxas Blvd', city: 'Pasay', province: 'Metro Manila' })).data.property;
  const mk = async (unit_name) => (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, description: 'Sea view.', bookable_online: true, min_nights: 2,
  })).data.unit;
  unit = await mk('Paris 1208');
  plain = await mk('Plain 2');
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Balay Phase Four'`))[0].organization_id;
  await sql('UPDATE units SET house_rules = $2, public_slug = $3 WHERE unit_id = $1', [unit.unit_id, RULES, 'paris-1208']);
  await sql('UPDATE units SET public_slug = $2 WHERE unit_id = $1', [plain.unit_id, 'plain-2']);

  const addon = async (name, over = {}) => {
    const v = { price: 1500, pricing: 'per_stay', max_quantity: 2, unit_ids: [], on_booking_page: true, before_arrival: true, ...over };
    const [{ addon_id }] = await sql(
      `INSERT INTO listing_addons (organization_id, name, price, pricing, max_quantity, unit_ids, on_booking_page, before_arrival)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING addon_id`,
      [orgId, name, v.price, v.pricing, v.max_quantity, v.unit_ids, v.on_booking_page, v.before_arrival]);
    return addon_id;
  };
  airport = await addon('Airport pickup', { max_quantity: 1 });
  breakfast = await addon('Breakfast', { price: 250, pricing: 'per_guest', max_quantity: 4 });
  hidden = await addon('Late checkout', { price: 300, on_booking_page: false });
  onlyPlain = await addon('Only plain', { price: 100, unit_ids: [plain.unit_id] });
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('public listing carries house rules, the add-ons for the booking page, and the page address', async () => {
  const page = await client(srv.base).get(`/api/public/book/${slug}`);
  assert.equal(page.status, 200, JSON.stringify(page.data));
  const l = page.data.listings.find((x) => x.unit_id === unit.unit_id);
  assert.equal(l.house_rules, RULES);
  assert.equal(l.public_url, '/stay/balay-phase-four/paris-1208');
  assert.deepEqual(l.addons.map((a) => a.name).sort(), ['Airport pickup', 'Breakfast']);
  assert.deepEqual(Object.keys(l.addons[0]).sort(), ['addon_id', 'description', 'max_quantity', 'name', 'name_tl', 'price', 'pricing']);
  const p = page.data.listings.find((x) => x.unit_id === plain.unit_id);
  assert.equal(p.house_rules, null);
  assert.deepEqual(p.addons.map((a) => a.name).sort(), ['Airport pickup', 'Breakfast', 'Only plain']);
});

test('quote total includes the add-ons; the deposit stays on the stay; add-ons not offered here are refused', async () => {
  const g = client(srv.base);
  const base = `/api/public/book/${slug}/units/${unit.unit_id}/quote?check_in=${d(5)}&check_out=${d(7)}&guests=2`;
  const withAddons = (list) => `${base}&addons=${encodeURIComponent(JSON.stringify(list))}`;
  const plainQ = (await g.get(base)).data;
  assert.equal(plainQ.total, '5500.00');
  assert.equal(plainQ.addons_total, '0.00');
  const q = (await g.get(withAddons([{ addon_id: airport, quantity: 1 }, { addon_id: breakfast, quantity: 1 }]))).data;
  assert.equal(q.addons_total, '2000.00', 'airport 1500 + breakfast 250 x 2 guests');
  assert.equal(q.total, '7500.00');
  assert.equal(q.deposit, '2750.00', 'deposit is on the stay only');
  assert.equal(q.available, true);
  assert.equal((await g.get(withAddons([{ addon_id: hidden, quantity: 1 }]))).status, 400, 'not offered on the booking page');
  assert.equal((await g.get(withAddons([{ addon_id: airport, quantity: 2 }]))).status, 400, 'over the maximum quantity');
  assert.equal((await g.get(withAddons([{ addon_id: onlyPlain, quantity: 1 }]))).status, 400, 'not offered for this listing');
  assert.equal((await g.get(`${base}&addons=${encodeURIComponent('not json')}`)).status, 400);
});

test('checkout: house rules must be accepted; add-ons plus the deposit are due now; the booking and its bill agree', async () => {
  const g = client(srv.base);
  const url = `/api/public/book/${slug}/units/${unit.unit_id}/checkout`;
  const body = {
    check_in: d(5), check_out: d(7), num_guests: 2, name: 'Ana Reyes', email: 'ana@example.com', phone: '09171230001',
    pay: 'deposit', consent: true, source: 'facebook',
    addons: [{ addon_id: airport, quantity: 1 }, { addon_id: breakfast, quantity: 1 }],
  };
  const noRules = await g.post(url, body);
  assert.equal(noRules.status, 400);
  assert.ok(noRules.data.fields.accept_rules, 'house rules are required');
  const r = await g.post(url, { ...body, accept_rules: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = lastSession();
  assert.equal(s.attributes.line_items[0].amount, 475000, 'deposit 2750 + add-ons 2000');
  const token = s.attributes.success_url.split('/done/')[1];
  pay(s.id, 475000);
  assert.equal(await direct.reconcileDirect(), 1);

  const [b] = await sql(`SELECT b.* FROM bookings b JOIN guests g ON g.guest_id = b.guest_id WHERE g.email = 'ana@example.com'`);
  assert.equal(b.total_amount, '7500.00', 'accommodation + cleaning + add-ons');
  assert.equal(b.extras_total, '2000.00');
  assert.equal(b.source, 'facebook');
  assert.equal(b.rules_text, RULES);
  assert.ok(b.rules_accepted_at);
  assert.match(b.notes, /50% deposit paid/);
  const charges = await sql(`SELECT category, addon_id, amount FROM booking_charges WHERE booking_id = $1 ORDER BY amount`, [b.booking_id]);
  assert.deepEqual(charges.map((c) => [c.category, c.addon_id, c.amount]), [['addon', breakfast, '500.00'], ['addon', airport, '1500.00']]);
  const pays = await sql('SELECT amount FROM booking_payments WHERE booking_id = $1', [b.booking_id]);
  assert.deepEqual(pays.map((p) => p.amount), ['4750.00']);
  const st = (await g.get(`/api/public/book/status/${token}`)).data;
  assert.equal(st.status, 'confirmed');
  assert.deepEqual([st.stay.total, st.stay.paid, st.stay.balance], ['7500.00', '4750.00', '2750.00']);
});

test('a listing without house rules needs no acceptance; a source outside the list is dropped; add-ons not on the booking page are refused', async () => {
  const g = client(srv.base);
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  const url = `/api/public/book/${slug}/units/${plain.unit_id}/checkout`;
  const guest = { check_in: d(20), check_out: d(22), num_guests: 2, name: 'Ben Cruz', email: 'ben@example.com', phone: '09171230002', pay: 'full', consent: true };
  const refused = await g.post(url, { ...guest, addons: [{ addon_id: hidden, quantity: 1 }] });
  assert.equal(refused.status, 400);
  assert.ok(refused.data.fields.addons);
  const r = await g.post(url, { ...guest, source: 'quote' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const row = (await sql(`SELECT source, rules_accepted_at, rules_text, addons_total FROM direct_checkouts WHERE guest_email = 'ben@example.com'`))[0];
  assert.deepEqual(row, { source: null, rules_accepted_at: null, rules_text: null, addons_total: '0.00' });
});

test('one follow-up email two hours after an abandoned booking, only when the host has it on, and never twice', async () => {
  const g = client(srv.base);
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  const plainUrl = `/api/public/book/${slug}/units/${plain.unit_id}/checkout`;
  await g.post(plainUrl, { check_in: d(30), check_out: d(32), num_guests: 2, name: 'Lia Tan', email: 'lia@example.com', phone: '09171230003', pay: 'full', consent: true });
  // The guest leaves the payment page; the attempt ended three hours ago.
  await sql(`UPDATE direct_checkouts SET status = 'expired', hold_until = now() - interval '3 hours' WHERE guest_email = 'lia@example.com'`);
  outbox.length = 0;
  assert.equal(await direct.sendAbandonedFollowups(new Date()), 0, 'off by default');
  await sql('UPDATE organizations SET abandoned_followup = true WHERE organization_id = $1', [orgId]);
  assert.equal(await direct.sendAbandonedFollowups(new Date()), 1);
  const mail = outbox.filter((m) => m.to === 'lia@example.com');
  assert.equal(mail.length, 1);
  assert.equal(mail[0].subject, 'Still want Plain 2?');
  assert.ok(mail[0].text.includes(`/#/book/${slug}/${plain.unit_id}`), 'links back to the listing');
  assert.ok(mail[0].text.includes('ignore this message'));
  assert.equal(await direct.sendAbandonedFollowups(new Date()), 0, 'never a second email for the same attempt');
  assert.equal((await sql(`SELECT followup_sent_at IS NOT NULL AS sent FROM direct_checkouts WHERE guest_email = 'lia@example.com'`))[0].sent, true);
});

test('no follow-up when the same guest has since booked those nights', async () => {
  const g = client(srv.base);
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  const plainUrl = `/api/public/book/${slug}/units/${plain.unit_id}/checkout`;
  await g.post(plainUrl, { check_in: d(40), check_out: d(42), num_guests: 2, name: 'Kim Lim', email: 'kim@example.com', phone: '09171230004', pay: 'full', consent: true });
  await sql(`UPDATE direct_checkouts SET status = 'expired', hold_until = now() - interval '3 hours' WHERE guest_email = 'kim@example.com'`);
  const booked = await owner.post('/api/reservations', { unit_id: plain.unit_id, check_in: d(40), check_out: d(42), guest_name: 'Kim Lim', guest_email: 'kim@example.com' });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  outbox.length = 0;
  assert.equal(await direct.sendAbandonedFollowups(new Date()), 0);
  assert.equal(outbox.filter((m) => m.to === 'kim@example.com').length, 0);
});

// Abandoned-booking follow-ups: greeting, which attempts count, and one email per address per 30 days.
const abandon = async (path, email, start, name = 'Tess Uy') => {
  const r = await client(srv.base).post(path, { check_in: d(start), check_out: d(start + 2), num_guests: 2, name, email, phone: '09171230005', pay: 'full', consent: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // The guest left the payment page three hours ago.
  await sql(`UPDATE direct_checkouts SET status = 'expired', hold_until = now() - interval '3 hours' WHERE guest_email = $1 AND status = 'pending'`, [email]);
};

test('follow-up: greets by first name only when the name is plain; otherwise "there" (Taglish: "po")', async () => {
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  const url = `/api/public/book/${slug}/units/${plain.unit_id}/checkout`;
  const people = [
    ['Joanna Reyes', 'greet-a@example.com'],
    ['Mark2 Santos', 'greet-b@example.com'],
    ['<i>Ana</i> Cruz', 'greet-c@example.com'],
    ['Mariaconcepcionanunciacionaguilarvillanueva Cruz', 'greet-d@example.com'],
  ];
  for (const [i, [name, email]] of people.entries()) await abandon(url, email, 130 + i * 3, name);
  outbox.length = 0;
  assert.equal(await direct.sendAbandonedFollowups(new Date()), people.length);
  const text = (email) => outbox.find((m) => m.to === email).text;
  assert.ok(text('greet-a@example.com').startsWith('Hi Joanna,\n'));
  assert.ok(text('greet-b@example.com').startsWith('Hi there,\n'), 'a digit in the name is not used');
  assert.ok(text('greet-c@example.com').startsWith('Hi there,\n'), 'markup is not used');
  assert.ok(text('greet-d@example.com').startsWith('Hi there,\n'), 'a name over 30 letters is not used');

  await sql(`UPDATE organizations SET guest_language = 'tl' WHERE organization_id = $1`, [orgId]);
  try {
    await abandon(url, 'greet-e@example.com', 150, 'Mark2 Santos');
    outbox.length = 0;
    assert.equal(await direct.sendAbandonedFollowups(new Date()), 1);
    assert.ok(outbox[0].text.startsWith('Hi po,\n\nNagsimula kang'), outbox[0].text.slice(0, 40));
  } finally {
    await sql(`UPDATE organizations SET guest_language = 'en' WHERE organization_id = $1`, [orgId]);
  }
});

test('follow-up: only an attempt that reached the payment page counts; a failed start or a session that never existed gets none', async () => {
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  const url = `/api/public/book/${slug}/units/${plain.unit_id}/checkout`;
  await abandon(url, 'failed@example.com', 160);
  await abandon(url, 'nosession@example.com', 164);
  // A failed start has no PayMongo session; an expired one with no session never reached the payment page.
  await sql(`UPDATE direct_checkouts SET status = 'failed', provider_checkout_id = NULL WHERE guest_email = 'failed@example.com'`);
  await sql(`UPDATE direct_checkouts SET provider_checkout_id = NULL WHERE guest_email = 'nosession@example.com'`);
  outbox.length = 0;
  assert.equal(await direct.sendAbandonedFollowups(new Date()), 0);
  assert.equal(outbox.filter((m) => m.to === 'failed@example.com' || m.to === 'nosession@example.com').length, 0);
});

test('follow-up: one email per address per 30 days across all workspaces; a month later another is allowed', async () => {
  const other = await ownerAccount(srv.base, 'second-host@example.com', 'Second Host Stays');
  const r2 = await other.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY9876543210', enabled: true });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  const slug2 = r2.data.url.split('/#/book/')[1];
  await sql('UPDATE organizations SET abandoned_followup = true WHERE booking_slug = $1', [slug2]);
  const prop2 = (await other.post('/api/properties', { property_name: 'Second Tower', property_type: 'condominium', address: 'Ortigas', city: 'Pasig', province: 'Metro Manila' })).data.property;
  const unit2 = (await other.post(`/api/properties/${prop2.property_id}/units`, { unit_name: 'Second 1', unit_type: 'studio', nightly_rate: '2000', bookable_online: true })).data.unit;

  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  await abandon(`/api/public/book/${slug}/units/${plain.unit_id}/checkout`, 'twice@example.com', 100);
  await abandon(`/api/public/book/${slug2}/units/${unit2.unit_id}/checkout`, 'twice@example.com', 100);
  outbox.length = 0;
  assert.equal(await direct.sendAbandonedFollowups(new Date()), 1, 'two attempts, one email');
  assert.equal(outbox.filter((m) => m.to === 'twice@example.com').length, 1);
  assert.equal(await direct.sendAbandonedFollowups(new Date()), 0);

  // Once the last email is more than 30 days old, a new attempt may get one.
  await sql(`UPDATE direct_checkouts SET followup_sent_at = now() - interval '31 days' WHERE guest_email = 'twice@example.com'`);
  await abandon(`/api/public/book/${slug}/units/${plain.unit_id}/checkout`, 'twice@example.com', 110);
  outbox.length = 0;
  assert.equal(await direct.sendAbandonedFollowups(new Date()), 1);
  assert.equal(outbox.filter((m) => m.to === 'twice@example.com').length, 1);
});

// A quote the host cancelled while the guest was paying: the payment still makes the booking.
test('a quote cancelled while the guest is paying: the payment still makes the booking, the quote stays cancelled, and the conversation gets a note', async () => {
  await sql(`UPDATE direct_checkouts SET status = 'expired' WHERE status = 'pending'`);
  const created = await owner.post('/api/quotes', { unit_id: plain.unit_id, check_in: d(170), check_out: d(172), num_guests: 2, guest_name: 'Quinn Dela Cruz',
    guest_email: 'quinn@example.com', guest_phone: '09171230007', accommodation_total: '5000', cleaning_fee: '500', pay_type: 'full' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const quoteId = created.data.quote.quote_id;
  const [{ public_token: token }] = await sql('SELECT public_token FROM booking_quotes WHERE quote_id = $1', [quoteId]);

  const start = await client(srv.base).post(`/api/public/quote/${token}/checkout`, { consent: true });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  pay(lastSession().id, 550000); // paid at PayMongo before the host cancels
  const cancelled = await owner.post(`/api/quotes/${quoteId}/cancel`, {});
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));

  const [quote] = await sql('SELECT status FROM booking_quotes WHERE quote_id = $1', [quoteId]);
  assert.equal(quote.status, 'cancelled', 'the host cancelled it, so it stays cancelled');
  const [b] = await sql(`SELECT b.booking_id FROM bookings b JOIN direct_checkouts c ON c.booking_id = b.booking_id WHERE c.quote_id = $1`, [quoteId]);
  assert.ok(b, 'the money was taken, so the booking is still made');
  const notes = await sql(`SELECT m.body FROM messages m JOIN conversations cv USING (conversation_id)
                            WHERE cv.booking_id = $1 AND m.direction = 'note' AND m.body LIKE 'Paid after the quote was cancelled%'`, [b.booking_id]);
  assert.equal(notes.length, 1);
});
