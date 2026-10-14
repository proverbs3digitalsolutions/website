'use strict';

// QA r6 lane C03: staff see guest names only (BACKEND-SCHEMA 6, "Guest profiles"). No VIP or do-not-rebook
// flag, no stay history, no ratings, on guests, reservations, receipts, groups and the homepage overview.
// Owners and managers keep everything.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const PASSWORD = 'longenough1';
const d = (n) => ical.addDays(manilaToday(), n);
const FLAGS = ['vip', 'do_not_rebook', 'guest_vip', 'guest_do_not_rebook', 'avg_rating', 'review', 'previous_stays'];
const noFlags = (o, what) => { for (const k of FLAGS) assert.ok(!(k in o), `${what} must not carry ${k}`); };

let groupId; let srv; let owner; let manager; let staff; let prop; let guest; let other; let res1; let res2;

async function accept(email, role, name) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [prop.property_id] });
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
  owner = await ownerAccount(srv.base, 'r6c03-owner@example.com', 'R6 C03');
  prop = (await owner.post('/api/properties', { property_name: 'R6 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  const u1 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'A1', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  const u2 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'A2', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  const u3 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'A3', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  manager = await accept('r6c03-mgr@example.com', 'manager', 'R6 Manager');
  staff = await accept('r6c03-staff@example.com', 'staff', 'R6 Staff');
  guest = (await owner.post('/api/guests', { full_name: 'Vera VIP', email: 'vera@example.com', phone: '09171234567', vip: true, do_not_rebook: true })).data.guest;
  other = (await owner.post('/api/guests', { full_name: 'Plain Pat' })).data.guest;
  res1 = (await owner.post('/api/reservations', { unit_id: u1.unit_id, check_in: d(-10), check_out: d(-8), guest_id: guest.guest_id })).data.reservation;
  res2 = (await owner.post('/api/reservations', { unit_id: u1.unit_id, check_in: d(0), check_out: d(2), guest_id: guest.guest_id })).data.reservation;
  assert.ok(res1 && res2);
  await sql(`INSERT INTO guest_reviews (organization_id, booking_id, guest_id, rating, comment) VALUES ($1,$2,$3,5,'lovely')`,
    [res1.organization_id, res1.booking_id, guest.guest_id]);
  await owner.post(`/api/reservations/${res2.booking_id}/payments`, { amount: '1000', payment_date: manilaToday(), payment_method: 'cash' }, { 'Idempotency-Key': 'r6c03-pay-0001' });
  const grp = await owner.post('/api/booking-groups', {
    name: 'R6 group', guest: { guest_id: guest.guest_id },
    rooms: [{ unit_id: u2.unit_id, check_in: d(20), check_out: d(22), num_guests: 2 }, { unit_id: u3.unit_id, check_in: d(20), check_out: d(22), num_guests: 2 }],
  });
  assert.equal(grp.status, 201, JSON.stringify(grp.data));
  groupId = grp.data.group.group_id;
});
test.after(async () => { await srv.close(); });

test('staff GET /guests rows are exactly guest_id, full_name, limited; filters other than q are ignored', async () => {
  const all = (await staff.get('/api/guests')).data.guests;
  assert.equal(all.length, 2);
  for (const g of all) assert.deepEqual(Object.keys(g).sort(), ['full_name', 'guest_id', 'limited']);
  assert.deepEqual(all.map((g) => g.full_name), ['Plain Pat', 'Vera VIP']);
  for (const qs of ['segment=vip', 'segment=do_not_rebook', 'rating=4', 'min_stays=2', 'stay=in_house', 'sort=stays']) {
    const r = (await staff.get(`/api/guests?${qs}`)).data.guests;
    assert.deepEqual(r, all, qs);
  }
  assert.equal((await staff.get('/api/guests?q=vera')).data.guests.length, 1);
});

test('staff guest profile has no stays, reviews or flags', async () => {
  const r = (await staff.get(`/api/guests/${guest.guest_id}`)).data;
  assert.deepEqual(r.guest, { guest_id: guest.guest_id, full_name: 'Vera VIP', limited: true });
  assert.deepEqual(r.stays, []);
  assert.deepEqual(r.reviews, []);
});

test('staff reservation list, detail, update-free views and overview carry no flags, history or rating', async () => {
  const list = (await staff.get('/api/reservations?view=all')).data.reservations;
  assert.ok(list.length >= 2);
  for (const r of list) noFlags(r, 'list row');
  noFlags((await staff.get(`/api/reservations/${res1.booking_id}`)).data.reservation, 'detail');
  const ov = (await staff.get('/api/stays/overview?range=7d')).data;
  for (const r of [...ov.arrivals, ...ov.departures, ...ov.staying]) noFlags(r, 'overview row');
  assert.ok(ov.staying.length >= 1);
});

test('staff cannot reveal flags or history by filtering reservations', async () => {
  const base = (await staff.get('/api/reservations?view=all')).data.reservations.map((r) => r.booking_id);
  for (const g of ['vip', 'repeat', 'first']) {
    const r = (await staff.get(`/api/reservations?view=all&guest=${g}`)).data.reservations.map((x) => x.booking_id);
    assert.deepEqual(r, base, g);
  }
});

test('staff receipt has no flags', async () => {
  const pays = (await owner.get(`/api/reservations/${res2.booking_id}`)).data.payments;
  const rc = (await staff.get(`/api/booking-payments/${pays[0].payment_id}/receipt`)).data.receipt;
  noFlags(rc, 'receipt');
  assert.ok(!('guest_email' in rc));
});

test('staff group lead guest is name only', async () => {
  const g = (await staff.get(`/api/booking-groups/${groupId}`)).data;
  assert.deepEqual(g.guest, { guest_id: guest.guest_id, full_name: 'Vera VIP', limited: true });
});

test('owner and manager responses are unchanged', async () => {
  for (const c of [owner, manager]) {
    const row = (await c.get('/api/guests')).data.guests.find((g) => g.guest_id === guest.guest_id);
    assert.equal(row.vip, true);
    assert.equal(row.do_not_rebook, true);
    assert.equal(Number(row.stays), 4);
    assert.equal(Number(row.avg_rating), 5);
    assert.equal((await c.get('/api/guests?segment=vip')).data.guests.length, 1);
    const p = (await c.get(`/api/guests/${guest.guest_id}`)).data;
    assert.equal(p.guest.vip, true);
    assert.equal(p.stays.length, 4);
    assert.equal(p.reviews.length, 1);
    const rv = (await c.get(`/api/reservations/${res1.booking_id}`)).data.reservation;
    assert.equal(rv.guest_vip, true);
    assert.equal(rv.guest_do_not_rebook, true);
    assert.equal(rv.review.rating, 5);
    assert.equal((await c.get('/api/reservations?view=all&guest=vip')).data.reservations.length >= 2, true);
    const gr = (await c.get(`/api/booking-groups/${groupId}`)).data.guest;
    assert.equal(gr.vip, true);
  }
});
