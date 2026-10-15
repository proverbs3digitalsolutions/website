'use strict';

// QA round 14, lane S4: GET /api/search?q= (top bar, D-90). One read-only endpoint over every role-scoped list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { articlesFor } = require('../src/lib/helpcenter');

const PASSWORD = 'longenough1';
const ORDER = ['reservations', 'guests', 'listings', 'properties', 'tenants', 'owners', 'quotes', 'maintenance', 'help'];
const SECRETS = /@|\+?63\d{9}|9171234567|secretnote|privatebooknote|987654|pii-token/i;
let srv; let owner; let manager; let staff; let cleaner; let other; let orgId; let propA; let propB; let unitA; let unitB;
let routeAllowed;

const search = (c, q) => c.get(`/api/search?q=${encodeURIComponent(q)}`);
const group = (r, key) => r.data.groups.find((g) => g.key === key);
const titles = (r, key) => (group(r, key)?.items || []).map((i) => i.title);
const keysOf = (r) => r.data.groups.map((g) => g.key);

async function accept(email, role, propertyIds, fullName) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}
const guest = async (org, name, extra = {}) => (await sql(
  `INSERT INTO guests (organization_id, full_name, email, phone, notes) VALUES ($1,$2,$3,$4,$5) RETURNING guest_id`,
  [org, name, extra.email || 'ana@secret.test', extra.phone || '+639171234567', 'secretnote']))[0].guest_id;
const booking = async (org, unit, guestId, label, code, ci, co, status = 'confirmed') => (await sql(
  `INSERT INTO bookings (organization_id, unit_id, kind, guest_id, guest_label, check_in, check_out, status, confirmation_code, notes, accommodation_total)
   VALUES ($1,$2,'reservation',$3,$4,$5,$6,$7,$8,'privatebooknote',987654.32) RETURNING booking_id`,
  [org, unit, guestId, label, ci, co, status, code]))[0].booking_id;

