'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { outbox } = require('../src/lib/mailer');

const d = (n) => ical.addDays(manilaToday(), n);

let srv; let host;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Gate Address');
});
test.after(async () => { await srv.close(); });

// Creates a building, sends its gate pass, and returns the address the public page shows.
async function passAddress(name, address, city) {
  const prop = (await host.post('/api/properties', { property_name: name, property_type: 'condominium', address, city, province: 'Metro Manila' })).data.property;
  const unit = (await host.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Unit 1', unit_type: 'studio', nightly_rate: '2500', max_guests: 4 })).data.unit;
  await host.patch(`/api/properties/${prop.property_id}/gatepass`, { admin_email: 'admin@example.com' });
  const b = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(3), check_out: d(4), guest_name: 'Rafael Diaz' })).data.reservation;
  outbox.length = 0;
  assert.equal((await host.post(`/api/reservations/${b.booking_id}/gatepass/send`)).status, 200);
  const token = outbox.at(-1).text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1];
  return (await client(srv.base).get(`/api/public/gatepass/${token}`)).data.address;
}

test('gate pass address does not repeat the property name or the city', async () => {
  // The page header reads "property · address", so the address must not say either again.
  assert.equal(await passAddress('Azure Urban Residences', 'Azure Urban Residences, Parañaque', 'Parañaque'), 'Parañaque');
  assert.equal(await passAddress('Grass Residences', 'EDSA', 'Quezon City'), 'EDSA, Quezon City');
  assert.equal(await passAddress('Sea Tower', '12 Roxas Blvd, PASAY city', 'Pasay City'), '12 Roxas Blvd, PASAY city');
  assert.equal(await passAddress('Palm Court', 'Tower B, palm court, Parañaque', 'Parañaque'), 'Tower B, Parañaque');
  assert.equal(await passAddress('Mango Suites', 'Mango Suites', 'Cebu City'), 'Cebu City');
  // The city is dropped only when a whole comma part matches it; "Makati Ave" is not "Makati".
  assert.equal(await passAddress('Makati Heights', 'Makati Ave', 'Makati'), 'Makati Ave, Makati');
  // A part ending in " City" matches the bare city name too.
  assert.equal(await passAddress('Bay Suites', '7 Seaside Blvd, PASAY city', 'Pasay'), '7 Seaside Blvd, PASAY city');
});
