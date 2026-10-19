'use strict';

// QA round 20, lane BIL: no second plan charge while one is open (hosted vs one-tap), and plan history keeps the card
// that paid after Remove card (migration 039).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_02 node --test --test-concurrency=1 test/qa-r20-bil.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const realFetch0 = globalThis.fetch;
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');

let cancelWorks = true; let expireWorks = true;
let srv; let fake; let c; let orgId; let calls = 0; let n = 0;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const rows = () => sql(`SELECT * FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' ORDER BY created_at`, [orgId]);
const pay = () => { calls += 1; return c.post('/api/billing/pay-saved', { plan: 'growth', months: '1' }); };
const hosted = () => { calls += 1; return c.post('/api/billing/checkout', { plan: 'growth', months: '1' }); };

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  // The fake now ends sessions and intents itself; these switches make PayMongo's cancel and expire calls fail.
  const faked = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const e = /\/checkout_sessions\/(cs_\w+)\/expire$/.exec(String(url));
    if (e && !expireWorks) return down();
    const m = /\/payment_intents\/(pi_\w+)\/cancel$/.exec(String(url));
    if (m && !cancelWorks) return down();
    if (m) { // the fake has no cancel endpoint: stand in for PayMongo's, which kills an intent that is not processing or paid
      const pi = fake.state.intents.get(m[1]);
      if (pi && !['processing', 'succeeded'].includes(pi.status)) fake.markIntent(m[1], 'failed');
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return faked(url, init);
  };
  srv = await startServer();
});
test.after(async () => { globalThis.fetch = realFetch0; fake.uninstall(); await srv.close(); });
test.beforeEach(async () => {
  cancelWorks = true; expireWorks = true;
  if (!c || calls >= 6) { // the checkout limiter counts per workspace (15 an hour)
    calls = 0; n += 1;
    const name = `R20 Bil ${n}`;
    c = await ownerAccount(srv.base, `r20-bil-${n}@example.com`, name);
    orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', [name]))[0].organization_id;
    await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days' WHERE organization_id = $1`, [orgId]);
  }
  await sql(`DELETE FROM billing_payments WHERE kind = 'plan' AND organization_id = $1`, [orgId]);
  await sql(`UPDATE organizations SET plan = 'trial', paid_until = NULL, card_payment_method_id = $2, card_brand = 'visa', card_last4 = '0007' WHERE organization_id = $1`,
    [orgId, fake.createPaymentMethod(card(TEST_CARDS.threeDS))]);
});

test('one-tap waiting at the bank + Pay another way with the intent still open: 409 and no second row', async () => {
  assert.equal((await pay()).data.status, 'action_required');
  cancelWorks = false;
  const r = await hosted();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_IN_PROGRESS');
  assert.equal(r.data.error, 'A payment is still waiting for your bank. Finish it there, or try again later.');
  assert.equal((await rows()).length, 1);
});

test('one-tap waiting + Pay another way with the intent dead at PayMongo: the old row expires and the checkout starts', async () => {
  await pay();
  const r = await hosted();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.checkout_url);
  const all = await rows();
  assert.deepEqual(all.map((x) => x.status), ['expired', 'pending']);
});

test('a hosted checkout is open + one-tap: 409 and no second row', async () => {
  assert.equal((await hosted()).status, 200);
  expireWorks = false;
  const r = await pay();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_IN_PROGRESS');
  assert.equal(r.data.error, 'A payment is already open in another window. Finish it there, or try again later.');
  assert.equal((await rows()).length, 1);
});

test('a hosted checkout that PayMongo shows expired lets a one-tap through', async () => {
  await hosted();
  const [row] = await rows();
  fake.markCheckout(row.checkout_id, 'expired');
  const r = await pay();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await rows()).map((x) => x.status), ['expired', 'pending']);
});

test('plan history keeps the card that paid after Remove card', async () => {
  await pay();
  const [row] = await rows();
  fake.markIntent(row.payment_intent_id, 'succeeded');
  assert.equal((await c.post(`/api/billing/${row.billing_id}/refresh`, {})).data.status, 'paid');
  const [paid] = await rows();
  assert.equal(paid.card_brand, 'visa');
  assert.equal(paid.card_last4, '0007');
  const del = await c.raw('DELETE', '/api/billing/card');
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const h = (await c.get('/api/billing')).data.history.find((x) => x.billing_id === row.billing_id);
  assert.equal(h.card_last4, '0007');
  assert.equal(h.card_brand, 'visa');
});

test('hosted + hosted: the old session is expired at PayMongo and the new checkout starts', async () => {
  await hosted();
  const r = await hosted();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await rows()).map((x) => x.status), ['expired', 'pending']);
});

