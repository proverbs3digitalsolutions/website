'use strict';

// QA round 1, bug #13: the guest's quote page showed add-on names in English even in Taglish mode.
// The quote's add-ons are a price snapshot without the Taglish name, so the guest JSON must carry
// name_tl read from the add-on list (the same way the pay page reads it).

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let unit; let airport; let late; let token;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'quote-names@example.com', 'Harbor Names');
  const [{ organization_id: orgId }] = await sql(`SELECT organization_id FROM organizations WHERE name = 'Harbor Names'`);
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Azure 301', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, description: 'Sea view.', bookable_online: true, min_nights: 2,
  })).data.unit;
  // One add-on with a Taglish name, one without.
  [{ addon_id: airport }] = await sql(
    `INSERT INTO listing_addons (organization_id, name, name_tl, price, pricing, max_quantity, on_booking_page, before_arrival)
     VALUES ($1, 'Airport pickup', 'Sundo sa paliparan', 1500, 'per_stay', 1, false, true) RETURNING addon_id`, [orgId]);
  [{ addon_id: late }] = await sql(
    `INSERT INTO listing_addons (organization_id, name, name_tl, price, pricing, max_quantity, on_booking_page, before_arrival)
     VALUES ($1, 'Late checkout', NULL, 800, 'per_stay', 1, false, true) RETURNING addon_id`, [orgId]);
});
test.after(async () => { await srv.close(); });

test('the guest quote carries each add-on Taglish name (null when there is none)', async () => {
  const r = await owner.post('/api/quotes', {
    unit_id: unit.unit_id, check_in: d(5), check_out: d(7), num_guests: 2, guest_name: 'Juan Dela Cruz',
    guest_email: 'juan@example.com', guest_phone: '09171234567', accommodation_total: '5000', cleaning_fee: '500',
    discount_amount: '0', addons: [{ addon_id: airport, quantity: 1 }, { addon_id: late, quantity: 1 }], pay_type: 'full', note: 'Includes airport pickup.',
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  token = (await sql('SELECT public_token FROM booking_quotes WHERE quote_id = $1', [r.data.quote.quote_id]))[0].public_token;

  const pub = await client(srv.base).get(`/api/public/quote/${token}`);
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  const byName = Object.fromEntries(pub.data.addons.map((a) => [a.name, a]));
  assert.equal(byName['Airport pickup'].name_tl, 'Sundo sa paliparan');
  assert.equal(byName['Late checkout'].name_tl, null);
  // The English name and amounts the guest already saw are unchanged.
  assert.equal(byName['Airport pickup'].amount, '1500.00');
});
