'use strict';

// QA round 19, lane BIL: a failed or abandoned plan payment releases its coupon, the in-progress message names the real
// minutes, refresh answers failed, and a workspace with no stored trial end uses created_at + TRIAL_DAYS.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_02 node --test --test-concurrency=1 test/qa-r19-bil.test.js

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
const config = require('../src/config');
const { planStatus, trialEndsAt } = require('../src/lib/plans');
const billing = require('../src/lib/billing');

let cancelWorks = true;
let srv; let fake; let c; let orgId;
const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const intents = () => fake.calls.filter((x) => x.method === 'POST' && x.path === '/payment_intents');
const lastIntentAmount = () => intents().at(-1).body.data.attributes.amount;
const rows = () => sql(`SELECT * FROM billing_payments WHERE organization_id = $1 AND kind = 'plan' ORDER BY created_at`, [orgId]);
const redemptions = () => sql('SELECT status, months_used FROM platform_coupon_redemptions WHERE organization_id = $1 ORDER BY created_at', [orgId]);
const reset = async () => {
  await sql(`DELETE FROM billing_payments WHERE kind = 'plan' AND organization_id = $1`, [orgId]);
  await sql('DELETE FROM platform_coupon_redemptions WHERE organization_id = $1', [orgId]);
  await sql(`UPDATE organizations SET plan = 'trial', paid_until = NULL, card_payment_method_id = $2, card_brand = 'visa', card_last4 = '0007' WHERE organization_id = $1`,
    [orgId, fake.createPaymentMethod(card(TEST_CARDS.threeDS))]);
};
const age = (billingId, minutes) => sql(`UPDATE billing_payments SET created_at = now() - make_interval(secs => $2) WHERE billing_id = $1`, [billingId, minutes * 60]);
const pay = (extra = {}) => { payCalls += 1; return c.post('/api/billing/pay-saved', { plan: 'growth', months: '1', coupon_code: 'R19HALF', ...extra }); };

