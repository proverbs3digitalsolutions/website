'use strict';

// QA round 8, lane C35: a sort/filter word that is a JavaScript property name (constructor, __proto__, toString)
// is ignored like any other unknown value, never interpolated into SQL (500). Plus the tab-arrow-key helper.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount } = require('./helpers');
const { own } = require('../src/lib/pick');

const ROUTES = ['unit-owners', 'cleaning-tasks', 'maintenance', 'rent', 'payments', 'expenses', 'inbox', 'tenants', 'properties', 'guests', 'reservations', 'deposits'];
const WORDS = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

test('own() returns only the object\'s own keys', () => {
  const o = { a: 1 };
  assert.equal(own(o, 'a'), 1);
  for (const w of WORDS) assert.equal(own(o, w), undefined, w);
  assert.equal(own(o, undefined), undefined);
  assert.equal(own(o, ['a']), 1);
});

let srv; let host;
test.before(async () => { srv = await startServer(); host = await ownerAccount(srv.base, 'host@example.com', 'Proto Sort Stays'); });
test.after(async () => { await srv.close(); });

test('list routes treat a property-name sort or filter as unknown (200, not 500)', async () => {
  for (const route of ROUTES) {
    for (const w of WORDS) {
      for (const key of ['sort', 'view', 'segment', 'stay', 'lease', 'balance', 'occupancy']) {
        const r = await host.get(`/api/${route}?${key}=${w}`);
        assert.equal(r.status, 200, `${route}?${key}=${w} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
      }
    }
  }
});

test('the admin workspace list does not pass a property-name sort or plan to .sort()/filter', () => {
  const src = fs.readFileSync(require.resolve('../src/routes/admin.js'), 'utf8');
  assert.ok(!/ADMIN_SORTS\[q\.sort\]/.test(src) && !/PLANS\[q\.plan\]/.test(src));
});

test('app.js tab-key helper picks the next, previous, first and last tab, and is wired on document', () => {
  const src = fs.readFileSync(require.resolve('../public/js/app.js'), 'utf8');
  const m = src.match(/function tabKeyTarget[\s\S]*?\n}\n/);
  assert.ok(m, 'tabKeyTarget is defined in app.js');
  const tabKeyTarget = new Function(`${m[0]}; return tabKeyTarget;`)();
  assert.equal(tabKeyTarget('ArrowRight', 0, 3), 1);
  assert.equal(tabKeyTarget('ArrowRight', 2, 3), 0);
  assert.equal(tabKeyTarget('ArrowLeft', 0, 3), 2);
  assert.equal(tabKeyTarget('ArrowLeft', 2, 3), 1);
  assert.equal(tabKeyTarget('Home', 2, 3), 0);
  assert.equal(tabKeyTarget('End', 0, 3), 2);
  assert.equal(tabKeyTarget('Enter', 0, 3), -1);
  assert.match(src, /document\.addEventListener\('keydown'[\s\S]*?defaultPrevented[\s\S]*?\[role="tab"\]/);
});
