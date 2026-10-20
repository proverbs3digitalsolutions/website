'use strict';

// QA round 23 (ACCOUNT, PHN-1): My account shows "Team: N members" to owners only. BACKEND-SCHEMA section 6
// says managers, staff and cleaners see no team count, so the server doesn't send it to them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, ownerAccount } = require('./helpers');

const PASSWORD = 'longenough1';
let srv; let owner; let prop; let manager; let staff; let cleaner;

// Accepts an invitation through the sign-up form, which also signs the new account in.
async function accept(email, role, fullName) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [prop.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'phn-r23-owner@example.com', 'PHN R23 Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  manager = await accept('phn-r23-mgr@example.com', 'manager', 'Mara Manager');
  staff = await accept('phn-r23-staff@example.com', 'staff', 'Sam Staff');
  cleaner = await accept('phn-r23-cleaner@example.com', 'cleaner', 'Nena Cleaner');
});
test.after(async () => { await srv.close(); });

test('the owner gets the team count: the owner plus every active member', async () => {
  const w = (await owner.get('/api/account/profile')).data.workspace;
  assert.equal(w.role, 'owner');
  assert.equal(w.members, 4);
});

test('managers, staff and cleaners get no team count, and still get their workspace', async () => {
  for (const [who, c, role] of [['manager', manager, 'manager'], ['staff', staff, 'staff'], ['cleaner', cleaner, 'cleaner']]) {
    const d = (await c.get('/api/account/profile')).data;
    assert.equal(d.workspace.role, role, who);
    assert.equal(d.workspace.name, 'PHN R23 Co', who);
    assert.ok(!('members' in d.workspace), `${who} should not get members: ${JSON.stringify(d.workspace)}`);
  }
});

test('the My account page draws the Team line only when the server sent a count', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'account.js'), 'utf8');
  assert.match(src, /w\.members != null && \[h\('dt', null, 'Team'\), h\('dd', null, `\$\{w\.members\} member/);
});
