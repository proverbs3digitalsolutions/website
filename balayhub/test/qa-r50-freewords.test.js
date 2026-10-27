'use strict';

// R50 FREEWORDS (C4, D-132, carry 15): a one-tap press in the minute after a free plan activation says the plan was
// activated, not that a payment was received (D-115). A paid row in the same minute still wins; after a minute the press pays.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_50_freewords DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_50_freewords node --test --test-concurrency=1 test/qa-r50-freewords.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use an r2_50_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');

const PAID_SENTENCE = 'That payment was just received. Check your plan before paying again.';
const FREE_SENTENCE = 'Your free plan was just activated. Check your plan before paying again.';
let srv; let fake; let c; let orgId; let n = 0; let used = 0;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const rows = () => sql(`SELECT * FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' ORDER BY created_at`, [orgId]);
const paidRows = async () => (await rows()).filter((r) => r.status === 'paid');
const day = (d) => (d ? String(d).slice(0, 10) : null);
const fresh = async () => day((await c.get('/api/billing')).data.paid_until);
const pay = (extra = {}) => { used += 1; return c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', seen_paid_until: null, ...extra }); };
const hosted = (extra = {}) => { used += 1; return c.post('/api/billing/checkout', { plan: 'growth', months: '1', seen_paid_until: null, ...extra }); };
const refused = (r, sentence) => {
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_RECEIVED');
  assert.equal(r.data.error, sentence);
};
async function coupon(code) { // a free coupon: the period is activated with no payment
  await sql(
    `INSERT INTO platform_coupons (code, name, kind, percent_off, duration, require_card, starts_at)
     VALUES ($1, 'QA r50 FREEWORDS', 'free', NULL, 'once', false, now() - interval '1 day') ON CONFLICT (code) DO NOTHING`, [code]);
}

async function reset() {
  if (!c || used >= 12) { // the checkout limiter counts per workspace (15 an hour)
    used = 0; n += 1;
    const name = `QA r50 FREEWORDS ${n}`;
    c = await ownerAccount(srv.base, `qa-r50-freewords-${n}@example.com`, name);
    orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', [name]))[0].organization_id;
    await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days' WHERE organization_id = $1`, [orgId]);
  }
  await sql('DELETE FROM billing_payments WHERE organization_id = $1', [orgId]);
  await sql('DELETE FROM platform_coupon_redemptions WHERE organization_id = $1', [orgId]);
  await sql(`UPDATE organizations SET plan = 'trial', paid_until = NULL, card_payment_method_id = $2, card_brand = 'visa', card_last4 = '4345' WHERE organization_id = $1`,
    [orgId, fake.createPaymentMethod(card(TEST_CARDS.ok))]);
}

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  await coupon('R50FREE');
});
test.after(async () => { fake.uninstall(); await srv.close(); });
test.beforeEach(reset);

test('a one-tap press in the minute after a free activation says the plan was activated, and charges nothing', async () => {
  const act = await hosted({ coupon_code: 'R50FREE' });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  assert.equal(act.data.activated, true);
  const intents = fake.state.intents.size; const before = (await rows()).length;
  refused(await pay({ seen_paid_until: await fresh() }), FREE_SENTENCE);
  assert.equal(fake.state.intents.size, intents, 'no payment intent for the refused press');
  assert.equal((await rows()).length, before, 'no pending row');
  assert.equal((await paidRows()).length, 1, 'only the activation is paid');
});

test('a one-tap press in the minute after a paid one-tap still says a payment was just received', async () => {
  const first = await pay({ seen_paid_until: await fresh() });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  refused(await pay({ seen_paid_until: await fresh() }), PAID_SENTENCE);
  assert.equal((await paidRows()).length, 1);
});

test('a paid one-tap and a free activation in the same minute: the press says a payment was just received', async () => {
  const first = await pay({ seen_paid_until: await fresh() });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const act = await hosted({ seen_paid_until: await fresh(), coupon_code: 'R50FREE' });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  refused(await pay({ seen_paid_until: await fresh() }), PAID_SENTENCE);
  assert.equal((await paidRows()).length, 2);
});

test('61 seconds after a free activation the one-tap press pays', async () => {
  const act = await hosted({ coupon_code: 'R50FREE' });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  refused(await pay({ seen_paid_until: await fresh() }), FREE_SENTENCE);
  await sql(`UPDATE billing_payments SET paid_at = paid_at - interval '61 seconds' WHERE organization_id = $1`, [orgId]);
  const later = await pay({ seen_paid_until: await fresh() });
  assert.equal(later.status, 200, JSON.stringify(later.data));
  assert.equal((await paidRows()).length, 2);
});
