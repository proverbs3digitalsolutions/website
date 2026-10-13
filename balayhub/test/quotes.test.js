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
const { hashPassword } = require('../src/lib/auth');
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
const RULES = 'No smoking indoors.';
const MANAGER_PASSWORD = 'manager-pass-1';
let srv; let owner; let orgId; let unitA; let unitB; let airport; let quoteId; let quoteUrl; let token; let base;

// A quote from the host's point of view (the body the host screen sends).
const quoteBody = (over = {}) => ({
  unit_id: unitA.unit_id, check_in: d(5), check_out: d(7), num_guests: 2, guest_name: 'Juan Dela Cruz',
  guest_email: 'juan@example.com', guest_phone: '09171234567', accommodation_total: '5000', cleaning_fee: '500',
  discount_amount: '500', addons: [{ addon_id: airport, quantity: 1 }], pay_type: 'deposit', note: 'Includes airport pickup.', ...over,
});

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'quote-host@example.com', 'Harbor Quotes');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Harbor Quotes'`))[0].organization_id;
  const propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  const propB = (await owner.post('/api/properties', { property_name: 'Bayview', property_type: 'condominium', address: 'Macapagal Ave', city: 'Pasay', province: 'Metro Manila' })).data.property;
  const mk = async (prop, unit_name) => (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, description: 'Sea view.', bookable_online: true, min_nights: 2,
  })).data.unit;
  unitA = await mk(propA, 'Azure 301');
  unitB = await mk(propB, 'Bayview 9');
  await sql('UPDATE units SET house_rules = $2 WHERE unit_id = $1', [unitA.unit_id, RULES]);
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  base = srv.base;
  const [{ addon_id }] = await sql(
    `INSERT INTO listing_addons (organization_id, name, price, pricing, max_quantity, on_booking_page, before_arrival)
     VALUES ($1, 'Airport pickup', 1500, 'per_stay', 1, false, true) RETURNING addon_id`, [orgId]);
  airport = addon_id;
  // A manager who looks after the Azure property only.
  const [{ user_id: managerId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, 'manager@example.com', $2, 'Mina Manager', 'manager', now()) RETURNING user_id`,
    [orgId, await hashPassword(MANAGER_PASSWORD)]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [managerId, propA.property_id]);
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('host prices a quote: totals, add-ons, validation and the private link', async () => {
  assert.equal((await owner.post('/api/quotes', quoteBody({ accommodation_total: '0', cleaning_fee: '0', discount_amount: '0', addons: [] }))).status, 400, 'total must be above zero');
  assert.equal((await owner.post('/api/quotes', quoteBody({ expires_in_hours: 0 }))).status, 400);
  assert.equal((await owner.post('/api/quotes', quoteBody({ expires_in_hours: 337 }))).status, 400);
  assert.equal((await owner.post('/api/quotes', quoteBody({ addons: [{ addon_id: crypto.randomUUID(), quantity: 1 }] }))).status, 400, 'unknown add-on');
  const r = await owner.post('/api/quotes', quoteBody());
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const q = r.data.quote;
  quoteId = q.quote_id; quoteUrl = q.url;
  assert.match(q.url, /\/#\/quote\/[A-Za-z0-9_-]{32}$/);
  token = q.url.split('/#/quote/')[1];
  assert.equal(q.total_amount, '6500.00', 'stay 5000 + cleaning 500 + add-on 1500 - discount 500');
  assert.equal(q.amount_due_now, '4000.00', 'deposit on the stay (2500) + add-on (1500)');
  assert.deepEqual(q.addons, [{ name: 'Airport pickup', quantity: 1, amount: '1500.00' }]);
  assert.deepEqual([q.status, q.pay_type, q.addons_total, q.discount_amount], ['open', 'deposit', '1500.00', '500.00']);
  assert.equal(q.unit_name, 'Azure 301');
  assert.equal(q.guest_phone, '09171234567');
});

test('host prices a quote: a discount cannot be more than the stay, and a deposit needs stay left after it', async () => {
  const over = await owner.post('/api/quotes', quoteBody({ accommodation_total: '1000', discount_amount: '1500', addons: [] }));
  assert.equal(over.status, 400, JSON.stringify(over.data));
  assert.deepEqual(Object.keys(over.data.fields), ['discount_amount']);
  const wholeStay = await owner.post('/api/quotes', quoteBody({ accommodation_total: '1000', discount_amount: '1000', pay_type: 'deposit', addons: [] }));
  assert.equal(wholeStay.status, 400);
  assert.deepEqual(Object.keys(wholeStay.data.fields), ['discount_amount']);
  // Paying in full, a discount equal to the stay is allowed: the total is what is left of the cleaning fee.
  const full = await owner.post('/api/quotes', quoteBody({ accommodation_total: '1000', discount_amount: '1000', pay_type: 'full', addons: [] }));
  assert.equal(full.status, 201, JSON.stringify(full.data));
  assert.equal(full.data.quote.total_amount, '500.00');
});

test('a quote whose amount due now is under ₱100 is refused, with the direct booking wording', async () => {
  const priced = (over) => owner.post('/api/quotes', quoteBody({ check_in: d(140), check_out: d(142), cleaning_fee: '0', discount_amount: '0', addons: [], ...over }));
  const tiny = await priced({ accommodation_total: '99', pay_type: 'full' });
  assert.equal(tiny.status, 400, JSON.stringify(tiny.data));
  assert.deepEqual(tiny.data.fields, { accommodation_total: 'The amount is too small to pay online. Please contact the host.' });
  // Deposit is 50% of the stay (the unit default), so 150 leaves 75 due now.
  const half = await priced({ accommodation_total: '150', pay_type: 'deposit' });
  assert.equal(half.status, 400, JSON.stringify(half.data));
  assert.deepEqual(Object.keys(half.data.fields), ['accommodation_total']);
  // Exactly 100 is allowed. Add-ons are paid up front, so they count toward the amount due now.
  assert.equal((await priced({ accommodation_total: '100', pay_type: 'full' })).status, 201);
  assert.equal((await priced({ accommodation_total: '100', pay_type: 'deposit', addons: [{ addon_id: airport, quantity: 1 }] })).status, 201);
  assert.equal((await priced({ accommodation_total: '100', pay_type: 'deposit' })).status, 400, 'the 50 deposit alone is under 100');
});

test('host reads: list with a status filter, detail, and the price preview', async () => {
  const list = (await owner.get('/api/quotes?status=open')).data.quotes;
  assert.ok(list.some((x) => x.quote_id === quoteId));
  assert.equal((await owner.get('/api/quotes?status=nope')).status, 400);
  const detail = await owner.get(`/api/quotes/${quoteId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.quote.guest_email, 'juan@example.com');
  assert.equal(detail.data.quote.url, quoteUrl);
  const pv = await owner.get(`/api/units/${unitA.unit_id}/price-preview?check_in=${d(5)}&check_out=${d(7)}&guests=2`);
  assert.equal(pv.status, 200, JSON.stringify(pv.data));
  assert.equal(pv.data.accommodation_total, '5000.00');
  assert.equal(pv.data.cleaning_fee, '500.00');
  assert.equal(pv.data.available, true);
  assert.equal((await owner.get(`/api/units/${unitA.unit_id}/price-preview?check_in=${d(-1)}&check_out=${d(2)}`)).status, 400, 'no past dates');
});

