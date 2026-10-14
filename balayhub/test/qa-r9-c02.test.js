'use strict';
// QA round 9, lane C02 (reservations and refunds views, frontend only, no database).
// #1: the guest balance already counts refunds (server, C01), so the screen never subtracts them a second time;
//     a refund that would leave money owed is asked first. #2 lost Save click, #3 source, #4 edit quote, #5 guests text, #48 filters.
// node --test --test-concurrency=1 test/qa-r9-c02.test.js

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
const peso = (n) => `₱${Number(n).toFixed(2)}`;

test('#1 overpaid is the negative balance (refunds are already in it), never reduced again', () => {
  const overpaid = new Function(`${grab(resSrc, 'overpaid')}\nreturn overpaid;`)();
  assert.equal(overpaid(-400), 400);
  assert.equal(overpaid('-400.00'), 400);
  assert.equal(overpaid(0), 0);
  assert.equal(overpaid(600), 0);
  assert.doesNotMatch(resSrc, /overpaidAfterRefunds/);
});

test('#1 the payment dialog says "Nothing more is owed" only when the balance is exactly 0', () => {
  const paymentInfo = new Function('peso', `${grab(resSrc, 'overpaid')}\n${grab(resSrc, 'paymentInfo')}\nreturn paymentInfo;`)(peso);
  assert.equal(paymentInfo(0), 'Nothing more is owed on this booking.');
  assert.equal(paymentInfo('0.00'), 'Nothing more is owed on this booking.');
  assert.equal(paymentInfo(-400), 'Guest overpaid by ₱400.00.');
  assert.match(paymentInfo(600, 1000), /^Balance: ₱600\.00 of ₱1000\.00/);
  assert.match(resSrc, /h\('div', \{ class: 'alert alert--info' \}, paymentInfo\(/);
});

test('#1 Record refund asks first when the refund would leave money owed; Cancel returns false and posts nothing', () => {
  const refundOwedAfter = new Function(`${grab(refSrc, 'refundOwedAfter')}\nreturn refundOwedAfter;`)();
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: -400 }, 1000), 600);
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: '-400.00' }, 400), 0);
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: -400 }, 100), 0);
  assert.equal(refundOwedAfter({ status: 'confirmed', balance: 5200 }, 100), 0); // round 10 #1: a booking that already owes is not asked
  assert.equal(refundOwedAfter({ status: 'cancelled', balance: -400 }, 1000), 0);
  assert.match(refSrc, /title: 'Refund more than the overpayment\?'/);
  assert.match(refSrc, /they will owe \$\{peso\(owed\)\}\. Record it\?/); // round 10 #1: new wording names both numbers
  assert.match(refSrc, /confirmText: 'Record refund'/);
  const ask = refSrc.indexOf("title: 'Refund more than the overpayment?'");
  const send = refSrc.indexOf('await post(`/reservations/${reservation.booking_id}/refunds`');
  assert.ok(ask > 0 && ask < send, 'the question comes before the refund is posted');
  assert.ok(refSrc.indexOf('return false;', ask) < send, 'a Cancel returns before posting');
});

test('#2 the rate offer keeps its space once a quote shows: visibility, not hidden', () => {
  const nq = resSrc.slice(resSrc.indexOf('export async function newReservationModal'), resSrc.indexOf('// ---------------------------------------------------------------- list'));
  assert.doesNotMatch(nq, /useRate\.hidden = !offer/);
  assert.doesNotMatch(nq, /useRate\.hidden = true/);
  assert.match(nq, /useRate\.style\.visibility = offer \? '' : 'hidden'/);
  assert.match(nq, /useRate\.disabled = !offer/);
});

test('#3 New reservation asks "Where did they book?" for Direct only and sends it; the detail says "Booked via"', () => {
  assert.match(resSrc, /name: 'source', label: 'Where did they book\?'/);
  assert.match(resSrc, /Other \(walk-in, phone call\)/);
  assert.match(resSrc, /Referral \(friend or past guest\)/);
  assert.match(resSrc, /\[data-field=source\]'\);\n\s+if \(src\) src\.hidden = !direct;/);
  assert.match(resSrc, /if \(data\.channel !== 'direct' \|\| !data\.source\) delete data\.source;/);
  assert.match(resSrc, /h\('dt', null, 'Booked via'\), h\('dd', null, SOURCE_LABEL\[r\.source\] \|\| r\.source\)/);
});

test('#4 the Edit form asks /reservations/quote when dates change and offers the new price without overwriting', () => {
  const ed = resSrc.slice(resSrc.indexOf('const editDetails'), resSrc.indexOf('const cancel = async'));
  assert.match(ed, /get\(`\/reservations\/quote\$\{qs\(\{ unit_id: r\.unit_id/);
  assert.match(ed, /\['check_in', 'check_out'\]\.includes\(e\.target\.name\)/);
  assert.match(ed, /rateOfferText\(/);
  assert.match(ed, /style\.visibility/);
  const click = ed.slice(ed.indexOf("rate.addEventListener('click'"));
  assert.match(click, /accommodation_total\.value = /);
});

test('#5 any bad guest count says "Enter a whole number of guests, 1 or more."', () => {
  const guestsProblem = new Function(`${grab(resSrc, 'guestsProblem')}\nreturn guestsProblem;`)();
  for (const bad of ['', ' ', '0', '-3', '2.5', 'abc']) assert.equal(guestsProblem(bad), 'Enter a whole number of guests, 1 or more.', `"${bad}"`);
  for (const good of ['1', '3', ' 4 ']) assert.equal(guestsProblem(good), null);
});

test('#48 channel and property filters sit under More filters; the view picker and search stay', () => {
  const bar = resSrc.slice(resSrc.indexOf('const bar = filterBar({'), resSrc.indexOf('await load();'));
  const quote = bar.slice(bar.indexOf('quick: ['), bar.indexOf('more: ['));
  assert.doesNotMatch(quote, /name: 'channel'/);
  assert.doesNotMatch(quote, /name: 'property_id'/);
  const more = bar.slice(bar.indexOf('more: ['));
  assert.match(more, /name: 'channel', label: 'Channel'/);
  assert.match(more, /name: 'property_id', label: 'Property'/);
  assert.match(bar, /res-view-select/);
  assert.match(bar, /search: \{ placeholder/);
});

test('D-81 every repeated row button in both files names its row', () => {
  assert.match(refSrc, /'aria-label': `Void refund of /);
  assert.match(resSrc, /'aria-label': `Void payment of /);
  assert.match(resSrc, /'aria-label': `Receipt for /);
});
