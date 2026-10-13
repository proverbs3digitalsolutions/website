'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const receipts = require('../src/lib/receipts');

// Fake PayMongo, just enough for the pay-link checkout to open and be closed.
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

const d = (n) => ical.addDays(manilaToday(), n);
const NO_ID = '00000000-0000-4000-8000-000000000000';

let srv; let owner; let other; let prop; let unit; let res; let mgr; let stf;

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
  owner = await ownerAccount(srv.base, 'host@example.com', 'Charges Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  // Two nights at 2000 plus a 500 cleaning fee: 4500 owed. The guest has paid 1000.
  res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  await owner.post(`/api/reservations/${res.booking_id}/payments`, { amount: '1000', payment_date: manilaToday(), payment_method: 'gcash' });
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

const url = () => `/api/reservations/${res.booking_id}/charges`;

test('adding charges: exact totals, quantity defaults to 1, balance follows', async () => {
  const before = (await owner.get(`/api/reservations/${res.booking_id}`)).data.reservation;
  assert.equal(before.total_amount, '4500.00');
  assert.equal(before.balance, '3500.00');

  const late = await owner.post(url(), { category: 'late_checkout', description: 'Late check-out', unit_price: '500' });
  assert.equal(late.status, 201, JSON.stringify(late.data));
  assert.equal(late.data.charge.quantity, 1);
  assert.equal(late.data.charge.amount, '500.00');
  assert.equal(late.data.charge.created_by_name, 'Maria Santos');

  const guests = await owner.post(url(), { category: 'extra_guest', description: 'Extra guest', quantity: 2, unit_price: '350.25' });
  assert.equal(guests.status, 201, JSON.stringify(guests.data));
  assert.equal(guests.data.charge.amount, '700.50');

  const after = (await owner.get(`/api/reservations/${res.booking_id}`)).data.reservation;
  assert.equal(after.extras_total, '1200.50');
  assert.equal(after.total_amount, '5700.50');
  assert.equal(after.balance, '4700.50');
});

test('list keeps the charges in order; voiding needs a reason and moves the totals back', async () => {
  const list = (await owner.get(url())).data;
  assert.deepEqual(list.charges.map((c) => c.category), ['late_checkout', 'extra_guest']);
  assert.equal(list.extras_total, '1200.50');

  const guestsId = list.charges[1].charge_id;
  assert.equal((await owner.post(`/api/charges/${guestsId}/void`, {})).status, 400, 'reason is required');
  const v = await owner.post(`/api/charges/${guestsId}/void`, { reason: 'Guest did not come' });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal((await owner.post(`/api/charges/${guestsId}/void`, { reason: 'Again' })).status, 409, 'voiding twice is refused');
  assert.equal((await owner.post(`/api/charges/${NO_ID}/void`, { reason: 'Missing' })).status, 404);

  const after = (await owner.get(`/api/reservations/${res.booking_id}`)).data.reservation;
  assert.equal(after.extras_total, '500.00');
  assert.equal(after.total_amount, '5000.00');
  assert.equal(after.balance, '4000.00');

  const kept = (await owner.get(url())).data;
  const voided = kept.charges.find((c) => c.charge_id === guestsId);
  assert.equal(voided.void_reason, 'Guest did not come', 'the voided line stays on record');
  assert.ok(voided.voided_at);
  assert.equal(voided.voided_by_name, 'Maria Santos');
  assert.equal(kept.extras_total, '500.00');
});

test('validation: bad category, text, quantity and price are refused with field errors', async () => {
  const base = { category: 'damage', description: 'Broken glass', quantity: 1, unit_price: '150' };
  const cases = [
    [{ ...base, category: undefined }, 'category'],
    [{ ...base, category: 'spa' }, 'category'],
    [{ ...base, description: '   ' }, 'description'],
    [{ ...base, description: 'x'.repeat(201) }, 'description'],
    [{ ...base, quantity: 0 }, 'quantity'],
    [{ ...base, quantity: 100 }, 'quantity'],
    [{ ...base, quantity: 1.5 }, 'quantity'],
    [{ ...base, unit_price: '0' }, 'unit_price'],
    [{ ...base, unit_price: '-50' }, 'unit_price'],
    [{ ...base, unit_price: 'lots' }, 'unit_price'],
    [{ ...base, unit_price: undefined }, 'unit_price'],
  ];
  for (const [body, field] of cases) {
    const r = await owner.post(url(), body);
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.code, 'VALIDATION');
    assert.ok(r.data.fields[field], `field error for ${field}`);
  }
  assert.equal((await owner.get(`/api/reservations/${res.booking_id}`)).data.reservation.extras_total, '500.00', 'refused attempts write nothing');
});