let n = 0;
// A fresh workspace every few tests: the checkout limiter counts per workspace (15 an hour) and signups are limited per IP.
let payCalls = 0;
async function freshWorkspace() {
  if (c && payCalls < 6) return;
  payCalls = 0;
  n += 1;
  const name = `R19 Bil Stays ${n}`;
  c = await ownerAccount(srv.base, `r19-bil-${n}@example.com`, name);
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', [name]))[0].organization_id;
  await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now(), trial_ends_at = now() + interval '14 days' WHERE organization_id = $1`, [orgId]);
}

test.before(async () => {
  fake = install({ realFetch: globalThis.fetch });
  // The fake has no cancel endpoint: stand in for PayMongo's, which kills an intent that is not processing or paid.
  const faked = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const m = /\/payment_intents\/(pi_\w+)\/cancel$/.exec(String(url));
    if (!m || cancelWorks === false) return faked(url, init);
    const pi = fake.state.intents.get(m[1]);
    if (pi && !['processing', 'succeeded'].includes(pi.status)) fake.markIntent(m[1], 'failed');
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  srv = await startServer();
  await sql(`INSERT INTO platform_coupons (code, name, kind, percent_off, duration, require_card, active, starts_at)
     VALUES ('R19HALF', 'Half off', 'percent', 50, 'once', false, true, now() - interval '1 day')`);
});
test.after(async () => { globalThis.fetch = realFetch0; fake.uninstall(); await srv.close(); });
test.beforeEach(async () => { cancelWorks = true; await freshWorkspace(); await reset(); });

test('a bank Fail: refresh answers failed, the row is failed, the coupon is released, and the next charge is discounted', async () => {
  const first = await pay();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.status, 'action_required');
  assert.equal(lastIntentAmount(), 49950);
  const [row] = await rows();
  fake.markIntent(row.payment_intent_id, 'failed');
  const r = await c.post(`/api/billing/${row.billing_id}/refresh`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'failed');
  assert.equal((await rows())[0].status, 'failed');
  assert.deepEqual((await redemptions()).map((x) => [x.status, x.months_used]), [['released', 0]]);
  // no waiting, and the coupon gives its discount again
  const second = await pay();
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(lastIntentAmount(), 49950);
  const all = await rows();
  assert.equal(all.length, 2);
  assert.equal(all[1].amount, '499.50');
  assert.equal(all[1].discount_amount, '499.50');
});

test('a failed intent found by the next charge (no page visit in between) is released and the charge goes through', async () => {
  await pay();
  const [row] = await rows();
  fake.markIntent(row.payment_intent_id, 'failed');
  const again = await pay();
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(lastIntentAmount(), 49950);
  assert.equal((await rows())[0].status, 'failed');
});

test('an awaiting_payment_method intent with no error yet (not attached) is not treated as failed', async () => {
  await pay();
  const [row] = await rows();
  const r = await c.post(`/api/billing/${row.billing_id}/refresh`, {});
  assert.equal(r.data.status, 'pending');
  assert.equal((await rows())[0].status, 'pending');
});

test('a stale pending row (past 15 minutes) is expired and its coupon released before the next charge is priced', async () => {
  await pay();
  const [old] = await rows();
  await age(old.billing_id, 20);
  const next = await pay();
  assert.equal(next.status, 200, JSON.stringify(next.data));
  assert.equal(lastIntentAmount(), 49950, 'the new charge gets the discount the coupon line shows');
  const all = await rows();
  assert.equal(all[0].status, 'expired');
  assert.equal(all[1].discount_amount, '499.50');
  const reds = await redemptions();
  assert.equal(reds.filter((x) => x.status === 'released').length, 1);
  assert.equal(reds.filter((x) => x.status === 'pending').length, 1);
});

test('a stale pending row is expired even without re-sending the coupon code once it is released (full price, nothing reserved twice)', async () => {
  await pay();
  const [old] = await rows();
  await age(old.billing_id, 20);
  const next = await pay({ coupon_code: undefined });
  assert.equal(next.status, 200, JSON.stringify(next.data));
  assert.equal(lastIntentAmount(), 99900);
  assert.equal((await rows())[0].status, 'expired');
});

test('PAYMENT_IN_PROGRESS names the minutes left (rounded up, at least 1, singular for 1)', async () => {
  const before = intents().length;
  await pay();
  const [row] = await rows();
  await age(row.billing_id, 5);
  const a = await pay();
  assert.equal(a.status, 409);
  assert.equal(a.data.code, 'PAYMENT_IN_PROGRESS');
  assert.equal(a.data.error ?? a.data.message, 'A payment is already in progress. Try again in 10 minutes.');
  await age(row.billing_id, 14.5);
  const b = await pay();
  assert.equal(b.status, 409);
  assert.equal(b.data.error ?? b.data.message, 'A payment is already in progress. Try again in 1 minute.');
  assert.equal(intents().length - before, 1);
});

test('trialEndsAt: the stored end, else created_at + TRIAL_DAYS, else null when neither is known', () => {
  const stored = new Date('2027-03-01T00:00:00Z');
  assert.equal(trialEndsAt({ trial_ends_at: stored, created_at: new Date('2020-01-01') }).getTime(), stored.getTime());
  const created = new Date('2027-02-01T00:00:00Z');
  assert.equal(trialEndsAt({ trial_ends_at: null, created_at: created }).getTime(), created.getTime() + config.trialDays * 86400000);
  assert.equal(trialEndsAt({ trial_ends_at: null }), null);
  const now = Date.now();
  const s = planStatus({ plan: 'trial', trial_ends_at: null, created_at: new Date(now - 2 * 86400000) });
  assert.equal(s.trial_days_left, config.trialDays - 2);
  assert.equal(s.read_only, false);
  assert.equal(planStatus({ plan: 'trial', trial_ends_at: null }).trial_days_left, config.trialDays);
});

test('a payment during a trial with no stored end starts the covered month after created_at + TRIAL_DAYS', async () => {
  await sql(`UPDATE organizations SET trial_ends_at = NULL, created_at = now() - interval '2 days' WHERE organization_id = $1`, [orgId]);
  const [b] = await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, list_amount, discount_amount, provider)
    VALUES ($1,'growth',1,999,999,0,'paymongo') RETURNING billing_id`, [orgId]);
  assert.equal(await billing.markPaid(b.billing_id, { method: 'card' }), true);
  const [paid] = await sql(`SELECT period_start::text AS s, (SELECT (created_at + interval '14 days' + interval '8 hours')::date::text FROM organizations WHERE organization_id = $1) AS expect FROM billing_payments WHERE billing_id = $2`, [orgId, b.billing_id]);
  assert.equal(paid.s, paid.expect);
  await sql(`UPDATE organizations SET trial_ends_at = now() + interval '14 days', created_at = now() WHERE organization_id = $1`, [orgId]);
});

test('a stale row whose intent is still processing is not expired or released; a late success then counts the coupon month', async () => {
  const first = await pay();
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const [row] = await rows();
  fake.markIntent(row.payment_intent_id, 'processing');
  await age(row.billing_id, 20);
  await c.get('/api/billing');
  assert.equal((await rows())[0].status, 'pending');
  assert.deepEqual((await redemptions()).map((x) => x.status), ['pending']);
  // a new charge is refused while the old one may still land
  const blocked = await pay();
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'PAYMENT_IN_PROGRESS');
  fake.markIntent(row.payment_intent_id, 'succeeded');
  const r = await c.post(`/api/billing/${row.billing_id}/refresh`, {});
  assert.equal(r.data.status, 'paid');
  assert.deepEqual((await redemptions()).map((x) => [x.status, x.months_used]), [['used_up', 1]]);
  await sql(`UPDATE organizations SET paid_until = NULL, plan = 'trial' WHERE organization_id = $1`, [orgId]);
  const again = await pay();
  assert.equal(again.status, 409, 'the once-only coupon is not given a second time');
  assert.equal(again.data.code, 'COUPON_USED');
});

