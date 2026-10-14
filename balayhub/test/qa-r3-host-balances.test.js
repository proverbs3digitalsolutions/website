'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.ANTHROPIC_API_KEY = 'test-key';

// QA round 3, money#11 (host views). A channel fee on a direct booking must not lower the balance
// the host sees in the inbox guest panel, the AI draft prompt or the daily close. A channel booking
// still takes off its own fee. Runs on its own database (TEST_DATABASE_URL) because the test resets the schema.

// Fake the Anthropic API; everything else (the test client) goes through.
const realFetch = globalThis.fetch;
const aiCalls = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.anthropic.com/')) {
    aiCalls.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hi! Your balance is noted.\n\nMaria' }] }), { headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, opts);
};

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');

const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

let srv; let owner; let today; let direct; let airbnb; let convDirect; let convAirbnb;

// The stored total for a booking, as a number (pg returns NUMERIC as a string).
async function totalOf(bookingId) {
  return Number((await sql('SELECT total_amount::text AS total FROM bookings WHERE booking_id = $1', [bookingId]))[0].total);
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r3-balances@example.com', 'Balance Stays');
  today = manilaToday();
  const prop = (await owner.post('/api/properties', { property_name: 'Balance House', property_type: 'house', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const unitDirect = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1A', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const unitAirbnb = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1B', unit_type: 'studio', nightly_rate: '2000' })).data.unit;

  // Direct booking, due in one day, 2,000 paid in cash today.
  const d = await owner.post('/api/reservations', {
    unit_id: unitDirect.unit_id, check_in: addDays(today, 1), check_out: addDays(today, 3), guest_name: 'Direct Guest', accommodation_total: '10000.00', channel: 'direct',
  });
  assert.equal(d.status, 201, JSON.stringify(d.data));
  direct = d.data.reservation;
  assert.equal((await owner.post(`/api/reservations/${direct.booking_id}/payments`, { amount: '2000.00', payment_date: today, payment_method: 'cash' })).status, 201);
  // A fee on a direct booking is legacy data here (the server refuses new ones), so it is set straight in the database.
  await sql('UPDATE bookings SET channel_fee = 300 WHERE booking_id = $1', [direct.booking_id]);

  // Airbnb booking on another unit, due in one day, with its 300 fee.
  const a = await owner.post('/api/reservations', {
    unit_id: unitAirbnb.unit_id, check_in: addDays(today, 1), check_out: addDays(today, 3), guest_name: 'Airbnb Guest', accommodation_total: '5000.00', channel: 'airbnb', channel_fee: '300',
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  airbnb = a.data.reservation;
});
test.after(async () => { await srv.close(); });

test('inbox guest balance on a direct booking is the total less payments, not less the stored fee', async () => {
  const conv = await owner.post(`/api/reservations/${direct.booking_id}/conversation`);
  assert.equal(conv.status, 200, JSON.stringify(conv.data));
  convDirect = conv.data.conversation_id;
  const { status, data } = await owner.get(`/api/inbox/${convDirect}`);
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.conversation.balance, money((await totalOf(direct.booking_id)) - 2000));
});

test('inbox guest balance on a channel booking still takes off its own fee', async () => {
  const conv = await owner.post(`/api/reservations/${airbnb.booking_id}/conversation`);
  assert.equal(conv.status, 200, JSON.stringify(conv.data));
  convAirbnb = conv.data.conversation_id;
  const { data } = await owner.get(`/api/inbox/${convAirbnb}`);
  assert.equal(data.conversation.balance, money((await totalOf(airbnb.booking_id)) - 300));
});

test('AI draft prompt gives the full balance for a direct booking', async () => {
  const before = aiCalls.length;
  const r = await owner.post(`/api/inbox/${convDirect}/ai-draft`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(aiCalls.length, before + 1);
  const prompt = aiCalls.at(-1).messages[0].content;
  const shown = prompt.match(/balance due: ₱([\d,.]+)/);
  assert.ok(shown, 'the prompt states a balance due');
  assert.equal(Number(shown[1].replace(/,/g, '')), (await totalOf(direct.booking_id)) - 2000);
});

test('daily close balances due shows a direct booking at its total less payments', async () => {
  const { status, data } = await owner.get(`/api/daily-close?date=${today}`);
  assert.equal(status, 200, JSON.stringify(data));
  const row = data.sections.find((s) => s.key === 'balances_due').items.find((i) => i.link === `#/reservations/${direct.booking_id}`);
  assert.ok(row, 'the direct booking is on today\'s balances list');
  assert.equal(row.amount, money((await totalOf(direct.booking_id)) - 2000));
});

test('the three host views no longer subtract the stored fee from a direct booking', () => {
  for (const file of ['src/routes/inbox.js', 'src/lib/ai.js', 'src/routes/dailyclose.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(src, /total_amount - b\.channel_fee/, `${file} still subtracts the stored channel fee`);
    assert.match(src, /BALANCE/, `${file} does not use the shared balance`);
  }
  // The effective fee (a direct booking has none) now lives in the one shared fragment (D-85).
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src/lib/balance.js'), 'utf8'), /CASE WHEN b\.channel = 'direct' THEN 0 ELSE b\.channel_fee END/);
});
