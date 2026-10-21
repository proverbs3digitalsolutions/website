'use strict';

// R40 PAYGATE (CRD-1, D-122): a one-tap charge is refused for a minute after any paid plan payment, under the workspace lock.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_40_paygate node --test --test-concurrency=1 test/qa-r40-paygate.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* or r2_40_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');

const SENTENCE = 'That payment was just received. Check your plan before paying again.';
let srv; let fake; let c; let orgId; let n = 0; let used = 0;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const rows = () => sql(`SELECT * FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' ORDER BY created_at`, [orgId]);
const paidRows = async () => (await rows()).filter((r) => r.status === 'paid');
const day = (d) => (d ? String(d).slice(0, 10) : null);
const paidUntil = async () => day((await sql('SELECT paid_until FROM organizations WHERE organization_id = $1', [orgId]))[0].paid_until);
const fresh = async () => day((await c.get('/api/billing')).data.paid_until);
const pay = (extra = {}) => { used += 1; return c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', seen_paid_until: null, ...extra }); };
const hosted = (extra = {}) => { used += 1; return c.post('/api/billing/checkout', { plan: 'growth', months: '1', seen_paid_until: null, ...extra }); };
async function coupon(code, percent) { // percent null = a free coupon
  await sql(
    `INSERT INTO platform_coupons (code, name, kind, percent_off, duration, require_card, starts_at)
     VALUES ($1, 'R40', $2, $3, 'once', false, now() - interval '1 day') ON CONFLICT (code) DO NOTHING`, [code, percent ? 'percent' : 'free', percent]);
}
const redemptions = async () => Number((await sql('SELECT count(*)::int AS n FROM platform_coupon_redemptions WHERE organization_id = $1', [orgId]))[0].n);
const refused = (r) => {
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'PAYMENT_RECEIVED');
  assert.equal(r.data.error, SENTENCE);
};

async function reset() {
  if (!c || used >= 12) { // the checkout limiter counts per workspace (15 an hour)
    used = 0; n += 1;
    const name = `R40 Gate ${n}`;
    c = await ownerAccount(srv.base, `r40-gate-${n}@example.com`, name);
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
  await coupon('R40HALF', 50); await coupon('R40FREE', null);
});
test.after(async () => { fake.uninstall(); await srv.close(); });
test.beforeEach(reset);

test('the redrawn page second press (fresh date) is refused: one paid row, no intent, no pending row, no coupon slot; 61 s later it pays', async () => {
  const first = await pay({ seen_paid_until: await fresh(), coupon_code: 'R40HALF' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const until1 = await paidUntil(); const red = await redemptions(); const intents = fake.state.intents.size;
  const again = await pay({ seen_paid_until: await fresh() });
  refused(again);
  assert.equal((await paidRows()).length, 1);
  assert.equal((await rows()).length, 1, 'no pending row');
  assert.equal(fake.state.intents.size, intents);
  assert.equal(await paidUntil(), until1);
  assert.equal(await redemptions(), red);
  const withCoupon = await pay({ seen_paid_until: await fresh(), coupon_code: 'R40HALF' });
  refused(withCoupon);
  assert.equal(await redemptions(), red, 'no coupon slot held by a refused press');
  await sql(`UPDATE billing_payments SET paid_at = paid_at - interval '61 seconds' WHERE organization_id = $1`, [orgId]);
  const later = await pay({ seen_paid_until: await fresh() });
  assert.equal(later.status, 200, JSON.stringify(later.data));
  assert.equal((await paidRows()).length, 2);
  const d1 = new Date(until1); const d2 = new Date(await paidUntil());
  assert.equal((d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + d2.getUTCMonth() - d1.getUTCMonth(), 1);
});

test('after a free activation a one-tap payment with the fresh date is refused', async () => {
  const act = await hosted({ coupon_code: 'R40FREE' });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  assert.equal(act.data.activated, true);
  const intents = fake.state.intents.size;
  refused(await pay({ seen_paid_until: await fresh() }));
  assert.equal(fake.state.intents.size, intents);
});

test('hosted checkout is unchanged: after a paid one-tap, a fresh hosted checkout still answers 200 with a checkout_url', async () => {
  const first = await pay({ seen_paid_until: await fresh() });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const r = await hosted({ seen_paid_until: await fresh() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.checkout_url);
});

test('an API caller with no seen_paid_until right after a paid charge is refused too', async () => {
  const first = await pay();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const { seen_paid_until: _omit, ...noDate } = { plan: 'growth', months: '1' };
  used += 1;
  refused(await c.post('/api/billing/pay-saved', noDate));
  assert.equal((await paidRows()).length, 1);
});

test('two pay-saved at once with the same date, 5 times: one paid row each round', async () => {
  for (let i = 0; i < 5; i += 1) {
    await reset();
    const [a, b] = await Promise.all([pay(), pay()]);
    assert.equal((await paidRows()).length, 1, `round ${i}: ${JSON.stringify([a.data, b.data])}`);
  }
});
