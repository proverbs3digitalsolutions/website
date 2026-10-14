'use strict';

// QA round 2, lane A05: an add-on's maximum quantity counts per stay (guest#1), bill lines carry the
// Taglish add-on name (guest#5), and a cancelled stay owes nothing on the pay page (guest#2).
process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let unit; let token; let booking; let towel; let bed;
const buy = (id, quantity) => client(srv.base).post(`/api/public/pay/${token}/addons`, { selections: [{ addon_id: id, quantity }] });
const listed = async () => (await client(srv.base).get(`/api/public/pay/${token}/addons`)).data.addons;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r2-addons@example.com', 'R2 Addon Stays');
  const p = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const mk = async (body) => (await owner.post('/api/addons', { pricing: 'per_stay', before_arrival: true, ...body })).data.addon;
  towel = await mk({ name: 'Extra towel', price: '100', max_quantity: 3 });
  bed = await mk({ name: 'Extra bed', price: '500', max_quantity: 1 });
  await sql(`UPDATE listing_addons SET name_tl = 'Dagdag na tuwalya' WHERE addon_id = $1`, [towel.addon_id]);
  booking = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890' });
  token = (await owner.get(`/api/reservations/${booking.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
});
test.after(async () => { await srv.close(); });

test('guest#1 the maximum applies across purchases on one stay', async () => {
  assert.equal((await buy(towel.addon_id, 2)).status, 200);
  const over = await buy(towel.addon_id, 2);
  assert.equal(over.status, 409, JSON.stringify(over.data));
  assert.equal(over.data.code, 'ADDON_LIMIT');
  assert.match(over.data.fields.addons, /up to 1 more of Extra towel/);
  assert.equal((await buy(towel.addon_id, 1)).status, 200);
  const full = await buy(towel.addon_id, 1);
  assert.equal(full.status, 409);
  assert.match(full.data.fields.addons, /already on your bill/i);
  const n = await sql(`SELECT COALESCE(SUM(quantity),0)::int AS n FROM booking_charges WHERE booking_id = $1 AND addon_id = $2`, [booking.booking_id, towel.addon_id]);
  assert.equal(n[0].n, 3);
});

test('guest#1 the add-on list says how many are bought and left; a voided charge frees its quantity', async () => {
  const t = (await listed()).find((a) => a.addon_id === towel.addon_id);
  assert.equal(t.bought, 3);
  assert.equal(t.left, 0);
  assert.equal((await listed()).find((a) => a.addon_id === bed.addon_id).left, 1);
  await sql(`UPDATE booking_charges SET voided_at = now(), voided_by = (SELECT user_id FROM users LIMIT 1), void_reason = 'test' WHERE booking_id = $1 AND addon_id = $2`, [booking.booking_id, towel.addon_id]);
  const t2 = (await listed()).find((a) => a.addon_id === towel.addon_id);
  assert.equal(t2.bought, 0);
  assert.equal(t2.left, 3);
  assert.equal((await buy(towel.addon_id, 3)).status, 200);
});

test('guest#5 bill lines carry the Taglish name, null when there is none', async () => {
  assert.equal((await buy(bed.addon_id, 1)).status, 200);
  const bill = (await client(srv.base).get(`/api/public/pay/${token}`)).data.bill;
  const lines = bill.charges;
  assert.equal(lines.find((c) => c.description === 'Extra towel').name_tl, 'Dagdag na tuwalya');
  assert.equal(lines.find((c) => c.description === 'Extra bed').name_tl, null);
});

test('guest#2 a cancelled stay owes nothing', async () => {
  const before = (await client(srv.base).get(`/api/public/pay/${token}`)).data;
  assert.equal(before.cancelled, false);
  assert.ok(Number(before.balance_due) > 0);
  await owner.post(`/api/reservations/${booking.booking_id}/cancel`, { reason: 'test' });
  const pg = (await client(srv.base).get(`/api/public/pay/${token}`)).data;
  assert.equal(pg.cancelled, true);
  assert.equal(pg.balance_due, '0.00');
  assert.equal(pg.balance, '0.00');
  assert.ok(pg.bill.charges.length > 0, 'bill lines are kept');
  assert.equal(pg.bill.owed, false);
});
