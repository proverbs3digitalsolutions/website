'use strict';

// QA round 10, C06 (guest booking and pay): the pay page bill lists refunds (K12, server side),
// the pay page's failure sentence is the agreed one (#6), Taglish labels come from the shared
// dictionary (#7), and quote and booking money shows two decimals (price ruling, D-86).

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

const AGREED = "Online payment isn't available right now. Please try again in a few minutes, or contact the host.";

// Fake PayMongo. `down` makes the checkout request fail the way an unreachable service does.
const realFetch = globalThis.fetch;
let down = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  if (down && opts.method === 'POST' && u.endsWith('/checkout_sessions')) throw new TypeError('fetch failed');
  const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
  const session = { id, attributes: { checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } };
  return new Response(JSON.stringify({ data: session }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const d = (n) => ical.addDays(manilaToday(), n);
const read = (rel) => fs.readFileSync(path.join(__dirname, '../public/js', rel), 'utf8');
let srv; let owner; let unit;

// A two-night stay (2 x 2,000 plus a 500 cleaning fee = 4,500) with 3,000 paid, and its pay-page token.
async function stayWithPayment(offset) {
  const b = (await owner.post('/api/reservations', {
    unit_id: unit.unit_id, check_in: d(offset), check_out: d(offset + 2), guest_name: 'Ana Cruz', guest_email: 'ana@example.com',
  })).data.reservation;
  await owner.post(`/api/reservations/${b.booking_id}/payments`, { amount: '3000', payment_date: manilaToday(), payment_method: 'gcash' });
  const token = (await owner.get(`/api/reservations/${b.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  return { id: b.booking_id, token };
}

const refund = (id, body) => owner.post(`/api/reservations/${id}/refunds`, { method: 'cash', reason: 'Refund for a late checkout fee', ...body });

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Refund Stays');
  await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890' });
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('the pay page bill lists the refund (amount and date) and the refunded total, and the balance adds up', async () => {
  const { id, token } = await stayWithPayment(10);
  assert.equal((await refund(id, { amount: '1000', refund_date: manilaToday() })).status, 201);
  const pg = (await client(srv.base).get(`/api/public/pay/${token}`)).data;
  assert.deepEqual(pg.bill.refunds, [{ amount: '1000.00', refund_date: manilaToday() }]);
  assert.equal(pg.bill.refunded, '1000.00');
  assert.equal(pg.bill.paid, '3000.00');
  assert.equal(pg.balance_due, '2500.00', 'the balance already counts the refund (D-85)');
  assert.equal((Number(pg.bill.total) - Number(pg.bill.paid) + Number(pg.bill.refunded)).toFixed(2), pg.balance_due,
    'total less payments plus refunds is the balance due on screen');
});

test('voided refunds are left out, and the rest are listed oldest first with no reason or name', async () => {
  const { id, token } = await stayWithPayment(20);
  await refund(id, { amount: '1000', refund_date: manilaToday() });
  await refund(id, { amount: '500', refund_date: d(-1), reason: 'Broken lamp' });
  const voided = (await refund(id, { amount: '200', refund_date: manilaToday() })).data.refund;
  assert.equal((await owner.post(`/api/refunds/${voided.refund_id}/void`, { reason: 'Entered twice' })).status, 200);
  const pg = (await client(srv.base).get(`/api/public/pay/${token}`)).data;
  assert.deepEqual(pg.bill.refunds, [
    { amount: '500.00', refund_date: d(-1) },
    { amount: '1000.00', refund_date: manilaToday() },
  ]);
  assert.equal(pg.bill.refunded, '1500.00');
  for (const r of pg.bill.refunds) assert.deepEqual(Object.keys(r).sort(), ['amount', 'refund_date']);
});

test('when PayMongo cannot be reached, the guest sees the agreed sentence and the real reason goes to the server log', async () => {
  const { token } = await stayWithPayment(30);
  const logs = [];
  const logError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  let r;
  try {
    down = true;
    r = await client(srv.base).post(`/api/public/pay/${token}/checkout`);
  } finally {
    down = false;
    console.error = logError;
  }
  assert.equal(r.status, 502);
  assert.equal(r.data.code, 'PAYMENT_FAILED');
  assert.equal(r.data.error, AGREED);
  assert.ok(logs.some((l) => /could not start online payment: Couldn't reach the payment service/.test(l)), 'the real reason is in the server log');
});

test('a stored PayMongo key that cannot be read gives the agreed sentence too', async () => {
  const { token } = await stayWithPayment(40);
  const [{ paymongo_key_enc: saved }] = await sql(`SELECT paymongo_key_enc FROM organizations WHERE name = $1`, ['Refund Stays']);
  const unreadable = `v1.${Buffer.alloc(12).toString('base64')}.${Buffer.alloc(16).toString('base64')}.${Buffer.alloc(8).toString('base64')}`;
  await sql(`UPDATE organizations SET paymongo_key_enc = $2 WHERE name = $1`, ['Refund Stays', unreadable]);
  try {
    const r = await client(srv.base).post(`/api/public/pay/${token}/checkout`);
    assert.equal(r.status, 502);
    assert.equal(r.data.code, 'PAYMENT_FAILED');
    assert.equal(r.data.error, AGREED);
  } finally {
    await sql(`UPDATE organizations SET paymongo_key_enc = $2 WHERE name = $1`, ['Refund Stays', saved]);
  }
});

test('quote page: Dates and Guests come from the shared Taglish dictionary, not local overrides (#7)', () => {
  const src = read('views/quote.js');
  assert.doesNotMatch(src, /'Dates': 'Dates'/);
  assert.doesNotMatch(src, /'Guests': 'Guests'/);
});

test('quote page: every amount shows two decimals, with no whole-peso shortcut', () => {
  const src = read('views/quote.js');
  assert.match(src, /const peso = .*minimumFractionDigits: 2, maximumFractionDigits: 2/);
  assert.doesNotMatch(src, /Number\.isInteger/);
});

test('booking page: owed and charged amounts use two decimals; advertised per-night prices and calendar tiles stay as they were', () => {
  const src = read('views/book.js');
  const summaryAt = src.indexOf("summary.replaceChildren(h('dl'");
  const summaryEnd = src.indexOf('submit.disabled = !q.available || !host.accepting', summaryAt);
  assert.ok(summaryAt > 0 && summaryEnd > summaryAt, 'the price summary block is found');
  const summary = src.slice(summaryAt, summaryEnd);
  assert.doesNotMatch(summary, /peso\(/, 'no whole-peso amount in the price summary');
  assert.match(summary, /money\(q\.total\)/);
  assert.match(src, /const money = .*minimumFractionDigits: 2, maximumFractionDigits: 2/);
  assert.match(src, /amountEl\.textContent = box\.checked && current \? money\(addonAmount/);
  assert.doesNotMatch(src, /peso\(st\.paid\)|peso\(st\.balance\)/);
  assert.match(src, /peso\(avgNight \?\? fromPrice\)/, 'the per-night and from price stay whole when exact');
  assert.match(src, /peso\(l\.nightly_rate\)/, 'the listing card price stays whole when exact');
  assert.match(src, /₱\$\{Math\.round\(info\.price \/ 100\) \/ 10\}k/, 'calendar tiles keep their short form');
});
