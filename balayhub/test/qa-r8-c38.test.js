'use strict';

// QA round 8, lane C38 (security review, Low findings). Three lookups took a query-string word straight
// from an object, so ?status=constructor or ?channel=__proto__ found an inherited property and passed
// the check. They now use own(): an unknown word is no filter at all. setupView in auth.js is read as text.
process.env.SMTP_URL = 'test://';
process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount } = require('./helpers');

let srv; let host; let boss;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'QA R8 Support Stays');
  boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ');
  const t = await host.post('/api/support/tickets', { subject: 'Calendar is empty', category: 'problem', body: 'The calendar shows nothing.' });
  assert.equal(t.status, 201, JSON.stringify(t.data));
});
test.after(async () => { await srv.close(); });

test('#C38 support ticket list: an inherited word in ?status or ?category is no filter', async () => {
  const all = (await boss.get('/api/admin/support/tickets')).data.tickets.map((t) => t.ticket_id).sort();
  assert.equal(all.length, 1);
  for (const qs of ['status=constructor', 'status=__proto__', 'category=__proto__', 'category=constructor', 'status=constructor&category=__proto__']) {
    const res = await boss.get(`/api/admin/support/tickets?${qs}`);
    assert.equal(res.status, 200, `${qs} answers 200`);
    assert.deepEqual(res.data.tickets.map((t) => t.ticket_id).sort(), all, `${qs} is treated as no filter`);
  }
});

test('#C38 support ticket list: real status and category words still filter', async () => {
  const hit = (await boss.get('/api/admin/support/tickets?status=new&category=problem')).data.tickets;
  assert.equal(hit.length, 1);
  const miss = (await boss.get('/api/admin/support/tickets?status=resolved')).data.tickets;
  assert.equal(miss.length, 0);
});

test('#C38 stay reports: ?channel=constructor is no channel filter, like leaving it out', async () => {
  const none = (await host.get('/api/stay-reports')).data;
  const res = await host.get('/api/stay-reports?channel=constructor');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.expenses_excluded, false, 'expenses are not dropped for a fake channel');
  assert.deepEqual(res.data.totals, none.totals);
  assert.deepEqual(res.data.channels, none.channels);
  const tax = await host.get('/api/stay-reports/tax?channel=__proto__');
  assert.equal(tax.status, 200, JSON.stringify(tax.data));
});

test('#C38 stay reports: a real channel still narrows the report', async () => {
  const res = await host.get('/api/stay-reports?channel=airbnb');
  assert.equal(res.status, 200);
  assert.equal(res.data.expenses_excluded, true);
});

test('#C38 setupView deletes the saved Get started answers before it returns early for a person with a workspace', () => {
  const auth = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'auth.js'), 'utf8');
  const view = auth.slice(auth.indexOf('export async function setupView'));
  const head = view.slice(0, view.indexOf('let stored'));
  assert.match(head, /if \(state\.user\.organization_id\)/, 'the early return for a person with a workspace is still there');
  assert.match(head, /removeItem\('bh-setup'\)/);
  assert.ok(head.indexOf("removeItem('bh-setup')") < head.indexOf('afterLogin()'), 'the answers are deleted before afterLogin() returns');
});
