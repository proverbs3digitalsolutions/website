'use strict';

// QA round 2, settings#1/#2/#5: text in the Accommodation box must never become a PHP 0 quote.
// The server refuses a non-positive or non-numeric accommodation total and words the hours message plainly.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let unit;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'quote-r2@example.com', 'Harbor R2');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Azure 301', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, description: 'Sea view.', bookable_online: true, min_nights: 2,
  })).data.unit;
});
test.after(async () => { await srv.close(); });

const body = (o = {}) => ({
  unit_id: unit.unit_id, check_in: d(5), check_out: d(7), num_guests: 2, guest_name: 'Juan Dela Cruz',
  guest_email: 'juan@example.com', accommodation_total: '5000', cleaning_fee: '500', discount_amount: '0', addons: [], pay_type: 'full', ...o,
});

test('a text or zero accommodation total is refused with a field message', async () => {
  for (const bad of ['abc', '0', '0.00', '']) {
    const r = await owner.post('/api/quotes', body({ accommodation_total: bad, cleaning_fee: '2000' }));
    assert.equal(r.status, 400, `${bad}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.fields?.accommodation_total, bad);
  }
  assert.equal((await owner.post('/api/quotes', body())).status, 201);
});

test('the hours message is plain', async () => {
  for (const bad of [0, 337, 'x']) {
    const r = await owner.post('/api/quotes', body({ expires_in_hours: bad }));
    assert.equal(r.status, 400);
    assert.equal(r.data.fields.expires_in_hours, 'Hours must be between 1 and 336 (14 days).');
  }
});

test('quotes.js no longer turns text into 0', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/quotes.js'), 'utf8');
  assert.doesNotMatch(src, /\|\|\s*0\)\s*\*\s*100/);
  assert.match(src, /Use rate-card price/);
});
