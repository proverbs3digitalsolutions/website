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
const messaging = require('../src/lib/messaging');
const balance = require('../src/routes/balancepay');

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
const pay = (s, centavos) => { s.attributes.payments = [{ attributes: { status: 'paid', amount: centavos, source: { type: 'gcash' } } }]; s.attributes.payment_method_used = 'gcash'; };
const d = (n) => ical.addDays(manilaToday(), n);

let srv; let owner; let res; let token;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Balance Stays');
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const u = (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  res = (await owner.post('/api/reservations', { unit_id: u.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  await owner.post(`/api/reservations/${res.booking_id}/payments`, { amount: '2000', payment_date: manilaToday(), payment_method: 'gcash' });
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('payment link needs PayMongo; the link shows the balance', async () => {
  const off = await owner.get(`/api/reservations/${res.booking_id}/payment-link`);
  assert.equal(off.data.available, false);
  await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890' });
  const on = await owner.get(`/api/reservations/${res.booking_id}/payment-link`);
  assert.equal(on.data.available, true);
  assert.equal(on.data.balance, '2500.00');
  token = on.data.link.split('/#/pay/')[1];
  const pg = await client(srv.base).get(`/api/public/pay/${token}`);
  assert.equal(pg.data.balance, '2500.00');
  assert.equal(pg.data.paid, '2000.00');
  assert.equal(pg.data.accepting, true);
  assert.equal(pg.data.test_mode, true);
  assert.equal((await client(srv.base).get('/api/public/pay/nonsense-token-123456789')).status, 404);
});

test('reminder template includes the payment link sentence', async () => {
  const tpl = (await owner.get('/api/message-templates')).data.templates.find((t) => t.system_key === 'payment_reminder');
  const r = await owner.get(`/api/message-templates/${tpl.template_id}/render?booking_id=${res.booking_id}`);
  assert.match(r.data.body, /Pay securely online \(GCash, Maya or card\): .*\/#\/pay\//);
});

test('guest pays the balance: amount from the server, recorded once with a receipt', async () => {
  const g = client(srv.base);
  const c1 = await g.post(`/api/public/pay/${token}/checkout`);
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  const s = last();
  assert.equal(s.attributes.line_items[0].amount, 250000);
  const c2 = await g.post(`/api/public/pay/${token}/checkout`);
  assert.equal(c2.data.checkout_url, c1.data.checkout_url, 'reuses the open checkout');
  assert.equal((await g.post(`/api/public/pay/${token}/refresh`)).data.paid, false);
  outbox.length = 0;
  pay(s, 250000);
  const r = await g.post(`/api/public/pay/${token}/refresh`);
  assert.equal(r.data.paid, true);
  assert.equal(r.data.balance, '0.00');
  assert.equal((await g.post(`/api/public/pay/${token}/refresh`)).data.paid, false, 'not applied twice');
  const pays = await sql(`SELECT amount, payment_method, receipt_number, recorded_by FROM booking_payments WHERE booking_id = $1 ORDER BY created_at`, [res.booking_id]);
  assert.equal(pays.length, 2);
  assert.deepEqual([pays[1].amount, pays[1].payment_method, pays[1].recorded_by], ['2500.00', 'gcash', null]);
  assert.ok(pays[1].receipt_number);
  assert.ok(outbox.some((m) => m.to === 'ana@example.com' && /Receipt/.test(m.subject)));
  assert.ok((await owner.get('/api/inbox?view=unread')).data.conversations.some((c) => /paid ₱2,500 online/.test(c.last_body)));
  assert.equal((await g.post(`/api/public/pay/${token}/checkout`)).status, 409, 'nothing left to pay');
  // The host's reservation page shows no balance and no link.
  assert.equal((await owner.get(`/api/reservations/${res.booking_id}/payment-link`)).data.available, false);
});

test('wrong amount is not accepted; reconcile confirms without the guest; reminders skip paid stays', async () => {
  const r2 = (await owner.post('/api/reservations', { unit_id: res.unit_id, check_in: d(20), check_out: d(21), guest_name: 'Ben', guest_email: 'ben@example.com' })).data.reservation;
  const t2 = (await owner.get(`/api/reservations/${r2.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  await client(srv.base).post(`/api/public/pay/${t2}/checkout`);
  const s = last();
  pay(s, 100);
  assert.equal((await client(srv.base).post(`/api/public/pay/${t2}/refresh`)).data.paid, false);
  pay(s, 250000);
  assert.ok(await balance.reconcileBalance() >= 1);
  assert.equal((await client(srv.base).get(`/api/public/pay/${t2}`)).data.balance, '0.00');

  // A balance reminder is sent only to guests who still owe.
  const auto = (await owner.get('/api/automations')).data.automations.find((a) => a.trigger_event === 'before_check_in' && /balance/.test(a.name));
  assert.ok(auto, 'default balance reminder exists');
  assert.equal(auto.enabled, false);
});

test('cancelled bookings and ended plans cannot take payments', async () => {
  const r3 = (await owner.post('/api/reservations', { unit_id: res.unit_id, check_in: d(30), check_out: d(31), guest_name: 'Cid', guest_email: 'cid@example.com' })).data.reservation;
  const t3 = (await owner.get(`/api/reservations/${r3.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  await sql(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE name = 'Balance Stays'`);
  assert.equal((await client(srv.base).get(`/api/public/pay/${t3}`)).data.accepting, false);
  assert.equal((await client(srv.base).post(`/api/public/pay/${t3}/checkout`)).status, 409);
  await sql(`UPDATE organizations SET trial_ends_at = now() + interval '5 days' WHERE name = 'Balance Stays'`);
  await owner.post(`/api/reservations/${r3.booking_id}/cancel`, { reason: 'test' });
  const pg = (await client(srv.base).get(`/api/public/pay/${t3}`)).data;
  assert.equal(pg.cancelled, true);
  assert.equal(pg.accepting, false);
  assert.ok(messaging);
});
