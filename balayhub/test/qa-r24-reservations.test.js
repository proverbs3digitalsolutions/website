'use strict';
// Round 24 RESERVATIONS (BKG-3): equal same-day payments get different Receipt, Email and Void button names.
// node --test --test-concurrency=1 test/qa-r24-reservations.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
const m = src.match(/export function paymentName[\s\S]*?\n}\n/);
const peso = (n) => `₱${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const fmtDate = (d) => ({ '2026-10-20': 'Oct 20, 2026', '2026-10-21': 'Oct 21, 2026' }[d] || d);
const paymentName = m ? new Function('peso', 'fmtDate', `${m[0].replace('export ', '')}\nreturn paymentName;`)(peso, fmtDate) : null;
const P = (id, amount, date, receipt, voided) => ({ payment_id: id, amount, payment_date: date, receipt_number: receipt || null, voided_at: voided || null });

test('paymentName exists', () => assert.ok(paymentName, 'export function paymentName not found'));

test('receipt numbers make twin payments differ', () => {
  const list = [P(1, 3000, '2026-10-20', 'AR-000100'), P(2, 3000, '2026-10-20', 'AR-000101')];
  assert.equal(paymentName(list, list[0]), 'payment AR-000100 of ₱3,000.00 on Oct 20, 2026');
  assert.notEqual(paymentName(list, list[0]), paymentName(list, list[1]));
});

test('without receipt numbers twins get (n of m)', () => {
  const list = [P(1, 3000, '2026-10-20'), P(2, 3000, '2026-10-20')];
  assert.equal(paymentName(list, list[0]), 'payment of ₱3,000.00 on Oct 20, 2026 (1 of 2)');
  assert.equal(paymentName(list, list[1]), 'payment of ₱3,000.00 on Oct 20, 2026 (2 of 2)');
});

test('a single payment keeps its plain name', () => {
  const list = [P(1, 3000, '2026-10-20'), P(2, 3000, '2026-10-21'), P(3, 1000, '2026-10-20')];
  assert.equal(paymentName(list, list[0]), 'payment of ₱3,000.00 on Oct 20, 2026');
});

test('voided twins are not counted', () => {
  const list = [P(1, 3000, '2026-10-20', null, '2026-10-20'), P(2, 3000, '2026-10-20')];
  assert.equal(paymentName(list, list[1]), 'payment of ₱3,000.00 on Oct 20, 2026');
});

test('the three row buttons use paymentName', () => {
  assert.match(src, /`Receipt for \$\{paymentName\(payments, p\)\}`/);
  assert.match(src, /for \$\{paymentName\(payments, p\)\}`/);
  assert.match(src, /`Void \$\{paymentName\(payments, p\)\}`/);
});