test('send by email: the link goes to the guest; a quote with no email is refused', async () => {
  const noMail = (await owner.post('/api/quotes', quoteBody({ guest_email: undefined, guest_phone: undefined, check_in: d(60), check_out: d(62), addons: [] }))).data.quote;
  const refused = await owner.post(`/api/quotes/${noMail.quote_id}/send`);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'NO_EMAIL');
  outbox.length = 0;
  assert.equal((await owner.post(`/api/quotes/${quoteId}/send`)).status, 200);
  const mail = outbox.find((m) => m.to === 'juan@example.com');
  assert.ok(mail, 'emailed');
  assert.ok(mail.text.includes(quoteUrl));
  assert.equal(mail.subject, 'Your quote from Harbor Quotes');
});

test('the guest sees their own offer; the host key and other guests never appear', async () => {
  const g = client(base);
  const pub = await g.get(`/api/public/quote/${token}`);
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  assert.equal(pub.data.status, 'open');
  assert.deepEqual([pub.data.accommodation_total, pub.data.discount_amount, pub.data.cleaning_fee], ['5000.00', '500.00', '500.00']);
  assert.deepEqual([pub.data.total_amount, pub.data.amount_due_now, pub.data.addons_total], ['6500.00', '4000.00', '1500.00']);
  assert.equal(pub.data.host.name, 'Harbor Quotes');
  assert.equal(pub.data.listing.unit_name, 'Azure 301');
  assert.equal(pub.data.listing.house_rules, RULES);
  assert.equal(pub.data.booking_code, null);
  const text = JSON.stringify(pub.data);
  assert.ok(!text.includes('sk_test'), 'no PayMongo key');
  assert.ok(!text.includes('paymongo_key'), 'no key fields');
  assert.equal((await g.get('/api/public/quote/not-a-real-quote-token-xxxxxxxxx')).status, 404);
});

