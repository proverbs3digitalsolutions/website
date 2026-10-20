'use strict';

// QA r26 RESERVATIONS: BKG-1 (Record payment Method on a direct booking shows the required mark) and BKG-2 (Edit reservation reports check-out before check-in with the other device problems). Source scan: frontend-only, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
const between = (from, to) => { const a = SRC.indexOf(from); assert.ok(a >= 0, from); const b = SRC.indexOf(to, a); assert.ok(b > a, to); return SRC.slice(a, b); };

test('BKG-1: the Method field on Record payment is marked required for a direct booking, and required stays for other channels', () => {
  const pay = between("const recordPayment = () =>", 'const editDetails');
  const line = pay.split('\n').find((l) => l.includes("name: 'payment_method'"));
  assert.ok(line.includes("markRequired: r.channel === 'direct'"), line);
  assert.ok(line.includes("required: r.channel !== 'direct'"), line);
  assert.ok(pay.includes("f.payment_method = 'Choose how the guest paid.'"));
});

test('BKG-2: Edit reservation has a check hook for check-out not after check-in, only when the date boxes exist', () => {
  const edit = between('const editDetails', 'fields: [');
  assert.match(edit, /check: \(d\) =>/);
  assert.match(edit, /d\.check_in && d\.check_out && d\.check_out <= d\.check_in/);
  assert.ok(edit.includes("check_out: 'Check-out must be after check-in.'"));
});
