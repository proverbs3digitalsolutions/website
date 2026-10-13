'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');

let srv; let host; let staff; let prop;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Profile Stays');
  prop = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  await host.post('/api/properties', { property_name: 'Pine', property_type: 'condominium', address: 'Rd 1', city: 'Tagaytay', province: 'Cavite' });
  const inv = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Nene Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); });

test('my account shows profile, workspace, properties, devices and activity', async () => {
  const d = (await host.get('/api/account/profile')).data;
  assert.equal(d.user.email, 'host@example.com');
  assert.equal(d.workspace.name, 'Profile Stays');
  assert.equal(d.workspace.role, 'owner');
  assert.equal(d.workspace.members, 2);
  assert.equal(d.properties.length, 2);
  assert.equal(d.owner, null);
  assert.equal(d.sessions.filter((s) => s.current).length, 1);
  assert.match(d.sessions[0].id, /^[a-f0-9]{16}$/);
  assert.ok(d.activity.length > 0);
  assert.deepEqual(d.support, { open: 0, waiting: 0 });

  const s = (await staff.get('/api/account/profile')).data;
  assert.equal(s.properties.length, 1, 'staff see only assigned properties');
  assert.equal(s.properties[0].property_name, 'Azure');
  assert.equal(s.owner.email, 'host@example.com');
  assert.ok(!JSON.stringify(s).includes('Pine'));
});

test('edit name and mobile', async () => {
  assert.equal((await host.patch('/api/account/profile', { full_name: '', phone: '0917' })).status, 400);
  assert.equal((await host.patch('/api/account/profile', { full_name: 'Maria S. Santos', phone: '0917 123 4567' })).status, 200);
  const me = (await host.get('/api/auth/me')).data.user;
  assert.equal(me.full_name, 'Maria S. Santos');
  assert.equal((await host.get('/api/account/profile')).data.user.phone, '0917 123 4567');
});

test('see and sign out other devices; can\'t touch other people\'s sessions', async () => {
  const phone = client(srv.base);
  await phone.post('/api/auth/login', { email: 'host@example.com', password: 'correct-horse-1' }, { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1' });
  let d = (await host.get('/api/account/profile')).data;
  const other = d.sessions.find((s) => !s.current && s.device === 'Safari on iPhone');
  assert.ok(other, JSON.stringify(d.sessions));
  assert.equal((await staff.post(`/api/account/sessions/${other.id}/logout`)).status, 404, 'not your session');
  assert.equal((await host.post(`/api/account/sessions/${d.sessions.find((s) => s.current).id}/logout`)).status, 404, 'use Log out for this device');
  assert.equal((await host.post(`/api/account/sessions/${other.id}/logout`)).status, 200);
  assert.equal((await phone.get('/api/auth/me')).status, 401);
  assert.equal((await host.get('/api/auth/me')).status, 200);

  const laptop = client(srv.base);
  await laptop.post('/api/auth/login', { email: 'host@example.com', password: 'correct-horse-1' });
  const r = await host.post('/api/account/sessions/logout-others');
  assert.equal(r.data.signed_out, 1);
  assert.equal((await laptop.get('/api/auth/me')).status, 401);
  d = (await host.get('/api/account/profile')).data;
  assert.equal(d.sessions.length, 1);
});

test('works in a view-only workspace; needs sign-in', async () => {
  await sql(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE name = 'Profile Stays'`);
  assert.equal((await host.patch('/api/account/profile', { full_name: 'Maria Santos' })).status, 200);
  assert.equal((await client(srv.base).get('/api/account/profile')).status, 401);
});