test('checkout: rules must be accepted; a new attempt ends the older payment page; paying confirms the booking and the quote', async () => {
  const g = client(base);
  const pay1 = `/api/public/quote/${token}/checkout`;
  const details = { name: 'Juan Dela Cruz', email: 'juan@example.com', phone: '09171234567', accept_rules: true, consent: true };
  const bare = await g.post(pay1, {});
  assert.equal(bare.status, 400);
  assert.deepEqual(Object.keys(bare.data.fields), ['consent'], 'the privacy notice must be agreed to');
  assert.deepEqual(Object.keys((await g.post(pay1, { ...details, consent: false })).data.fields), ['consent']);
  const noRules = await g.post(pay1, { ...details, accept_rules: false });
  assert.ok(noRules.data.fields.accept_rules, 'house rules are required');
  const first = await g.post(pay1, details);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const s1 = lastSession();
  assert.equal(s1.attributes.line_items[0].amount, 400000);
  const second = await g.post(pay1, details);
  assert.equal(second.status, 200);
  assert.equal(expired.has(s1.id), true, 'the older payment page was ended');
  const s2 = lastSession();
  assert.notEqual(s2.id, s1.id);
  const row = (await sql('SELECT status, quote_id, source, total_amount, addons_total, amount_due_now, rules_text FROM direct_checkouts WHERE provider_checkout_id = $1', [s2.id]))[0];
  assert.deepEqual(row, { status: 'pending', quote_id: quoteId, source: 'quote', total_amount: '5000.00', addons_total: '1500.00', amount_due_now: '4000.00', rules_text: RULES });
  assert.ok((await sql('SELECT consent_at FROM direct_checkouts WHERE provider_checkout_id = $1', [s2.id]))[0].consent_at instanceof Date, 'consent stamped when the checkout is made');
  assert.equal((await sql('SELECT status FROM direct_checkouts WHERE provider_checkout_id = $1', [s1.id]))[0].status, 'expired');

  pay(s2.id, 400000);
  const done = await g.get(`/api/public/quote/${token}`);
  assert.equal(done.status, 200);
  assert.equal(done.data.status, 'paid');
  assert.match(done.data.booking_code, /^BH-/);
  const [b] = await sql(`SELECT b.* FROM bookings b JOIN booking_quotes q ON q.booking_id = b.booking_id WHERE q.quote_id = $1`, [quoteId]);
  assert.equal(b.source, 'quote');
  assert.equal(b.channel, 'direct');
  assert.equal(b.total_amount, '6500.00', 'booking total = accommodation + cleaning + add-ons');
  assert.equal(b.extras_total, '1500.00');
  assert.equal(b.rules_text, RULES);
  assert.deepEqual((await sql('SELECT amount FROM booking_payments WHERE booking_id = $1', [b.booking_id])).map((p) => p.amount), ['4000.00']);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM booking_charges WHERE booking_id = $1 AND category = 'addon'`, [b.booking_id]))[0].n, 1);
  assert.equal((await owner.get('/api/quotes?status=paid')).data.quotes.find((x) => x.quote_id === quoteId).booking_id, b.booking_id);

  const again = await g.post(pay1, details);
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'QUOTE_PAID', 'a paid quote cannot be paid twice');
});

test('a full-payment quote with no contact details: the guest fills them in on the page; the host can cancel it while it is unpaid', async () => {
  const quote = (await owner.post('/api/quotes', { unit_id: unitA.unit_id, check_in: d(70), check_out: d(72), num_guests: 3, guest_name: 'Rosa Mendez', accommodation_total: '4000', pay_type: 'full' }))
    .data.quote;
  assert.equal(quote.total_amount, '4000.00');
  assert.equal(quote.amount_due_now, '4000.00');
  const tok = quote.url.split('/#/quote/')[1];
  const g = client(base);
  const missing = await g.post(`/api/public/quote/${tok}/checkout`, { accept_rules: true, consent: true });
  assert.equal(missing.status, 400);
  assert.ok(missing.data.fields.email && missing.data.fields.phone, 'email and phone are needed');
  const ok = await g.post(`/api/public/quote/${tok}/checkout`, { email: 'rosa@example.com', phone: '09181234567', accept_rules: true, consent: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const s = lastSession();
  assert.equal(s.attributes.line_items[0].amount, 400000);

  const cancel = await owner.post(`/api/quotes/${quote.quote_id}/cancel`);
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal(cancel.data.quote.status, 'cancelled');
  assert.equal(expired.has(s.id), true, 'the open payment page was ended');
  const pub = await g.get(`/api/public/quote/${tok}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.status, 'cancelled');
  const blocked = await g.post(`/api/public/quote/${tok}/checkout`, { accept_rules: true });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'QUOTE_CANCELLED');
  const twice = await owner.post(`/api/quotes/${quote.quote_id}/cancel`);
  assert.equal(twice.status, 409);
  assert.equal(twice.data.code, 'QUOTE_NOT_OPEN');
});

