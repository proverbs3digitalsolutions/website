'use strict';

// QA round 4, lane C03 (refunds and the reservation view).
// money#15: after a partial refund, the cancelled-booking alert, the Refunds card and the Record refund
// prefill work from what is still owed back, not from the full policy amount.
// money#16 (client): Edit reservation says "No changes to save." unless the server wrote something, and
// the fee boxes say a blank means 0.
// money#17 (client): a direct booking does not offer "Channel payout" as a payment method.
// Server part uses its own database: TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_03
// node --test --test-concurrency=1 test/qa-r4-c03.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, manilaToday } = require('./helpers');
const { addDays } = require('../src/lib/holidays');

const d = (n) => addDays(manilaToday(), n);
const refundBody = (over = {}) => ({ amount: '1000.00', refund_date: d(0), method: 'gcash', reason: 'Cancelled by guest', ...over });

let srv; let owner; let unit;
const refundLog = (id) => owner.get(`/api/reservations/${id}/refunds`);
const setPolicy = (policy) => owner.patch(`/api/units/${unit.unit_id}`, { cancellation_policy: policy });

// A reservation 20 days out with `amount` paid, cancelled today. Policy is judged on the cancellation day.
async function paidThenCancelled(amount) {
  const { booking_id: id } = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(20), check_out: d(22), guest_name: 'Juan Dela Cruz' })).data.reservation;
  assert.equal((await owner.post(`/api/reservations/${id}/payments`, { amount, payment_date: d(0), payment_method: 'gcash' })).status, 201);
  assert.equal((await owner.post(`/api/reservations/${id}/cancel`, { reason: 'Guest asked' })).status, 200);
  return id;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-r4c03@example.com', 'Balay Stays R4C03');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4, bookable_online: true, min_nights: 2,
  })).data.unit;
});
test.after(async () => { await srv.close(); });

test('after a partial refund, the suggestion says what was refunded and what is still owed back (money#15)', async () => {
  assert.equal((await setPolicy('flexible')).status, 200);
  const id = await paidThenCancelled('5000.00');
  assert.equal((await owner.post(`/api/reservations/${id}/refunds`, refundBody({ amount: '2000.00' }))).status, 201);
  const log = (await refundLog(id)).data;
  assert.equal(log.suggestion.amount, '5000.00', 'the policy share of what was paid is unchanged');
  assert.equal(log.suggestion.already_refunded, '2000.00');
  assert.equal(log.suggestion.remaining, '3000.00', 'what is still owed back');
  assert.equal(log.refundable, '3000.00', 'the top-level figures are unchanged');
});

test('a refund that covers the whole suggestion leaves 0.00 remaining, and a refund past it never goes negative (money#15)', async () => {
  assert.equal((await setPolicy('flexible')).status, 200);
  const full = await paidThenCancelled('5000.00');
  assert.equal((await owner.post(`/api/reservations/${full}/refunds`, refundBody({ amount: '5000.00' }))).status, 201);
  assert.equal((await refundLog(full)).data.suggestion.remaining, '0.00');

  // Strict: 50% at 20 days out, so the suggestion is 2,500.00; a 3,000.00 refund is more than that.
  assert.equal((await setPolicy('strict')).status, 200);
  const past = await paidThenCancelled('5000.00');
  assert.equal((await owner.post(`/api/reservations/${past}/refunds`, refundBody({ amount: '3000.00' }))).status, 201);
  const sug = (await refundLog(past)).data.suggestion;
  assert.equal(sug.amount, '2500.00');
  assert.equal(sug.already_refunded, '3000.00');
  assert.equal(sug.remaining, '0.00', 'never negative');
});

test('with nothing to suggest (no policy) the suggestion stays null and nothing is added', async () => {
  assert.equal((await setPolicy(null)).status, 200);
  const id = await paidThenCancelled('5000.00');
  assert.equal((await refundLog(id)).data.suggestion, null);
});

// ---------------------------------------------------------------- browser views (pure helpers and source checks)
const refundsSrc = fs.readFileSync(path.join(__dirname, '../public/js/views/refunds.js'), 'utf8');
const reservationsSrc = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
// The views import browser modules, so pull the pure pieces out of the source and evaluate them.
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test('the cancelled-booking alert adds what is already refunded and what is still owed (money#15)', () => {
  const refundAlertText = new Function('peso', `${grab(reservationsSrc, 'refundAlertText')}\nreturn refundAlertText;`)(peso);
  assert.equal(refundAlertText({ suggestion: { amount: '2750.00' }, refundable: '8000.00', paid: '8000.00', policy: { key: 'flexible' } }),
    'Cancelled: policy suggests refunding ₱2,750.00 of ₱8,000.00 paid.', 'no refunds yet: wording unchanged');
  assert.equal(refundAlertText({ suggestion: { amount: '5000.00', already_refunded: '2000.00', remaining: '3000.00' }, refundable: '3000.00', paid: '5000.00', policy: { key: 'flexible' } }),
    'Cancelled: policy suggests refunding ₱5,000.00 of ₱5,000.00 paid. ₱2,000.00 is already refunded, so ₱3,000.00 more.');
  assert.equal(refundAlertText({ suggestion: { amount: '5000.00', already_refunded: '5000.00', remaining: '0.00' }, refundable: '0.00', paid: '5000.00', policy: { key: 'flexible' } }),
    'Cancelled: policy suggests refunding ₱5,000.00 of ₱5,000.00 paid. ₱5,000.00 is already refunded, so nothing more is suggested.');
});

