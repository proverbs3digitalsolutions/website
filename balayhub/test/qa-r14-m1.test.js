'use strict';
// QA round 14, lane M1 (money and reports views, frontend only, no database).
// pricing.js: the seasons column reads "Dates" (#31) and the listing name link is a link-tap link (#26).
// addons.js: See Archived is a link-tap link (#26) and the Description field says guests see it as typed (#11).
// guestcare.js: codeDates names only the end that is set (#32).
// stayreports.js: Listing choices follow the property (#27), Download CSV waits for a complete range with reports.js's hint (#28),
//   Record an expense is a link-tap link (#26), and the whole-property row reads "Whole-property expenses" (K2).
// deposits.js: over the cap the return line is empty, because the field already says the sentence (K1).
// node --test --test-concurrency=1 test/qa-r14-m1.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const pricing = read('public/js/views/pricing.js');
const addons = read('public/js/views/addons.js');
const guestcare = read('public/js/views/guestcare.js');
const stayreports = read('public/js/views/stayreports.js');
const deposits = read('public/js/views/deposits.js');
const uiSrc = read('public/js/ui.js');

// The views import browser modules, so pull the pure pieces out of the source and evaluate them (as the other frontend tests do).
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const parseAmount = (v) => Number(String(v).replace(/[₱,\s]/g, ''));
const loadFmtDate = () => {
  const manilaDay = new Function(`${grab(uiSrc, 'manilaDay')}\nreturn manilaDay;`)();
  return new Function('manilaDay', `${grab(uiSrc, 'fmtDate')}\nreturn fmtDate;`)(manilaDay);
};

test('#26 pricing: the listing name link in the rate table is a standalone link-tap link', () => {
  assert.match(pricing, /href: `#\/listings\?focus=\$\{l\.unit_id\}`, class: 'link-tap'/);
});

test('#31 pricing: the seasons column that holds the dates is headed Dates, not Nights', () => {
  assert.match(pricing, /\['Season', 'Dates', 'Listing', 'Price', 'Min\. nights'\]/);
  assert.doesNotMatch(pricing, /'Season', 'Nights'/);
});

test('#26 add-ons: See Archived is a link-tap link', () => {
  assert.match(addons, /h\('a', \{ href: '#\/addons\?status=archived', class: 'link-tap' \}, 'See Archived'\)/);
});

test('#11 add-ons: the Description field tells the host guests see it exactly as typed', () => {
  assert.ok(addons.includes("hint: 'Guests see this description exactly as you type it, on English and Tagalog pages.'"));
});

test('#32 discount codes: codeDates names only the end that is set, and the range when both are', () => {
  const codeDates = new Function('fmtDate', `${grab(guestcare, 'codeDates')}\nreturn codeDates;`)(loadFmtDate());
  assert.equal(codeDates({ valid_from: null, valid_until: '2027-01-31' }), 'Until Jan 31, 2027');
  assert.equal(codeDates({ valid_from: '2027-02-01', valid_until: null }), 'From Feb 1, 2027');
  assert.equal(codeDates({ valid_from: '2026-12-01', valid_until: '2027-01-31' }), 'Dec 1, 2026 – Jan 31, 2027');
  assert.equal(codeDates({ valid_from: null, valid_until: null }), null);
});

test('#32 discount codes: the table reads its dates from codeDates, not from a dash with a blank end', () => {
  assert.match(guestcare, /codeDates\(c\)/);
  assert.doesNotMatch(guestcare, /c\.valid_from \? fmtDate\(c\.valid_from\) : '…'/);
});

test('#27 stay reports: the Listing choices are only the chosen property listings, all of them when no property is chosen', () => {
  const listingsFor = new Function(`${grab(stayreports, 'listingsFor')}\nreturn listingsFor;`)();
  const all = [{ unit_id: 'u1', property_id: 'p1' }, { unit_id: 'u2', property_id: 'p2' }, { unit_id: 'u3', property_id: 'p1' }];
  assert.deepEqual(listingsFor(all, 'p1').map((l) => l.unit_id), ['u1', 'u3']);
  assert.deepEqual(listingsFor(all, 'p2').map((l) => l.unit_id), ['u2']);
  assert.deepEqual(listingsFor(all, '').map((l) => l.unit_id), ['u1', 'u2', 'u3']);
});

test('#27 stay reports: the Listing choices follow the chosen property, and the bar is drawn again when the property changes', () => {
  assert.match(stayreports, /listingsFor\(listings, propertyId\)/);
  assert.match(stayreports, /property_id !== shownFor/);
});

test('#28 stay reports: Download CSV uses reports.js exportHint and is disabled while the range is incomplete', () => {
  assert.match(stayreports, /import \{ exportHint \} from '\.\/reports\.js';/);
  assert.doesNotMatch(stayreports, /(const|function) exportHint\b/);
  assert.match(stayreports, /exportHint\(\{ from: filters\.from, to: filters\.to \}\)/);
  assert.match(stayreports, /aria-disabled/);
});

test('#26 stay reports: Record an expense is a link-tap link', () => {
  assert.match(stayreports, /h\('a', \{ href: '#\/rent\?tab=expenses', class: 'link-tap' \}, 'Record an expense'\)/);
});

test('K2 stay reports: the whole-property row reads Whole-property expenses, without the dues note', () => {
  assert.match(stayreports, /'Whole-property expenses'\)/);
  assert.doesNotMatch(stayreports, /dues etc/);
});

test('K1 deposits: over the cap the return line is empty, and under the cap it still shows the return figure', () => {
  const returnLine = new Function('peso', 'parseAmount', `${grab(deposits, 'returnLine')}\nreturn returnLine;`)(peso, parseAmount);
  assert.equal(returnLine('5000', { amount: '1000' }), '');
  assert.equal(returnLine('400', { amount: '1000.00' }), 'Return to guest: ₱600.00');
});

test('D-81 discount codes: each Turn on / Turn off button names its code, and keeps one focus key across its label change', () => {
  assert.match(guestcare, /'aria-label': `\$\{c\.active \? 'Turn off' : 'Turn on'\} \$\{c\.code\}`/);
  assert.match(guestcare, /'data-focus-key': `dc-toggle-\$\{c\.code_id\}`/);
});