test('an expired quote: the guest is told who sent it; the host list shows it expired', async () => {
  const quote = (await owner.post('/api/quotes', quoteBody({ check_in: d(80), check_out: d(82), expires_in_hours: 1, addons: [] }))).data.quote;
  const tok = quote.url.split('/#/quote/')[1];
  await sql(`UPDATE booking_quotes SET expires_at = now() - interval '1 minute' WHERE quote_id = $1`, [quote.quote_id]);
  const g = client(base);
  const pub = await g.get(`/api/public/quote/${tok}`);
  assert.equal(pub.status, 410);
  assert.equal(pub.data.code, 'QUOTE_EXPIRED');
  assert.equal(pub.data.host.name, 'Harbor Quotes');
  const paying = await g.post(`/api/public/quote/${tok}/checkout`, { name: 'Late Guest', email: 'late@example.com', phone: '09171230009', accept_rules: true });
  assert.equal(paying.status, 410);
  assert.ok((await owner.get('/api/quotes?status=expired')).data.quotes.some((x) => x.quote_id === quote.quote_id && x.status === 'expired'));
});

test('dates booked by someone else before the guest pays: the payment is refused and nothing is charged', async () => {
  const quote = (await owner.post('/api/quotes', quoteBody({ check_in: d(90), check_out: d(92), addons: [] }))).data.quote;
  const tok = quote.url.split('/#/quote/')[1];
  assert.equal((await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: d(90), check_out: d(92), guest_name: 'Walk-in guest' })).status, 201);
  const before = sessions.size;
  const r = await client(base).post(`/api/public/quote/${tok}/checkout`, { accept_rules: true, consent: true });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'DATES_TAKEN');
  assert.equal(sessions.size, before, 'no payment page was opened');
});

test('a quote whose follow-up is never sent: abandoned-booking emails skip quote payments', async () => {
  await sql('UPDATE direct_checkouts SET hold_until = now() - interval \'3 hours\' WHERE quote_id = $1 AND status = \'expired\'', [quoteId]);
  await sql('UPDATE organizations SET abandoned_followup = true WHERE organization_id = $1', [orgId]);
  outbox.length = 0;
  assert.equal(await direct.sendAbandonedFollowups(new Date()), 0);
  assert.equal(outbox.filter((m) => /Still want/.test(m.subject)).length, 0);
});

