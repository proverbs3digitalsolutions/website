'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

// Fake PayMongo. `rejectNext` makes the next checkout fail the way a rejected key does.
const realFetch = globalThis.fetch;
const sessions = new Map();
let rejectNext = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    if (rejectNext) { rejectNext = false; return json({ errors: [{ detail: 'Unauthorized' }] }, 401); }
    const a = JSON.parse(opts.body).data.attributes;
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    sessions.set(id, { id, attributes: { ...a, checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } });
    return json({ data: sessions.get(id) });
  }
  const m = /checkout_sessions\/(cs_\w+)$/.exec(u);
  if (m && sessions.has(m[1])) return json({ data: sessions.get(m[1]) });
  return json({ errors: [{ detail: 'not found' }] }, 404);
};
const lastSession = () => [...sessions.values()].at(-1);
const paid = (s, centavos) => {
  s.attributes.payments = [{ attributes: { status: 'paid', amount: centavos, source: { type: 'gcash' } } }];
  s.attributes.payment_method_used = 'gcash';
};

const d = (n) => ical.addDays(manilaToday(), n);
const NEUTRAL = "Online payment isn't available right now. Please try again in a few minutes, or contact the host.";
const form = (extra = {}) => ({ check_in: d(30), check_out: d(32), num_guests: 2, name: 'Juan Dela Cruz', email: 'juan@example.com', phone: '09171234567', pay: 'full', consent: true, ...extra });

let srv; let owner; let slug; let unitA; let unitC;
const base = (u) => `/api/public/book/${slug}/units/${u.unit_id}`;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c04@example.com', 'Balay Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unit = (name, rate) => owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: name, unit_type: 'studio', nightly_rate: rate, cleaning_fee: '0', max_guests: 4, bookable_online: true, min_nights: 2,
  }).then((r) => r.data.unit);
  unitA = await unit('Loft A', '2000.00');
  unitC = await unit('Loft C', '2000.00');
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_c04KEY1234567890', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('a code worth ₱1,500.50 off shows its centavos on the booking quote', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'QAR9-AMOUNT', amount_off: '1500.50' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const q = (await client(srv.base).get(`${base(unitA)}/quote?check_in=${d(10)}&check_out=${d(12)}&code=QAR9-AMOUNT`)).data;
  assert.equal(q.promo_label, '₱1,500.50 off');
  assert.equal(q.promo_discount, '1500.50');
});

test('an owner code with spaces is refused at the field, with a dashed suggestion, and nothing is saved', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'QA R9 BAD', percent_off: 10 });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.code, "Codes can't contain spaces. Try QA-R9-BAD.");
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM discount_codes WHERE code LIKE 'QAR9BAD%'`))[0].n, 0);
});

test('a guest who types a code in lower case, or with spaces, still gets the discount', async () => {
  assert.equal((await owner.post('/api/discount-codes', { code: 'QAR9TEN', percent_off: 10 })).status, 201);
  const g = client(srv.base);
  for (const typed of ['qar9ten', 'QA R9 TEN']) {
    const q = (await g.get(`${base(unitA)}/quote?check_in=${d(10)}&check_out=${d(12)}&code=${encodeURIComponent(typed)}`)).data;
    assert.equal(q.promo_label, '10% off', typed);
    assert.equal(q.code_error, null, typed);
  }
});

test('a failed card payment tells the guest a neutral sentence, and the dates are released', async () => {
  const g = client(srv.base);
  rejectNext = true;
  const r = await g.post(`${base(unitA)}/checkout`, form({ check_in: d(20), check_out: d(22) }));
  assert.equal(r.status, 502);
  assert.equal(r.data.code, 'PAYMENT_FAILED');
  assert.equal(r.data.error, NEUTRAL);
  assert.doesNotMatch(r.data.error, /Settings|key|host's/i, 'the host\'s settings are not shown to the guest');
  const retry = await g.post(`${base(unitA)}/checkout`, form({ check_in: d(20), check_out: d(22) }));
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
});

test('the owner is told a direct booking amount with its centavos, and the booking note keeps the discount', async () => {
  const g = client(srv.base);
  // 2 nights at 2000.00 is 4000.00, less the 1500.50 code, leaves 2499.50 to pay now.
  const r = await g.post(`${base(unitC)}/checkout`, form({ code: 'QAR9-AMOUNT' }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = lastSession();
  const token = s.attributes.success_url.split('/done/')[1];
  assert.equal(s.attributes.line_items[0].amount, 249950);
  paid(s, 249950);
  const st = await g.get(`/api/public/book/status/${token}`);
  assert.equal(st.data.status, 'confirmed');
  const [b] = await sql('SELECT notes FROM bookings WHERE confirmation_code = $1', [st.data.stay.code]);
  assert.match(b.notes, /Discount code QAR9-AMOUNT: −₱1,500\.50 \(already taken off the accommodation\)\./);
  const inbox = (await owner.get('/api/inbox?view=unread')).data.conversations;
  assert.ok(inbox.some((c) => /New direct booking: .*Paid ₱2,499\.50 online \(in full\)\./.test(c.last_body)), 'the inbox message shows ₱2,499.50');
});

test('the booking page shows a nightly "from" price with its centavos', async () => {
  const h = await ownerAccount(srv.base, 'seo-c04@example.com', 'Seo Stays C04');
  const p = (await h.post('/api/properties', { property_name: 'Pine', property_type: 'condominium', address: 'Ayala Ave', city: 'Makati', province: 'Metro Manila' })).data.property;
  await h.post(`/api/properties/${p.property_id}/units`, { unit_name: 'Pine 1', unit_type: 'studio', nightly_rate: '2500.50', cleaning_fee: '0', bookable_online: true });
  const r = await h.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_seoKEY1234567890', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const page = await fetch(`${srv.base}/stay/${r.data.url.split('/#/book/')[1]}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /From ₱2,500\.50 \/ night/);
});

test('money text on the server uses two decimals through fmtPeso, and the code form says no spaces', () => {
  for (const f of ['src/lib/discounts.js', 'src/routes/directbooking.js', 'src/routes/guestcare.js', 'src/routes/seo.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.doesNotMatch(src, /toLocaleString\((?![^)]*minimumFractionDigits)/, `${f} formats a peso amount without two decimals`);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '../src/lib/discounts.js'), 'utf8'), /fmtPeso/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/routes/seo.js'), 'utf8'), /fmtPeso/);
  const view = fs.readFileSync(path.join(__dirname, '../public/js/views/guestcare.js'), 'utf8');
  assert.match(view, /hint: 'Letters, numbers and dashes\. No spaces\.'/);
});