test('hosted + hosted with the old session still open: 409 and no second row', async () => {
  await hosted();
  expireWorks = false;
  const r = await hosted();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_IN_PROGRESS');
  assert.equal(r.data.error, 'A payment is already open in another window. Finish it there, or try again later.');
  assert.equal((await rows()).length, 1);
});

test('hosted + hosted when the old session was already paid: refused, one paid row only', async () => {
  await hosted();
  const [row] = await rows();
  fake.markCheckout(row.checkout_id, 'paid');
  const r = await hosted();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_RECEIVED');
  assert.deepEqual((await rows()).map((x) => x.status), ['paid']);
});

test('one-tap succeeded at the bank, then Pay another way: 409 PAYMENT_RECEIVED, no hosted checkout', async () => {
  await pay();
  const [row] = await rows();
  fake.markIntent(row.payment_intent_id, 'succeeded');
  const r = await hosted();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_RECEIVED');
  assert.deepEqual((await rows()).map((x) => [x.provider, x.status]), [['paymongo_intent', 'paid']]);
});

test('hosted checkout paid, then one-tap: 409 PAYMENT_RECEIVED and the saved card is not charged', async () => {
  await hosted();
  const [row] = await rows();
  fake.markCheckout(row.checkout_id, 'paid');
  const before = fake.calls.filter((x) => x.path === '/payment_intents').length;
  const r = await pay();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_RECEIVED');
  assert.equal(fake.calls.filter((x) => x.path === '/payment_intents').length, before);
  assert.deepEqual((await rows()).map((x) => x.status), ['paid']);
});

test('a plan payment that lands after the request started stops it under the lock', async () => {
  // paid_at in the future stands in for a payment that landed while this request was running
  await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, list_amount, discount_amount, provider, status, paid_at)
             VALUES ($1, 'growth', 1, 999, 999, 0, 'paymongo', 'paid', now() + interval '1 minute')`, [orgId]);
  const r = await hosted();
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_RECEIVED');
  assert.equal((await rows()).length, 1);
});

// seen_paid_until: the "paid until" the page showed. A different current value means a payment landed since.
const payWith = (path, seen) => { calls += 1; return c.post(path, { plan: 'growth', months: '1', ...(seen === undefined ? {} : { seen_paid_until: seen }) }); };
for (const [name, path] of [['hosted', '/api/billing/checkout'], ['one-tap', '/api/billing/pay-saved']]) {
  test(`${name}: a stale seen_paid_until (null, but the plan was paid since) gives 409 PAYMENT_RECEIVED before any PayMongo call`, async () => {
    await sql(`UPDATE organizations SET plan = 'growth', paid_until = current_date + 30 WHERE organization_id = $1`, [orgId]);
    const before = fake.calls.length;
    const r = await payWith(path, null);
    assert.equal(r.status, 409, JSON.stringify(r.data));
    assert.equal(r.data.code, 'PAYMENT_RECEIVED');
    assert.equal(fake.calls.length, before);
    assert.equal((await rows()).length, 0);
  });
  test(`${name}: a matching seen_paid_until proceeds, and so does an absent one`, async () => {
    await sql(`UPDATE organizations SET plan = 'growth', paid_until = current_date + 30 WHERE organization_id = $1`, [orgId]);
    const [{ d }] = await sql(`SELECT paid_until::text AS d FROM organizations WHERE organization_id = $1`, [orgId]);
    const ok = await payWith(path, d);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    await sql(`DELETE FROM billing_payments WHERE kind = 'plan' AND organization_id = $1`, [orgId]);
    const none = await payWith(path, undefined);
    assert.equal(none.status, 200, JSON.stringify(none.data));
  });
}
test('seen_paid_until null matches a workspace with no paid_until; a bad value is a 400', async () => {
  assert.equal((await payWith('/api/billing/checkout', null)).status, 200);
  assert.equal((await payWith('/api/billing/checkout', 'tomorrow')).status, 400);
});

test('GET /billing paid_until is the text the seen_paid_until guard compares against', async () => {
  assert.equal((await c.get('/api/billing')).data.paid_until, null);
  await sql(`UPDATE organizations SET plan = 'growth', paid_until = current_date + 30 WHERE organization_id = $1`, [orgId]);
  const [{ d }] = await sql(`SELECT paid_until::text AS d FROM organizations WHERE organization_id = $1`, [orgId]);
  const seen = (await c.get('/api/billing')).data.paid_until;
  assert.equal(seen, d);
  assert.equal((await payWith('/api/billing/checkout', seen)).status, 200);
});
