'use strict';
// QA round 10, lane C02 (refunds and reservations views, frontend only, no database).
// #1 ask only when a refund flips overpaid to owing, #2 cap checked before the question, #35 edit dates asks "Use the new price?", #36 search placeholder.
// node --test --test-concurrency=1 test/qa-r10-c02.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
const refSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/refunds.js'), 'utf8');
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const refundOwedAfter = new Function(`${grab(refSrc, 'refundOwedAfter')}\nreturn refundOwedAfter;`)();
const refundCapProblem = new Function(`${grab(refSrc, 'refundCapProblem')}\nreturn refundCapProblem;`)();
const askNewPrice = new Function(`${grab(resSrc, 'askNewPrice')}\nreturn askNewPrice;`)();

test('#1 refundOwedAfter asks only when overpaid before and owing after', () => {
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: 5200 }, 100), 0);
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: -400 }, 1000), 600);
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: -800 }, 500), 0);
  assert.equal(refundOwedAfter({ status: 'cancelled', balance: -400 }, 1000), 0);
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: 0 }, 100), 0);
});

test('#1 the question names both numbers', () => {
  assert.match(refSrc, /title: 'Refund more than the overpayment\?'/);
  assert.match(refSrc, /The guest overpaid by \$\{peso\(-Number\(reservation\.balance\)\)\}\. After this \$\{peso\(amount\)\} refund they will owe \$\{peso\(owed\)\}\. Record it\?/);
});

test('#2 refundCapProblem repeats the server sentence', () => {
  const left = { refundable: '199.00', paid: '1000.00', refunded: '801.00' };
  assert.equal(refundCapProblem(500, left), 'Only ₱199.00 is left to refund (₱1,000.00 paid, ₱801.00 already refunded).');
  assert.equal(refundCapProblem(199, left), null);
  assert.equal(refundCapProblem(5, { refundable: '0.00', paid: '1000.00', refunded: '1000.00' }), 'Nothing is left to refund (₱1,000.00 paid, ₱1,000.00 already refunded).');
});

test('#2 the cap check comes before the question and before the post, shown at the amount field', () => {
  const cap = refSrc.indexOf('refundCapProblem(amount, data)');
  const ask = refSrc.indexOf('await confirmDialog({ title: \'Refund more than');
  const send = refSrc.indexOf('await post(`/reservations/${reservation.booking_id}/refunds`');
  assert.ok(cap > 0 && cap < ask && ask < send);
  assert.match(refSrc, /fields: \{ amount: tooMuch \}/);
});

test('#35 askNewPrice true only for moved dates, untouched amount, a different rates price', () => {
  assert.equal(askNewPrice({ changedDates: true, typed: 5000, stored: 5000, suggested: 6200 }), true);
  assert.equal(askNewPrice({ changedDates: false, typed: 5000, stored: 5000, suggested: 6200 }), false);
  assert.equal(askNewPrice({ changedDates: true, typed: 5500, stored: 5000, suggested: 6200 }), false);
  assert.equal(askNewPrice({ changedDates: true, typed: 5000, stored: 5000, suggested: 5000 }), false);
  assert.equal(askNewPrice({ changedDates: true, typed: 5000, stored: 5000, suggested: null }), false);
});

test('#35 editDetails awaits the pending quote and asks "Use the new price?"', () => {
  const ed = resSrc.slice(resSrc.indexOf('const editDetails'), resSrc.indexOf('const cancel = async'));
  assert.match(ed, /await pending;/);
  assert.match(ed, /title: 'Use the new price\?'/);
  assert.ok(ed.indexOf("title: 'Use the new price?'") < ed.indexOf('await patch('));
});

test('#36 search placeholder fits at 390 and the full name stays for screen readers', () => {
  assert.match(resSrc, /placeholder: 'Guest, code or listing'/);
  assert.match(resSrc, /label: 'Search guest, code or listing'/);
});
