'use strict';

// QA r19 lane STAYS (server): two fixes from the round 19 sweep.
// 1. POST /reservations and POST /booking-groups answer guest_do_not_rebook_name: the name of the flagged guest the warning is
//    about (the booking's own guest when flagged, else the flagged guest with the same email, D-97), or null when nothing is flagged.
//    Both routes are managers and owners only, so staff never receive the name.
// 2. POST /blocks: an overlap answers 409 with the sentence that names what is in the way, and its field errors use the block
//    form's names start_date and end_date (the reservation form keeps check_in and check_out).

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const PASSWORD = 'longenough1';
const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let prop; let unitA; let unitB; let flagged; let azure; let azureUnit; let manager;

async function accept(email, role, name, property = prop) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [property.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: name, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r19stays-owner@example.com', 'R19 Stays');
  prop = (await owner.post('/api/properties', { property_name: 'R19 Harbor', property_type: 'condominium', address: 'Roxas Blvd', city: 'Pasay', province: 'Metro Manila' })).data.property;
  const makeUnit = (name) => owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: name, unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, description: 'Sea view.', bookable_online: true,
  });
  unitA = (await makeUnit('Paris 1208')).data.unit;
  unitB = (await makeUnit('Rio 2210')).data.unit;
  flagged = (await owner.post('/api/guests', { full_name: 'QA r19 DNR Flagged', email: 'dnr.r19@x.test', do_not_rebook: true })).data.guest;
  assert.equal(flagged.do_not_rebook, true);
  azure = (await owner.post('/api/properties', { property_name: 'R19 Azure', property_type: 'condominium', address: 'Ayala Ave', city: 'Makati', province: 'Metro Manila' })).data.property;
  azureUnit = (await owner.post(`/api/properties/${azure.property_id}/units`, {
    unit_name: 'Azure 1', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, description: 'City view.', bookable_online: true,
  })).data.unit;
  manager = await accept('r19stays-manager@example.com', 'manager', 'R19 Manager', azure);
});
test.after(async () => { await srv.close(); });

const reserve = (unit, from, to, extra) => owner.post('/api/reservations', {
  unit_id: unit.unit_id, check_in: d(from), check_out: d(to), accommodation_total: '5000.00', ...extra,
});
const room = (unit, from, to) => ({ unit_id: unit.unit_id, check_in: d(from), check_out: d(to), num_guests: 2, accommodation_total: '5000.00' });

