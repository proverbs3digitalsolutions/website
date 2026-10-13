'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
// helpers sets DATABASE_URL from TEST_DATABASE_URL; load it before anything that opens the pool.
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { pool } = require('../src/db');
const addons = require('../src/lib/addons');

// Fake PayMongo, enough for the pay-link checkout to open and be closed.
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

const d = (n) => ical.addDays(manilaToday(), n);
const NO_ID = '00000000-0000-4000-8000-00000000ffff';
const refusedFor = (field) => (e) => e.status === 400 && e.extra?.code === 'VALIDATION' && Object.keys(e.extra.fields).join() === field;

let srv; let owner; let prop; let u1; let u2; let orgId;
const ids = {};

async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Addon Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  u1 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500', max_guests: 4, house_rules: 'No pets. Quiet after 10pm.' })).data.unit;
  u2 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1202', unit_type: 'studio', nightly_rate: '1500', max_guests: 4 })).data.unit;
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Addon Stays'`))[0].organization_id;
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('catalogue: owners create, edit and archive; validation names each bad field', async () => {
  const bad = await owner.post('/api/addons', { price: '0', pricing: 'weekly', max_quantity: 25 });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.code, 'VALIDATION');
  assert.deepEqual(Object.keys(bad.data.fields).sort(), ['max_quantity', 'name', 'price', 'pricing']);
  const foreign = await owner.post('/api/addons', { name: 'Ghost', price: '100', pricing: 'per_stay', unit_ids: [NO_ID] });
  assert.equal(foreign.status, 400);
  assert.deepEqual(Object.keys(foreign.data.fields), ['unit_ids']);

  const a = await owner.post('/api/addons', { name: 'Airport pickup', name_tl: 'Sundo sa airport', description: 'Sedan, up to 3 bags', price: '1500', pricing: 'per_stay' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.deepEqual(a.data.addon.price, '1500.00');
  assert.equal(a.data.addon.max_quantity, 1, 'maximum defaults to one');
  assert.deepEqual(a.data.addon.unit_ids, [], 'no listings chosen means every listing');
  assert.equal(a.data.addon.on_booking_page, true);
  assert.equal(a.data.addon.before_arrival, true);
  assert.equal(a.data.addon.active, true);
  ids.A = a.data.addon.addon_id;

  const b = await owner.post('/api/addons', { name: 'Breakfast', price: '150.25', pricing: 'per_guest_night', max_quantity: 4, unit_ids: [u1.unit_id] });
  assert.equal(b.status, 201);
  assert.deepEqual(b.data.addon.unit_ids, [u1.unit_id]);
  ids.B = b.data.addon.addon_id;

  const c = await owner.post('/api/addons', { name: 'Early check-in', price: '300.10', pricing: 'per_night', on_booking_page: false });
  assert.equal(c.data.addon.on_booking_page, false, 'an explicit false is kept');
  assert.equal(c.data.addon.before_arrival, true, 'an absent flag defaults to on');
  ids.C = c.data.addon.addon_id;

  ids.D = (await owner.post('/api/addons', { name: 'Extra bed', price: '500', pricing: 'per_night', on_booking_page: false, before_arrival: false })).data.addon.addon_id;
  ids.E = (await owner.post('/api/addons', { name: 'Old towel set', price: '100', pricing: 'per_stay' })).data.addon.addon_id;
  ids.F = (await owner.post('/api/addons', { name: 'Cooler', price: '33.33', pricing: 'per_guest', max_quantity: 3 })).data.addon.addon_id;

  // Edit: only the fields sent change; a blank name_tl clears it.
  const p = await owner.patch(`/api/addons/${ids.B}`, { name_tl: '', price: '150.25' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.addon.name_tl, null);
  assert.equal(p.data.addon.name, 'Breakfast');
  assert.equal((await owner.patch(`/api/addons/${ids.D}`, { price: '550' })).data.addon.price, '550.00');
  assert.equal((await owner.patch(`/api/addons/${ids.B}`, { max_quantity: null })).status, 400, 'a blank maximum is refused');
  assert.equal((await owner.patch(`/api/addons/${ids.B}`, { unit_ids: [NO_ID] })).status, 400);
  assert.equal((await owner.patch(`/api/addons/${NO_ID}`, { name: 'Nope' })).status, 404);
  assert.equal((await owner.patch('/api/addons/not-a-uuid', { name: 'Nope' })).status, 404);

  // Archive hides an add-on from guests but keeps it on record; archiving twice is fine; it can be restored.
  assert.equal((await owner.post(`/api/addons/${ids.E}/archive`)).data.addon.active, false);
  assert.equal((await owner.post(`/api/addons/${ids.E}/archive`)).status, 200);
  assert.equal((await owner.patch(`/api/addons/${ids.E}`, { active: true })).data.addon.active, true);
  assert.equal((await owner.patch(`/api/addons/${ids.E}`, { active: false })).data.addon.active, false);

  const all = (await owner.get('/api/addons')).data.addons;
  assert.equal(all.length, 6);
  assert.ok(all.every((x) => ['addon_id', 'name', 'name_tl', 'description', 'price', 'pricing', 'max_quantity', 'unit_ids', 'on_booking_page', 'before_arrival', 'active'].every((k) => k in x)));
});

test('roles: owners write; managers read; staff and other workspaces get nothing', async () => {
  const mgr = await invite('manager@example.com', 'manager', [prop.property_id]);
  assert.equal((await mgr.get('/api/addons')).status, 200);
  assert.equal((await mgr.post('/api/addons', { name: 'X', price: '10', pricing: 'per_stay' })).status, 403);
  assert.equal((await mgr.patch(`/api/addons/${ids.A}`, { name: 'X' })).status, 403);
  assert.equal((await mgr.post(`/api/addons/${ids.A}/archive`)).status, 403);

  const staff = await invite('staff@example.com', 'staff', [prop.property_id]);
  assert.equal((await staff.get('/api/addons')).status, 403);

  assert.equal((await client(srv.base).get('/api/addons')).status, 401, 'signed-out callers are refused');

  const other = await ownerAccount(srv.base, 'other@example.com', 'Other Addon Stays');
  assert.deepEqual((await other.get('/api/addons')).data.addons, []);
  assert.equal((await other.post(`/api/addons/${ids.A}/archive`)).status, 404);
  assert.equal((await other.patch(`/api/addons/${ids.A}`, { name: 'Hijack' })).status, 404);
  const op = (await other.post('/api/properties', { property_name: 'Elsewhere', property_type: 'condominium', address: 'x', city: 'Makati', province: 'Metro Manila' })).data.property;
  const foreignUnit = (await other.post(`/api/properties/${op.property_id}/units`, { unit_name: '9', unit_type: 'studio', nightly_rate: '900', max_guests: 2 })).data.unit;
  assert.equal((await owner.post('/api/addons', { name: 'Stolen', price: '10', pricing: 'per_stay', unit_ids: [foreignUnit.unit_id] })).status, 400);
});

test('pricing: each scheme multiplies exactly; errors name the field addons', async () => {
  const price = (selections, extra = {}) => addons.priceAddons(pool, { orgId, unitId: u1.unit_id, nights: 2, guests: 2, selections, context: 'booking', ...extra });

  assert.deepEqual(await price([{ addon_id: ids.A, quantity: 1 }]), {
    items: [{ addon_id: ids.A, name: 'Airport pickup', quantity: 1, unit_price: '1500.00', amount: '1500.00' }], total: '1500.00',
  });
  // Per guest and night: 150.25 x 2 guests x 2 nights = 601.00 a unit; two units.
  assert.deepEqual(await price([{ addon_id: ids.B, quantity: 2 }]), {
    items: [{ addon_id: ids.B, name: 'Breakfast', quantity: 2, unit_price: '601.00', amount: '1202.00' }], total: '1202.00',
  });
  // Per guest, to the centavo: 33.33 x 3 guests = 99.99 a unit; three units = 299.97.
  assert.deepEqual(await price([{ addon_id: ids.F, quantity: 3 }], { guests: 3 }), {
    items: [{ addon_id: ids.F, name: 'Cooler', quantity: 3, unit_price: '99.99', amount: '299.97' }], total: '299.97',
  });
  // With the two guests of the default stay: 33.33 x 2 = 66.66 a unit; three units = 199.98.
  const mixed = await price([{ addon_id: ids.A, quantity: 1 }, { addon_id: ids.B, quantity: 2 }, { addon_id: ids.F, quantity: 3 }]);
  assert.equal(mixed.total, '2901.98');
  assert.equal(mixed.items.length, 3);
  assert.deepEqual(await price([]), { items: [], total: '0.00' });

  // Per night, offered before arrival only (quotes take any active add-on).
  assert.equal((await price([{ addon_id: ids.C, quantity: 1 }], { context: 'before_arrival' })).total, '600.20');
  assert.equal((await price([{ addon_id: ids.D, quantity: 1 }], { context: 'quote' })).items[0].amount, '1100.00');

  await assert.rejects(price([{ addon_id: NO_ID, quantity: 1 }]), refusedFor('addons'), 'unknown');
  await assert.rejects(price([{ addon_id: ids.E, quantity: 1 }]), refusedFor('addons'), 'archived');
  await assert.rejects(price([{ addon_id: ids.B, quantity: 1 }], { unitId: u2.unit_id }), refusedFor('addons'), 'not for this listing');
  await assert.rejects(price([{ addon_id: ids.C, quantity: 1 }]), refusedFor('addons'), 'not on the booking page');
  await assert.rejects(price([{ addon_id: ids.D, quantity: 1 }], { context: 'before_arrival' }), refusedFor('addons'), 'not before arrival');
  await assert.rejects(price([{ addon_id: ids.B, quantity: 5 }]), refusedFor('addons'), 'over the maximum');
  await assert.rejects(price([{ addon_id: ids.A, quantity: 1 }, { addon_id: ids.A, quantity: 1 }]), refusedFor('addons'), 'repeated');
  await assert.rejects(price([{ addon_id: ids.A, quantity: 0 }]), refusedFor('addons'), 'zero quantity');
  await assert.rejects(price([{ addon_id: 'A', quantity: 1 }]), refusedFor('addons'), 'not an id');
  await assert.rejects(price('A'), refusedFor('addons'), 'not a list');
});

test('listings: each page shows the add-ons offered for that listing and context', async () => {
  const names = async (unit, context) => (await addons.listAddonsForUnit(pool, orgId, unit.unit_id, context)).map((r) => r.name).sort();
  assert.deepEqual(await names(u1, 'booking'), ['Airport pickup', 'Breakfast', 'Cooler']);
  assert.deepEqual(await names(u2, 'booking'), ['Airport pickup', 'Cooler']);
  assert.deepEqual(await names(u1, 'before_arrival'), ['Airport pickup', 'Breakfast', 'Cooler', 'Early check-in']);
  assert.deepEqual(await names(u1, 'quote'), ['Airport pickup', 'Breakfast', 'Cooler', 'Early check-in', 'Extra bed']);
  const [row] = await addons.listAddonsForUnit(pool, orgId, u1.unit_id, 'booking');
  assert.deepEqual(Object.keys(row).sort(), ['addon_id', 'description', 'max_quantity', 'name', 'name_tl', 'price', 'pricing']);
});

test('booking charges: add-ons become addon charges and the total is accommodation + cleaning + add-ons', async () => {
  const r = (await owner.post('/api/reservations', { unit_id: u1.unit_id, check_in: d(20), check_out: d(22), guest_name: 'Ana Cruz', guest_email: 'ana@example.com', num_guests: 2 })).data.reservation;
  assert.equal((await owner.get(`/api/reservations/${r.booking_id}`)).data.reservation.total_amount, '4500.00');

  const { items } = await addons.priceAddons(pool, { orgId, unitId: u1.unit_id, nights: 2, guests: 2, selections: [{ addon_id: ids.A, quantity: 1 }, { addon_id: ids.B, quantity: 2 }], context: 'booking' });
  const chargeIds = await addons.createAddonCharges(pool, r.booking_id, items, null);
  assert.equal(chargeIds.length, 2);

  const after = (await owner.get(`/api/reservations/${r.booking_id}`)).data.reservation;
  assert.equal(after.extras_total, '2702.00');
  assert.equal(after.total_amount, '7202.00');
  const rows = await sql(`SELECT category, addon_id, description, quantity, unit_price, amount FROM booking_charges WHERE booking_id = $1 ORDER BY description`, [r.booking_id]);
  assert.deepEqual(rows.map((x) => [x.category, x.addon_id, x.description, x.quantity, x.unit_price, x.amount]), [
    ['addon', ids.A, 'Airport pickup', 1, '1500.00', '1500.00'],
    ['addon', ids.B, 'Breakfast', 2, '601.00', '1202.00'],
  ]);

  // Voiding one through the charges route moves the total back, like any charge.
  assert.equal((await owner.post(`/api/charges/${chargeIds[1]}/void`, { reason: 'Guest cancelled breakfast' })).status, 200);
  const voided = (await owner.get(`/api/reservations/${r.booking_id}`)).data.reservation;
  assert.equal(voided.extras_total, '1500.00');
  assert.equal(voided.total_amount, '6000.00');
});

test('pay page: the guest sees add-ons, buys them, and the bill and balance follow', async () => {
  const p1 = (await owner.post('/api/reservations', { unit_id: u1.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ben Reyes', guest_email: 'ben@example.com', num_guests: 2 })).data.reservation;
  await owner.post(`/api/reservations/${p1.booking_id}/payments`, { amount: '1000', payment_date: manilaToday(), payment_method: 'gcash' });
  await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890' });
  const token = (await owner.get(`/api/reservations/${p1.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  const g = client(srv.base);
  assert.equal((await g.get(`/api/public/pay/${token}`)).data.balance, '3500.00');
  assert.equal((await g.get('/api/public/pay/nonsense-token-123456789/addons')).status, 404, 'an unknown link shows nothing');

  const list = await g.get(`/api/public/pay/${token}/addons`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.addons.map((x) => x.name).sort(), ['Airport pickup', 'Breakfast', 'Cooler', 'Early check-in']);

  // A checkout is open with the balance before the add-ons: buying must close it.
  assert.equal((await g.post(`/api/public/pay/${token}/checkout`)).status, 200);
  const session = last();
  assert.equal(session.attributes.status, 'active');

  const bought = await g.post(`/api/public/pay/${token}/addons`, { selections: [{ addon_id: ids.A, quantity: 1 }, { addon_id: ids.B, quantity: 1 }] });
  assert.equal(bought.status, 200, JSON.stringify(bought.data));
  assert.equal(bought.data.ok, true);
  assert.equal(bought.data.bill.extras_total, '2101.00');
  assert.equal(bought.data.bill.total, '6601.00');
  assert.equal(bought.data.bill.paid, '1000.00');
  assert.deepEqual(bought.data.bill.charges.map((c) => [c.description, c.amount]).sort(), [['Airport pickup', '1500.00'], ['Breakfast', '601.00']]);
  assert.equal(session.attributes.status, 'expired', 'the open checkout was closed at PayMongo');
  assert.equal((await sql(`SELECT status FROM balance_checkouts WHERE booking_id = $1`, [p1.booking_id]))[0].status, 'expired');
  assert.equal((await g.get(`/api/public/pay/${token}`)).data.balance, '5601.00');

  // The early check-in is offered before arrival even though it isn't on the booking page.
  const more = await g.post(`/api/public/pay/${token}/addons`, { selections: [{ addon_id: ids.C, quantity: 1 }] });
  assert.equal(more.data.bill.total, '7201.20');

  // Refusals: quotes-only, empty, over the maximum, repeated, archived, nothing picked.
  for (const body of [
    { selections: [{ addon_id: ids.D, quantity: 1 }] },
    { selections: [] },
    { selections: [{ addon_id: ids.B, quantity: 5 }] },
    { selections: [{ addon_id: ids.A, quantity: 1 }, { addon_id: ids.A, quantity: 1 }] },
    { selections: [{ addon_id: ids.E, quantity: 1 }] },
    {},
  ]) {
    const r = await g.post(`/api/public/pay/${token}/addons`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(Object.keys(r.data.fields), ['addons']);
  }
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM booking_charges WHERE booking_id = $1 AND category = 'addon'`, [p1.booking_id]))[0].n, 3,
    'refused purchases add nothing');
});

test('pay page: on check-in day add-ons are still offered; for a listing they are not for, they are refused', async () => {
  const y1 = (await owner.post('/api/reservations', { unit_id: u2.unit_id, check_in: d(70), check_out: d(72), guest_name: 'Cora', guest_email: 'cora@example.com', num_guests: 2 })).data.reservation;
  await sql(`UPDATE bookings SET check_in = $2, check_out = $3 WHERE booking_id = $1`, [y1.booking_id, manilaToday(), d(2)]);
  const token = (await owner.get(`/api/reservations/${y1.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  const g = client(srv.base);
  const list = await g.get(`/api/public/pay/${token}/addons`);
  assert.deepEqual(list.data.addons.map((x) => x.name).sort(), ['Airport pickup', 'Cooler', 'Early check-in']);
  assert.equal((await g.post(`/api/public/pay/${token}/addons`, { selections: [{ addon_id: ids.B, quantity: 1 }] })).status, 400, 'Breakfast is for listing 1201 only');
  assert.equal((await g.post(`/api/public/pay/${token}/addons`, { selections: [{ addon_id: ids.A, quantity: 1 }] })).status, 200);
});

test('pay page: after check-in day, and for a cancelled stay, nothing can be added', async () => {
  const x1 = (await owner.post('/api/reservations', { unit_id: u1.unit_id, check_in: d(50), check_out: d(52), guest_name: 'Dan', guest_email: 'dan@example.com', num_guests: 2 })).data.reservation;
  await sql(`UPDATE bookings SET check_in = $2, check_out = $3 WHERE booking_id = $1`, [x1.booking_id, d(-1), d(1)]);
  const xToken = (await owner.get(`/api/reservations/${x1.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  const g = client(srv.base);
  assert.deepEqual((await g.get(`/api/public/pay/${xToken}/addons`)).data.addons, []);
  const late = await g.post(`/api/public/pay/${xToken}/addons`, { selections: [{ addon_id: ids.A, quantity: 1 }] });
  assert.equal(late.status, 409);
  assert.equal(late.data.code, 'AFTER_CHECK_IN');

  const c1 = (await owner.post('/api/reservations', { unit_id: u1.unit_id, check_in: d(40), check_out: d(41), guest_name: 'Eva', guest_email: 'eva@example.com', num_guests: 2 })).data.reservation;
  const cToken = (await owner.get(`/api/reservations/${c1.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  await owner.post(`/api/reservations/${c1.booking_id}/cancel`, { reason: 'test' });
  assert.deepEqual((await g.get(`/api/public/pay/${cToken}/addons`)).data.addons, []);
  const cancelled = await g.post(`/api/public/pay/${cToken}/addons`, { selections: [{ addon_id: ids.A, quantity: 1 }] });
  assert.equal(cancelled.status, 409);
  assert.equal(cancelled.data.code, 'CANCELLED');
});

test('check-in form: house rules are shown, agreed once, and the time and exact text are kept', async () => {
  const k1 = (await owner.post('/api/reservations', { unit_id: u1.unit_id, check_in: d(60), check_out: d(62), guest_name: 'Rafa Lim', guest_email: 'rafa@example.com', num_guests: 2 })).data.reservation;
  const token = (await owner.get(`/api/reservations/${k1.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  const g = client(srv.base);
  const info = await g.get(`/api/public/checkin/${token}`);
  assert.equal(info.data.stay.house_rules, 'No pets. Quiet after 10pm.');
  assert.equal(info.data.stay.rules_accepted_at, null);

  const form = { lead_name: 'Rafa Lim', phone: '09171113333', consent: true };
  const refused = await g.post(`/api/public/checkin/${token}`, form);
  assert.equal(refused.status, 400);
  assert.deepEqual(Object.keys(refused.data.fields), ['accept_rules']);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM guest_registrations WHERE booking_id = $1`, [k1.booking_id]))[0].n, 0);

  assert.equal((await g.post(`/api/public/checkin/${token}`, { ...form, accept_rules: true })).status, 200);
  const [first] = await sql(`SELECT rules_accepted_at, rules_text FROM bookings WHERE booking_id = $1`, [k1.booking_id]);
  assert.ok(first.rules_accepted_at instanceof Date);
  assert.equal(first.rules_text, 'No pets. Quiet after 10pm.');

  // Once agreed, a later edit to the form doesn't ask again, and the first agreement is kept as it was.
  await sql(`UPDATE units SET house_rules = 'Changed later' WHERE unit_id = $1`, [u1.unit_id]);
  assert.equal((await g.post(`/api/public/checkin/${token}`, form)).status, 200);
  const [again] = await sql(`SELECT rules_accepted_at, rules_text FROM bookings WHERE booking_id = $1`, [k1.booking_id]);
  assert.equal(again.rules_text, 'No pets. Quiet after 10pm.');
  assert.equal(again.rules_accepted_at.getTime(), first.rules_accepted_at.getTime());
  assert.equal(typeof (await g.get(`/api/public/checkin/${token}`)).data.stay.rules_accepted_at, 'string');
});

test('check-in form: a listing without house rules asks for nothing', async () => {
  const k2 = (await owner.post('/api/reservations', { unit_id: u2.unit_id, check_in: d(30), check_out: d(31), guest_name: 'Gil', guest_email: 'gil@example.com', num_guests: 1 })).data.reservation;
  const token = (await owner.get(`/api/reservations/${k2.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  const g = client(srv.base);
  const info = await g.get(`/api/public/checkin/${token}`);
  assert.equal(info.data.stay.house_rules, null);
  assert.equal((await g.post(`/api/public/checkin/${token}`, { lead_name: 'Gil', phone: '09171114444', consent: true })).status, 200);
  assert.equal((await sql(`SELECT rules_accepted_at FROM bookings WHERE booking_id = $1`, [k2.booking_id]))[0].rules_accepted_at, null);
});

test('rate limit: each pay link takes at most 20 add-on attempts an hour', async () => {
  const rl = (await owner.post('/api/reservations', { unit_id: u2.unit_id, check_in: d(80), check_out: d(81), guest_name: 'Hana', guest_email: 'hana@example.com', num_guests: 1 })).data.reservation;
  const token = (await owner.get(`/api/reservations/${rl.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  const g = client(srv.base);
  for (let i = 0; i < 20; i += 1) assert.equal((await g.post(`/api/public/pay/${token}/addons`, {})).status, 400, `attempt ${i + 1}`);
  const blocked = await g.post(`/api/public/pay/${token}/addons`, {});
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.code, 'RATE_LIMITED');
});

test('pay page: a retried purchase with the same key adds nothing twice and gets the same bill back', async () => {
  const r = (await owner.post('/api/reservations', { unit_id: u1.unit_id, check_in: d(90), check_out: d(92), guest_name: 'Ivy Tan', guest_email: 'ivy@example.com', num_guests: 2 })).data.reservation;
  const token = (await owner.get(`/api/reservations/${r.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  const g = client(srv.base);
  const url = `/api/public/pay/${token}/addons`;
  const breakfast = [{ addon_id: ids.B, quantity: 1 }];
  const addonRows = () => sql(`SELECT request_key, amount FROM booking_charges WHERE booking_id = $1 AND category = 'addon' ORDER BY request_key`, [r.booking_id]);

  // A double tap: the second request with the same key returns the first bill and adds nothing.
  const first = await g.post(url, { selections: breakfast }, { 'Idempotency-Key': 'tap-breakfast-1' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.bill.extras_total, '601.00');
  const second = await g.post(url, { selections: breakfast }, { 'Idempotency-Key': 'tap-breakfast-1' });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.deepEqual(second.data, first.data);
  assert.deepEqual((await addonRows()).map((x) => x.request_key), [`tap-breakfast-1:${ids.B}`]);

  // The key may come in the body instead; a different selection under the same key still gets the first bill.
  const inBody = await g.post(url, { selections: [{ addon_id: ids.A, quantity: 1 }], request_key: 'tap-breakfast-1' });
  assert.deepEqual(inBody.data, first.data);
  assert.equal((await addonRows()).length, 1);

  // Two taps at once with one key: both succeed, and one set of charges is made.
  const pair = await Promise.all([1, 2].map(() => g.post(url, { selections: [{ addon_id: ids.F, quantity: 1 }] }, { 'Idempotency-Key': 'tap-cooler-2' })));
  assert.deepEqual(pair.map((x) => x.status), [200, 200]);
  assert.deepEqual(pair[0].data, pair[1].data);
  assert.equal(pair[0].data.bill.extras_total, '667.66');
  assert.equal((await addonRows()).filter((x) => x.request_key === `tap-cooler-2:${ids.F}`).length, 1);

  // A new key is a new purchase, so the same add-on can be bought again.
  const again = await g.post(url, { selections: breakfast }, { 'Idempotency-Key': 'tap-breakfast-3' });
  assert.equal(again.data.bill.extras_total, '1268.66');
  assert.equal((await addonRows()).length, 3);

  // The host voids the first breakfast: a retry of that purchase does not put it back.
  const [voided] = await sql('SELECT charge_id FROM booking_charges WHERE booking_id = $1 AND request_key = $2', [r.booking_id, `tap-breakfast-1:${ids.B}`]);
  assert.equal((await owner.post(`/api/charges/${voided.charge_id}/void`, { reason: 'Guest changed plans' })).status, 200);
  const retry = await g.post(url, { selections: breakfast }, { 'Idempotency-Key': 'tap-breakfast-1' });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.bill.extras_total, '667.66');
  assert.equal((await addonRows()).length, 3);

  // Keys are checked the same way as refunds: 8 to 100 letters, numbers, dashes or underscores.
  for (const headers of [{ 'Idempotency-Key': 'short' }, { 'Idempotency-Key': 'bad key with spaces' }]) {
    const bad = await g.post(url, { selections: breakfast }, headers);
    assert.equal(bad.status, 400, JSON.stringify(headers));
    assert.equal(bad.data.code, 'BAD_REQUEST');
  }
  for (const request_key of ['short', 12]) {
    assert.equal((await g.post(url, { selections: breakfast, request_key })).status, 400, JSON.stringify(request_key));
  }
  assert.equal((await addonRows()).length, 3, 'a refused key adds nothing');
});
