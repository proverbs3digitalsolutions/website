'use strict';

// QA round 13, lane F12 (listings view). Frontend only, no database.
// #38: a blank cleaning fee is explained (the "e.g. 500" placeholder and a hint), and a 0 fee reads "No cleaning fee" on the card.
// #39: after the building saves and the listing does not, the saved building is named in a line above the listing fields.
// #40: a live line under the payment fields says what a guest pays now and later (payNowLine, a pure helper).
// #41: the channel link field is labelled in plain words, with a hint that says where to find the link.
// #47: the description placeholder is short enough to fit a phone.
// K7c: the guests list passes one argument to apiFilters.
// listings.js imports the signed-in user from app.js, which does not load in Node, so the helper is copied out as text
// and run on its own, and the rest are source scans.
// node --test --test-concurrency=1 test/qa-r13-f12.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

// Text from a start marker up to the first end marker after it.
function between(startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `found the end after: ${startMarker}`);
  return src.slice(start, end);
}

// payNowLine, from its export to the first column-0 closing brace, run as a plain function.
function loadPayNowLine() {
  const start = src.indexOf('export function payNowLine(');
  assert.notEqual(start, -1, 'payNowLine is an exported function in listings.js');
  const end = src.indexOf('\n}\n', start);
  assert.notEqual(end, -1, 'payNowLine ends at a column-0 closing brace');
  return new Function(`${src.slice(start, end + 3).replace('export function', 'function')}\nreturn payNowLine;`)();
}

const addForm = () => between('async function addListingModal(', '// Listing photos for the booking page');
const paymentGroup = () => between("h('summary', null, 'Booking page and payments')", "h('summary', null, 'Booking rules')");

// ---- #40: the sentence says what a guest pays

test('#40 payNowLine says the deposit and the balance in plain words, for each payment option', () => {
  const payNowLine = loadPayNowLine();
  assert.equal(payNowLine({ payment_option: 'either', deposit_pct: 50, balance_due_days: 3 }),
    'A guest pays 50% or the full amount when booking, and any balance 3 days before check-in.');
  assert.equal(payNowLine({ payment_option: 'either', deposit_pct: 50, balance_due_days: 1 }),
    'A guest pays 50% or the full amount when booking, and any balance 1 day before check-in.');
  assert.equal(payNowLine({ payment_option: 'deposit', deposit_pct: 50, balance_due_days: 3 }),
    'A guest pays 50% when booking and the rest 3 days before check-in.');
  assert.equal(payNowLine({ payment_option: 'deposit', deposit_pct: '30', balance_due_days: 1 }),
    'A guest pays 30% when booking and the rest 1 day before check-in.');
  assert.equal(payNowLine({ payment_option: 'full', deposit_pct: 50, balance_due_days: 3 }),
    'A guest pays the full amount when booking.');
});

test('#40 payNowLine shows nothing while a number is blank or outside the 10 to 90 range (the field asks for it)', () => {
  const payNowLine = loadPayNowLine();
  assert.equal(payNowLine({ payment_option: 'either', deposit_pct: '', balance_due_days: 3 }), '');
  assert.equal(payNowLine({ payment_option: 'either', deposit_pct: 5, balance_due_days: 3 }), '');
  assert.equal(payNowLine({ payment_option: 'either', deposit_pct: 91, balance_due_days: 3 }), '');
});