test('a manager sees and prices only the properties they look after', async () => {
  const mgr = client(base);
  const login = await mgr.post('/api/auth/login', { email: 'manager@example.com', password: MANAGER_PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const other = (await owner.post('/api/quotes', { unit_id: unitB.unit_id, check_in: d(100), check_out: d(102), num_guests: 2, guest_name: 'Other Guest', accommodation_total: '5000', pay_type: 'full' })).data.quote;
  const list = (await mgr.get('/api/quotes')).data.quotes;
  assert.ok(list.some((x) => x.quote_id === quoteId), 'own property is visible');
  assert.ok(!list.some((x) => x.quote_id === other.quote_id), 'other property is hidden');
  assert.equal((await mgr.get(`/api/quotes/${other.quote_id}`)).status, 404);
  assert.equal((await mgr.get(`/api/units/${unitB.unit_id}/price-preview?check_in=${d(100)}&check_out=${d(102)}`)).status, 404);
  assert.equal((await mgr.post('/api/quotes', quoteBody({ unit_id: unitB.unit_id, addons: [] }))).status, 404);
});

test('send limits: 3 emails per quote and 30 per workspace a day; a demo or unpaid workspace cannot send', async () => {
  const quote = (await owner.post('/api/quotes', quoteBody({ check_in: d(110), check_out: d(112), addons: [] }))).data.quote;
  const send = () => owner.post(`/api/quotes/${quote.quote_id}/send`);
  for (let i = 1; i <= 3; i += 1) assert.equal((await send()).status, 200, `send ${i}`);
  const fourth = await send();
  assert.equal(fourth.status, 429, JSON.stringify(fourth.data));
  assert.equal(fourth.data.code, 'RATE_LIMITED');
  assert.equal((await sql('SELECT sent_count FROM booking_quotes WHERE quote_id = $1', [quote.quote_id]))[0].sent_count, 3);

  // Fill the workspace's day up to 30 sends (counted from the audit log), then the next quote is refused and not counted.
  const [{ n: sentToday }] = await sql(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE organization_id = $1 AND action = 'quote.sent'
    AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')`, [orgId]);
  await sql(`INSERT INTO audit_logs (organization_id, action, record_type) SELECT $1, 'quote.sent', 'quote' FROM generate_series(1, $2)`, [orgId, 30 - sentToday]);
  const more = (await owner.post('/api/quotes', quoteBody({ check_in: d(120), check_out: d(122), addons: [] }))).data.quote;
  const capped = await owner.post(`/api/quotes/${more.quote_id}/send`);
  assert.equal(capped.status, 429);
  assert.equal(capped.data.code, 'RATE_LIMITED');
  assert.equal((await sql('SELECT sent_count FROM booking_quotes WHERE quote_id = $1', [more.quote_id]))[0].sent_count, 0, 'a refused send is not counted');

  // A demo workspace can't send quotes, and nor can one with no PayMongo key (the guest could not pay).
  const fresh = (await owner.post('/api/quotes', quoteBody({ check_in: d(130), check_out: d(132), addons: [] }))).data.quote;
  await sql('UPDATE organizations SET is_demo = true WHERE organization_id = $1', [orgId]);
  const demo = await owner.post(`/api/quotes/${fresh.quote_id}/send`);
  assert.equal(demo.status, 403, JSON.stringify(demo.data));
  assert.equal(demo.data.code, 'DEMO_READ_ONLY');
  await sql('UPDATE organizations SET is_demo = false WHERE organization_id = $1', [orgId]);

  const [{ paymongo_key_enc: savedKey }] = await sql('SELECT paymongo_key_enc FROM organizations WHERE organization_id = $1', [orgId]);
  await sql('UPDATE organizations SET paymongo_key_enc = NULL WHERE organization_id = $1', [orgId]);
  const unpaid = await owner.post(`/api/quotes/${fresh.quote_id}/send`);
  assert.equal(unpaid.status, 409, JSON.stringify(unpaid.data));
  assert.equal(unpaid.data.code, 'NOT_ACCEPTING');
  await sql('UPDATE organizations SET paymongo_key_enc = $2 WHERE organization_id = $1', [orgId, savedKey]);
  assert.equal((await sql('SELECT sent_count FROM booking_quotes WHERE quote_id = $1', [fresh.quote_id]))[0].sent_count, 0);
});
