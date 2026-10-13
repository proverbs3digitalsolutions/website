'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { addDays } = require('../src/lib/holidays');
const { POLICY_KEYS, suggestRefund, describePolicy } = require('../src/lib/policies');

// ---------------------------------------------------------------- pure rules (no database)
const CHECK_IN = '2030-06-10';
const before = (days) => addDays(CHECK_IN, -days); // a cancellation this many days before check-in
const PAID = '2750.00';

test('policy keys match the units.cancellation_policy CHECK in migration 027', () => {
  assert.deepEqual(POLICY_KEYS, ['flexible', 'moderate', 'strict', 'non_refundable', 'custom']);
});

test('flexible: full refund at 1 day or more before check-in, nothing from the day before', () => {
  assert.deepEqual(suggestRefund('flexible', PAID, CHECK_IN, before(2)), {
    percent: 100, amount: '2750.00', rule: 'Full refund: cancelled at least 1 day before check-in',
  });
  assert.equal(suggestRefund('flexible', PAID, CHECK_IN, before(1)).percent, 100, 'boundary: 1 day before is still full');
  assert.equal(suggestRefund('flexible', PAID, CHECK_IN, before(0)).percent, 0, 'boundary: check-in day');
  assert.equal(suggestRefund('flexible', PAID, CHECK_IN, before(0)).amount, '0.00');
  assert.equal(suggestRefund('flexible', PAID, CHECK_IN, before(-3)).percent, 0, 'after check-in');
});

test('moderate: full refund at 5 or more days before, 50% from 4 days down to and after check-in', () => {
  assert.equal(suggestRefund('moderate', PAID, CHECK_IN, before(5)).percent, 100, 'boundary: 5 days before is full');
  assert.equal(suggestRefund('moderate', PAID, CHECK_IN, before(5)).amount, '2750.00');
  assert.equal(suggestRefund('moderate', PAID, CHECK_IN, before(4)).percent, 50, 'boundary: 4 days before is half');
  assert.equal(suggestRefund('moderate', PAID, CHECK_IN, before(4)).amount, '1375.00');
  assert.equal(suggestRefund('moderate', PAID, CHECK_IN, before(0)).percent, 50);
  assert.equal(suggestRefund('moderate', PAID, CHECK_IN, before(-2)).percent, 50, 'after check-in');
});

test('strict: 50% at 7 or more days before, nothing from 6 days before', () => {
  assert.equal(suggestRefund('strict', PAID, CHECK_IN, before(7)).percent, 50, 'boundary: 7 days before is half');
  assert.equal(suggestRefund('strict', PAID, CHECK_IN, before(7)).amount, '1375.00');
  assert.equal(suggestRefund('strict', PAID, CHECK_IN, before(6)).percent, 0, 'boundary: 6 days before is nothing');
  assert.equal(suggestRefund('strict', PAID, CHECK_IN, before(6)).amount, '0.00');
});

test('non-refundable suggests 0% at any date, so the host sees it stated', () => {
  assert.deepEqual(suggestRefund('non_refundable', PAID, CHECK_IN, before(60)), {
    percent: 0, amount: '0.00', rule: 'Non-refundable',
  });
  assert.equal(suggestRefund('non_refundable', PAID, CHECK_IN, before(-1)).percent, 0);
});

test('custom, unset and unknown policies get no automatic suggestion, and nothing paid means none either', () => {
  assert.equal(suggestRefund('custom', PAID, CHECK_IN, before(30)), null, 'custom: host decides');
  assert.equal(suggestRefund(null, PAID, CHECK_IN, before(30)), null, 'not set');
  assert.equal(suggestRefund(undefined, PAID, CHECK_IN, before(30)), null, 'not set');
  assert.equal(suggestRefund('constructor', PAID, CHECK_IN, before(30)), null, 'no inherited keys');
  assert.equal(suggestRefund('flexible', '0.00', CHECK_IN, before(30)), null, 'nothing paid');
});

test('refund amounts are exact to the centavo, with a half centavo rounding up', () => {
  assert.equal(suggestRefund('moderate', '1234.57', CHECK_IN, before(4)).amount, '617.29', '617.285 rounds up');
  assert.equal(suggestRefund('moderate', '1000.01', CHECK_IN, before(4)).amount, '500.01', '500.005 rounds up');
  assert.equal(suggestRefund('flexible', '99.99', CHECK_IN, before(1)).amount, '99.99');
});

