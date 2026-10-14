'use strict';

// Server-side filters for reviews, discount codes, unit owners, deposits,
// stay reports and the platform admin workspace list.

process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);

let srv; let host; let staff; let org; let azure; let breeze; let a1; let a2; let b1; let r1; let r2; let r3; let r4;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Filter Stays');
  org = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Filter Stays'`))[0].organization_id;
  const prop = async (name) => { const r = await host.post('/api/properties', { property_name: name, property_type: 'condominium', address: `${name} Tower, Bicutan Ave`, city: 'Taguig', province: 'Metro Manila' }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.property; };
  azure = await prop('Azure');
  breeze = await prop('Breeze');
  const unit = async (p, name, type = 'studio') => { const r = await host.post(`/api/properties/${p.property_id}/units`, { unit_name: name, unit_type: type, nightly_rate: '2000' }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.unit; };
  a1 = await unit(azure, '1201');
  a2 = await unit(azure, '805');
  b1 = await unit(breeze, 'Loft', 'apartment');
  const book = async (u, ci, co, guest, extra = {}) => {
    const r = await host.post('/api/reservations', { unit_id: u.unit_id, check_in: ci, check_out: co, guest_name: guest, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.reservation;
  };
  r1 = await book(a1, d(-10), d(-8), 'Ana Cruz');
  r2 = await book(a2, d(-6), d(-4), 'Ben Reyes', { channel: 'airbnb', channel_fee: '400' });
  r3 = await book(b1, d(-3), d(-1), 'Carla Lim');
  r4 = await book(a1, d(5), d(7), 'Dan Uy');
  const inv = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [azure.property_id] });
  staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Nene Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); });

const ids = (list, key = 'booking_id') => list.map((x) => x[key]).sort();

test('reviews: rating, listing, property, dates, comment, search, sort; staff stay scoped', async () => {
  const add = (b, rating, comment, at) => sql(
    `INSERT INTO guest_reviews (organization_id, booking_id, rating, comment, created_at) VALUES ($1,$2,$3,$4,$5)`, [org, b.booking_id, rating, comment, at]);
  await add(r1, 5, 'Spotless and quiet', '2026-01-10T04:00:00Z');
  await add(r2, 2, null, '2026-02-10T04:00:00Z');
  await add(r3, 3, 'Noisy aircon', '2026-03-10T04:00:00Z');
  const get = async (q) => (await host.get(`/api/reviews${q}`)).data;

  const all = await get('');
  assert.equal(all.count, 3);
  assert.equal(all.average, 3.3);
  assert.deepEqual(ids((await get('?rating=low')).reviews), ids([r2, r3]));
  assert.deepEqual(ids((await get('?rating=high')).reviews), ids([r1]));
  assert.deepEqual(ids((await get('?rating=2')).reviews), ids([r2]));
  assert.equal((await get('?rating=9')).reviews.length, 3, 'unknown rating is ignored');
  assert.deepEqual(ids((await get(`?unit_id=${a1.unit_id}`)).reviews), ids([r1]));
  assert.deepEqual(ids((await get(`?property_id=${breeze.property_id}`)).reviews), ids([r3]));
  assert.deepEqual(ids((await get('?from=2026-02-01&to=2026-02-28')).reviews), ids([r2]));
  assert.equal((await get('?from=nope')).reviews.length, 3, 'bad date is ignored');
  assert.deepEqual(ids((await get('?has_comment=1')).reviews), ids([r1, r3]));
  assert.deepEqual(ids((await get('?q=aircon')).reviews), ids([r3]));
  assert.deepEqual(ids((await get('?q=ben')).reviews), ids([r2]));
  const f = await get('?rating=low');
  assert.equal(f.count, 3, 'headline count is unfiltered');
  assert.equal(f.matched, 2);
  assert.equal(f.matched_average, 2.5);
  assert.deepEqual((await get('?sort=lowest')).reviews.map((r) => r.rating), [2, 3, 5]);
  assert.deepEqual((await get('?sort=oldest')).reviews.map((r) => r.rating), [5, 2, 3]);
  // A malformed unit_id is ignored like any bad filter value (D-77), so the list is the unfiltered one.
  const bad = await host.get('/api/reviews?unit_id=not-a-uuid');
  assert.equal(bad.status, 200);
  assert.deepEqual(ids(bad.data.reviews), ids((await get('')).reviews));
  assert.equal(bad.data.matched, bad.data.count, 'matched equals the unfiltered count');
  assert.equal(bad.data.matched_average, bad.data.average, 'matched average equals the unfiltered average');

  // Staff only see their property's reviews, even when filtering for another.
  assert.deepEqual(ids((await staff.get('/api/reviews')).data.reviews), ids([r1, r2]));
  assert.equal((await staff.get('/api/reviews')).data.count, 2);
  assert.equal((await staff.get(`/api/reviews?property_id=${breeze.property_id}`)).data.reviews.length, 0);
});

