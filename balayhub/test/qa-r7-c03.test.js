'use strict';
// QA round 7, lane C03 (reservation and group forms, frontend only, no database).
// #38: a payment over the balance asks first; Cancel posts nothing and sends no receipt.
// #1:  a money box that changes re-checks the "Use ₱X from your rates" offer against the last quote, with no request and no box write.
// #3:  dates set but backwards leave the quote line empty; a missing date still says the price shows once the dates are set.
// #39: Nights and Guests (at least) take whole numbers from 1; any other value is flagged at the field and not applied.
// #2:  a cancelled group reads "Cancelled" in the list with the money its rooms hold; the detail totals add the held money.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
const grpSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/groups.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/ui.js'), 'utf8');
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const uiConst = (name) => uiSrc.match(new RegExp(`const ${name} = [^\\n]*;\\n`))[0];
const uiGrab = (name) => uiSrc.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
// parseAmount (ui.js) reads the typed amount the way the server does; overBalance is built on it.
const parseAmount = new Function(`${uiConst('MONEY_RE')}${uiConst('MONEY_COMMA_RE')}${uiGrab('parseAmount')}\nreturn parseAmount;`)();
const loadOverBalance = () => new Function('parseAmount', `${grab(resSrc, 'overBalance')}\nreturn overBalance;`)(parseAmount);

test('#38 overBalance is the amount above what is owed, 0 when not over; a balance below 0 counts as 0; an unreadable amount is 0', () => {
  const overBalance = loadOverBalance();
  assert.equal(overBalance(5000, 4500), 500);
  assert.equal(overBalance(4500, 4500), 0, 'the exact balance is not over');
  assert.equal(overBalance(100, -200), 100, 'an overpaid booking still owes nothing');
  assert.equal(overBalance('1,5', 4500), 0, '"1,5" is refused, so it is not counted');
  assert.equal(overBalance('6,000', '5500.00'), 500, 'a typed amount with a thousands comma');
});