test('roles: staff only view, managers add, other workspaces and anonymous callers are refused', async () => {
  mgr = await invite('manager@example.com', 'manager', [prop.property_id]);
  stf = await invite('staff@example.com', 'staff', [prop.property_id]);
  const extraBed = { category: 'extra_bed', description: 'Extra bed', quantity: 2, unit_price: '350.25' };
  const someId = (await owner.get(url())).data.charges[0].charge_id;

  const seen = await stf.get(url());
  assert.equal(seen.status, 200, 'staff can see the charges');
  assert.equal(seen.data.extras_total, '500.00');
  assert.equal((await stf.post(url(), extraBed)).status, 403);
  assert.equal((await stf.post(`/api/charges/${someId}/void`, { reason: 'Not mine' })).status, 403);

  const byManager = await mgr.post(url(), extraBed);
  assert.equal(byManager.status, 201, 'managers add charges');
  assert.equal((await stf.get(url())).data.extras_total, '1200.50', 'staff see the new total');

  other = await ownerAccount(srv.base, 'other@example.com', 'Other Workspace');
  assert.equal((await other.get(url())).status, 404);
  assert.equal((await other.post(url(), extraBed)).status, 404);
  assert.equal((await other.post(`/api/charges/${someId}/void`, { reason: 'Theirs' })).status, 404);

  assert.equal((await owner.get(`/api/reservations/${NO_ID}/charges`)).status, 404, 'unknown reservation');
  assert.equal((await owner.get('/api/reservations/not-a-uuid/charges')).status, 404);
  assert.equal((await client(srv.base).get(url())).status, 401, 'signed-out callers get nothing');
});

test('cancelled reservations refuse new and voided charges; their charges stay on record', async () => {
  const c = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(20), check_out: d(21), guest_name: 'Cancel Me', accommodation_total: '2000' })).data.reservation;
  const cUrl = `/api/reservations/${c.booking_id}/charges`;
  const added = await owner.post(cUrl, { category: 'damage', description: 'Cracked mirror', unit_price: '300' });
  assert.equal(added.status, 201);
  assert.equal((await owner.post(`/api/reservations/${c.booking_id}/cancel`, { reason: 'Guest changed plans' })).status, 200);

  const refused = await owner.post(cUrl, { category: 'damage', description: 'More damage', unit_price: '100' });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'CANCELLED');
  const voidRefused = await owner.post(`/api/charges/${added.data.charge.charge_id}/void`, { reason: 'Oops' });
  assert.equal(voidRefused.status, 409);
  assert.equal(voidRefused.data.code, 'CANCELLED');

  const left = (await owner.get(cUrl)).data;
  assert.equal(left.charges.length, 1);
  assert.equal(left.extras_total, '300.00');
});

test('receipts list the charge lines and leave out voided ones', async () => {
  const [pay] = await sql('SELECT payment_id FROM booking_payments WHERE booking_id = $1 ORDER BY created_at LIMIT 1', [res.booking_id]);
  const r = await owner.get(`/api/booking-payments/${pay.payment_id}/receipt`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.receipt.charges.map((c) => c.description), ['Late check-out', 'Extra bed']);

  const text = receipts.receiptText(await receipts.receiptData(pay.payment_id));
  assert.match(text, /Itemised charges:/);
  assert.match(text, /Late check-out: ₱500\.00/);
  assert.match(text, /Extra bed \(2 × ₱350\.25\): ₱700\.50/);
  assert.match(text, /Extras total: ₱1,200\.50/);
  assert.match(text, /Booking total: ₱5,700\.50/);
  assert.doesNotMatch(text, /Extra guest/, 'the voided line is not on the receipt');
});

test('an open pay link is closed when a charge changes the amount, and the new balance is what the guest sees', async () => {
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890' })).status, 200);
  const link = await owner.get(`/api/reservations/${res.booking_id}/payment-link`);
  assert.equal(link.data.available, true);
  assert.equal(link.data.balance, '4700.50');
  const token = link.data.link.split('/#/pay/')[1];

  const guest = client(srv.base);
  const first = await guest.post(`/api/public/pay/${token}/checkout`);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const open = await sql(`SELECT status, amount FROM balance_checkouts WHERE booking_id = $1`, [res.booking_id]);
  assert.deepEqual(open.map((x) => [x.status, x.amount]), [['pending', '4700.50']]);

  const damage = await owner.post(url(), { category: 'damage', description: 'Cracked mirror', unit_price: '150' });
  assert.equal(damage.status, 201);
  const closed = await sql(`SELECT status FROM balance_checkouts WHERE booking_id = $1`, [res.booking_id]);
  assert.deepEqual(closed.map((x) => x.status), ['expired'], 'the stale checkout can no longer be paid');

  const pg = await guest.get(`/api/public/pay/${token}`);
  assert.equal(pg.data.balance, '4850.50');
  assert.equal(pg.data.paid, '1000.00');
});

test('every charge change is audited with its reason', async () => {
  const rows = await sql(`SELECT action, details FROM audit_logs WHERE action LIKE 'reservation.charge_%' ORDER BY created_at`);
  assert.ok(rows.some((x) => x.action === 'reservation.charge_added'));
  const voided = rows.find((x) => x.action === 'reservation.charge_voided');
  assert.equal(voided.details.reason, 'Guest did not come');
});