test('a policy is shown in English and Taglish; custom uses the host text; nothing set shows nothing', () => {
  assert.equal(describePolicy(null, null), null);
  assert.equal(describePolicy('bogus', null), null);
  assert.equal(describePolicy('custom', null), null, 'custom with no text shows nothing');
  const strict = describePolicy('strict');
  assert.equal(strict.key, 'strict');
  assert.equal(strict.label, 'Strict');
  assert.match(strict.en, /50% refund/);
  assert.match(strict.tl, /araw/);
  for (const key of POLICY_KEYS.filter((k) => k !== 'custom')) {
    const p = describePolicy(key);
    assert.ok(p.en && p.tl, `${key} has both wordings`);
  }
  assert.deepEqual(describePolicy('custom', 'Bawal ang refund sa Holy Week.'), {
    key: 'custom', label: 'Custom', en: 'Bawal ang refund sa Holy Week.', tl: null,
  });
});

// ---------------------------------------------------------------- HTTP and database
// Fake PayMongo for the direct-booking checkout (same shape as directbooking.test.js).
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
const lastSession = () => [...sessions.values()].at(-1).data;
const pay = (id, centavos) => {
  const s = sessions.get(id).data;
  s.attributes.payments = [{ attributes: { status: 'paid', amount: centavos, source: { type: 'gcash' } } }];
  s.attributes.payment_method_used = 'gcash';
};

const d = (n) => addDays(manilaToday(), n);
const refundBody = (over = {}) => ({ amount: '1000.00', refund_date: d(0), method: 'gcash', reason: 'Cancelled by guest', ...over });

let srv; let owner; let other; let manager; let staff; let prop; let unit; let res; let res2; let res3; let slug;
const path = () => `/api/units/${unit.unit_id}`;
const unitOf = async () => (await owner.get(`/api/properties/${prop.property_id}`)).data.units.find((u) => u.unit_id === unit.unit_id);
const refundLog = (id) => owner.get(`/api/reservations/${id}/refunds`);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-b@example.com', 'Balay Stays B');
  other = await ownerAccount(srv.base, 'other-b@example.com', 'Other Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, bookable_online: true, min_nights: 2,
  })).data.unit;
  const invite = async (email, role) => {
    const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [prop.property_id] });
    const c = client(srv.base);
    await c.post('/api/auth/signup', {
      full_name: `${role} ${email}`, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
      invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
    });
    return c;
  };
  manager = await invite('manager-b@example.com', 'manager');
  staff = await invite('staff-b@example.com', 'staff');
  // Two nights at 2,500 plus a 500 cleaning fee: total 5,500.
  res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(20), check_out: d(22), guest_name: 'Juan Dela Cruz', guest_email: 'juan@example.com' })).data.reservation;
});
test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('unit policy and deposit percentage are validated, saved and read back', async () => {
  assert.equal((await owner.patch(path(), { cancellation_policy: 'lenient' })).status, 400);
  const custom = await owner.patch(path(), { cancellation_policy: 'custom' });
  assert.equal(custom.status, 400, 'a custom policy needs its text');
  assert.ok(custom.data.fields.cancellation_policy_text, 'the error names the text field');
  for (const bad of [5, 95, 'lots']) assert.equal((await owner.patch(path(), { deposit_pct: bad })).status, 400, `deposit ${bad} refused`);
  assert.equal((await owner.patch(path(), { deposit_pct: 35, cancellation_policy: 'moderate' })).status, 200);
  const saved = await unitOf();
  assert.equal(saved.deposit_pct, 35);
  assert.equal(saved.cancellation_policy, 'moderate');
  // A blank deposit leaves it alone (the column is NOT NULL); clearing the policy works.
  assert.equal((await owner.patch(path(), { cancellation_policy: null, deposit_pct: null })).status, 200);
  const cleared = await unitOf();
  assert.equal(cleared.cancellation_policy, null);
  assert.equal(cleared.deposit_pct, 35);
  const fresh = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Fresh 1', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  assert.equal(fresh.deposit_pct, 50, 'new listings default to 50%');
  assert.equal(fresh.cancellation_policy, null);
  assert.equal((await staff.patch(path(), { deposit_pct: 40 })).status, 403, 'staff cannot change the deposit');
});