test('discount codes: status, type, returning only, search, sort', async () => {
  const mk = async (body) => { const r = await host.post('/api/discount-codes', body); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.code_id; };
  await mk({ code: 'ACTIVE10', percent_off: 10, description: 'Rainy season' });
  await mk({ code: 'OLD100', amount_off: '100', valid_until: '2020-01-31' });
  await mk({ code: 'SOON', percent_off: 15, valid_from: d(30) });
  const once = await mk({ code: 'ONCE', amount_off: '200', max_uses: 1 });
  const off = await mk({ code: 'OFFCODE', percent_off: 5 });
  await mk({ code: 'BALIK5', percent_off: 5, returning_only: true });
  await host.post(`/api/discount-codes/${off}/active`, { active: false });
  await sql(
    `INSERT INTO direct_checkouts (public_token, organization_id, unit_id, check_in, check_out, num_guests, guest_name, guest_email, guest_phone, pay_type,
       accommodation_total, cleaning_fee, total_amount, amount_due_now, status, hold_until, consent_at, discount_code_id, discount_amount)
     VALUES ('tok-filters-b', $1, $2, $3, $4, 2, 'Eve', 'eve@example.com', '09170000000', 'full', 4000, 0, 3800, 3800, 'confirmed', now(), now(), $5, 200)`,
    [org, a1.unit_id, d(20), d(22), once]);
  const codes = async (q) => (await host.get(`/api/discount-codes${q}`)).data.codes.map((c) => c.code).sort();

  assert.deepEqual(await codes('?status=active'), ['ACTIVE10', 'BALIK5']);
  assert.deepEqual(await codes('?status=expired'), ['OLD100']);
  assert.deepEqual(await codes('?status=scheduled'), ['SOON']);
  assert.deepEqual(await codes('?status=used_up'), ['ONCE']);
  assert.deepEqual(await codes('?status=off'), ['OFFCODE']);
  assert.equal((await codes('?status=bogus')).length, 6);
  assert.deepEqual(await codes('?type=amount'), ['OLD100', 'ONCE']);
  assert.deepEqual(await codes('?returning=1'), ['BALIK5']);
  assert.deepEqual(await codes('?q=rainy'), ['ACTIVE10']);
  assert.deepEqual(await codes('?q=balik'), ['BALIK5']);
  const r = (await host.get('/api/discount-codes?status=expired')).data;
  assert.equal(r.total, 6);
  assert.equal(r.codes[0].expired, true);
  assert.deepEqual((await host.get('/api/discount-codes?sort=code')).data.codes.map((c) => c.code), ['ACTIVE10', 'BALIK5', 'OFFCODE', 'OLD100', 'ONCE', 'SOON']);
  assert.equal((await host.get('/api/discount-codes?sort=most_used')).data.codes[0].code, 'ONCE');
  assert.equal((await staff.get('/api/discount-codes?status=active')).status, 403);
});

test('unit owners: search, has units, owns listing, sort', async () => {
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Lorna Diaz', email: 'lorna@example.com', unit_ids: [a1.unit_id, a2.unit_id] })).status, 201);
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Pedro Gomez', phone: '09171234567', unit_ids: [b1.unit_id] })).status, 201);
  assert.equal((await host.post('/api/unit-owners', { full_name: 'Zeny Ramos', unit_ids: [] })).status, 201);
  const names = async (q) => (await host.get(`/api/unit-owners${q}`)).data.owners.map((o) => o.full_name);

  assert.deepEqual(await names(''), ['Lorna Diaz', 'Pedro Gomez', 'Zeny Ramos']);
  assert.deepEqual(await names('?q=lorna@'), ['Lorna Diaz']);
  assert.deepEqual(await names('?q=0917'), ['Pedro Gomez']);
  assert.deepEqual(await names('?has_units=yes'), ['Lorna Diaz', 'Pedro Gomez']);
  assert.deepEqual(await names('?has_units=no'), ['Zeny Ramos']);
  assert.deepEqual(await names(`?unit_id=${b1.unit_id}`), ['Pedro Gomez']);
  assert.deepEqual(await names('?sort=units'), ['Lorna Diaz', 'Pedro Gomez', 'Zeny Ramos']);
  assert.deepEqual(await names('?sort=newest'), ['Zeny Ramos', 'Pedro Gomez', 'Lorna Diaz']);
  const r = (await host.get('/api/unit-owners?has_units=no')).data;
  assert.equal(r.total, 3);
  assert.equal(r.units.length, 3, 'the unit list is never filtered');
  assert.equal((await host.get('/api/unit-owners?unit_id=x')).status, 404);
});

