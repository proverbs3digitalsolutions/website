'use strict';
// Round 24 REFUNDS (BKG-3): two active refunds of the same amount on the same date get different Void names.
// node --test --test-concurrency=1 test/qa-r24-refunds.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/refunds.js'), 'utf8');
const m = src.match(/export function refundName[\s\S]*?\n}\n/);
const refundName = m
  ? new Function('peso', 'fmtDate', `${m[0].replace('export ', '')}\nreturn refundName;`)((n) => `P${n}`, (d) => d)
  : null;

test('refundName exists', () => assert.ok(refundName, 'export function refundName not found'));

test('a single refund keeps the plain name', () => {
  const r = { refund_id: 1, amount: 1500, refund_date: 'D1' };
  assert.equal(refundName([r], r), 'refund of P1500 on D1');
});

test('equal same-day active refunds are numbered; a different one is not', () => {
  const a = { refund_id: 1, amount: 1500, refund_date: 'D1' };
  const b = { refund_id: 2, amount: 1500, refund_date: 'D1' };
  const c = { refund_id: 3, amount: 900, refund_date: 'D1' };
  const list = [a, b, c];
  assert.equal(refundName(list, a), 'refund of P1500 on D1 (1 of 2)');
  assert.equal(refundName(list, b), 'refund of P1500 on D1 (2 of 2)');
  assert.equal(refundName(list, c), 'refund of P900 on D1');
});

test('voided twins do not count', () => {
  const a = { refund_id: 1, amount: 1500, refund_date: 'D1', voided_at: 'x' };
  const b = { refund_id: 2, amount: 1500, refund_date: 'D1' };
  assert.equal(refundName([a, b], b), 'refund of P1500 on D1');
});

test('the Void button uses the name', () => assert.match(src, /'aria-label': `Void \$\{refundName\(data\.refunds, r\)\}`/));