test('a reservation whose email belongs to a flagged guest names that guest', async () => {
  const r = await reserve(unitA, 10, 11, { guest_name: 'Marco Testdela', guest_email: 'DNR.R19@x.test ' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.guest_do_not_rebook, true);
  assert.equal(r.data.reservation.guest_do_not_rebook_name, 'QA r19 DNR Flagged');
});

test('a reservation for the flagged guest record names that guest', async () => {
  const r = await reserve(unitA, 12, 13, { guest_id: flagged.guest_id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.guest_do_not_rebook_name, 'QA r19 DNR Flagged');
});

test('a reservation with no flag answers a null name', async () => {
  const r = await reserve(unitA, 14, 15, { guest_name: 'Clean Guest', guest_email: 'clean.r19@x.test' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.guest_do_not_rebook, false);
  assert.equal(r.data.reservation.guest_do_not_rebook_name, null);
});

test('an email flagged in another workspace names nobody in this one', async () => {
  const other = await ownerAccount(srv.base, 'r19stays-other@example.com', 'R19 Other Workspace');
  const og = await other.post('/api/guests', { full_name: 'Other Flagged', email: 'other.r19@x.test', do_not_rebook: true });
  assert.equal(og.status, 201, JSON.stringify(og.data));
  const r = await reserve(unitA, 16, 17, { guest_name: 'Other Buyer', guest_email: 'other.r19@x.test' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.guest_do_not_rebook, false);
  assert.equal(r.data.reservation.guest_do_not_rebook_name, null);
});

test('staff cannot create a reservation, so the flagged name never reaches them', async () => {
  const staff = await accept('r19stays-staff@example.com', 'staff', 'R19 Staff');
  const r = await staff.post('/api/reservations', { unit_id: unitA.unit_id, check_in: d(20), check_out: d(21), guest_name: 'Staff Try', guest_email: 'dnr.r19@x.test', accommodation_total: '5000.00' });
  assert.equal(r.status, 403, JSON.stringify(r.data));
});

test('a group whose lead has a flagged email names the flagged guest', async () => {
  const r = await owner.post('/api/booking-groups', {
    name: 'R19 DNR group', guest: { full_name: 'Lea Otherlead', email: 'DNR.R19@x.test' }, rooms: [room(unitA, 22, 24), room(unitB, 22, 24)],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.guest_do_not_rebook, true);
  assert.equal(r.data.guest_do_not_rebook_name, 'QA r19 DNR Flagged');
  assert.equal(r.data.guest_name, 'Lea Otherlead');
});

test('a group whose lead has no flag answers a null name', async () => {
  const r = await owner.post('/api/booking-groups', {
    name: 'R19 clean group', guest: { full_name: 'Clean Lead', email: 'lead.r19@x.test' }, rooms: [room(unitA, 30, 32), room(unitB, 30, 32)],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.guest_do_not_rebook, false);
  assert.equal(r.data.guest_do_not_rebook_name, null);
});

test('a block over a block answers 409 with the sentence that names it and the block form field names', async () => {
  assert.equal((await owner.post('/api/blocks', { unit_id: unitA.unit_id, start_date: d(40), end_date: d(40), reason: 'Painting' })).status, 201);
  const r = await owner.post('/api/blocks', { unit_id: unitA.unit_id, start_date: d(40), end_date: d(40), reason: 'Again' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'DATES_TAKEN');
  assert.match(r.data.error, /^These dates overlap a block on the night of [A-Z][a-z]{2} \d{1,2}, \d{4} on this listing\.$/);
  assert.deepEqual(r.data.fields, { start_date: 'Dates not available', end_date: 'Dates not available' });
});

test('a block over a stay names the guest, the code and the dates, with the block form field names', async () => {
  const stay = await reserve(unitB, 42, 44, { guest_name: 'Block Clash Guest' });
  assert.equal(stay.status, 201, JSON.stringify(stay.data));
  const code = stay.data.reservation.confirmation_code;
  const r = await owner.post('/api/blocks', { unit_id: unitB.unit_id, start_date: d(43), end_date: d(43), reason: 'Painting' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.match(r.data.error, /^These dates overlap Block Clash Guest's stay .+ – .+ on this listing\.$/);
  assert.ok(r.data.error.includes(`(${code})`), r.data.error);
  assert.deepEqual(r.data.fields, { start_date: 'Dates not available', end_date: 'Dates not available' });
});

test('a reservation over a stay still answers the reservation form field names', async () => {
  const r = await reserve(unitB, 43, 44, { guest_name: 'Second Clash' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.deepEqual(r.data.fields, { check_in: 'Dates not available', check_out: 'Dates not available' });
});

test('a manager whose properties do not hold the flagged guest gets the flag, but not that guest name', async () => {
  // The flagged guest has a stay on Paris 1208, which this manager (Azure only) cannot open.
  assert.equal((await reserve(unitA, 50, 51, { guest_id: flagged.guest_id })).status, 201);
  const r = await manager.post('/api/reservations', {
    unit_id: azureUnit.unit_id, check_in: d(52), check_out: d(53), accommodation_total: '5000.00', guest_name: 'Azure Guest', guest_email: 'DNR.R19@x.test',
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.guest_do_not_rebook, true);
  assert.equal(r.data.reservation.guest_do_not_rebook_name, 'Azure Guest');
});

test('a manager sees the flagged guest name when that guest has a stay on their own property', async () => {
  const azureFlagged = (await owner.post('/api/guests', { full_name: 'R19 Azure Flagged', email: 'azure.r19@x.test', do_not_rebook: true })).data.guest;
  assert.equal((await reserve(azureUnit, 60, 61, { guest_id: azureFlagged.guest_id })).status, 201);
  const r = await manager.post('/api/reservations', {
    unit_id: azureUnit.unit_id, check_in: d(62), check_out: d(63), accommodation_total: '5000.00', guest_name: 'Azure Clean', guest_email: 'AZURE.R19@x.test',
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.guest_do_not_rebook, true);
  assert.equal(r.data.reservation.guest_do_not_rebook_name, 'R19 Azure Flagged');
});

test('a manager group whose lead matches a flagged guest with stays elsewhere names the lead, with the flag', async () => {
  const r = await manager.post('/api/booking-groups', {
    name: 'R19 manager group', guest: { full_name: 'Lea Azure', email: 'DNR.R19@x.test' },
    rooms: [{ unit_id: azureUnit.unit_id, check_in: d(70), check_out: d(71), num_guests: 2, accommodation_total: '5000.00' },
      { unit_id: azureUnit.unit_id, check_in: d(72), check_out: d(73), num_guests: 2, accommodation_total: '5000.00' }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.guest_do_not_rebook, true);
  assert.equal(r.data.guest_do_not_rebook_name, 'Lea Azure');
});