test('#40 the payment fields sit in one box that refreshes the line on input and change, and the line is set on load', () => {
  const group = paymentGroup();
  assert.match(src, /^export function payNowLine\(/m, 'exported');
  assert.match(group, /h\('div', \{ class: 'stack', oninput: paintPayLine, onchange: paintPayLine \}/, 'the box listens for input and change');
  for (const name of ['payment_option', 'deposit_pct', 'balance_due_days']) {
    assert.match(group, new RegExp(`field\\(\\{ name: '${name}'`), `${name} is still a field in the group`);
  }
  assert.ok(group.indexOf('payLine)') > group.indexOf("name: 'balance_due_days'"), 'the line sits under the payment fields');
  const paint = between('const paintPayLine = () => {', '};');
  assert.match(paint, /payLine\.parentElement/, 'the values are read from the box the line sits in');
  assert.match(paint, /payNowLine\(\{ payment_option: box\.querySelector\('\[name=payment_option\]'\)\.value, deposit_pct: box\.querySelector\('\[name=deposit_pct\]'\)\.value, balance_due_days: box\.querySelector\('\[name=balance_due_days\]'\)\.value \}\)/);
  assert.match(src, /queueMicrotask\(paintPayLine\);\s*return fields;/, 'the line is read again once the form is in place, so a restored draft and a new listing show their own values');
});

// ---- #38: the cleaning fee is explained, and a 0 fee reads plainly

test('#38 the cleaning fee box shows "e.g. 500" and says a blank fee is fine', () => {
  assert.match(src, /name: 'cleaning_fee', label: 'Cleaning fee per stay', type: 'money', value: u\.cleaning_fee, placeholder: 'e\.g\. 500', hint: "Leave blank if you don't charge a cleaning fee\." \}\)/);
  assert.doesNotMatch(src, /placeholder: '500' \}\)/, 'the bare grey 500 that looked like a value is gone');
});

test('#38 the listing card says "No cleaning fee" for a 0 fee and shows the amount otherwise', () => {
  assert.match(src, /h\('dt', null, 'Cleaning fee'\), h\('dd', null, Number\(l\.cleaning_fee\) > 0 \? peso\(l\.cleaning_fee\) : 'No cleaning fee'\)/);
});

// ---- #39: the saved building stays named while the listing is retried

test('#39 once the building saves, a read-only line names it above the listing fields', () => {
  const add = addForm();
  assert.match(add, /const savedLine = h\('p', \{ class: 'muted small', hidden: true \}\);/, 'the line starts hidden');
  assert.match(add, /fields: \[savedLine, \.\.\.listingFields\(\{\}, roomTypes, newPropMore, \[h\('hr', \{ class: 'divider' \}\), propSelect, newProp\]\)\]/,
    'the line is the first field, above the listing name');
  const saved = add.indexOf('savedPropertyId = res.property.property_id;');
  const line = add.indexOf('savedLine.textContent = `Building: ${d.property_name} (saved)`; savedLine.hidden = false;');
  assert.notEqual(line, -1, 'the line reads "Building: <name> (saved)" and is shown');
  assert.ok(saved < line, 'shown right after the building is saved');
  assert.ok(line < add.indexOf('await post(`/properties/${propertyId}/units`'), 'shown before the listing save is tried');
});

// ---- #41: the calendar link field in plain words

test('#41 the calendar link field is labelled "(ends in .ics)" and says where to find the link', () => {
  assert.match(src, /field\(\{ name: 'url', label: 'Calendar link from Airbnb, Booking\.com or Agoda \(ends in \.ics\)', type: 'url', placeholder: 'https:\/\/www\.airbnb\.com\/calendar\/ical\/…', hint: 'In Airbnb or Booking\.com, look for Export calendar or Sync calendars and copy the link that ends in \.ics\.' \}\)/);
  assert.doesNotMatch(src, /Agoda \(iCal\)/, 'the old label is gone');
});

// ---- #47: the description placeholder fits a phone

test('#47 the description placeholder is the short example', () => {
  assert.match(src, /placeholder: 'e\.g\. Bright studio with a balcony' \}\)/);
  assert.doesNotMatch(src, /Bright studio with a balcony and city view/, 'the long example is gone');
});

// ---- K7c: apiFilters takes one argument

test('K7c no apiFilters call in listings.js passes a second argument', () => {
  assert.doesNotMatch(src, /apiFilters\([^()]*,/);
  assert.match(src, /get\(`\/guests\$\{qs\(apiFilters\(filters\)\)\}`\)/);
});
