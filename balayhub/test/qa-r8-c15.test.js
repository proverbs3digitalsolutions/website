'use strict';

process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';
process.env.ANTHROPIC_API_KEY = 'test-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');

const PASSWORD = 'correct-horse-1';
const FORMAT = 'Use 3 to 60 lowercase letters, numbers or hyphens.';

let srv; let owner; let manager; let prop;

const invite = (email, role, propertyIds) => owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });

// Accepts an invitation through the sign-up form, which also signs the new account in.
async function accept(email, role, propertyIds, fullName) {
  const inv = await invite(email, role, propertyIds);
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
  owner = await ownerAccount(srv.base, 'c15-owner@example.com', 'C15 Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  manager = await accept('c15-mgr@example.com', 'manager', [prop.property_id], 'Mara C15');
});
test.after(async () => { await srv.close(); });

const addUnit = (c, name, extra = {}) => c.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', ...extra });

test('a page address must start and end with a letter or number', async () => {
  for (const bad of ['---', '-abc', 'abc-', 'a-b-', '--a']) {
    const r = await addUnit(owner, 'Bad address', { public_slug: bad });
    assert.equal(r.status, 400, bad);
    assert.equal(r.data.fields.public_slug, FORMAT, bad);
  }
  const edited = await addUnit(owner, 'C15 unit', { public_slug: 'c15-unit' });
  assert.equal(edited.status, 201);
  const up = `/api/units/${edited.data.unit.unit_id}`;
  assert.equal((await owner.patch(up, { public_slug: '-abc' })).status, 400, 'a leading dash is refused on edit');
  assert.equal((await owner.patch(up, { public_slug: 'abc-' })).status, 400, 'a trailing dash is refused on edit');
});

test('valid page addresses still save, including the 3 and 60 character limits', async () => {
  const short = await addUnit(owner, 'Short', { public_slug: 'a-b' });
  assert.equal(short.status, 201);
  assert.equal(short.data.unit.public_slug, 'a-b');
  const paris = await addUnit(owner, 'Paris', { public_slug: 'paris-1208' });
  assert.equal(paris.status, 201);
  assert.equal(paris.data.unit.public_slug, 'paris-1208');
  const longest = 'a'.repeat(60);
  const long = await addUnit(owner, 'Long', { public_slug: longest });
  assert.equal(long.status, 201);
  assert.equal(long.data.unit.public_slug, longest);
  assert.equal((await addUnit(owner, 'Too long', { public_slug: `${longest}a` })).status, 400, '61 characters is refused');
});

test('a manager at the plan limit is told to ask the owner, with no number', async () => {
  await sql(`UPDATE organizations SET plan = 'starter' WHERE name = 'C15 Stays'`);
  assert.equal((await addUnit(owner, 'Listing 1', { nightly_rate: '2000' })).status, 201);
  assert.equal((await addUnit(owner, 'Listing 2', { nightly_rate: '2000' })).status, 201);

  const mgr = await addUnit(manager, 'Listing 3', { nightly_rate: '2000' });
  assert.equal(mgr.status, 402);
  assert.equal(mgr.data.code, 'PLAN_LIMIT');
  assert.equal(mgr.data.error, "Your plan's listing limit is reached. Ask the workspace owner to upgrade.");
  assert.doesNotMatch(mgr.data.error, /\d/, 'a manager is not told the number');
});

test('the owner still sees the plan name and listing limit', async () => {
  const plan = (await owner.get('/api/auth/me')).data.user.plan;
  const own = await addUnit(owner, 'Listing 3', { nightly_rate: '2000' });
  assert.equal(own.status, 402);
  assert.equal(own.data.code, 'PLAN_LIMIT');
  assert.equal(own.data.error, `Your ${plan.name} plan includes up to 2 listings. Upgrade your plan in Settings to add more.`);
});