test('booking page: policy wording in English and Taglish, deposit percentage, nothing shown when unset', async () => {
  const r = await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890', enabled: true, intro: 'Welcome!' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  slug = r.data.url.split('/#/book/')[1];
  const listing = async () => (await client(srv.base).get(`/api/public/book/${slug}`)).data.listings.find((l) => l.unit_id === unit.unit_id);
  await owner.patch(path(), { cancellation_policy: 'moderate', deposit_pct: 35 });
  const l = await listing();
  assert.equal(l.deposit_pct, 35);
  assert.equal(l.cancellation.key, 'moderate');
  assert.match(l.cancellation.tl, /5 araw/);
  assert.equal('cancellation_policy' in l, false, 'raw columns are not sent to guests');
  await owner.patch(path(), { cancellation_policy: 'custom', cancellation_policy_text: 'No refunds during Holy Week.' });
  assert.deepEqual((await listing()).cancellation, { key: 'custom', label: 'Custom', en: 'No refunds during Holy Week.', tl: null });
  await owner.patch(path(), { cancellation_policy: null });
  assert.equal((await listing()).cancellation, null, 'unset policy shows nothing');
});

test('the deposit percentage sets the quote and the PayMongo amount, at 50 and at 35', async () => {
  const g = client(srv.base);
  const quote = (ci, co) => g.get(`/api/public/book/${slug}/units/${unit.unit_id}/quote?check_in=${ci}&check_out=${co}`);
  const checkout = (ci, co, email) => g.post(`/api/public/book/${slug}/units/${unit.unit_id}/checkout`, {
    check_in: ci, check_out: co, num_guests: 2, name: 'Juan Dela Cruz', email, phone: '09171234567', pay: 'deposit', consent: true,
  });

  await owner.patch(path(), { deposit_pct: 50, cancellation_policy: 'moderate' });
  assert.equal((await quote(d(40), d(42))).data.deposit, '2750.00');
  assert.equal((await checkout(d(40), d(42), 'half@example.com')).status, 200);
  assert.equal(lastSession().attributes.line_items[0].amount, 275000);
  assert.match(lastSession().attributes.line_items[0].name, / · 50% deposit$/);

  await owner.patch(path(), { deposit_pct: 35 });
  const q = (await quote(d(50), d(52))).data;
  assert.equal(q.total, '5500.00');
  assert.equal(q.deposit, '1925.00', '35% of 5,500');
  const c = await checkout(d(50), d(52), 'third@example.com');
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const s = lastSession();
  assert.equal(s.attributes.line_items[0].amount, 192500);
  assert.match(s.attributes.line_items[0].name, / · 35% deposit$/);

  // Paying the 35% deposit confirms the booking; the note and the payment carry the same share,
  // and the confirmation data carries the policy wording.
  pay(s.id, 192500);
  const token = s.attributes.success_url.split('/done/')[1];
  const st = (await g.get(`/api/public/book/status/${token}`)).data;
  assert.equal(st.status, 'confirmed');
  assert.equal(st.stay.cancellation.key, 'moderate');
  assert.equal(st.stay.paid, '1925.00');
  const [b] = await sql('SELECT notes FROM bookings WHERE confirmation_code = $1', [st.stay.code]);
  assert.match(b.notes, /Booked online \(35% deposit paid\)/);
  const [p] = await sql(`SELECT amount FROM booking_payments WHERE booking_id = (SELECT booking_id FROM bookings WHERE confirmation_code = $1)`, [st.stay.code]);
  assert.equal(p.amount, '1925.00');
});

