'use strict';

process.env.SMTP_URL = 'test://';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA round 1, lane F6: direct-booking checkout reports every missing field in one 400, consent and house rules included.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const RULES = 'No parties. Quiet hours after 10pm.';
let srv; let slug; let withRules; let noRules;

test.before(async () => {
  srv = await startServer();
  const owner = await ownerAccount(srv.base, 'f6host@example.com', 'Lane Six Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Shore', property_type: 'condominium', address: 'Roxas Blvd', city: 'Pasay', province: 'Metro Manila' })).data.property;
  const mk = async (unit_name) => (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, bookable_online: true, min_nights: 2,
  })).data.unit;
  withRules = await mk('Shore 1');
  noRules = await mk('Shore 2');
  await sql('UPDATE units SET house_rules = $2 WHERE unit_id = $1', [withRules.unit_id, RULES]);
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
});
test.after(async () => { await srv.close(); });

const checkoutUrl = (unit) => `/api/public/book/${slug}/units/${unit.unit_id}/checkout`;

test('checkout with every field empty: one 400 that names name, email, phone, consent and accept_rules', async () => {
  const r = await client(srv.base).post(checkoutUrl(withRules), {});
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'VALIDATION');
  for (const field of ['name', 'email', 'phone', 'consent', 'accept_rules']) {
    assert.ok(r.data.fields[field], `${field} is named in the same 400`);
  }
});

test('checkout: consent and house rules keep their existing messages; house rules are asked only when the listing has them', async () => {
  const g = client(srv.base);
  const details = { check_in: d(5), check_out: d(7), num_guests: 2, name: 'Ana Reyes', email: 'ana@example.com', phone: '09171230002', pay: 'deposit' };
  const both = await g.post(checkoutUrl(withRules), details);
  assert.equal(both.status, 400);
  assert.equal(both.data.fields.consent, 'Please agree to continue.');
  assert.equal(both.data.fields.accept_rules, 'Please read and agree to the house rules.');
  assert.deepEqual(Object.keys(both.data.fields).sort(), ['accept_rules', 'consent']);
  const plain = await g.post(checkoutUrl(noRules), {});
  assert.equal(plain.status, 400);
  assert.equal(plain.data.fields.consent, 'Please agree to continue.');
  assert.equal(plain.data.fields.accept_rules, undefined, 'no house rules, nothing to accept');
});
