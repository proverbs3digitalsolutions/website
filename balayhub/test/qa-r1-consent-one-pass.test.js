'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';
process.env.GUEST_ID_RETENTION_DAYS = '30';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA round 1: the guest check-in form and the public quote checkout name every missing field in one 400,
// consent and house rules included (the same fix as the direct-booking checkout in lane F6).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const RULES = 'No parties. Quiet hours after 10pm.';
let srv; let base; let owner; let rulesUnit; let plainUnit;
let rulesCheckin; let plainCheckin; let rulesQuote; let plainQuote;

test.before(async () => {
  srv = await startServer();
  base = srv.base;
  owner = await ownerAccount(srv.base, 'consent-host@example.com', 'Consent Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Cove', property_type: 'condominium', address: 'Ayala Ave', city: 'Makati', province: 'Metro Manila' })).data.property;
  const mk = async (unit_name) => (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, bookable_online: true, min_nights: 2,
  })).data.unit;
  rulesUnit = await mk('Cove 1');
  plainUnit = await mk('Cove 2');
  await sql('UPDATE units SET house_rules = $2 WHERE unit_id = $1', [rulesUnit.unit_id, RULES]);

  // One stay per listing, each with its private check-in link.
  const tokenFor = async (unit, check_in, check_out) => {
    const r = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in, check_out, guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com', num_guests: 2 })).data.reservation;
    return (await owner.get(`/api/reservations/${r.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  };
  rulesCheckin = await tokenFor(rulesUnit, d(3), d(5));
  plainCheckin = await tokenFor(plainUnit, d(3), d(5));

  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // A quote with no email or phone, so the guest has to fill those in too.
  const quoteFor = async (unit) => {
    const q = (await owner.post('/api/quotes', { unit_id: unit.unit_id, check_in: d(10), check_out: d(12), num_guests: 2, guest_name: 'Rosa Mendez', accommodation_total: '4000', pay_type: 'full' })).data.quote;
    return q.url.split('/#/quote/')[1];
  };
  rulesQuote = await quoteFor(rulesUnit);
  plainQuote = await quoteFor(plainUnit);
});
test.after(async () => { await srv.close(); });

const names = (r) => Object.keys(r.data.fields).sort();

test('check-in with every field empty: one 400 that names the name, phone, consent and house rules', async () => {
  const r = await client(base).post(`/api/public/checkin/${rulesCheckin}`, {});
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'VALIDATION');
  assert.deepEqual(names(r), ['accept_rules', 'consent', 'lead_name', 'phone']);
  assert.equal(r.data.fields.consent, 'Please agree so your host can register you with the building.');
  assert.equal(r.data.fields.accept_rules, 'Please agree to the house rules.');
});

test('check-in on a listing with no house rules: the empty form names name, phone and consent, not house rules', async () => {
  const r = await client(base).post(`/api/public/checkin/${plainCheckin}`, {});
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(names(r), ['consent', 'lead_name', 'phone']);
});

test('check-in: a bad phone number and no consent come back together, and house rules are asked only until accepted', async () => {
  const g = client(base);
  const both = await g.post(`/api/public/checkin/${rulesCheckin}`, { lead_name: 'Rafael Diaz', phone: '12' });
  assert.equal(both.status, 400);
  assert.deepEqual(names(both), ['accept_rules', 'consent', 'phone']);
  const saved = await g.post(`/api/public/checkin/${rulesCheckin}`, { lead_name: 'Rafael Diaz', phone: '09171112222', consent: true, accept_rules: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const again = await g.post(`/api/public/checkin/${rulesCheckin}`, {});
  assert.deepEqual(names(again), ['consent', 'lead_name', 'phone'], 'house rules already accepted, so not asked again');
});

test('quote checkout with every field empty: one 400 that names email, phone, consent and house rules', async () => {
  const r = await client(base).post(`/api/public/quote/${rulesQuote}/checkout`, {});
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'VALIDATION');
  assert.deepEqual(names(r), ['accept_rules', 'consent', 'email', 'phone']);
  assert.equal(r.data.fields.consent, 'Please agree to continue.');
  assert.equal(r.data.fields.accept_rules, 'Please read and agree to the house rules.');
});

test('quote checkout on a listing with no house rules: the empty form names email, phone and consent', async () => {
  const r = await client(base).post(`/api/public/quote/${plainQuote}/checkout`, {});
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.deepEqual(names(r), ['consent', 'email', 'phone']);
});

test('quote checkout with contact details given: consent and house rules are still named together', async () => {
  const r = await client(base).post(`/api/public/quote/${rulesQuote}/checkout`, { email: 'rosa@example.com', phone: '09181234567' });
  assert.equal(r.status, 400);
  assert.deepEqual(names(r), ['accept_rules', 'consent']);
});
