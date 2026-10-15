'use strict';

// QA r16 lane DNR (finding #4, owner decision O1): "Do not rebook" follows the guest's email, not
// the first name. A booking whose email belongs to a flagged guest in the same workspace gets the
// warning, even under another first name where a separate guest record is created. The flag stays
// on the original guest record, staff never see it, and another workspace's flag never leaks in.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const direct = require('../src/routes/directbooking');

// Fake PayMongo (same shape as directbooking-phase4.test.js): creates and reads checkout sessions.
const realFetch = globalThis.fetch;
const sessions = new Map();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const key = Buffer.from(String(opts.headers.Authorization).replace('Basic ', ''), 'base64').toString().replace(/:$/, '');
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (!key.startsWith('sk_test_host')) return json({ errors: [{ detail: 'bad key' }] }, 401);
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    const a = JSON.parse(opts.body).data.attributes;
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    sessions.set(id, { data: { id, attributes: { ...a, checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } } });
    return json({ data: sessions.get(id).data });
  }
  const m = /checkout_sessions\/(cs_\w+)$/.exec(u);
  if (m && sessions.has(m[1])) return json({ data: sessions.get(m[1]).data });
  return json({ errors: [{ detail: 'not found' }] }, 404);
};
// Marks the newest checkout session as paid in full.
const payLast = () => {
  const s = [...sessions.values()].at(-1).data;
  s.attributes.payments = [{ attributes: { status: 'paid', amount: s.attributes.line_items[0].amount, source: { type: 'gcash' } } }];
  s.attributes.payment_method_used = 'gcash';
};

const PASSWORD = 'longenough1';
const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let prop; let staff; let unit; let slug; let flagged; let reservationId;

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
  owner = await ownerAccount(srv.base, 'r16dnr-owner@example.com', 'R16 DNR');
  prop = (await owner.post('/api/properties', { property_name: 'R16 Harbor', property_type: 'condominium', address: 'Roxas Blvd', city: 'Pasay', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Stay 1', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, description: 'Sea view.', bookable_online: true,
  })).data.unit;
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
  await sql('UPDATE units SET public_slug = $2 WHERE unit_id = $1', [unit.unit_id, 'stay-1']);
  flagged = (await owner.post('/api/guests', { full_name: 'Ana Cruz', email: 'a@x.test', do_not_rebook: true })).data.guest;
  assert.equal(flagged.do_not_rebook, true);
  staff = await accept('r16dnr-staff@example.com', 'staff', 'R16 Staff');
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('a reservation under another first name, with a flagged email, warns and gets its own guest record', async () => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(30), check_out: d(31), guest_name: 'B. Cruz', guest_email: 'A@X.test ' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  reservationId = r.data.reservation.booking_id;
  assert.equal(r.data.reservation.guest_do_not_rebook, true);
  const [g] = await sql('SELECT guest_id, do_not_rebook FROM guests WHERE guest_id = $1', [r.data.reservation.guest_id]);
  assert.notEqual(g.guest_id, flagged.guest_id, 'a separate guest record is created');
  assert.equal(g.do_not_rebook, false, 'the flag stays on the original guest');
});

test('the owner keeps the warning on later reads of that booking', async () => {
  const one = await owner.get(`/api/reservations/${reservationId}`);
  assert.equal(one.data.reservation.guest_do_not_rebook, true);
  const list = (await owner.get('/api/reservations')).data.reservations;
  assert.equal(list.find((x) => x.booking_id === reservationId).guest_do_not_rebook, true);
});

test('staff never see the flag, even when the email matches', async () => {
  const res = await staff.get(`/api/reservations/${reservationId}`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal('guest_do_not_rebook' in res.data.reservation, false);
});

test('a different email carries no flag, even under the same name', async () => {
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(32), check_out: d(33), guest_name: 'Ana Cruz', guest_email: 'ana.cruz@x.test' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.guest_do_not_rebook, false);
});

test('an email flagged in another workspace does not warn this one', async () => {
  const other = await ownerAccount(srv.base, 'r16dnr-other@example.com', 'R16 Other Workspace');
  const og = await other.post('/api/guests', { full_name: 'Zed Lim', email: 'z@x.test', do_not_rebook: true });
  assert.equal(og.status, 201, JSON.stringify(og.data));
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(34), check_out: d(35), guest_name: 'Zed Lim', guest_email: 'z@x.test' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.reservation.guest_do_not_rebook, false);
});

test('an online booking under a flagged email gets the Do not rebook note and the Inbox line', async () => {
  const url = `/api/public/book/${slug}/units/${unit.unit_id}/checkout`;
  const body = { check_in: d(37), check_out: d(39), num_guests: 2, name: 'Ben Cruz', email: 'a@x.test', phone: '09171230002', pay: 'full', consent: true, source: 'facebook' };
  const r = await client(srv.base).post(url, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  payLast();
  assert.equal(await direct.reconcileDirect(), 1);
  const [b] = await sql(`SELECT b.notes FROM bookings b JOIN guests g ON g.guest_id = b.guest_id WHERE g.full_name = 'Ben Cruz'`);
  assert.match(b.notes, /⚠ This guest is marked "Do not rebook" in Guests\./);
  const [m] = await sql(`SELECT body FROM messages WHERE body LIKE 'New direct booking: Ben Cruz%'`);
  assert.match(m.body, /⚠ This guest is marked "Do not rebook" in Guests\./);
});

test('an online booking under an unflagged email has no warning', async () => {
  const url = `/api/public/book/${slug}/units/${unit.unit_id}/checkout`;
  const body = { check_in: d(41), check_out: d(43), num_guests: 2, name: 'Cy Lee', email: 'cy@x.test', phone: '09171230003', pay: 'full', consent: true, source: 'facebook' };
  const r = await client(srv.base).post(url, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  payLast();
  assert.equal(await direct.reconcileDirect(), 1);
  const [b] = await sql(`SELECT b.notes FROM bookings b JOIN guests g ON g.guest_id = b.guest_id WHERE g.full_name = 'Cy Lee'`);
  assert.doesNotMatch(b.notes, /Do not rebook/);
});
