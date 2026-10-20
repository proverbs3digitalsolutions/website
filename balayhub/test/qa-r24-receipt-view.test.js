'use strict';

// QA round 24, lane RCPT-VIEW: the printed receipt page shows the itemised charge lines and the extras total,
// the same stay the emailed receipt (receiptText) describes (D-106). Source scan: no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
const view = SRC.slice(SRC.indexOf('export async function receiptView'));
const body = view.slice(0, view.indexOf('\n}\n'));
const text = fs.readFileSync(path.join(__dirname, '../src/lib/receipts.js'), 'utf8');

test('receiptView renders the itemised charges and extras total, only when there are charges', () => {
  assert.match(body, /r\.charges/);
  assert.match(body, /Itemised charges/);
  assert.match(body, /Extras total/);
  assert.match(body, /\(r\.charges \|\| \[\]\)\.length > 0/);
  assert.match(body, /r\.extras_total/);
  assert.match(body, /c\.quantity > 1/);
  assert.match(body, /peso\(c\.amount\)/);
  assert.ok(body.indexOf('Extras total') < body.indexOf("'Booking total'"), 'charges come before the booking total, as in the email');
});

test('wording matches the emailed receipt', () => {
  assert.match(text, /Itemised charges:/);
  assert.match(text, /Extras total:/);
});

test('staff receipts keep the charges keys', () => {
  const stays = fs.readFileSync(path.join(__dirname, '../src/routes/stays.js'), 'utf8');
  const keys = stays.match(/STAFF_RECEIPT_KEYS = \[[\s\S]*?\];/)[0];
  assert.match(keys, /'charges'/);
  assert.match(keys, /'extras_total'/);
});

test('no inline style added for the charge lines', () => {
  const seg = body.slice(body.indexOf('Itemised charges'), body.indexOf("'Booking total'"));
  assert.doesNotMatch(seg, /style:/);
});
