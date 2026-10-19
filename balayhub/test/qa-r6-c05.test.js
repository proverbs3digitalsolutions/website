'use strict';
// QA round 6, lane C05 (reservation and group forms, frontend only, no database).
// #3 + N3: the "Use ₱X from your rates" button fills only the boxes it offered (from the last quote, never from a rate that is
//          missing), hides itself first, and never offers a box with no suggestion. A typed "1,5" is unreadable, so it is not 15.
// #4:      with no valid dates the quote box says the price shows once the dates are set; the rule stays at the field.
// #5:      a lead guest search with more than 8 matches says how many are shown.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
const grpSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/groups.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/ui.js'), 'utf8');
// The views import browser modules, so pull the pure pieces out of the source and evaluate them.
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// offerRate reads the typed box with parseAmount from ui.js, which needs the two patterns that sit above it in that file.
const loadOfferRate = () => {
  const patterns = ['MONEY_RE', 'MONEY_COMMA_RE'].map((n) => uiSrc.match(new RegExp(`const ${n} = [^\\n]*;\\n`))[0]).join('');
  const parseAmount = new Function(`${patterns}${grab(uiSrc, 'parseAmount')}\nreturn parseAmount;`)();
  return new Function('parseAmount', `${grab(resSrc, 'offerRate')}\nreturn offerRate;`)(parseAmount);
};
const loadRateOfferText = () => new Function('peso', `${grab(resSrc, 'rateOfferText')}\nreturn rateOfferText;`)(peso);

test('#3 a typed box that differs from the listing price is offered the rate, and an unreadable one counts as different', () => {
  const offerRate = loadOfferRate();
  assert.equal(offerRate({ typed: true, mode: 'unit', suggestion: '15.00', current: '1,5' }), true, '"1,5" is unreadable, so it is not 15');
  assert.equal(offerRate({ typed: true, mode: 'unit', suggestion: '1500.00', current: '1,500' }), false, '"1,500" reads as 1500');
  assert.equal(offerRate({ typed: true, mode: 'unit', suggestion: '1500.00', current: '₱1,500.00' }), false, 'a peso sign is ignored');
  assert.equal(offerRate({ typed: true, mode: 'unit', suggestion: null, current: '9000' }), false, 'no suggestion, no offer');
});

test('#3 the offer names only the boxes it fills, so a quote with no nightly rates never says ₱0 for the stay', () => {
  const rateOfferText = loadRateOfferText();
  assert.equal(rateOfferText({ accommodation_total: '2500.00', cleaning_fee: '500.00' }), 'Use ₱2,500.00 + ₱500.00 cleaning from your rates');
  assert.equal(rateOfferText({ accommodation_total: '6300.00', cleaning_fee: '0.00' }), 'Use ₱6,300.00 from your rates');
  assert.equal(rateOfferText({ accommodation_total: null, cleaning_fee: '500.00' }), 'Use ₱500.00 cleaning from your rates');
  assert.equal(rateOfferText({ accommodation_total: null, cleaning_fee: '0.00' }), 'Use ₱0.00 cleaning from your rates');
});

test('#3 the Use click hides first and fills only the boxes it offered, never reading a null rate', () => {
  const click = resSrc.slice(resSrc.indexOf("useRate.addEventListener('click'"), resSrc.indexOf('quoteBox.after(useRate)'));
  assert.doesNotMatch(click, /rate\[/, 'the click must not read the last rate, which is null when rates are missing');
  assert.ok(click.indexOf('useRate.hidden = true') < click.indexOf('for (const n of MONEY)'), 'the button hides before any box is filled');
  assert.match(click, /if \(sugg\[n\] == null\) continue;/);
  assert.match(click, /form\.elements\[n\]\.value = sugg\[n\]; typed\[n\] = false;/);
  assert.doesNotMatch(resSrc, /let rate = null/);
  assert.match(resSrc, /sugg = \{ accommodation_total: q && !q\.missing_rates \? q\.accommodation_total : null, cleaning_fee: q \? q\.cleaning_fee : null \};/);
  assert.match(resSrc, /useRate\.textContent = rateOfferText\(sugg\)/);
});

test('#3 N3 the typed box is read with parseAmount from ui.js, not by stripping commas', () => {
  assert.match(resSrc, /import \{[^}]*\bparseAmount\b[^}]*\} from '\.\.\/ui\.js';/);
  assert.doesNotMatch(grab(resSrc, 'offerRate'), /replace\(/);
});

test('#4 with no valid dates the quote box says the price shows once the dates are set; the rule stays at the field', () => {
  assert.match(resSrc, /quoteBox\.textContent = 'The price shows once the dates are set\.'/);
  assert.equal(resSrc.match(/Check-out must be after check-in\./g).length, 1, 'the rule is said once, in the check hook (field error), never in the quote box');
  assert.match(resSrc, /f\.check_out = 'Check-out must be after check-in\.'/);
});

test('#5 a lead guest search with more than 8 matches says how many are shown', () => {
  const search = grpSrc.slice(grpSrc.indexOf("search.addEventListener('input'"), grpSrc.indexOf('const rowsBox'));
  assert.match(search, /slice\(0, 8\)/);
  assert.match(search, /Showing \$\{shown\.length\} of \$\{guests\.length\}\. Type more to narrow the search\./);
});
