'use strict';

// QA round 1, lane L12: season price above zero, overlap warning, archived preview, staff preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, client, sql } = require('./helpers');
const { hashPassword } = require('../src/lib/auth');

const PASSWORD = 'correct-horse-1';
let srv; let owner; let staff; let u1; let uOther;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'l12-host@example.com', 'L12 Host');
  const orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'L12 Host'`))[0].organization_id;
  const prop = async (name) => { const r = await owner.post('/api/properties', { property_name: name, property_type: 'condominium', address: `${name} Ave`, city: 'Paranaque', province: 'Metro Manila' }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.property; };
  const unit = async (p, name) => (await owner.post(`/api/properties/${p.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const harbor = await prop('Harbor'); const hill = await prop('Hill');
  u1 = await unit(harbor, 'H1'); uOther = await unit(hill, 'X1');
  const [{ user_id: uid }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, 'l12-staff@example.com', $2, 'Sam Staff', 'staff', now()) RETURNING user_id`, [orgId, await hashPassword(PASSWORD)]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [uid, harbor.property_id]);
  staff = client(srv.base);
  assert.equal((await staff.post('/api/auth/login', { email: 'l12-staff@example.com', password: PASSWORD })).status, 200);
});
test.after(async () => { await srv.close(); });

const season = (b) => owner.post('/api/pricing/seasons', { unit_id: u1.unit_id, ...b });

test('#21 a fixed season price must be greater than zero', async () => {
  for (const nightly_rate of ['0', '0.00']) {
    const r = await season({ name: 'Free', start_date: '2031-01-01', end_date: '2031-01-05', nightly_rate });
    assert.equal(r.status, 400, JSON.stringify(r.data));
    assert.ok(r.data.fields.nightly_rate);
  }
  assert.equal((await season({ name: 'Paid', start_date: '2031-01-01', end_date: '2031-01-05', nightly_rate: '1' })).status, 201);
});

test('#22 overlapping seasons on the same scope are saved with a warning that names the winner', async () => {
  const a = await season({ name: 'Peak', start_date: '2031-03-01', end_date: '2031-03-31', nightly_rate: '3000' });
  assert.equal(a.status, 201);
  assert.deepEqual(a.data.overlaps, []);
  const b = await season({ name: 'Holy Week', start_date: '2031-03-20', end_date: '2031-03-25', nightly_rate: '4000' });
  assert.equal(b.status, 201);
  assert.deepEqual(b.data.overlaps.map((o) => [o.name, o.start_date, o.end_date, o.wins]), [['Peak', '2031-03-01', '2031-03-31', 'new']]);
  // An earlier-starting season loses to the one that starts later.
  const c = await season({ name: 'Early', start_date: '2031-03-10', end_date: '2031-03-22', adjust_pct: 10 });
  assert.deepEqual(c.data.overlaps.map((o) => [o.name, o.wins]).sort(), [['Holy Week', 'existing'], ['Peak', 'new']]);
  // A different listing, the all-listings scope, and non-overlapping dates do not warn.
  const other = await owner.post('/api/pricing/seasons', { unit_id: uOther.unit_id, name: 'Other', start_date: '2031-03-20', end_date: '2031-03-25', nightly_rate: '900' });
  assert.deepEqual(other.data.overlaps, []);
  assert.deepEqual((await season({ name: 'April', start_date: '2031-04-01', end_date: '2031-04-02', nightly_rate: '900' })).data.overlaps, []);
  // The engine agrees: Holy Week beats Peak on a shared night.
  const { nights } = (await owner.get(`/api/pricing/preview?unit_id=${u1.unit_id}&from=2031-03-21&days=1`)).data;
  assert.equal(nights[0].label, 'Holy Week');
});

test('#27 the preview returns 404 for an archived listing, like the pricing list', async () => {
  assert.equal((await owner.get(`/api/pricing/preview?unit_id=${uOther.unit_id}&days=1`)).status, 200);
  await sql(`UPDATE units SET status = 'archived' WHERE unit_id = $1`, [uOther.unit_id]);
  assert.equal((await owner.get(`/api/pricing/preview?unit_id=${uOther.unit_id}&days=1`)).status, 404);
  assert.ok(!(await owner.get('/api/pricing')).data.listings.some((l) => l.unit_id === uOther.unit_id));
});

test('#76 staff can read the preview for assigned listings only, and still cannot write', async () => {
  assert.equal((await staff.get(`/api/pricing/preview?unit_id=${u1.unit_id}&days=3`)).status, 200);
  const hill = (await sql(`SELECT unit_id FROM units WHERE unit_name = 'X1'`))[0].unit_id;
  await sql(`UPDATE units SET status = 'active' WHERE unit_id = $1`, [hill]);
  assert.equal((await staff.get(`/api/pricing/preview?unit_id=${hill}&days=3`)).status, 404);
  assert.equal((await client(srv.base).get(`/api/pricing/preview?unit_id=${u1.unit_id}`)).status, 401);
  assert.equal((await staff.post('/api/pricing/seasons', { unit_id: u1.unit_id, name: 'No', start_date: '2031-06-01', end_date: '2031-06-02', nightly_rate: '900' })).status, 403);
});