test('#38 recording a payment over the balance asks first; the post and the receipt come only after a yes', () => {
  const rp = resSrc.slice(resSrc.indexOf('const recordPayment = () => formModal'), resSrc.indexOf('const editDetails'));
  assert.match(rp, /const over = overBalance\(d\.amount, r\.balance\);/);
  assert.match(rp, /const owed = Math\.max\(0, Number\(r\.balance\)\);/);
  assert.match(rp, /confirmDialog\(\{ title: 'Record more than the balance\?', text: `This is \$\{peso\(over\)\} more than the balance of \$\{peso\(owed\)\}\. Record it\?`, confirmText: 'Record it' \}\)/);
  const ask = rp.indexOf('confirmDialog(');
  const stop = rp.indexOf('return false;');
  const send = rp.indexOf('await post(`/reservations/${r.booking_id}/payments`');
  assert.ok(ask > 0 && ask < stop && stop < send, 'a Cancel stops before the payment is posted');
  assert.match(rp, /if \(over > 0 && !await confirmDialog/);
  // QA round 8 #47: Cancel returns false, so makeForm keeps the form open with no "Payment not saved." message.
});

test('#3 a quote still in flight cannot fill the boxes after the dates go empty or backwards', () => {
  // Each invalid-date branch bumps the request counter, so the response of an earlier request (mySeq !== seq) is dropped.
  const body = resSrc.slice(resSrc.indexOf('async function refreshQuote'), resSrc.indexOf("form.addEventListener('change', refreshQuote)"));
  assert.match(body, /if \(!u\) \{ \+\+seq; applyQuote\(null\);/);
  assert.match(body, /if \(!ci \|\| !coNow\) \{ \+\+seq; applyQuote\(null\);/);
  assert.match(body, /if \(coNow <= ci\) \{ \+\+seq; applyQuote\(null\);/);
  assert.match(body, /const mySeq = \+\+seq;/);
  assert.match(body, /if \(mySeq !== seq\) return;/);
  assert.match(body, /if \(mySeq === seq\) \{ applyQuote\(null\);/);
});

test('#1 a money box that changes re-checks the rate offer from the last quote, without a request or a box write', () => {
  const offer = resSrc.slice(resSrc.indexOf('const offerNow'), resSrc.indexOf("useRate.addEventListener('click'"));
  assert.doesNotMatch(offer, /\bget\(/, 'no server request');
  assert.doesNotMatch(offer, /\.value = /, 'no money box is written');
  assert.match(offer, /const offer = MONEY\.some\(\(n\) => offerRate\(\{ typed: typed\[n\], mode, suggestion: sugg\[n\], current: form\.elements\[n\]\.value \}\)\);/);
  assert.match(offer, /useRate\.hidden = !offer;/);
  assert.match(offer, /useRate\.textContent = rateOfferText\(sugg\)/);
  assert.match(resSrc, /form\.addEventListener\('change', \(e\) => \{ if \(MONEY\.includes\(e\.target\.name\)\) offerNow\(\); \}\);/);
});

test('#1 applyQuote writes the boxes and then checks the offer through the same function', () => {
  const aq = resSrc.slice(resSrc.indexOf('const applyQuote'), resSrc.indexOf('const offerNow'));
  assert.match(aq, /box\.value = boxValue\(/);
  assert.match(aq, /offerNow\(\);/);
  assert.doesNotMatch(aq, /useRate\.hidden = !offer;/, 'the offer is computed in one place');
});

test('#3 dates set but backwards leave the quote line empty; a missing date still says the price shows once the dates are set', () => {
  assert.match(resSrc, /if \(!ci \|\| !coNow\) \{ \+\+seq; applyQuote\(null\); quoteBox\.textContent = 'The price shows once the dates are set\.'; return; \}/);
  assert.match(resSrc, /if \(coNow <= ci\) \{ \+\+seq; applyQuote\(null\); quoteBox\.hidden = true; quoteBox\.textContent = ''; return; \}/);
  // The empty box is hidden, so it is not an empty blue strip; every other path shows it again.
  assert.match(resSrc, /if \(e && !\['unit_id', 'check_in', 'check_out', 'pick_mode', 'room_pick'\]\.includes\(e\.target\.name\)\) return;\n    quoteBox\.hidden = false;/);
});

test('#39 Nights and Guests (at least) get a whole-number pattern with the field message, and the pattern matches what the server reads', () => {
  for (const name of ['min_nights', 'min_guests']) {
    const m = resSrc.match(new RegExp(`name: '${name}'[^\\n]*?pattern: (\\/.+?\\/),\\s*patternText: '([^']+)'`));
    assert.ok(m, `${name} has a pattern and patternText`);
    assert.equal(m[2], 'Enter a whole number, 1 or more.');
    const re = new Function(`return ${m[1]};`)();
    for (const bad of ['0', '-1', '1.5', '99999999999', '100', 'abc']) assert.equal(re.test(bad), false, `${name} refuses ${bad}`);
    for (const good of ['1', '2', '12', '99']) assert.equal(re.test(good), true, `${name} accepts ${good}`);
  }
});

test('#2 a cancelled group reads Cancelled in the list, with the money its rooms hold; active rows keep the same cells', () => {
  const row = grpSrc.slice(grpSrc.indexOf('const bal = Number(g.balance)'), grpSrc.indexOf("const bar = filterBar"));
  assert.match(row, /isCancelled\(g\) \? \[h\('span', \{ class: 'muted' \}, 'Cancelled'\)/);
  assert.match(row, /Number\(g\.held\) > 0 \? `\$\{peso\(g\.held\)\} held` : '—'/);
  assert.match(row, /: peso\(g\.total\)\)/, 'an active group still shows its total');
  assert.match(row, /isCancelled\(g\) \? '—' : peso\(bal\)/, 'the balance of a cancelled group stays a dash');
  assert.match(row, /isCancelled\(g\) \? '—' : String\(g\.rooms\)/, 'the rooms cell is unchanged');
});

test('#2 the group detail totals add "Held from cancelled rooms" when there is money held, only for managers', () => {
  assert.match(grpSrc, /canManage && h\('tfoot', null, h\('tr', null,/);
  assert.match(grpSrc, /Number\(totals\.held\) > 0 && h\('tr', null, h\('td', \{ colspan: cancelled \? 6 : 7, class: 'muted' \}, `Held from cancelled rooms \$\{peso\(totals\.held\)\}`\)\)/);
});
