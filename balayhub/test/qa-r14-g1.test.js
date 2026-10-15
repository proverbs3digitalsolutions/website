'use strict';

// QA round 14, lane G1 (SEV1): the booking summary must show what is due now for the payment choice that is ticked.
// Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');
let book; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r14g1-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/views/book.js'), path.join(dir, 'views/book.js'));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  book = await import(pathToFileURL(path.join(dir, 'views/book.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.document; delete globalThis.Element; });

const q = { total: '6200', deposit: '3100', addons_total: '0', deposit_allowed: true, balance_due_date: '2026-11-01' };

test('dueNow: Pay in full charges the whole total', () => {
  assert.deepEqual(book.dueNow(q, 'full'), { kind: 'full', now: 6200 });
});
test('dueNow: deposit charges the deposit, the rest is due later', () => {
  assert.deepEqual(book.dueNow(q, 'deposit'), { kind: 'deposit', now: 3100, rest: 3100, date: '2026-11-01' });
});
test('dueNow: add-ons are paid in full on top of the deposit', () => {
  const r = book.dueNow({ ...q, total: '7700', addons_total: '1500' }, 'deposit');
  assert.equal(r.now, 4600);
  assert.equal(r.rest, 3100);
});
test('dueNow: a deposit choice when deposits are not allowed falls back to full', () => {
  assert.deepEqual(book.dueNow({ ...q, deposit_allowed: false }, 'deposit'), { kind: 'full', now: 6200 });
});

test('summary uses dueNow and redraws on a pay-radio change without a new quote', () => {
  assert.match(src, /= dueNow\(q, /);
  assert.match(src, /name=pay\]'\)[\s\S]{0,200}addEventListener\('change'|payChoice\.addEventListener\('change'/);
  const fn = src.slice(src.indexOf('function drawSummary'), src.indexOf('async function updateQuote'));
  assert.ok(fn.length > 50, 'drawSummary exists');
  assert.doesNotMatch(fn, /\bget\(/);
});
test("'Pay now' has its Taglish entry", () => {
  assert.match(src, /'Pay now': 'Bayad ngayon'/);
});
test('the deposit row is only drawn for the deposit kind', () => {
  assert.match(src, /due\.kind === 'deposit'/);
  assert.doesNotMatch(src, /q\.deposit_allowed && \(\(\) =>/);
});