test('refund cap: none before anything is paid; refunds total never exceeds what was paid; balance unchanged', async () => {
  const id = res.booking_id;
  assert.equal((await owner.post(`/api/reservations/${id}/refunds`, refundBody())).status, 400, 'nothing paid yet');
  assert.equal((await owner.post(`/api/reservations/${id}/payments`, { amount: '2000.00', payment_date: d(0), payment_method: 'gcash' })).status, 201);
  const balance = (await owner.get(`/api/reservations/${id}`)).data.reservation.balance;
  assert.equal(balance, '3500.00');

  const first = await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '1500.00' }));
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const over = await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '600.00' }));
  assert.equal(over.status, 400);
  assert.match(over.data.fields.amount, /Only ₱500\.00 is left to refund/);
  assert.equal((await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '500.00' }))).status, 201, 'exactly the rest is allowed');
  const none = await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '0.01' }));
  assert.equal(none.status, 400);
  assert.match(none.data.fields.amount, /Nothing is left to refund/);

  const log = (await refundLog(id)).data;
  assert.equal(log.paid, '2000.00');
  assert.equal(log.refunded, '2000.00');
  assert.equal(log.refundable, '0.00');
  assert.equal(log.refunds.length, 2);
  assert.equal((await owner.get(`/api/reservations/${id}`)).data.reservation.balance, balance, 'refunds do not change the balance');
});

test('void frees the cap again; voiding twice is refused; a reason is required; a voided payment stops counting as paid', async () => {
  const id = res.booking_id;
  const first = (await refundLog(id)).data.refunds.find((r) => r.amount === '1500.00');
  assert.equal((await owner.post(`/api/refunds/${first.refund_id}/void`, {})).status, 400, 'reason required');
  assert.equal((await owner.post(`/api/refunds/${first.refund_id}/void`, { reason: 'Entered twice' })).status, 200);
  assert.equal((await owner.post(`/api/refunds/${first.refund_id}/void`, { reason: 'Again' })).status, 409);
  const after = (await refundLog(id)).data;
  assert.equal(after.refundable, '1500.00');
  const voided = after.refunds.find((r) => r.refund_id === first.refund_id);
  assert.equal(voided.void_reason, 'Entered twice');
  assert.equal(voided.voided_by_name, 'Maria Santos');
  assert.equal((await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '1500.00' }))).status, 201, 'the cap is free again');

  // Voiding the payment after refunding leaves nothing refundable (never negative).
  const [pay1] = await sql('SELECT payment_id FROM booking_payments WHERE booking_id = $1', [id]);
  assert.equal((await owner.post(`/api/booking-payments/${pay1.payment_id}/void`, { reason: 'Wrong guest' })).status, 200);
  const none = (await refundLog(id)).data;
  assert.equal(none.paid, '0.00');
  assert.equal(none.refunded, '2000.00', 'the 500 and the re-recorded 1500 are still active');
  assert.equal(none.refundable, '0.00');
});

test('roles: staff can read but not record or void (403); a manager can record; another workspace gets 404', async () => {
  res2 = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(30), check_out: d(32), guest_name: 'Ana Cruz' })).data.reservation;
  await owner.post(`/api/reservations/${res2.booking_id}/payments`, { amount: '2750.00', payment_date: d(0), payment_method: 'gcash' });
  const id = res2.booking_id;
  assert.equal((await staff.get(`/api/reservations/${id}/refunds`)).status, 200, 'staff can read the log');
  assert.equal((await staff.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '100.00' }))).status, 403);
  const made = await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '100.00' }));
  assert.equal(made.status, 201);
  assert.equal((await staff.post(`/api/refunds/${made.data.refund.refund_id}/void`, { reason: 'Mine' })).status, 403);
  assert.equal((await manager.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '100.00' }))).status, 201, 'a manager can record');
  assert.equal((await other.get(`/api/reservations/${id}/refunds`)).status, 404);
  assert.equal((await other.post(`/api/reservations/${id}/refunds`, refundBody())).status, 404);
  assert.equal((await other.post(`/api/refunds/${made.data.refund.refund_id}/void`, { reason: 'Mine now' })).status, 404);
  assert.equal((await owner.post(`/api/refunds/${made.data.refund.refund_id}/void`, { reason: 'Test cleanup' })).status, 200, 'the owner can void');
});