test('a cancel that fails and an intent that cannot be read leave the stale row pending', async () => {
  cancelWorks = false;
  const p0 = await pay();
  assert.equal(p0.status, 200, JSON.stringify(p0.data));
  const [row] = await rows();
  await age(row.billing_id, 20);
  const r = await pay();
  assert.equal(r.status, 409);
  assert.equal((await rows())[0].status, 'pending');
  assert.deepEqual((await redemptions()).map((x) => x.status), ['pending']);
});

test('backstop: a payment that lands on a row already expired with its coupon released takes the coupon back', async () => {
  await pay();
  const [row] = await rows();
  await sql(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1`, [row.billing_id]);
  await sql(`UPDATE platform_coupon_redemptions SET status = 'released', released_at = now() WHERE organization_id = $1`, [orgId]);
  fake.markIntent(row.payment_intent_id, 'succeeded');
  assert.equal((await c.post(`/api/billing/${row.billing_id}/refresh`, {})).data.status, 'paid');
  assert.deepEqual((await redemptions()).map((x) => [x.status, x.months_used]), [['used_up', 1]]);
});

test('backstop: when the workspace already reserved the coupon again, the late payment counts on that reservation', async () => {
  await pay();
  const [row] = await rows();
  await sql(`UPDATE billing_payments SET status = 'expired' WHERE billing_id = $1`, [row.billing_id]);
  await sql(`UPDATE platform_coupon_redemptions SET status = 'released', released_at = now() WHERE organization_id = $1`, [orgId]);
  await sql(`INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total) SELECT coupon_id, $1, 1 FROM platform_coupons WHERE code = 'R19HALF'`, [orgId]);
  fake.markIntent(row.payment_intent_id, 'succeeded');
  assert.equal((await c.post(`/api/billing/${row.billing_id}/refresh`, {})).data.status, 'paid');
  assert.deepEqual((await redemptions()).map((x) => [x.status, x.months_used]).sort(), [['released', 0], ['used_up', 1]]);
});

test('an old pending row that PayMongo still shows open: the message says we are waiting for the bank, not a minute count', async () => {
  cancelWorks = false;
  await pay();
  const [row] = await rows();
  await age(row.billing_id, 20);
  const r = await pay();
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'PAYMENT_IN_PROGRESS');
  assert.equal(r.data.error ?? r.data.message, "We're still waiting for your bank to finish an earlier payment. Pay another way, or try again later.");
});

test('the 2-day reconcile leaves a processing intent pending with its coupon reserved, and expires a dead one and releases its coupon', async () => {
  await pay();
  const [row] = await rows();
  fake.markIntent(row.payment_intent_id, 'processing');
  await age(row.billing_id, 3 * 24 * 60);
  await billing.reconcile();
  assert.equal((await rows())[0].status, 'pending');
  assert.deepEqual((await redemptions()).map((x) => x.status), ['pending']);
  // the intent dies (cancel stands in for a bank that never finished): reconcile now expires it and frees the coupon
  fake.state.intents.get(row.payment_intent_id).status = 'awaiting_payment_method';
  fake.state.intents.get(row.payment_intent_id).last_payment_error = { code: 'card_declined', detail: 'x' };
  await billing.reconcile();
  assert.notEqual((await rows())[0].status, 'pending');
  assert.deepEqual((await redemptions()).map((x) => x.status), ['released']);
});

test('GET /billing shows the open one-tap charge with its discounted amount, and null once it failed', async () => {
  assert.equal((await c.get('/api/billing')).data.pending_payment, null);
  await pay();
  const [row] = await rows();
  let v = (await c.get('/api/billing')).data.pending_payment;
  assert.equal(v.amount, '499.50');
  assert.equal(v.plan, 'growth');
  assert.equal(v.coupon_code, 'R19HALF');
  assert.ok(v.minutes_left >= 14 && v.minutes_left <= 15, String(v.minutes_left));
  assert.ok(!Number.isNaN(Date.parse(v.started_at)));
  await age(row.billing_id, 20);
  cancelWorks = false;
  v = (await c.get('/api/billing')).data.pending_payment;
  assert.equal(v.minutes_left, 0);
  fake.markIntent(row.payment_intent_id, 'failed');
  assert.equal((await c.get('/api/billing')).data.pending_payment, null);
});