test('deposits list: status (incl. due), listing, property, method, dates, deduction, search; managers only', async () => {
  const rec = async (b, body) => assert.equal((await host.post(`/api/reservations/${b.booking_id}/deposit`, body)).status, 201);
  await rec(r1, { amount: '1000', received_date: d(-10), method: 'cash' });
  await rec(r2, { amount: '500', received_date: d(-6), method: 'gcash' });
  await rec(r3, { amount: '800', received_date: d(-3), method: 'cash' });
  await rec(r4, { amount: '1000', received_date: d(-1), method: 'gcash' });
  assert.equal((await host.post(`/api/reservations/${r1.booking_id}/deposit/settle`, { deduction_amount: '0', refund_method: 'cash' })).status, 200);
  assert.equal((await host.post(`/api/reservations/${r3.booking_id}/deposit/settle`, { deduction_amount: '200', deduction_reason: 'Broken glass', refund_method: 'cash' })).status, 200);
  const list = async (q) => ids((await host.get(`/api/deposits${q}`)).data.deposits);

  assert.deepEqual(await list(''), ids([r1, r2, r3, r4]));
  assert.deepEqual(await list('?status=held'), ids([r2, r4]));
  assert.deepEqual(await list('?status=due'), ids([r2]));
  assert.deepEqual(await list('?status=settled'), ids([r1, r3]));
  assert.deepEqual(await list('?status=refunded'), ids([r1]));
  assert.deepEqual(await list('?status=partly_refunded'), ids([r3]));
  assert.deepEqual(await list('?status=nope'), ids([r1, r2, r3, r4]));
  assert.deepEqual(await list(`?unit_id=${a1.unit_id}`), ids([r1, r4]));
  assert.deepEqual(await list(`?property_id=${breeze.property_id}`), ids([r3]));
  assert.deepEqual(await list('?method=gcash'), ids([r2, r4]));
  assert.deepEqual(await list(`?from=${d(-6)}&to=${d(-2)}`), ids([r2, r3]));
  assert.deepEqual(await list('?deducted=1'), ids([r3]));
  assert.deepEqual(await list('?q=carla'), ids([r3]));
  assert.deepEqual(await list(`?q=${r2.confirmation_code}`), ids([r2]));
  const due = (await host.get('/api/deposits?status=due')).data.deposits[0];
  assert.equal(due.due, true);
  assert.equal((await host.get('/api/deposits?sort=amount')).data.deposits[0].amount, '1000.00');
  assert.equal((await host.get('/api/deposits?property_id=bad')).status, 404);
  assert.equal((await staff.get('/api/deposits')).status, 403);
});

test('stay reports: property, listing and channel filters (performance, tax, export)', async () => {
  const user = (await sql(`SELECT user_id FROM users WHERE email = 'host@example.com'`))[0].user_id;
  await sql(`INSERT INTO expenses (organization_id, property_id, unit_id, category, amount, expense_date, recorded_by) VALUES ($1,$2,$3,'repairs',100,$4,$5)`, [org, azure.property_id, a1.unit_id, d(-5), user]);
  await sql(`INSERT INTO expenses (organization_id, property_id, category, amount, expense_date, recorded_by) VALUES ($1,$2,'association_dues',300,$3,$4)`, [org, azure.property_id, d(-5), user]);
  const range = `from=${d(-12)}&to=${d(0)}`;
  const rep = async (q) => (await host.get(`/api/stay-reports?${range}${q}`)).data;

  const all = await rep('');
  assert.equal(all.totals.stays, 3);
  assert.equal(all.totals.expenses, '400.00');
  const air = await rep('&channel=airbnb');
  assert.equal(air.totals.stays, 1);
  assert.equal(air.totals.channel_fees, '400.00');
  assert.equal(air.totals.expenses, '0.00');
  assert.equal(air.expenses_excluded, true);
  assert.deepEqual(air.channels.map((c) => c.channel), ['airbnb']);
  assert.equal((await rep('&channel=myspace')).totals.stays, 3, 'unknown channel is ignored');
  const one = await rep(`&unit_id=${a1.unit_id}`);
  assert.equal(one.totals.stays, 1);
  assert.deepEqual(one.units.map((u) => u.unit_name), ['1201']);
  assert.equal(one.totals.expenses, '100.00', 'building-level expenses are left out for one listing');
  const az = await rep(`&property_id=${azure.property_id}`);
  assert.equal(az.totals.stays, 2);
  assert.equal(az.totals.expenses, '400.00');
  assert.equal((await rep(`&property_id=${breeze.property_id}`)).totals.expenses, '0.00');
  assert.equal((await host.get(`/api/stay-reports?${range}&unit_id=zzz`)).status, 404);

  const year = d(-2).slice(0, 4);
  const tAll = (await host.get(`/api/stay-reports/tax?year=${year}`)).data;
  const tB = (await host.get(`/api/stay-reports/tax?year=${year}&unit_id=${b1.unit_id}`)).data;
  assert.ok(Number(tB.totals.revenue) > 0);
  assert.ok(Number(tB.totals.revenue) < Number(tAll.totals.revenue));

  const csv = await host.get(`/api/stay-reports/export?${range}&unit_id=${a1.unit_id}`);
  assert.equal(csv.status, 200);
  assert.match(csv.data, /1201/);
  assert.doesNotMatch(csv.data, /Loft/);
});