test('refund validation: method, reason, dates, reference, amount, and unknown records', async () => {
  const p = `/api/reservations/${res2.booking_id}/refunds`;
  assert.equal((await owner.post(p, refundBody({ method: 'channel_payout' }))).status, 400, 'channel payouts are not refunds');
  assert.equal((await owner.post(p, refundBody({ method: 'bitcoin' }))).status, 400);
  assert.equal((await owner.post(p, refundBody({ reason: '' }))).status, 400);
  assert.equal((await owner.post(p, refundBody({ reason: 'x'.repeat(301) }))).status, 400);
  assert.equal((await owner.post(p, refundBody({ refund_date: d(1) }))).status, 400, 'no future refund date');
  assert.equal((await owner.post(p, refundBody({ refund_date: 'yesterday' }))).status, 400);
  assert.equal((await owner.post(p, refundBody({ reference_number: 'R'.repeat(101) }))).status, 400);
  for (const amount of ['0', '-5', 'abc']) assert.equal((await owner.post(p, refundBody({ amount }))).status, 400, `amount ${amount}`);
  assert.equal((await owner.post(`/api/reservations/${crypto.randomUUID()}/refunds`, refundBody())).status, 404, 'unknown reservation');
  assert.equal((await owner.post('/api/reservations/not-an-id/refunds', refundBody())).status, 404);
  assert.equal((await owner.post(`/api/refunds/${crypto.randomUUID()}/void`, { reason: 'x' })).status, 404, 'unknown refund');
});

test('suggestion follows the listing policy, the days before check-in, and the cancellation date', async () => {
  res3 = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ben Reyes' })).data.reservation;
  const id = res3.booking_id;
  const suggestion = async (policy, text) => {
    await owner.patch(path(), { cancellation_policy: policy, cancellation_policy_text: text ?? null });
    return (await refundLog(id)).data;
  };
  assert.equal((await suggestion(null)).suggestion, null, 'no policy');
  assert.equal((await suggestion('strict')).suggestion, null, 'nothing paid yet');
  await owner.post(`/api/reservations/${id}/payments`, { amount: '2750.00', payment_date: d(0), payment_method: 'gcash' });
  assert.equal((await suggestion(null)).suggestion, null, 'policy not set');
  const flex = (await suggestion('flexible')).suggestion;
  assert.equal(flex.percent, 100);
  assert.equal(flex.amount, '2750.00');
  assert.equal((await suggestion('strict')).suggestion.amount, '1375.00', 'strict: 10 days before, half');
  assert.equal((await suggestion('moderate')).suggestion.percent, 100, 'moderate: 10 days before, full');
  assert.equal((await suggestion('non_refundable')).suggestion.amount, '0.00');
  const custom = await suggestion('custom', 'Talk to us first.');
  assert.equal(custom.suggestion, null, 'custom: no automatic amount');
  assert.equal(custom.policy.key, 'custom');

  // Cancelled: the suggestion is judged on the day it was cancelled, not on today.
  await owner.patch(path(), { cancellation_policy: 'strict' });
  assert.equal((await owner.post(`/api/reservations/${id}/cancel`, { reason: 'Guest asked' })).status, 200);
  await sql(`UPDATE bookings SET cancelled_at = now() - interval '4 days' WHERE booking_id = $1`, [id]);
  assert.equal((await refundLog(id)).data.suggestion.amount, '1375.00', 'cancelled 4 days ago: 14 days before check-in');
  await sql(`UPDATE bookings SET cancelled_at = now() + interval '4 days' WHERE booking_id = $1`, [id]);
  assert.equal((await refundLog(id)).data.suggestion.amount, '0.00', 'cancelled 4 days before check-in: 6 days, nothing');
});

test('a refund can still be recorded on a cancelled reservation, and each refund and void is audited', async () => {
  const id = res3.booking_id;
  const r = await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '1000.00', reason: 'Cancelled, partial refund' }));
  assert.equal(r.status, 201, 'cancelled reservations can be refunded');
  assert.equal((await owner.post(`/api/refunds/${r.data.refund.refund_id}/void`, { reason: 'Keyed by mistake' })).status, 200);
  const rows = await sql(`SELECT action, details FROM audit_logs WHERE action IN ('reservation.refund_recorded', 'reservation.refund_voided')`);
  assert.ok(rows.some((x) => x.action === 'reservation.refund_recorded' && x.details.amount === '1000.00'));
  assert.ok(rows.some((x) => x.action === 'reservation.refund_voided' && x.details.reason === 'Keyed by mistake'));
});
