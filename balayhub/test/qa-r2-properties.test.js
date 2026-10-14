'use strict';

// QA round 2, lane A16. A blank in a field a unit must keep is refused with a field message, and a
// blank cleaning fee, security deposit or discount clears to 0 (listings#1). A postal code is 4
// digits (longterm#6). Property search treats % and _ as plain text (like-escape).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount } = require('./helpers');

let srv; let owner; let prop; let unit;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'properties-r2-16@example.com', 'Properties R2');
  prop = (await owner.post('/api/properties', { property_name: 'Azure Plain', property_type: 'condominium', address: '1 Plain Street', city: 'Makati', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Room 1', unit_type: 'room', monthly_rent: '8000', cleaning_fee: '500', security_deposit_amount: '1000', weekly_discount: 10,
  })).data.unit;
});
test.after(async () => { await srv.close(); });

const patchUnit = (body) => owner.patch(`/api/units/${unit.unit_id}`, body);
// The property view shows times as HH:MM; the PATCH response does not.
const savedUnit = async () => (await owner.get(`/api/properties/${prop.property_id}`)).data.units.find((u) => u.unit_id === unit.unit_id);

test('a blank check-in time, check-out time, minimum nights or balance-due days is refused and saves nothing', async () => {
  const before = await savedUnit();
  const r = await patchUnit({ monthly_rent: '9000', checkin_time: '', checkout_time: null, min_nights: '', balance_due_days: null });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.checkin_time, 'Check-in time is required.');
  assert.equal(r.data.fields.checkout_time, 'Check-out time is required.');
  assert.equal(r.data.fields.min_nights, 'Minimum nights is required.');
  assert.equal(r.data.fields.balance_due_days, 'Balance due is required.');
  const after = await savedUnit();
  assert.equal(after.monthly_rent, before.monthly_rent, 'the valid change in the same request is not saved either');
  assert.equal(after.checkin_time, before.checkin_time);
});

test('a blank payment option or availability is refused', async () => {
  const r = await patchUnit({ payment_option: null, availability: '' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.payment_option, 'Online payment is required.');
  assert.equal(r.data.fields.availability, 'Availability is required.');
});

test('a blank cleaning fee, security deposit or discount clears to 0, as a new unit stores it', async () => {
  const r = await patchUnit({ cleaning_fee: '', security_deposit_amount: null, weekly_discount: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = await savedUnit();
  assert.equal(after.cleaning_fee, '0.00');
  assert.equal(after.security_deposit_amount, '0.00');
  assert.equal(after.weekly_discount, 0);
});

test('a blank wifi name or weekend rate still clears', async () => {
  await patchUnit({ wifi_name: 'Bahay Wi-Fi', weekend_rate: '3000' });
  const r = await patchUnit({ wifi_name: '', weekend_rate: null });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.unit.wifi_name, null);
  assert.equal(r.data.unit.weekend_rate, null);
});

test('a postal code must be 4 digits on create and edit; a blank one is allowed', async () => {
  let n = 0;
  const base = (extra) => ({ property_type: 'house', address: `${++n} Postal Road`, city: 'Quezon City', province: 'Metro Manila', property_name: `Postal ${n}`, ...extra });
  for (const bad of ['ABCD', '120A', '12000', '12 00']) {
    const r = await owner.post('/api/properties', base({ postal_code: bad }));
    assert.equal(r.status, 400, bad);
    assert.equal(r.data.fields.postal_code, 'Postal code should be 4 digits.', bad);
  }
  const blank = await owner.post('/api/properties', base({}));
  assert.equal(blank.status, 201, JSON.stringify(blank.data));
  const ok = await owner.post('/api/properties', base({ postal_code: '1100' }));
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.property.postal_code, '1100');
  const edited = await owner.patch(`/api/properties/${ok.data.property.property_id}`, { postal_code: 'abcd' });
  assert.equal(edited.status, 400, JSON.stringify(edited.data));
  assert.equal(edited.data.fields.postal_code, 'Postal code should be 4 digits.');
  assert.equal((await owner.patch(`/api/properties/${ok.data.property.property_id}`, { postal_code: '1550' })).status, 200);
});

test('property search treats % and _ as plain text', async () => {
  await owner.post('/api/properties', { property_name: 'Block_C Tower', property_type: 'condominium', address: '9 Tower Road', city: 'Pasig', province: 'Metro Manila' });
  const found = async (q) => (await owner.get(`/api/properties?q=${encodeURIComponent(q)}`)).data.properties.map((p) => p.property_name).sort();
  assert.deepEqual(await found('%'), []);
  assert.deepEqual(await found('_'), ['Block_C Tower']);
  assert.deepEqual(await found('plain'), ['Azure Plain']);
});
