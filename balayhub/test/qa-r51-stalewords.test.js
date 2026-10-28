'use strict';

// R51 STALEWORDS (C1, CARD51-1, D-133): a plan page whose "paid until" is out of date is refused with the words for what moved
// the plan. The workspace's latest paid plan row is a free activation (a ₱0 coupon row): "Your free plan was just activated…".
// Any other paid row, or none: "That payment was just received…". Which requests are refused does not change: every case is a
// 409 PAYMENT_RECEIVED and nothing starts. The one-minute rule (D-122, D-132) is not part of these cases: the rows are aged.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_51_stalewords DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_51_stalewords node --test --test-concurrency=1 test/qa-r51-stalewords.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use an r2_51_* database.');
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
     VALUES ($1, 'QA r51 STALEWORDS', 'free', NULL, 'once', false, now() - interval '1 day') ON CONFLICT (code) DO NOTHING`, [code]);
}

async function reset() {
  if (!c || used >= 12) { // the checkout limiter counts per workspace (15 an hour)
    used = 0; n += 1;
    const name = `QA r51 STALEWORDS ${n}`;
    c = await ownerAccount(srv.base, `qa-r51-stalewords-${n}@example.com`, name);
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
  await coupon('R51FREE');
});
test.after(async () => { fake.uninstall(); await srv.close(); });
test.beforeEach(reset);

// Five minutes on every plan row: past the one-minute rule, so only the stale check can refuse the press.
const age = () => sql(`UPDATE billing_payments SET paid_at = paid_at - interval '5 minutes', created_at = created_at - interval '5 minutes' WHERE organization_id = $1`, [orgId]);

test('a stale one-tap press after another tab free activation names the activation; nothing starts', async () => {
  const seen = await fresh(); // the stale tab's date (no plan yet)
  const act = await hosted({ seen_paid_until: seen, coupon_code: 'R51FREE' });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  assert.equal(act.data.activated, true);
  await age();
  const intents = fake.state.intents.size; const before = (await rows()).length;
  refused(await pay({ seen_paid_until: seen }), FREE_SENTENCE);
  assert.equal(fake.state.intents.size, intents, 'no payment intent for the refused press');
  assert.equal((await rows()).length, before, 'no new row');
});

test('a stale Pay another way after another tab free activation names the activation; no row', async () => {
  const seen = await fresh();
  assert.equal((await hosted({ seen_paid_until: seen, coupon_code: 'R51FREE' })).status, 200);
  await age();
  const before = (await rows()).length;
  refused(await hosted({ seen_paid_until: seen }), FREE_SENTENCE);
  assert.equal((await rows()).length, before, 'no new row');
});

test('a stale press after another tab paid one-tap still says a payment was received', async () => {
  const seen = await fresh();
  assert.equal((await pay({ seen_paid_until: seen })).status, 200);
  await age();
  refused(await pay({ seen_paid_until: seen }), PAID_SENTENCE);
  assert.equal((await paidRows()).length, 1);
});

test('the latest paid row decides: free then paid reads paid, paid then free reads free', async () => {
  const seen = await fresh();
  assert.equal((await hosted({ seen_paid_until: seen, coupon_code: 'R51FREE' })).status, 200);
  await age();
  assert.equal((await pay({ seen_paid_until: await fresh() })).status, 200);
  await age();
  refused(await pay({ seen_paid_until: seen }), PAID_SENTENCE);
  await reset();
  const seen2 = await fresh();
  assert.equal((await pay({ seen_paid_until: seen2 })).status, 200);
  await age();
  const mid = await fresh();
  await sql('DELETE FROM platform_coupon_redemptions WHERE organization_id = $1', [orgId]);
  const act = await hosted({ seen_paid_until: mid, coupon_code: 'R51FREE' });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  await age();
  refused(await pay({ seen_paid_until: seen2 }), FREE_SENTENCE);
});

test('a fresh page after a free activation (past the minute) pays as before', async () => {
  assert.equal((await hosted({ seen_paid_until: await fresh(), coupon_code: 'R51FREE' })).status, 200);
  await age();
  const r = await pay({ seen_paid_until: await fresh() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await paidRows()).length, 2, 'the activation and the payment');
});
