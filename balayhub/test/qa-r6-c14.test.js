'use strict';

// QA round 6, lane C14 (owners). Covers #22 to #26: the invite screen says "sent" only when the email went,
// a payout must name its month, the review list leaves out owners with nothing to review, the statement
// month check follows the server's year range, and archiving an owner ends portal access.
// node --test --test-concurrency=1 test/qa-r6-c14.test.js

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { outbox } = require('../src/lib/mailer');

const SEP = '2026-09';
const today = manilaToday();
const payouts = (id) => `/api/unit-owners/${id}/payouts`;
const payoutBody = (over = {}) => ({ amount: '100', paid_on: today, method: 'gcash', ...over });
const countWhere = async (text, params) => (await sql(text, params))[0].n;

let srv; let host; let unit;
const createOwner = async (body) => {
  const r = await host.post('/api/unit-owners', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.owner_id;
};
const orgOf = async (ownerId) => (await sql('SELECT organization_id FROM unit_owners WHERE owner_id = $1', [ownerId]))[0].organization_id;

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'c14-host@example.com', 'C14 Stays');
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
});
test.after(async () => { await srv.close(); });

test('#23: a payout must name its statement month, so the owes and over-payment checks always run', async () => {
  const id = await createOwner({ full_name: 'Month Owner' });
  // September is published as owing the workspace 500.00. A payout with no month used to skip that check and be saved.
  await sql(`INSERT INTO owner_statements (organization_id, owner_id, month, status, snapshot, published_at)
             VALUES ($1, $2, $3, 'published', $4, now())`, [await orgOf(id), id, SEP, JSON.stringify({ totals: { payout: '-500.00' }, units: [] })]);
  const r = await host.post(payouts(id), payoutBody());
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'VALIDATION');
  assert.equal(r.data.fields.month, 'Choose the statement month this payout is for.');
  assert.equal(await countWhere('SELECT COUNT(*)::int AS n FROM owner_payouts WHERE owner_id = $1', [id]), 0, 'nothing saved');

  // With the month named, the owes check applies and refuses it for the right reason.
  const withMonth = await host.post(payouts(id), payoutBody({ month: SEP }));
  assert.equal(withMonth.status, 409);
  assert.equal(withMonth.data.code, 'NOTHING_DUE');
});

test('#23 (year range): a payout month outside 2000 to 2100 is refused, as the statement routes refuse it (1999-01 gives 400)', async () => {
  const id = await createOwner({ full_name: 'Year Range Owner' });
  for (const month of ['1999-01', '2101-01']) {
    const r = await host.post(payouts(id), payoutBody({ month }));
    assert.equal(r.status, 400, month);
    assert.equal(r.data.code, 'VALIDATION', month);
    assert.equal(r.data.fields.month, 'Choose a month.', month);
  }
  assert.equal(await countWhere('SELECT COUNT(*)::int AS n FROM owner_payouts WHERE owner_id = $1', [id]), 0, 'nothing saved');
});

test('#24: the review list leaves out owners with no units and no saved statement', async () => {
  const withUnit = await createOwner({ full_name: 'Review Has Units', unit_ids: [unit.unit_id] });
  await createOwner({ full_name: 'Review No Units' });
  const saved = await createOwner({ full_name: 'Review Saved Draft' });
  await sql(`INSERT INTO owner_statements (organization_id, owner_id, month, status) VALUES ($1, $2, $3, 'draft')`, [await orgOf(saved), saved, SEP]);
  const rows = (await host.get(`/api/owner-statements?month=${SEP}`)).data.owners;
  const names = rows.map((r) => r.full_name);
  assert.ok(names.includes('Review Has Units'), 'an owner with a unit shows');
  assert.ok(names.includes('Review Saved Draft'), 'a saved record still shows');
  assert.ok(!names.includes('Review No Units'), 'no units and nothing saved: left out');
  assert.equal(rows.find((r) => r.owner_id === withUnit).unit_count, 1);
});

test('#26: archiving an owner turns portal access off and ends their sessions and unused sign-in links', async () => {
  const email = 'c14-archive@example.com';
  const id = await createOwner({ full_name: 'Archive Portal', email });
  const invite = async () => {
    outbox.length = 0;
    assert.equal((await host.post(`/api/unit-owners/${id}/portal-invite`)).status, 200);
    return decodeURIComponent(/token=([^&\s]+)/.exec(outbox.find((m) => m.to === email).text)[1]);
  };
  const signedIn = client(srv.base);
  assert.equal((await signedIn.post('/api/owner-portal/session', { token: await invite() })).status, 200);
  const unused = await invite();

  assert.equal((await host.post(`/api/unit-owners/${id}/archive`)).status, 200);
  assert.equal((await sql('SELECT portal_enabled FROM unit_owners WHERE owner_id = $1', [id]))[0].portal_enabled, false);
  assert.equal(await countWhere('SELECT COUNT(*)::int AS n FROM owner_sessions WHERE owner_id = $1', [id]), 0, 'sessions ended');
  assert.equal(await countWhere('SELECT COUNT(*)::int AS n FROM owner_login_tokens WHERE owner_id = $1 AND used_at IS NULL', [id]), 0, 'unused links gone');
  assert.equal((await signedIn.get('/api/owner-portal/me')).status, 401);
  assert.equal((await client(srv.base).post('/api/owner-portal/session', { token: unused })).data.code, 'INVALID_LINK');
});

// Screen checks: the owners view imports the app shell, which does not load in Node, so these read the source.
const ownersView = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/owners.js'), 'utf8');

test('#25: the statement month check uses the server year range, so 1999-01 gets the inline month message', () => {
  const line = /^const MONTH_RE = (\/.*\/);$/m.exec(ownersView);
  assert.ok(line, 'MONTH_RE is one line');
  const MONTH_RE = new Function(`return ${line[1]};`)();
  for (const [month, ok] of [['1999-01', false], ['2000-01', true], ['2026-09', true], ['2100-12', true], ['2101-01', false], ['2026-13', false]]) {
    assert.equal(MONTH_RE.test(month), ok, month);
  }
});

test('#22: the invite says "sent" only when the email went, and the owner card can send it again while portal access is on', () => {
  const invite = ownersView.slice(ownersView.indexOf('const invite = async (o) => {'), ownersView.indexOf('const disablePortal = async'));
  assert.match(invite, /const r = await post\(`\/unit-owners\/\$\{o\.owner_id\}\/portal-invite`\);/);
  assert.match(invite, /if \(r\.sent\) toast\(`Invite sent to \$\{o\.email\}\.`\);/);
  assert.match(invite, /else toast\(`The invite email to \$\{o\.email\} couldn't be sent\. Portal access is on\. Check the email address, then use Send the invite again\.`, 'error'\);/);
  assert.match(invite, /rerender\(\);/);
  assert.match(ownersView, /'Turn off portal access'\)[\s\S]*?'Send the invite again'\)/);
});
