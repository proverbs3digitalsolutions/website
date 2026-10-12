'use strict';

process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';
process.env.ANTHROPIC_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const demo = require('../src/lib/demo');

let srv; let owner; let prop;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Trial Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
});
test.after(async () => { await srv.close(); });

const addListing = (c, name) => c.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' });

test('new workspaces start a 14-day trial', async () => {
  const me = (await owner.get('/api/auth/me')).data.user;
  assert.equal(me.plan.plan, 'trial');
  assert.ok(me.plan.trial_days_left >= 13 && me.plan.trial_days_left <= 14);
  assert.equal(me.plan.read_only, false);
  assert.equal(me.is_platform_admin, false);
  const pub = await client(srv.base).get('/api/public/plans');
  assert.deepEqual(pub.data.plans.map((p) => p.key), ['starter', 'growth', 'pro']);
  assert.equal(pub.data.trial_days, 14);
});

test('listing limits and AI by plan', async () => {
  await sql(`UPDATE organizations SET plan = 'starter' WHERE name = 'Trial Stays'`);
  assert.equal((await addListing(owner, 'A')).status, 201);
  assert.equal((await addListing(owner, 'B')).status, 201);
  const third = await addListing(owner, 'C');
  assert.equal(third.status, 402);
  assert.equal(third.data.code, 'PLAN_LIMIT');
  // Long-term units (no nightly rate) don't count.
  assert.equal((await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Room 1', unit_type: 'room', monthly_rent: '5000' })).status, 201);
  const st = await owner.get('/api/inbox/status');
  assert.equal(st.data.ai_drafts, false);
  assert.equal(st.data.ai_needs_upgrade, true);
  await sql(`UPDATE organizations SET plan = 'growth' WHERE name = 'Trial Stays'`);
  assert.equal((await addListing(owner, 'C')).status, 201);
  assert.equal((await owner.get('/api/inbox/status')).data.ai_drafts, true);
});

test('an ended trial or overdue plan is read-only but data stays viewable', async () => {
  await sql(`UPDATE organizations SET plan = 'trial', trial_ends_at = now() - interval '1 day' WHERE name = 'Trial Stays'`);
  const me = (await owner.get('/api/auth/me')).data.user;
  assert.equal(me.plan.read_only, true);
  assert.equal(me.plan.reason, 'trial_ended');
  const blocked = await addListing(owner, 'D');
  assert.equal(blocked.status, 402);
  assert.equal(blocked.data.code, 'PLAN_READ_ONLY');
  assert.equal((await owner.get('/api/listings')).status, 200);
  assert.equal((await owner.get('/api/reservations/export')).status, 200);

  // Paid plan: 7-day grace after the paid-until date.
  await sql(`UPDATE organizations SET plan = 'pro', paid_until = CURRENT_DATE - 3 WHERE name = 'Trial Stays'`);
  assert.equal((await owner.get('/api/auth/me')).data.user.plan.reason, 'grace');
  assert.equal((await addListing(owner, 'D')).status, 201);
  await sql(`UPDATE organizations SET paid_until = CURRENT_DATE - 9 WHERE name = 'Trial Stays'`);
  assert.equal((await addListing(owner, 'E')).status, 402);
  assert.equal((await owner.post('/api/auth/logout')).status, 200, 'logging out still works');
});

test('platform admin sees all workspaces and sets plans; hidden from others', async () => {
  const boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ');
  const other = await ownerAccount(srv.base, 'nobody@example.com', 'Nobody Co');
  assert.equal((await other.get('/api/admin/workspaces')).status, 404);
  assert.equal((await boss.get('/api/auth/me')).data.user.is_platform_admin, true);
  const list = await boss.get('/api/admin/workspaces');
  assert.equal(list.status, 200);
  const ws = list.data.workspaces.find((w) => w.name === 'Trial Stays');
  assert.equal(ws.owner_email, 'host@example.com');
  assert.equal(ws.status.read_only, true);
  const p = await boss.patch(`/api/admin/workspaces/${ws.organization_id}`, { plan: 'pro', paid_until: '2099-12-31', plan_note: 'GCash ref 123' });
  assert.equal(p.status, 200);
  const after = (await boss.get('/api/admin/workspaces')).data.workspaces.find((w) => w.name === 'Trial Stays');
  assert.equal(after.plan, 'pro');
  assert.equal(after.status.read_only, false);
  const ext = await boss.patch(`/api/admin/workspaces/${(await sql(`SELECT organization_id FROM organizations WHERE name = 'Nobody Co'`))[0].organization_id}`, { trial_ends_at: '2099-01-31' });
  assert.equal(ext.status, 200);
  assert.equal((await other.get('/api/auth/me')).data.user.plan.trial_days_left > 1000, true);
  assert.equal((await other.patch(`/api/admin/workspaces/${ws.organization_id}`, { plan: 'comped' })).status, 404);
});

test('public demo: one click in, read-only, never emails, dates stay current', async () => {
  const v = client(srv.base);
  const d = await v.post('/api/auth/demo');
  assert.equal(d.status, 200);
  const me = (await v.get('/api/auth/me')).data.user;
  assert.equal(me.plan.is_demo, true);
  assert.equal(me.plan.read_only, true);
  const inbox = await v.get('/api/inbox');
  assert.ok(inbox.data.conversations.length >= 3);
  assert.ok((await v.get('/api/listings')).data.listings.length === 5);
  const res = await v.post('/api/properties', { property_name: 'X', property_type: 'condominium', address: 'Somewhere St', city: 'Taguig', province: 'Metro Manila' });
  assert.equal(res.status, 403);
  assert.equal(res.data.code, 'DEMO_READ_ONLY');
  assert.equal((await v.patch('/api/workspace', { business_type: 'both' })).status, 403);
  assert.equal((await v.post('/api/auth/logout')).status, 200);
  // A second visitor reuses the same demo.
  const v2 = client(srv.base);
  await v2.post('/api/auth/demo');
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM organizations WHERE is_demo`))[0].n, 1);
  // Nobody can log in to the demo with a password.
  const login = await client(srv.base).post('/api/auth/login', { email: demo.DEMO_EMAIL, password: 'anything-at-all' });
  assert.equal(login.status, 401);

  // Daily refresh moves every date forward without overlap errors.
  const before = await sql(`SELECT booking_id, check_in::text FROM bookings b JOIN organizations o USING (organization_id) WHERE o.is_demo ORDER BY booking_id`);
  await sql(`UPDATE organizations SET demo_anchor = demo_anchor - 3 WHERE is_demo`);
  assert.equal(await demo.refreshDemo(), 3);
  const after = await sql(`SELECT booking_id, check_in::text FROM bookings b JOIN organizations o USING (organization_id) WHERE o.is_demo ORDER BY booking_id`);
  const plus3 = (s) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 3); return x.toISOString().slice(0, 10); };
  assert.deepEqual(after.map((r) => r.check_in), before.map((r) => plus3(r.check_in)));
  assert.equal(await demo.refreshDemo(), 0);
});

test('review fixes: listing limit can\'t be bypassed by PATCH or property restore', async () => {
  const c = await ownerAccount(srv.base, 'limit@example.com', 'Limit Co');
  await sql(`UPDATE organizations SET plan = 'starter' WHERE name = 'Limit Co'`);
  const p1 = (await c.post('/api/properties', { property_name: 'One', property_type: 'condominium', address: 'First Street 1', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const p2 = (await c.post('/api/properties', { property_name: 'Two', property_type: 'condominium', address: 'Second Street 2', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const add = (p, name, extra = { nightly_rate: '1500' }) => c.post(`/api/properties/${p.property_id}/units`, { unit_name: name, unit_type: 'studio', ...extra });
  assert.equal((await add(p1, 'A')).status, 201);
  assert.equal((await add(p1, 'B')).status, 201);
  const lt = (await add(p1, 'Room', { monthly_rent: '5000' })).data.unit;
  assert.equal((await c.patch(`/api/units/${lt.unit_id}`, { nightly_rate: '1500' })).status, 402);
  // Archive the property holding both listings, add two more, then try to restore it.
  assert.equal((await c.post(`/api/properties/${p1.property_id}/archive`)).status, 200);
  assert.equal((await add(p2, 'C')).status, 201);
  assert.equal((await add(p2, 'D')).status, 201);
  const r = await c.post(`/api/properties/${p1.property_id}/restore`);
  assert.equal(r.status, 402);
});

test('review fixes: read-only workspaces send no scheduled or automatic messages', async () => {
  const messaging = require('../src/lib/messaging');
  const c = await ownerAccount(srv.base, 'lapsed@example.com', 'Lapsed Co');
  const p = (await c.post('/api/properties', { property_name: 'P', property_type: 'condominium', address: 'Third Street 3', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const u = (await c.post(`/api/properties/${p.property_id}/units`, { unit_name: 'U', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const b = (await c.post('/api/reservations', { unit_id: u.unit_id, check_in: '2099-01-01', check_out: '2099-01-02', guest_name: 'G', guest_email: 'g@example.com' })).data.reservation;
  const conv = (await c.post(`/api/reservations/${b.booking_id}/conversation`)).data.conversation_id;
  const row = await sql(`SELECT organization_id FROM conversations WHERE conversation_id = $1`, [conv]);
  const [m] = await sql(`INSERT INTO messages (conversation_id, organization_id, direction, body, status, scheduled_at, to_email)
                         VALUES ($1,$2,'out','hi','scheduled', now() - interval '1 minute', 'g@example.com') RETURNING message_id`, [conv, row[0].organization_id]);
  await sql(`UPDATE organizations SET plan = 'trial', trial_ends_at = now() - interval '1 day' WHERE name = 'Lapsed Co'`);
  await messaging.sendDueMessages();
  const after = await sql('SELECT status, error FROM messages WHERE message_id = $1', [m.message_id]);
  assert.equal(after[0].status, 'failed');
  assert.match(after[0].error, /plan is inactive/);
});