test('platform admin: status, plan, business type, created dates, search, sort', async () => {
  const boss = await ownerAccount(srv.base, 'boss@example.com', 'Boss Co');
  await ownerAccount(srv.base, 'late@example.com', 'Late Stays');
  await ownerAccount(srv.base, 'over@example.com', 'Overdue Inc');
  await sql(`UPDATE organizations SET plan = 'growth', paid_until = $1, business_type = 'short_term' WHERE name = 'Filter Stays'`, [d(20)]);
  await sql(`UPDATE organizations SET plan = 'starter', paid_until = $1, business_type = 'long_term' WHERE name = 'Boss Co'`, [d(-3)]);
  await sql(`UPDATE organizations SET trial_ends_at = now() - interval '1 day', created_at = '2025-01-15T04:00:00Z', business_type = 'both' WHERE name = 'Late Stays'`);
  await sql(`UPDATE organizations SET plan = 'pro', paid_until = $1, business_type = 'long_term' WHERE name = 'Overdue Inc'`, [d(-30)]);
  const names = async (q) => (await boss.get(`/api/admin/workspaces${q}`)).data.workspaces.map((w) => w.name).sort();

  assert.deepEqual(await names('?status=paying'), ['Filter Stays']);
  assert.deepEqual(await names('?status=grace'), ['Boss Co']);
  assert.deepEqual(await names('?status=trial_ended'), ['Late Stays']);
  assert.deepEqual(await names('?status=overdue'), ['Overdue Inc']);
  assert.deepEqual(await names('?status=trial'), []);
  assert.equal((await names('?status=whatever')).length, 4);
  assert.deepEqual(await names('?plan=pro'), ['Overdue Inc']);
  assert.deepEqual(await names('?business_type=short_term'), ['Filter Stays']);
  assert.deepEqual(await names('?business_type=both'), ['Late Stays']);
  assert.deepEqual(await names('?created_to=2025-12-31'), ['Late Stays']);
  assert.deepEqual(await names(`?created_from=${d(-1)}`), ['Boss Co', 'Filter Stays', 'Overdue Inc']);
  assert.deepEqual(await names('?q=late@'), ['Late Stays']);
  assert.deepEqual(await names('?q=boss co'), ['Boss Co']);
  const r = (await boss.get('/api/admin/workspaces?status=overdue&sort=name')).data;
  assert.equal(r.total, 4);
  assert.deepEqual({ paying: r.summary.paying, grace: r.summary.grace, trial_ended: r.summary.trial_ended, overdue: r.summary.overdue }, { paying: 1, grace: 1, trial_ended: 1, overdue: 1 });
  assert.equal(r.mrr, 999 + 499, 'paying + grace');
  assert.deepEqual((await boss.get('/api/admin/workspaces?sort=name')).data.workspaces.map((w) => w.name), ['Boss Co', 'Filter Stays', 'Late Stays', 'Overdue Inc']);
  assert.equal((await boss.get('/api/admin/workspaces?sort=oldest')).data.workspaces[0].name, 'Late Stays');
  assert.equal((await host.get('/api/admin/workspaces?status=paying')).status, 404, 'hidden from everyone else');
});