test.before(async () => {
  srv = await startServer();
  // The browser module is ESM in a CommonJS package, so load its source as a data: module.
  const src = fs.readFileSync(path.join(__dirname, '../public/js/routeaccess.js'), 'utf8');
  ({ routeAllowed } = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`));
  owner = await ownerAccount(srv.base, 's4-owner@example.com', 'S4 Both');
  await owner.patch('/api/workspace', { business_type: 'both' });
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'S4 Both'`))[0].organization_id;
  propA = (await owner.post('/api/properties', { property_name: 'Alpha House', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Bravo House', property_type: 'condominium', address: 'Project 8 Road', city: 'Quezon City', province: 'Metro Manila' })).data.property;
  unitA = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: 'Alpha Studio', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unitB = (await owner.post(`/api/properties/${propB.property_id}/units`, { unit_name: 'Bravo Loft', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = await accept('s4-mgr@example.com', 'manager', [propA.property_id], 'Manager Alpha');
  staff = await accept('s4-staff@example.com', 'staff', [propA.property_id], 'Staff Alpha');
  cleaner = await accept('s4-cleaner@example.com', 'cleaner', [propA.property_id], 'Cleaner Alpha');

  const gAna = await guest(orgId, 'Ana Reyes');
  const gAaron = await guest(orgId, 'Aaron Banana');
  const gBravo = await guest(orgId, 'Ana Bravoguest');
  await guest(orgId, '50% Dela Cruz');
  await guest(orgId, 'Unplaced Guest');
  for (let i = 1; i <= 7; i += 1) await guest(orgId, `Limitguest ${i}`);
  await booking(orgId, unitA.unit_id, gAna, null, 'HMX4Q2', '2026-10-20', '2026-10-22');
  await booking(orgId, unitA.unit_id, gAna, null, 'CNX1Z9', '2026-12-01', '2026-12-03', 'cancelled');
  await booking(orgId, unitA.unit_id, gAaron, null, 'AAR0N1', '2026-11-01', '2026-11-03');
  await booking(orgId, unitA.unit_id, null, 'Walkin Anabel', 'WLK1N2', '2026-11-10', '2026-11-12');
  await booking(orgId, unitB.unit_id, gBravo, null, 'BRV0A1', '2026-10-20', '2026-10-22');
  await sql(`INSERT INTO tenants (organization_id, full_name, email, phone, notes) VALUES ($1,'Tomas Tenant','tomas@secret.test','+639171234567','secretnote')`, [orgId]);
  await sql(`INSERT INTO unit_owners (organization_id, full_name, email, phone, notes) VALUES ($1,'Olga Unitowner','olga@secret.test','+639171234567','secretnote')`, [orgId]);
  await sql(`INSERT INTO unit_owners (organization_id, full_name, archived_at) VALUES ($1,'Archie Unitowner', now())`, [orgId]);
  const quote = (unit, name, status) => sql(
    `INSERT INTO booking_quotes (organization_id, unit_id, public_token, check_in, check_out, num_guests, guest_name, guest_email, guest_phone, accommodation_total, total_amount, pay_type, expires_at, status)
     VALUES ($1,$2,$3,'2027-01-10','2027-01-12',2,$4,'q@secret.test','+639171234567',987654.32,987654.32,'full', now() + interval '1 day', $5)`,
    [orgId, unit, `pii-token-${name}`, name, status]);
  await quote(unitA.unit_id, 'Quincy Alphaquote', 'open');
  await quote(unitB.unit_id, 'Quincy Bravoquote', 'paid');
  const maint = (prop, title, status) => sql(
    `INSERT INTO maintenance_requests (organization_id, property_id, title, description, status, estimated_cost) VALUES ($1,$2,$3,'secretnote',$4,987654.32)`,
    [orgId, prop, title, status]);
  await maint(propA.property_id, 'Leaky faucet', 'open');
  await maint(propA.property_id, 'Old leaky pipe', 'resolved');
  await maint(propB.property_id, 'Leaky bravo roof', 'open');

  other = await ownerAccount(srv.base, 's4-other@example.com', 'S4 Other');
  const otherOrg = (await sql(`SELECT organization_id FROM organizations WHERE name = 'S4 Other'`))[0].organization_id;
  const oProp = (await other.post('/api/properties', { property_name: 'Crossworkspace Inn', property_type: 'condominium', address: 'Lahug', city: 'Cebu City', province: 'Cebu' })).data.property;
  const oUnit = (await other.post(`/api/properties/${oProp.property_id}/units`, { unit_name: 'Crossworkspace Room', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const oGuest = await guest(otherOrg, 'Ana Crossworkspace');
  await booking(otherOrg, oUnit.unit_id, oGuest, null, 'CRS0S1', '2026-10-20', '2026-10-22');
  await sql(`INSERT INTO tenants (organization_id, full_name) VALUES ($1,'Crossworkspace Tenant')`, [otherOrg]);
  await sql(`INSERT INTO unit_owners (organization_id, full_name) VALUES ($1,'Crossworkspace Owner')`, [otherOrg]);
});
test.after(async () => { await srv.close(); });

test('owner: groups come in the fixed order, a code ranks its booking first, a short query answers nothing', async () => {
  const r = await search(owner, 'ana');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.q, 'ana');
  const keys = keysOf(r);
  assert.deepEqual(keys, ORDER.filter((k) => keys.includes(k)), 'fixed order');
  for (const k of ['reservations', 'guests']) assert.ok(keys.includes(k), k);
  const res = group(r, 'reservations');
  assert.equal(res.label, 'Reservations');
  const ana = res.items.find((i) => i.title === 'Ana Reyes' && /HMX4Q2/.test(i.sub));
  assert.equal(ana.sub, 'Alpha Studio · Oct 20, 2026 – Oct 22, 2026 · HMX4Q2');
  assert.equal(ana.href, `#/reservations/${ana.id}`);
  assert.match(res.items.find((i) => /CNX1Z9/.test(i.sub)).sub, / · Cancelled$/);
  assert.ok(res.items.some((i) => i.title === 'Walkin Anabel'), 'a booking with only a label is found');
  const code = await search(owner, 'aar0n1');
  assert.equal(code.data.groups[0].items[0].title, 'Aaron Banana');
  const mixed = await search(owner, 'hmx4q2');
  assert.equal(mixed.data.groups[0].items[0].sub.endsWith('HMX4Q2'), true);
  const short = await search(owner, 'a');
  assert.equal(short.status, 200);
  assert.deepEqual(short.data, { q: 'a', groups: [] });
  assert.deepEqual((await search(owner, '')).data, { q: '', groups: [] });
  assert.deepEqual((await search(owner, ' a ')).data, { q: 'a', groups: [] });
});

test('listings, properties, tenants, owners, quotes and maintenance are found with their links and sub lines', async () => {
  const l = await search(owner, 'alpha');
  assert.deepEqual(group(l, 'listings').items.map((i) => [i.title, i.sub, i.href]), [['Alpha Studio', 'Alpha House', `#/listings?focus=${unitA.unit_id}`]]);
  assert.deepEqual(group(l, 'properties').items.map((i) => [i.title, i.sub, i.href]), [['Alpha House', 'Taguig', `#/properties/${propA.property_id}`]]);
  assert.deepEqual(group(l, 'quotes').items.map((i) => [i.title, i.sub]), [['Quincy Alphaquote', 'Alpha Studio · Jan 10, 2027 – Jan 12, 2027 · Open']]);
  const t = await search(owner, 'tomas');
  assert.deepEqual(titles(t, 'tenants'), ['Tomas Tenant']);
  assert.match(group(t, 'tenants').items[0].href, /^#\/tenants\//);
  const o = await search(owner, 'unitowner');
  assert.deepEqual(titles(o, 'owners'), ['Olga Unitowner'], 'archived owners are left out');
  assert.equal(group(o, 'owners').items[0].href, '#/owners?q=Olga%20Unitowner');
  const m = await search(owner, 'leaky');
  assert.deepEqual(titles(m, 'maintenance'), ['Leaky bravo roof', 'Leaky faucet', 'Old leaky pipe'], 'open first, then newest, resolved last');
  assert.equal(group(m, 'maintenance').items[1].sub, 'Alpha House · Open');
  assert.equal(group(m, 'maintenance').items[2].sub, 'Alpha House · Resolved');
});

test('ranking: a name that starts with the text comes before one that only contains it', async () => {
  const g = await search(owner, 'ana');
  const names = titles(g, 'guests');
  assert.ok(names.indexOf('Ana Reyes') < names.indexOf('Aaron Banana'), JSON.stringify(names));
  assert.ok(names.indexOf('Ana Bravoguest') < names.indexOf('Aaron Banana'));
});

test('each group returns at most 5 items', async () => {
  const r = await search(owner, 'limitguest');
  assert.equal(group(r, 'guests').items.length, 5);
});

test('items carry exactly id, title, sub, href, and no search ever matches or returns contact, notes, money or tokens', async () => {
  for (const [who, c] of [['owner', owner], ['manager', manager], ['staff', staff]]) {
    for (const q of ['ana', 'alpha', 'leaky', 'tomas', 'quincy', 'unitowner']) {
      const r = await search(c, q);
      assert.equal(r.status, 200, `${who} ${q}`);
      assert.doesNotMatch(JSON.stringify(r.data), SECRETS, `${who} ${q}`);
      for (const g of r.data.groups) for (const i of g.items) {
        assert.deepEqual(Object.keys(i).sort(), ['href', 'id', 'sub', 'title'], `${who} ${g.key}`);
        assert.ok(i.sub === null || typeof i.sub === 'string');
      }
    }
  }
  for (const q of ['secret.test', 'ana@secret', '9171234567', '+639171234567', 'secretnote', 'privatebooknote', '987654', 'pii-token']) {
    const r = await search(owner, q);
    // Help articles are static text, not workspace data, so a body word may match them.
    assert.deepEqual(r.data.groups.filter((g) => g.key !== 'help'), [], `owner must not find by ${q}`);
  }
});

test('manager sees only the properties they are assigned to', async () => {
  const r = await search(manager, 'bravo');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.groups, [], JSON.stringify(r.data));
  assert.ok(keysOf(await search(owner, 'bravo')).length >= 5, 'the owner does see them');
  const a = await search(manager, 'ana');
  assert.ok(!titles(a, 'guests').includes('Ana Bravoguest'));
  assert.ok(titles(a, 'guests').includes('Ana Reyes'));
  assert.ok(!keysOf(a).includes('owners'));
  assert.deepEqual(titles(await search(manager, 'quincy'), 'quotes'), ['Quincy Alphaquote']);
  assert.deepEqual(titles(await search(manager, 'leaky'), 'maintenance'), ['Leaky faucet', 'Old leaky pipe']);
  assert.ok(titles(await search(manager, 'unplaced'), 'guests').includes('Unplaced Guest'), 'guests with no stay yet stay visible');
});

test('staff get no owners or quotes group, and nothing beyond id, title, sub and href', async () => {
  for (const q of ['quincy', 'unitowner', 'alpha']) {
    const r = await search(staff, q);
    assert.equal(r.status, 200);
    assert.ok(!keysOf(r).includes('owners'));
    assert.ok(!keysOf(r).includes('quotes'));
  }
  assert.deepEqual((await search(staff, 'bravo')).data.groups, []);
  assert.ok(keysOf(await search(staff, 'ana')).includes('reservations'));
  const allowed = new Set(articlesFor('staff', 'both').map((a) => a.title));
  for (const i of group(await search(staff, 'refund'), 'help')?.items || []) assert.ok(allowed.has(i.title), i.title);
});

test('a cleaner is refused, and a signed-out request is 401', async () => {
  const c = await search(cleaner, 'ana');
  assert.equal(c.status, 403);
  assert.equal(c.data.code, 'CLEANER_FORBIDDEN');
  assert.equal((await search(client(srv.base), 'ana')).status, 401);
});

test('another workspace never shows up, in any group', async () => {
  const r = await search(owner, 'crossworkspace');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.groups, []);
  assert.deepEqual((await search(manager, 'crossworkspace')).data.groups, []);
  assert.deepEqual((await search(other, 'bravo')).data.groups, []);
  assert.deepEqual((await search(other, 'HMX4Q2')).data.groups, []);
  assert.ok(titles(await search(other, 'crossworkspace'), 'guests').includes('Ana Crossworkspace'));
});

test('LIKE wildcards are literal and injection text is just text', async () => {
  for (const q of ['%%', '__', '_n', '%', 'a%']) assert.deepEqual((await search(owner, q)).data.groups, [], q);
  assert.deepEqual((await search(owner, `' OR 1=1 --`)).data.groups, []);
  assert.equal((await search(owner, `'; DROP TABLE guests; --`)).status, 200);
  assert.deepEqual(titles(await search(owner, '50%'), 'guests'), ['50% Dela Cruz']);
  assert.deepEqual(titles(await search(owner, '\\'), 'guests'), []);
});

test('the query is trimmed, spaces collapsed and cut to 80 characters', async () => {
  const long = await search(owner, 'a'.repeat(200));
  assert.equal(long.status, 200);
  assert.equal(long.data.q.length, 80);
  assert.equal((await search(owner, '  ana    reyes ')).data.q, 'ana reyes');
  assert.deepEqual(titles(await search(owner, 'ana    reyes'), 'guests'), ['Ana Reyes']);
  const arr = await owner.get('/api/search?q=ana&q=zzz');
  assert.equal(arr.status, 200, 'a repeated key does not crash');
  assert.equal((await owner.get('/api/search')).status, 200);
});

test('workspace type hides groups: long-term has no stay groups, short-term has no tenants', async () => {
  const lt = await ownerAccount(srv.base, 's4-lt@example.com', 'S4 Long');
  await lt.patch('/api/workspace', { business_type: 'long_term' });
  const ltOrg = (await sql(`SELECT organization_id FROM organizations WHERE name = 'S4 Long'`))[0].organization_id;
  const p = (await lt.post('/api/properties', { property_name: 'Zeta Court', property_type: 'apartment', address: 'Rd', city: 'Pasig', province: 'Metro Manila' })).data.property;
  const u = (await lt.post(`/api/properties/${p.property_id}/units`, { unit_name: 'Zeta Unit', unit_type: 'studio', monthly_rent: '9000' })).data.unit;
  await guest(ltOrg, 'Zeta Guest');
  await sql(`INSERT INTO tenants (organization_id, full_name) VALUES ($1,'Zeta Tenant')`, [ltOrg]);
  await sql(`INSERT INTO unit_owners (organization_id, full_name) VALUES ($1,'Zeta Owner')`, [ltOrg]);
  const r = await search(lt, 'zeta');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(keysOf(r), ['properties', 'tenants']);
  const st = await ownerAccount(srv.base, 's4-st@example.com', 'S4 Short');
  const stOrg = (await sql(`SELECT organization_id FROM organizations WHERE name = 'S4 Short'`))[0].organization_id;
  await sql(`INSERT INTO tenants (organization_id, full_name) VALUES ($1,'Yankee Tenant')`, [stOrg]);
  await guest(stOrg, 'Yankee Guest');
  const s = await search(st, 'yankee');
  assert.deepEqual(keysOf(s), ['guests']);
  assert.ok(u.unit_id);
});

test('every link returned is a page that role may open', async () => {
  const me = async (c) => (await c.get('/api/auth/me')).data.user;
  for (const c of [owner, manager, staff]) {
    const user = await me(c);
    for (const q of ['ana', 'alpha', 'leaky', 'tomas', 'quincy', 'unitowner', 'refund']) {
      for (const g of (await search(c, q)).data.groups) for (const i of g.items) {
        assert.ok(routeAllowed(i.href.slice(1).split('?')[0], user), `${user.role} ${i.href}`);
      }
    }
  }
});

test('help articles: owner gets a help group linking to the help search', async () => {
  const r = await search(owner, 'refund');
  const help = group(r, 'help');
  assert.ok(help && help.items.length > 0 && help.items.length <= 4);
  assert.equal(help.label, 'Help articles');
  for (const i of help.items) assert.match(i.href, /^#\/help\?q=/);
  assert.equal(keysOf(r).at(-1), 'help');
});

test('rate limit: the 61st search within a minute is 429', async () => {
  const c = await ownerAccount(srv.base, 's4-rate@example.com', 'S4 Rate');
  for (let i = 0; i < 60; i += 1) assert.equal((await search(c, 'zz')).status, 200, `request ${i + 1}`);
  const r = await search(c, 'zz');
  assert.equal(r.status, 429);
  assert.equal(r.data.code, 'RATE_LIMITED');
  assert.ok(r.headers.get('retry-after'));
  assert.equal((await search(owner, 'zz')).status, 200, 'the limit is per user');
});
