'use strict';

// QA round 17, lane BP. K2: closing a balance checkout that PayMongo refuses (401) clears the host's "connected"
// check, but only when that checkout was made with the key still saved (as the round 16 refresh route does).
// Any other PayMongo error leaves the check alone, and the checkout still answers 'pending'.
// PayMongo is stubbed (fetch and checkoutStatus): no real network call.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_07 node --test --test-concurrency=1 test/qa-r17-bp.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const paymongo = require('../src/lib/paymongo');
const balance = require('../src/routes/balancepay');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    return json({ data: { id, attributes: { checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } } });
  }
  return json({ errors: [{ detail: 'not found' }] }, 404); // the expire call fails here; closeCheckout ignores that
};

const realCheckoutStatus = paymongo.checkoutStatus;
let statusError = null; // what PayMongo's status read throws on the next refresh; null means "still unpaid"
paymongo.checkoutStatus = async () => {
  if (statusError) throw statusError;
  return { paid: false, paidAmount: 0, listed: 0, expired: false };
};
const refused = () => Object.assign(new Error('Unauthorized'), { unauthorized: true });

const prop = { property_name: 'BP Bay', property_type: 'condominium', address: 'BP Ave', city: 'Taguig', province: 'Metro Manila' };
const d = (n) => ical.addDays(manilaToday(), n);
const checked = async () => (await sql(`SELECT paymongo_key_checked_at FROM organizations WHERE name = 'QA BP Stays'`))[0].paymongo_key_checked_at;
const markChecked = () => sql(`UPDATE organizations SET paymongo_key_checked_at = now() WHERE name = 'QA BP Stays'`);

let srv; let owner; let unitId;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r17-bp@example.com', 'QA BP Stays');
  const p = (await owner.post('/api/properties', prop)).data.property;
  unitId = (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: '1301', unit_type: 'studio', nightly_rate: '2000' })).data.unit.unit_id;
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_bpKEY1234567890' })).status, 200);
});
test.after(async () => {
  paymongo.checkoutStatus = realCheckoutStatus;
  globalThis.fetch = realFetch;
  await srv.close();
});

// A pending balance checkout, made by a guest with the host's key as it is saved right now. Returns its checkout_ref.
async function startCheckout(offset) {
  const res = (await owner.post('/api/reservations', {
    unit_id: unitId, check_in: d(offset), check_out: d(offset + 1), guest_name: 'Ana Cruz', guest_email: `ana-bp-${offset}@example.com`,
  })).data.reservation;
  const token = (await owner.get(`/api/reservations/${res.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  const c = await client(srv.base).post(`/api/public/pay/${token}/checkout`);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const [row] = await sql(`SELECT checkout_ref FROM balance_checkouts WHERE booking_id = $1 AND status = 'pending'`, [res.booking_id]);
  return row.checkout_ref;
}

test('a checkout PayMongo refuses (401) clears the connected check when the checkout used the key still saved', async () => {
  const ref = await startCheckout(20);
  await markChecked();
  assert.ok(await checked(), 'checked before the close');

  statusError = refused();
  assert.equal(await balance.closeCheckout(ref), 'pending');
  assert.equal(await checked(), null, 'the refused key is no longer marked as connected');
});

test('a 401 on a checkout made with a key the host has since replaced leaves the connected check alone', async () => {
  const ref = await startCheckout(22);
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_bpKEY9999999999' })).status, 200);
  await markChecked();

  statusError = refused();
  assert.equal(await balance.closeCheckout(ref), 'pending');
  assert.ok(await checked(), 'the new, working key is not marked unchecked because of an old checkout');
});

test('another PayMongo error on close leaves the connected check alone and still answers pending', async () => {
  const ref = await startCheckout(24);
  await markChecked();

  statusError = new Error('socket hang up');
  assert.equal(await balance.closeCheckout(ref), 'pending');
  assert.ok(await checked(), 'still checked');
});

test('the scheduled balance check that PayMongo refuses (401) clears the connected check when the checkout used the key still saved', async () => {
  // Only this checkout may be pending, so the scheduled check looks at nothing else.
  await sql(`UPDATE balance_checkouts SET status = 'failed' WHERE status = 'pending'`);
  const ref = await startCheckout(26);
  await markChecked();
  assert.ok(await checked(), 'checked before the scheduled check');

  statusError = refused();
  await balance.reconcileBalance();
  assert.equal(await checked(), null, 'the refused key is no longer marked as connected');
  assert.equal((await sql(`SELECT status FROM balance_checkouts WHERE checkout_ref = $1`, [ref]))[0].status, 'pending', 'the checkout stays open for a later check');
});
