'use strict';

// QA round 17, lane SA (admin server). Bug #22: a fixed-amount plan coupon above the highest plan price asks first
// (409 AMOUNT_ABOVE_PLAN; saved with confirm_high_amount: true, which is never stored). Bug #25: summary.discount_total
// sums every coupon in integer centavos, whatever the list filters.

process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql, manilaToday } = require('./helpers');

// A Manila calendar day n days from today, as YYYY-MM-DD.
const day = (n) => {
  const t = new Date(`${manilaToday()}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const HIGH = 'This is more than the highest plan price (₱1,799.00), so the plan would be free.';

let srv; let boss; let host;
test.before(async () => {
  srv = await startServer();
  boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ');
  host = await ownerAccount(srv.base, 'host@example.com', 'Alpha Stays');
});
test.after(async () => { await srv.close(); });

// A complete fixed-amount create body. Each test overrides only what it needs.
const fixed = (over = {}) => ({
  name: 'Fixed test', code: 'SA17FIX', kind: 'fixed', percent_off: null, amount_off: '1799', duration: 'once', duration_months: null,
  plans: ['growth', 'pro'], max_redemptions: 20, once_per_workspace: true, require_card: false, starts_on: day(10), starts_time: '00:00',
  ends_on: null, ends_time: '23:59', note: '', ...over,
});

test('a fixed coupon at the highest plan price saves with no question', async () => {
  const r = await boss.post('/api/admin/coupons', fixed({ code: 'SA17AT' }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(Number(r.data.coupon.amount_off), 1799);
});

test('a fixed coupon above the highest plan price answers 409 AMOUNT_ABOVE_PLAN and saves nothing', async () => {
  const r = await boss.post('/api/admin/coupons', fixed({ code: 'SA17OVER', amount_off: '1799.01' }));
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'AMOUNT_ABOVE_PLAN');
  assert.equal(r.data.max_plan_price, '1799.00');
  assert.equal(r.data.fields.amount_off, HIGH);
  assert.equal(r.data.error, HIGH);
  assert.equal((await sql(`SELECT 1 FROM platform_coupons WHERE code = 'SA17OVER'`)).length, 0);
});

test('the host confirms a high amount: it saves, and the confirm flag is not stored', async () => {
  const r = await boss.post('/api/admin/coupons', fixed({ code: 'SA17BIG', amount_off: '2000', confirm_high_amount: true }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(Number(r.data.coupon.amount_off), 2000);
  assert.equal('confirm_high_amount' in r.data.coupon, false);
});

test('an edit of only the name on a coupon above the ceiling does not ask', async () => {
  const made = await boss.post('/api/admin/coupons', fixed({ code: 'SA17NAME', amount_off: '2000', confirm_high_amount: true }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const r = await boss.patch(`/api/admin/coupons/${made.data.coupon.coupon_id}`, { name: 'Renamed only' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.coupon.name, 'Renamed only');
});

test('raising the amount above the ceiling asks again, and the confirm flag saves it', async () => {
  const made = await boss.post('/api/admin/coupons', fixed({ code: 'SA17RAISE', amount_off: '1000' }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.coupon.coupon_id;
  const ask = await boss.patch(`/api/admin/coupons/${id}`, { amount_off: '2000' });
  assert.equal(ask.status, 409, JSON.stringify(ask.data));
  assert.equal(ask.data.code, 'AMOUNT_ABOVE_PLAN');
  assert.equal(Number((await sql('SELECT amount_off FROM platform_coupons WHERE coupon_id = $1', [id]))[0].amount_off), 1000, 'a refused edit saves nothing');
  const yes = await boss.patch(`/api/admin/coupons/${id}`, { amount_off: '2000', confirm_high_amount: true });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.equal(Number(yes.data.coupon.amount_off), 2000);
});

test('summary.discount_total sums every coupon in centavos, whatever the list filter', async () => {
  const live = await boss.post('/api/admin/coupons', fixed({ code: 'SA17SUM', amount_off: '499', starts_on: day(-3) }));
  assert.equal(live.status, 201, JSON.stringify(live.data));
  const later = await boss.post('/api/admin/coupons', fixed({ code: 'SA17SCHED', kind: 'percent', percent_off: 10, amount_off: null, duration: 'once', starts_on: day(10) }));
  assert.equal(later.status, 201, JSON.stringify(later.data));
  await sql(`INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, status, months_total, months_used)
    VALUES ((SELECT coupon_id FROM platform_coupons WHERE code = 'SA17SUM'), (SELECT organization_id FROM organizations WHERE name = 'Alpha Stays'), 'active', 1, 1)`);
  for (const discount of ['499.00', '99.90']) {
    await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, status, provider, list_amount, discount_amount, coupon_redemption_id, coupon_months)
      VALUES ((SELECT organization_id FROM organizations WHERE name = 'Alpha Stays'), 'growth', 1, '499.50', 'paid', 'paymongo', '999.00', $1,
        (SELECT r.redemption_id FROM platform_coupon_redemptions r JOIN platform_coupons c USING (coupon_id) WHERE c.code = 'SA17SUM'), 1)`, [discount]);
  }

  const all = await boss.get('/api/admin/coupons');
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.equal(all.data.summary.discount_total, '598.90');
  assert.equal(all.data.summary.scheduled, all.data.coupons.filter((c) => c.state === 'scheduled').length, 'the state counts cover the whole list');

  const scheduled = await boss.get('/api/admin/coupons?state=scheduled');
  const codes = scheduled.data.coupons.map((c) => c.code);
  assert.ok(codes.includes('SA17SCHED'));
  assert.ok(!codes.includes('SA17SUM'), 'the paid coupon is not in the scheduled list');
  assert.equal(scheduled.data.summary.discount_total, '598.90', 'the total does not follow the filter');
});
