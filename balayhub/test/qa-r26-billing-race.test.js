'use strict';

// QA round 26, lane BILLING: BIL-1 (a free coupon activation is an open payment too) and the CARD-1 timeline / races.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_26_billing node --test --test-concurrency=1 test/qa-r26-billing-race.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use a balayhub_test_* or r2_26_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');

let srv; let fake; let c; let orgId; let n = 0; let used = 0;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const rows = () => sql(`SELECT * FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' ORDER BY created_at`, [orgId]);
const paidRows = async () => (await rows()).filter((r) => r.status === 'paid');
const day = (d) => (d ? String(d).slice(0, 10) : null);
const paidUntil = async () => day((await sql('SELECT paid_until FROM organizations WHERE organization_id = $1', [orgId]))[0].paid_until);
const pay = (extra = {}) => { used += 1; return c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', seen_paid_until: null, ...extra }); };
const hosted = (extra = {}) => { used += 1; return c.post('/api/billing/checkout', { plan: 'growth', months: '1', seen_paid_until: null, ...extra }); };
async function coupon(code, percent) { // percent null = a free coupon
  await sql(
    `INSERT INTO platform_coupons (code, name, kind, percent_off, duration, require_card, starts_at)
     VALUES ($1, 'R26', $2, $3, 'once', false, now() - interval '1 day') ON CONFLICT (code) DO NOTHING`, [code, percent ? 'percent' : 'free', percent]);
}

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  srv = await startServer();
  await coupon('R26HALF', 50); await coupon('R26FREE', null);
});
test.after(async () => { fake.uninstall(); await srv.close(); });
async function reset() {
  if (!c || used >= 12) { // the checkout limiter counts per workspace (15 an hour)
    used = 0; n += 1;
    const name = `R26 Race ${n}`;
    c = await ownerAccount(srv.base, `r26-race-${n}@example.com`, name);
    orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', [name]))[0].organization_id;
    await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days' WHERE organization_id = $1`, [orgId]);
  }
  await sql(`DELETE FROM billing_payments WHERE organization_id = $1`, [orgId]);
  await sql(`DELETE FROM platform_coupon_redemptions WHERE organization_id = $1`, [orgId]);
  await sql(`UPDATE organizations SET plan = 'trial', paid_until = NULL, card_payment_method_id = $2, card_brand = 'visa', card_last4 = '4345' WHERE organization_id = $1`,
    [orgId, fake.createPaymentMethod(card(TEST_CARDS.ok))]);
}
test.beforeEach(reset);

const pendingCoupon = (ageMinutes = 0) => sql(
  `INSERT INTO billing_payments (organization_id, plan, months, amount, list_amount, discount_amount, provider, status, kind, created_at)
   VALUES ($1, 'growth', 1, 0, 999, 999, 'coupon', 'pending', 'plan', now() - make_interval(mins => $2))`, [orgId, ageMinutes]);

test('BIL-1: a free activation still open blocks one-tap and hosted payments; no intent, no session, no row', async () => {
  await pendingCoupon(0);
  const intents = fake.state.intents.size; const sessions = fake.state.sessions.size;
  const a = await pay();
  assert.equal(a.status, 409, JSON.stringify(a.data));
  assert.equal(a.data.code, 'PAYMENT_IN_PROGRESS');
  assert.equal(a.data.error, 'A payment is already in progress. Try again in a moment.');
  const b = await hosted();
  assert.equal(b.status, 409, JSON.stringify(b.data));
  assert.equal(b.data.code, 'PAYMENT_IN_PROGRESS');
  assert.equal((await rows()).length, 1);
  assert.equal(fake.state.intents.size, intents);
  assert.equal(fake.state.sessions.size, sessions);
});

test('BIL-1: a free activation row left pending 3 minutes ago does not block', async () => {
  await pendingCoupon(3);
  const r = await pay();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await paidRows()).length, 1);
});

test('CARD-1 timeline: coupon pay, stale pay refused, fresh early renewal adds a month', async () => {
  const first = await pay({ coupon_code: 'R26HALF' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const until1 = await paidUntil();
  assert.ok(until1);
  assert.equal((await paidRows()).length, 1);
  const intents = fake.state.intents.size;
  const stale = await pay();
  assert.equal(stale.status, 409, JSON.stringify(stale.data));
  assert.equal(stale.data.code, 'PAYMENT_RECEIVED');
  assert.equal((await rows()).length, 1);
  assert.equal(fake.state.intents.size, intents);
  assert.equal(await paidUntil(), until1);
  const bill = await c.get('/api/billing');
  assert.equal(day(bill.data.paid_until), until1);
  // The one-tap gate refuses a charge for 60 s after a paid plan payment (D-122). This is a later, separate renewal, so age that payment.
  await sql(`UPDATE billing_payments SET paid_at = paid_at - interval '61 seconds' WHERE billing_id = (SELECT billing_id FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' AND status = 'paid' ORDER BY paid_at DESC LIMIT 1)`, [orgId]);
  const third = await pay({ seen_paid_until: day(bill.data.paid_until) });
  assert.equal(third.status, 200, JSON.stringify(third.data));
  const until2 = await paidUntil();
  const d1 = new Date(until1); const d2 = new Date(until2);
  const months = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + d2.getUTCMonth() - d1.getUTCMonth();
  assert.equal(months, 1, `${until1} -> ${until2}`);
  assert.equal((await paidRows()).length, 2);
});

test('two one-tap payments at once (coupon and none), 5 times: never two paid rows', async () => {
  for (let i = 0; i < 5; i += 1) {
    await reset();
    const [a, b] = await Promise.all([pay({ coupon_code: 'R26HALF' }), pay()]);
    const ok = [a, b].filter((r) => r.status === 200);
    const no = [a, b].filter((r) => r.status !== 200);
    assert.equal((await paidRows()).length, 1, `round ${i}: ${JSON.stringify([a.data, b.data])}`);
    assert.equal(ok.length, 1, `round ${i}`);
    assert.equal(no[0].status, 409);
    assert.ok(['PAYMENT_IN_PROGRESS', 'PAYMENT_RECEIVED'].includes(no[0].data.code), JSON.stringify(no[0].data));
  }
});

test('a free coupon activation and a one-tap payment at once, 5 times: exactly one paid plan row', async () => {
  for (let i = 0; i < 5; i += 1) {
    await reset();
    const res = await Promise.all([hosted({ coupon_code: 'R26FREE' }), pay()]);
    assert.equal((await paidRows()).length, 1, `round ${i}: ${JSON.stringify(res.map((x) => [x.status, x.data]))}`);
  }
});