test('the refund card and the Record refund form work from what is still owed (money#15)', () => {
  const suggestionText = new Function('peso', `${grab(refundsSrc, 'suggestionText')}\nreturn suggestionText;`)(peso);
  const s = { amount: '5000.00', percent: 100, rule: 'Full refund: cancelled at least 1 day before check-in' };
  assert.equal(suggestionText(s, true), 'Suggested refund: ₱5,000.00 (100%). Full refund: cancelled at least 1 day before check-in.',
    'no refunds yet: wording unchanged');
  assert.equal(suggestionText({ ...s, already_refunded: '2000.00', remaining: '3000.00' }, true),
    'Suggested refund: ₱5,000.00 (100%). Full refund: cancelled at least 1 day before check-in. ₱2,000.00 is already refunded, so ₱3,000.00 more.');
  assert.equal(suggestionText({ ...s, already_refunded: '5000.00', remaining: '0.00' }, true),
    'Suggested refund: ₱5,000.00 (100%). Full refund: cancelled at least 1 day before check-in. ₱5,000.00 is already refunded, so nothing more is suggested.');
  assert.match(refundsSrc, /value: cancelled && Number\(data\.suggestion\?\.remaining\) > 0 \? data\.suggestion\.remaining : undefined/);
});

test('Edit reservation says "No changes to save." unless the server says it wrote something (money#16)', () => {
  assert.match(reservationsSrc, /const saved = Object\.keys\(changes\)\.length \? await patch\(`\/reservations\/\$\{r\.booking_id\}`, changes\) : \{ changed: false \};/);
  assert.match(reservationsSrc, /toast\(saved\.changed \? 'Reservation updated\.' : 'No changes to save\.'\)/);
  assert.doesNotMatch(reservationsSrc, /Object\.keys\(changes\)\.length \? 'Reservation updated\./, 'no toast from the client guess');
});

test('the fee boxes on Edit reservation say a blank means 0 (money#16)', () => {
  assert.match(reservationsSrc, /label: 'Cleaning fee', type: 'money', value: r\.cleaning_fee, hint: 'Leave blank for 0\.'/);
  assert.match(reservationsSrc, /label: 'Other fees', type: 'money', value: r\.other_fees, hint: 'Leave blank for 0\.'/);
  assert.match(reservationsSrc, /label: 'Channel fee \/ commission', type: 'money', value: r\.channel_fee, hint: 'What the channel keeps\. Used in owner statements\. Leave blank for 0\.'/);
});

test('a direct booking does not offer channel payout as a payment method (money#17)', () => {
  const METHOD_LABEL = reservationsSrc.match(/const METHOD_LABEL = [^\n]*;/);
  assert.ok(METHOD_LABEL, 'METHOD_LABEL found');
  const { paymentMethodOptions } = new Function(`${METHOD_LABEL[0]}\n${grab(reservationsSrc, 'paymentMethodOptions')}\nreturn { paymentMethodOptions };`)();
  const keys = (channel) => paymentMethodOptions(channel).map(([k]) => k);
  assert.ok(!keys('direct').includes('channel_payout'), 'hidden on a direct booking');
  assert.ok(keys('direct').includes('gcash'), 'other methods stay');
  assert.ok(keys('airbnb').includes('channel_payout'), 'shown on a channel booking');
  assert.match(reservationsSrc, /options: paymentMethodOptions\(r\.channel\)/);
});

test('Record payment says "Guest overpaid by ..." when the balance is below 0, worded and computed as the page does (re-verify SEV3)', () => {
  // Below 0 is an overpayment: the same figure the page shows (net of refunds), with the page's wording.
  assert.match(reservationsSrc, /Number\(r\.balance\) < 0\s+\? \(overpaidAfterRefunds\(r\.balance, heldInfo\?\.refunded\) > 0 \? `Guest overpaid by \$\{peso\(overpaidAfterRefunds\(r\.balance, heldInfo\?\.refunded\)\)\}\.` : '[^']+'\)\s+: `Balance: /);
  // Any other balance keeps the old Balance line, with the channel fee note.
  assert.match(reservationsSrc, /`Balance: \$\{peso\(r\.balance\)\} of \$\{peso\(r\.total_amount\)\}\$\{Number\(r\.channel_fee\) > 0 && !r\.channel_fee_ignored/);
  assert.doesNotMatch(reservationsSrc, /Balance: -/, 'no negative balance shown as a Balance line');
});
