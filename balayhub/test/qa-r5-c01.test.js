'use strict';
// QA round 5, lane C01 (reservation and group forms, frontend only).
// #1/#22/X1: a suggested price never replaces money the host typed, and is never written for a room type
//            (the server picks the listing later). #4 count wording, #23 overpaid sentence, #27 saving basis,
//            #47 real link in the Check-in cell, D-80 Check-out and Listing show on phone cards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
const grpSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/groups.js'), 'utf8');
const grab = (name) => resSrc.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
// offerRate reads the typed box with parseAmount from ui.js (QA round 6, C05), so that function and its two patterns come from ui.js too.
const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/ui.js'), 'utf8');
const uiConst = (name) => uiSrc.match(new RegExp(`const ${name} = [^\\n]*;\\n`))[0];
const uiGrab = (name) => uiSrc.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
const parseAmount = new Function(`${uiConst('MONEY_RE')}${uiConst('MONEY_COMMA_RE')}${uiGrab('parseAmount')}\nreturn parseAmount;`)();
const { boxValue, offerRate } = new Function('parseAmount', `${grab('boxValue')}\n${grab('offerRate')}\nreturn { boxValue, offerRate };`)(parseAmount);

test('a typed box keeps what was typed, whatever the suggestion is', () => {
  assert.equal(boxValue({ typed: true, mode: 'unit', suggestion: '2500.00', current: '9000' }), '9000');
  assert.equal(boxValue({ typed: true, mode: 'type', suggestion: '2500.00', current: '9000' }), '9000');
  assert.equal(boxValue({ typed: true, mode: 'unit', suggestion: null, current: '9000' }), '9000');
});
test('an untouched box takes the suggestion for a specific listing', () => {
  assert.equal(boxValue({ typed: false, mode: 'unit', suggestion: '2500.00', current: '1000' }), '2500.00');
});
test('an untouched box is never filled for a room type, and an old suggestion is emptied', () => {
  assert.equal(boxValue({ typed: false, mode: 'type', suggestion: '2800.00', current: '' }), '');
  assert.equal(boxValue({ typed: false, mode: 'type', suggestion: '2800.00', current: '2800.00' }), '');
});
test('a failed or incomplete quote empties an untouched box that holds an old suggestion', () => {
  assert.equal(boxValue({ typed: false, mode: 'unit', suggestion: null, current: '2800.00' }), '');
});
test('the rate button is offered only for a typed box that differs from a specific listing quote', () => {
  assert.equal(offerRate({ typed: true, mode: 'unit', suggestion: '6300.00', current: '9000' }), true);
  assert.equal(offerRate({ typed: true, mode: 'unit', suggestion: '6300.00', current: '6300' }), false);
  assert.equal(offerRate({ typed: false, mode: 'unit', suggestion: '6300.00', current: '9000' }), false);
  assert.equal(offerRate({ typed: true, mode: 'type', suggestion: '6300.00', current: '9000' }), false);
  assert.equal(offerRate({ typed: true, mode: 'unit', suggestion: null, current: '9000' }), false);
});

test('New reservation: refreshQuote no longer writes the money boxes directly', () => {
  const rq = resSrc.slice(resSrc.indexOf('async function refreshQuote'), resSrc.indexOf("form.addEventListener('change', refreshQuote)"));
  assert.doesNotMatch(rq, /form\.elements\.accommodation_total\.value = q\./);
  assert.doesNotMatch(rq, /form\.elements\.cleaning_fee\.value = q\./);
  assert.match(rq, /applyQuote\(q\)/);
  assert.match(resSrc, /boxValue\(/);
  assert.match(resSrc, /typed\[e\.target\.name\] = e\.target\.value\.trim\(\) !== ''/);
  assert.match(resSrc, /Use \$\{parts\.join\(' \+ '\)\} from your rates/);
  assert.match(resSrc, /Each room is priced from the listing BalayHub picks/);
});

test('groups: separate typed flags, boxValue used, no direct write of a quote', () => {
  assert.match(grpSrc, /import \{[^}]*boxValue[^}]*\} from '\.\/reservations\.js'/);
  assert.match(grpSrc, /priceEdited/);
  assert.match(grpSrc, /cleaningEdited/);
  assert.match(grpSrc, /cleaning\.addEventListener\('input', \(\) => \{ cleaningEdited = /);
  const sg = grpSrc.slice(grpSrc.indexOf('async function suggest'), grpSrc.indexOf("mode.addEventListener('change'"));
  assert.doesNotMatch(sg, /price\.value = q\./);
  assert.doesNotMatch(sg, /cleaning\.value = q\./);
  assert.doesNotMatch(sg, /!priceEdited\) cleaning/);
  assert.match(sg, /boxValue\(/);
  assert.match(grpSrc, /Each room is priced from the listing BalayHub picks/);
});

test('#4 a bad group count says whole number', () => {
  assert.match(grpSrc, /Count must be a whole number from 1 to 20\./);
  assert.doesNotMatch(grpSrc, /Count must be between 1 and 20/);
});

test('#23 the overpaid sentence shows only while something is still owed back', () => {
  assert.match(resSrc, /overpaidAfterRefunds\(r\.balance, heldInfo\?\.refunded\) > 0/);
});

test('#27 the saving estimate uses the same amount as You keep', () => {
  assert.match(resSrc, /const feeSaved = r\.channel === 'direct' \? Math\.round\(keep \* 15\) \/ 100 : 0/);
  assert.match(resSrc, /saved vs a 15% channel fee on this stay's total/);
});

test('#47 the Check-in cell is a real link and the row is not a tab stop', () => {
  const body = resSrc.slice(resSrc.indexOf("h('tbody', null, reservations.map"), resSrc.indexOf('viewSelect.addEventListener'));
  assert.doesNotMatch(body, /tabindex: 0/);
  assert.doesNotMatch(body, /onkeydown/);
  assert.match(body, /h\('a', \{ href: `#\/reservations\/\$\{r\.booking_id\}` \}, fmtDate\(r\.check_in\)\)/);
  assert.match(body, /onclick: \(\) => navigate\(/);
});

test('D-80 Check-out and Listing show on phone cards; Channel and Code stay hidden', () => {
  const head = resSrc.slice(resSrc.indexOf("h('thead'"), resSrc.indexOf("h('tbody', null, reservations"));
  assert.doesNotMatch(head, /col-sm-hide' \}, 'Check-out'/);
  assert.doesNotMatch(head, /col-sm-hide' \}, 'Listing'/);
  assert.match(head, /col-sm-hide' \}, 'Channel'/);
  assert.match(head, /col-sm-hide' \}, 'Code'/);
});
