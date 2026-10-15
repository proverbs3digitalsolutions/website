'use strict';

// Round 15 B4: platform admin endpoints for plan coupons (D-94). List, create, edit, switch off, and who redeemed each coupon.

process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

// A Manila calendar day n days from today, as YYYY-MM-DD.
const day = (n) => {
  const t = new Date(`${manilaToday()}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const MISSING_ID = '00000000-0000-4000-8000-00000000f00d';

let srv; let boss; let host;
test.before(async () => {
  srv = await startServer();
  boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ');
  host = await ownerAccount(srv.base, 'host@example.com', 'Alpha Stays');
});
test.after(async () => { await srv.close(); });

// A complete create body. Each test overrides only what it needs.
const body = (over = {}) => ({
  name: 'Alpha testers', code: 'alpha 50', kind: 'percent', percent_off: 50, amount_off: null,
  duration: 'months', duration_months: 3, plans: ['growth', 'pro'], max_redemptions: 20,
  once_per_workspace: true, require_card: false, starts_on: day(10), starts_time: '00:00',
  ends_on: day(40), ends_time: '23:59', note: '', ...over,
});
const create = (over) => boss.post('/api/admin/coupons', body(over));
const codesOf = (list) => list.map((c) => c.code);

// Manila calendar day and minute of a timestamp, as the admin form shows them.
const manilaParts = (t) => {
  const wall = new Date(new Date(t).getTime() + 8 * 3600 * 1000).toISOString();
  return { day: wall.slice(0, 10), clock: wall.slice(11, 16) };
};
const idOf = async (code) => (await sql('SELECT coupon_id FROM platform_coupons WHERE code = $1', [code]))[0].coupon_id;
// The body the admin form sends for a stored coupon: every field, the locked ones as they are stored, times in Manila minutes.
async function formFor(code, over = {}) {
  const [c] = await sql('SELECT * FROM platform_coupons WHERE code = $1', [code]);
  const start = manilaParts(c.starts_at);
  const end = manilaParts(c.ends_at);
  return {
    name: c.name, code: c.code, kind: c.kind, percent_off: c.percent_off, amount_off: c.amount_off, duration: c.duration,
    duration_months: c.duration_months, plans: c.plans, max_redemptions: c.max_redemptions, once_per_workspace: c.once_per_workspace,
    require_card: c.require_card, starts_on: start.day, starts_time: start.clock, ends_on: end.day, ends_time: end.clock,
    note: c.note ?? '', ...over,
  };
}

// Give a workspace a redemption of a coupon, as a checkout would have.
const redeem = (code, workspace, status = 'active', monthsUsed = 1) => sql(
  `INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, status, months_total, months_used)
   VALUES ((SELECT coupon_id FROM platform_coupons WHERE code = $1), (SELECT organization_id FROM organizations WHERE name = $2), $3, 3, $4)`,
  [code, workspace, status, monthsUsed]);

test('plan coupon routes answer 404 to everyone but the platform admin', async () => {
  const made = await create({ code: 'HIDDEN1' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.coupon.coupon_id;
  const signedOut = await client(srv.base).get('/api/admin/coupons');
  assert.equal(signedOut.status, 401);
  assert.equal(signedOut.data.code, 'UNAUTHENTICATED');
  assert.equal((await host.get('/api/admin/coupons')).status, 404);
  assert.equal((await host.post('/api/admin/coupons', body({ code: 'HIDDEN2' }))).status, 404);
  assert.equal((await host.patch(`/api/admin/coupons/${id}`, { name: 'Hacked' })).status, 404);
  assert.equal((await host.get(`/api/admin/coupons/${id}/redemptions`)).status, 404);
  assert.equal((await sql('SELECT name FROM platform_coupons WHERE coupon_id = $1', [id]))[0].name, 'Alpha testers');
  assert.equal((await sql(`SELECT 1 FROM platform_coupons WHERE code = 'HIDDEN2'`)).length, 0);
});

test('create stores the code in capitals with spaces removed, active and scheduled, and writes an audit row', async () => {
  const r = await create();
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const c = r.data.coupon;
  assert.equal(c.code, 'ALPHA50');
  assert.equal(c.kind, 'percent');
  assert.equal(c.percent_off, 50);
  assert.equal(c.amount_off, null);
  assert.deepEqual(c.plans, ['growth', 'pro']);
  assert.equal(c.active, true);
  assert.equal(c.state, 'scheduled');
  assert.equal(c.used, 0);
  assert.equal(c.discount_total, '0.00');
  assert.equal('created_by' in c, false, 'the creator id is not part of the contract');
  const log = await sql(`SELECT details FROM audit_logs WHERE action = 'platform.coupon_created' AND details->>'code' = 'ALPHA50'`);
  assert.deepEqual(log[0].details, { code: 'ALPHA50', kind: 'percent', duration: 'months' });
});

test('create refuses a code another coupon already uses, in any case, with CODE_TAKEN', async () => {
  const r = await create({ code: 'alpha50' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'CODE_TAKEN');
  assert.equal(r.data.error, 'Another coupon already uses this code.');
});

test('create checks the fields that matter and says which one is wrong', async () => {
  const bad = async (over, field) => {
    const r = await create(over);
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.equal(r.data.code, 'VALIDATION');
    assert.ok(r.data.fields[field], `expected a message for ${field}, got ${JSON.stringify(r.data.fields)}`);
  };
  await bad({ code: 'NOPCT', percent_off: null }, 'percent_off');
  await bad({ code: 'PCT0', percent_off: 0 }, 'percent_off');
  await bad({ code: 'FIXNONE', kind: 'fixed', percent_off: null, amount_off: null }, 'amount_off');
  await bad({ code: 'MONTHS1', duration_months: 1 }, 'duration_months');
  await bad({ code: 'BADPLAN', plans: ['comped'] }, 'plans');
  await bad({ code: 'BADCODE!' }, 'code');
  await bad({ code: 'ENDFIRST', ends_on: day(5) }, 'ends_on');
  await bad({ code: 'NOSTART', starts_on: '2030-13-01' }, 'starts_on');
  const endFirst = await create({ code: 'ENDFIRST', ends_on: day(5) });
  assert.equal(endFirst.data.fields.ends_on, 'The end must be after the start.');
  assert.equal((await sql(`SELECT 1 FROM platform_coupons WHERE code IN ('NOPCT', 'BADPLAN', 'ENDFIRST')`)).length, 0);
});

test('start and end are Manila wall-clock times, stored as UTC', async () => {
  const r = await create({ code: 'MANILA01', starts_on: '2026-10-16', starts_time: '00:00', ends_on: '2026-10-16', ends_time: '08:30' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [row] = await sql(`SELECT starts_at, ends_at FROM platform_coupons WHERE code = 'MANILA01'`);
  assert.equal(row.starts_at.toISOString(), '2026-10-15T16:00:00.000Z');
  assert.equal(row.ends_at.toISOString(), '2026-10-16T00:30:00.000Z');
});

test('list filters by state, kind, plan and search, sorts, and ignores unknown values', async () => {
  await create({ code: 'ALP50', name: 'Alpha testers', plans: ['growth', 'pro'], starts_on: day(10), ends_on: day(40) });
  await create({ code: 'FREE1', name: 'Launch friends', kind: 'free', percent_off: null, duration: 'once', duration_months: null, plans: null, starts_on: day(-1), ends_on: null });
  await create({ code: 'SALE100', name: 'Summer sale', kind: 'fixed', amount_off: '100', percent_off: null, duration: 'forever', duration_months: null, plans: ['starter'], starts_on: day(-20), ends_on: day(-1) });
  const get = async (q) => (await boss.get(`/api/admin/coupons${q}`)).data;

  const all = await get('');
  assert.equal(all.total, all.coupons.length);
  const tally = (state) => all.coupons.filter((c) => c.state === state).length;
  assert.equal(all.summary.scheduled, tally('scheduled'));
  assert.equal(all.summary.active, tally('active'));
  assert.equal(all.summary.ended, tally('ended'));

  const scheduled = await get('?state=scheduled');
  assert.ok(scheduled.coupons.every((c) => c.state === 'scheduled'));
  assert.ok(codesOf(scheduled.coupons).includes('ALP50'));
  assert.ok(!codesOf(scheduled.coupons).includes('FREE1'));
  assert.equal(scheduled.summary.scheduled, all.summary.scheduled, 'the summary counts every coupon, whatever the filter');

  const free = await get('?kind=free');
  assert.ok(free.coupons.every((c) => c.kind === 'free'));
  assert.ok(codesOf(free.coupons).includes('FREE1'));
  assert.ok(!codesOf(free.coupons).includes('ALP50'));

  const pro = await get('?plan=pro');
  assert.ok(pro.coupons.every((c) => c.plans === null || c.plans.includes('pro')));
  assert.ok(codesOf(pro.coupons).includes('ALP50'), 'a coupon for growth and pro covers pro');
  assert.ok(codesOf(pro.coupons).includes('FREE1'), 'a coupon with no plan list covers every paid plan');
  assert.ok(!codesOf(pro.coupons).includes('SALE100'));

  const search = await get('?q=ALP');
  assert.ok(search.coupons.every((c) => `${c.code} ${c.name}`.toLowerCase().includes('alp')));
  assert.ok(codesOf(search.coupons).includes('ALP50'));
  assert.ok(!codesOf(search.coupons).includes('FREE1'));

  const byCode = await get('?sort=code');
  assert.deepEqual(codesOf(byCode.coupons), [...codesOf(all.coupons)].sort((a, b) => a.localeCompare(b)));

  assert.deepEqual(codesOf((await get('?sort=bogus')).coupons), codesOf(all.coupons), 'an unknown sort is ignored');
  assert.equal((await get('?state=nope')).coupons.length, all.coupons.length, 'an unknown state is ignored');
});

test('a used coupon keeps its discount, dates and plans, but name, end date and switch stay editable', async () => {
  assert.equal((await create({ code: 'LOCK50', starts_on: day(10) })).status, 201);
  await redeem('LOCK50', 'Alpha Stays');
  const locked = (r) => r.status === 409 && r.data.code === 'COUPON_LOCKED'
    && r.data.error === "This coupon has been used, so its discount can't change. Make a new coupon instead.";
  const id = (await sql(`SELECT coupon_id FROM platform_coupons WHERE code = 'LOCK50'`))[0].coupon_id;

  assert.ok(locked(await boss.patch(`/api/admin/coupons/${id}`, { percent_off: 40 })));
  assert.ok(locked(await boss.patch(`/api/admin/coupons/${id}`, { plans: ['pro'] })));
  assert.ok(locked(await boss.patch(`/api/admin/coupons/${id}`, { starts_on: day(12) })));
  assert.equal((await boss.patch(`/api/admin/coupons/${id}`, { percent_off: 50, plans: ['pro', 'growth'] })).status, 200, 'the same values are not a change');

  const renamed = await boss.patch(`/api/admin/coupons/${id}`, { name: 'Renamed' });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.coupon.name, 'Renamed');
  const ended = await boss.patch(`/api/admin/coupons/${id}`, { ends_on: day(60) });
  assert.equal(ended.status, 200, JSON.stringify(ended.data));
  assert.equal(ended.data.coupon.percent_off, 50);
});

test('a name-only edit of a used coupon sends its locked values back and is no change, even with seconds on the stored times', async () => {
  assert.equal((await create({ code: 'SAME50', starts_on: day(10), ends_on: day(40) })).status, 201);
  await redeem('SAME50', 'Alpha Stays');
  const id = await idOf('SAME50');
  await sql(`UPDATE platform_coupons SET starts_at = starts_at + interval '42 seconds', ends_at = ends_at + interval '17 seconds' WHERE coupon_id = $1`, [id]);
  const stored = async () => (await sql('SELECT name, percent_off, starts_at, ends_at FROM platform_coupons WHERE coupon_id = $1', [id]))[0];
  const before = await stored();

  const renamed = await boss.patch(`/api/admin/coupons/${id}`, await formFor('SAME50', { name: 'Same coupon', code: 'same50' }));
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.coupon.name, 'Same coupon');
  const after = await stored();
  assert.equal(after.starts_at.getTime(), before.starts_at.getTime(), 'the stored start keeps its seconds');
  assert.equal(after.ends_at.getTime(), before.ends_at.getTime(), 'the stored end keeps its seconds');

  const real = await boss.patch(`/api/admin/coupons/${id}`, await formFor('SAME50', { percent_off: 40 }));
  assert.equal(real.status, 409, JSON.stringify(real.data));
  assert.equal(real.data.code, 'COUPON_LOCKED');
  assert.equal((await stored()).name, 'Same coupon');
});

test('plan names compare without case or order, and a fixed amount compares in centavos', async () => {
  assert.equal((await create({ code: 'PLANS1' })).status, 201);
  await redeem('PLANS1', 'Alpha Stays');
  const plans = await boss.patch(`/api/admin/coupons/${await idOf('PLANS1')}`, await formFor('PLANS1', { name: 'Plans renamed', plans: ['PRO', 'Growth'] }));
  assert.equal(plans.status, 200, JSON.stringify(plans.data));
  assert.equal(plans.data.coupon.name, 'Plans renamed');
  assert.deepEqual(plans.data.coupon.plans, ['growth', 'pro'], 'the stored list is unchanged');

  assert.equal((await create({ code: 'FIX50', kind: 'fixed', percent_off: null, amount_off: '50.00', duration: 'forever', duration_months: null, plans: null })).status, 201);
  await redeem('FIX50', 'Alpha Stays');
  const fixed = await boss.patch(`/api/admin/coupons/${await idOf('FIX50')}`, await formFor('FIX50', { name: 'Fixed renamed', amount_off: 50 }));
  assert.equal(fixed.status, 200, JSON.stringify(fixed.data));
  const moved = await boss.patch(`/api/admin/coupons/${await idOf('FIX50')}`, await formFor('FIX50', { amount_off: '55' }));
  assert.equal(moved.status, 409, JSON.stringify(moved.data));
  assert.equal(moved.data.code, 'COUPON_LOCKED');
});

test('an edit cannot give a coupon a code another coupon already uses', async () => {
  assert.equal((await create({ code: 'TAKEN1' })).status, 201);
  assert.equal((await create({ code: 'TAKEN2' })).status, 201);
  const id = (await sql(`SELECT coupon_id FROM platform_coupons WHERE code = 'TAKEN2'`))[0].coupon_id;
  const r = await boss.patch(`/api/admin/coupons/${id}`, { code: 'taken1' });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'CODE_TAKEN');
  assert.equal((await sql(`SELECT code FROM platform_coupons WHERE coupon_id = $1`, [id]))[0].code, 'TAKEN2');
});

test('the limit cannot go below the times a coupon has been used, and must be at least 1', async () => {
  assert.equal((await create({ code: 'LIMIT5' })).status, 201);
  const id = (await sql(`SELECT coupon_id FROM platform_coupons WHERE code = 'LIMIT5'`))[0].coupon_id;
  await redeem('LIMIT5', 'Alpha Stays', 'active', 1);
  await redeem('LIMIT5', 'BalayHub HQ', 'used_up', 3);
  const low = await boss.patch(`/api/admin/coupons/${id}`, { max_redemptions: 1 });
  assert.equal(low.status, 400, JSON.stringify(low.data));
  assert.equal(low.data.fields.max_redemptions, "The limit can't be below the 2 times it has been used.");
  assert.equal((await boss.patch(`/api/admin/coupons/${id}`, { max_redemptions: 2 })).status, 200);
  assert.equal((await boss.patch(`/api/admin/coupons/${id}`, { max_redemptions: 0 })).status, 400);
});

test('switching a coupon off and on is audited by name, and other edits list the changed fields only', async () => {
  assert.equal((await create({ code: 'SWITCH1' })).status, 201);
  const id = (await sql(`SELECT coupon_id FROM platform_coupons WHERE code = 'SWITCH1'`))[0].coupon_id;
  const off = await boss.patch(`/api/admin/coupons/${id}`, { active: false });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.coupon.active, false);
  assert.equal(off.data.coupon.state, 'off');
  const on = await boss.patch(`/api/admin/coupons/${id}`, { active: true });
  assert.equal(on.data.coupon.active, true);
  await boss.patch(`/api/admin/coupons/${id}`, { name: 'Switch test' });

  const rows = await sql(`SELECT action, record_type, record_id, details FROM audit_logs
    WHERE details->>'code' = 'SWITCH1' AND action LIKE 'platform.coupon%' ORDER BY audit_id`);
  assert.deepEqual(rows.map((r) => r.action), ['platform.coupon_created', 'platform.coupon_switched_off', 'platform.coupon_switched_on', 'platform.coupon_updated']);
  assert.ok(rows.every((r) => r.record_type === 'platform_coupon' && r.record_id === id));
  assert.deepEqual(rows[1].details, { code: 'SWITCH1' });
  assert.deepEqual(rows[3].details, { code: 'SWITCH1', changed: ['name'] });
});

test('redemptions list who used a coupon, with their discount total and paid checkout count as strings', async () => {
  assert.equal((await create({ code: 'RED50' })).status, 201);
  await redeem('RED50', 'Alpha Stays', 'active', 1);
  await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, status, provider, list_amount, discount_amount, coupon_redemption_id, coupon_months)
    VALUES ((SELECT organization_id FROM organizations WHERE name = 'Alpha Stays'), 'growth', 1, '499.50', 'paid', 'paymongo', '999.00', '499.50',
      (SELECT r.redemption_id FROM platform_coupon_redemptions r JOIN platform_coupons c USING (coupon_id) WHERE c.code = 'RED50'), 1)`);
  await sql(`INSERT INTO billing_payments (organization_id, plan, months, amount, status, provider, list_amount, discount_amount, coupon_redemption_id, coupon_months)
    VALUES ((SELECT organization_id FROM organizations WHERE name = 'Alpha Stays'), 'growth', 1, '499.50', 'pending', 'paymongo', '999.00', '100.00',
      (SELECT r.redemption_id FROM platform_coupon_redemptions r JOIN platform_coupons c USING (coupon_id) WHERE c.code = 'RED50'), 1)`);
  const id = (await sql(`SELECT coupon_id FROM platform_coupons WHERE code = 'RED50'`))[0].coupon_id;

  const r = await boss.get(`/api/admin/coupons/${id}/redemptions`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.coupon.code, 'RED50');
  assert.equal(r.data.coupon.used, 1);
  assert.equal(r.data.coupon.discount_total, '499.50');
  assert.equal(r.data.redemptions.length, 1);
  const [row] = r.data.redemptions;
  assert.equal(row.workspace_name, 'Alpha Stays');
  assert.equal(row.owner_email, 'host@example.com');
  assert.equal(row.status, 'active');
  assert.equal(row.months_total, 3);
  assert.equal(row.months_used, 1);
  assert.equal(row.discount_total, '499.50');
  assert.equal(row.payments, 1, 'only paid checkouts count');
});

test('an unknown or malformed coupon id answers 404 on edit and redemptions', async () => {
  assert.equal((await boss.patch(`/api/admin/coupons/${MISSING_ID}`, { name: 'Ghost' })).status, 404);
  assert.equal((await boss.get(`/api/admin/coupons/${MISSING_ID}/redemptions`)).status, 404);
  assert.equal((await boss.patch('/api/admin/coupons/not-a-uuid', { name: 'Ghost' })).status, 404);
});
