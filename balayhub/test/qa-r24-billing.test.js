'use strict';

// QA round 24, lane BILLING (CARD-3): with PayMongo unreachable, hosted checkout and one-tap pay give the same sentence.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_24_billing node --test --test-concurrency=1 test/qa-r24-billing.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install } = require('./fakes/paymongo');

const SENTENCE = "We couldn't reach the payment service. Nothing was charged. Please try again in a moment.";
let srv; let fake;
test.before(async () => { fake = install({ realFetch: globalThis.fetch }); srv = await startServer(); });
test.after(async () => { fake.uninstall(); await srv.close(); });

test('PayMongo unreachable: checkout and pay-saved both answer 502 BILLING_FAILED with the one sentence', async () => {
  const c = await ownerAccount(srv.base, 'r24-bil@example.com', 'R24 Bil');
  await sql(`UPDATE organizations SET card_payment_method_id = 'pm_r24test', card_check = 'passed', card_checked_at = now() WHERE name = 'R24 Bil'`);
  for (const [path, re] of [['/api/billing/checkout', /\/checkout_sessions$/], ['/api/billing/pay-saved', /\/payment_intents$/]]) {
    fake.failNext(re, 0);
    const r = await c.post(path, { plan: 'starter', months: '1' });
    assert.equal(r.status, 502, path + JSON.stringify(r.data));
    assert.equal(r.data.code, 'BILLING_FAILED', path);
    assert.equal(r.data.error, SENTENCE, path);
  }
});
