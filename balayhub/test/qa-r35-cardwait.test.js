'use strict';

// QA round 35, CARDWAIT (CARD-1, contract C1, D-117): GET /billing/card-check answers retry_after, the seconds the next
// start would be refused for (0 when none), counting nothing; the page says that wait above the form on load.
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_35_cardwait node --test --test-concurrency=1 test/qa-r35-cardwait.test.js

if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL. This test never falls back to the default database.');
if (/\/balayhub(\?|$)/.test(process.env.TEST_DATABASE_URL)) throw new Error('Refusing to run on the balayhub database. Use an r2_35_* database.');
process.env.PAYMONGO_SECRET_KEY = 'sk_test_x';
process.env.PAYMONGO_PUBLIC_KEY = 'pk_test_x';
process.env.PAYMONGO_WEBHOOK_SECRET = 'whsk_test';

require('./helpers'); // must load before any ../src module: it points DATABASE_URL at the test DB
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount } = require('./helpers');
const { install, TEST_CARDS } = require('./fakes/paymongo');

const card = (number) => ({ card_number: number, exp_month: 12, exp_year: new Date().getFullYear() + 3, cvc: '123' });
const declined = () => fake.createPaymentMethod(card(TEST_CARDS.declined));
const view = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/cardcheck.js'), 'utf8');
const code = view.replace(/\/\/.*$/gm, '');
// The client's own rateText, lifted out of the module (it imports the whole app, which a test cannot load).
const rateText = new Function(`const MSG = { rate: 'Too many tries. Please wait a few minutes and try again.' };
  ${/export (function rateText[\s\S]*?\n})/.exec(view)[1]}; return rateText;`)();

let srv; let fake;
test.before(async () => { fake = install({ realFetch: globalThis.fetch }); srv = await startServer(); });
test.after(async () => { fake.uninstall(); await srv.close(); });

test('a gated workspace with no tries used answers retry_after 0', async () => {
  const A = await ownerAccount(srv.base, 'cwt-a@example.com', 'CWT A');
  const g = await A.get('/api/billing/card-check');
  assert.equal(g.status, 200);
  assert.equal(g.data.status, 'required');
  assert.equal(g.data.retry_after, 0);
});

test('after the day limit, GET says the day wait, the start says the same, and asking counts nothing', async () => {
  const B = await ownerAccount(srv.base, 'cwt-b@example.com', 'CWT B');
  for (let i = 0; i < 8; i += 1) {
    const s = await B.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    assert.equal((await B.post(`/api/billing/card-check/${s.data.billing_id}/attach`, { payment_method_id: declined() })).status, 402);
  }
  const g1 = await B.get('/api/billing/card-check');
  assert.ok(g1.data.retry_after >= 82800 && g1.data.retry_after <= 86400, `retry_after ${g1.data.retry_after}`);
  assert.equal(rateText(g1.data.retry_after), 'Too many tries. Please try again in about 24 hours.');
  const g2 = await B.get('/api/billing/card-check');
  assert.ok(Math.abs(g2.data.retry_after - g1.data.retry_after) <= 1);
  const r = await B.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
  assert.equal(r.status, 429);
  assert.ok(Math.abs(r.data.retry_after - g1.data.retry_after) <= 1, `${r.data.retry_after} vs ${g1.data.retry_after}`);
});

test('after 10 starts in an hour with no declines, GET says the hourly wait', async () => {
  const C = await ownerAccount(srv.base, 'cwt-c@example.com', 'CWT C');
  for (let i = 0; i < 10; i += 1) assert.equal((await C.post('/api/billing/card-check/start', { renewal_plan: 'growth' })).status, 200);
  const g = await C.get('/api/billing/card-check');
  assert.ok(g.data.retry_after >= 3500 && g.data.retry_after <= 3600, `retry_after ${g.data.retry_after}`);
  const r = await C.post('/api/billing/card-check/start', { renewal_plan: 'growth' });
  assert.equal(r.status, 429);
});

test('a workspace whose card is confirmed answers retry_after 0', async () => {
  const D = await ownerAccount(srv.base, 'cwt-d@example.com', 'CWT D');
  await sql(`UPDATE organizations SET card_check = 'passed', card_checked_at = now() WHERE name = 'CWT D'`);
  const g = await D.get('/api/billing/card-check');
  assert.notEqual(g.data.status, 'required');
  assert.equal(g.data.retry_after, 0);
});

test('the page shows the wait above the form on load, and typing does not hide it', () => {
  const form = code.slice(code.indexOf('const formEl'));
  assert.match(code, /const waitNote = info\.retry_after > 0 \? h\('div', \{[^}]*id: 'cc-wait'[^}]*\}, rateText\(info\.retry_after\)\) : null;/);
  assert.ok(code.indexOf('const waitNote') < code.indexOf('const formEl'));
  assert.ok(form.indexOf('waitNote') > -1 && form.indexOf('waitNote') < form.indexOf('summary'), 'waitNote must sit before summary in formEl');
  const clearOne = /const clearOne = [\s\S]*?\n  };/.exec(code)[0];
  assert.ok(!/waitNote/.test(clearOne));
});
