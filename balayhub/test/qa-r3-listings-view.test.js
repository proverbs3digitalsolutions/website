'use strict';

// QA round 3, lane C22 (listings-view): the lowest-price question. Add listing and Edit listing both ask
// before they save a lowest price above the usual nightly rate, and Cancel keeps the form open.
// Frontend source scan only. listings.js imports app.js (the signed-in user), so the file is read as
// text rather than imported; the one helper that matters is run on its own below.
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

const helper = () => between('async function lowPriceOk(', 'const BUILDING_SAVED');
const addForm = () => between('async function addListingModal(', '// Listing photos for the booking page');
// The Edit listing handler: from loading the unit to the Edit button that starts it.
const editHandler = () => between('const { units } = await get(`/properties/${l.property_id}`)', "}, 'Edit'),");

test('one helper asks the lowest-price question, and only when the lowest price is above the nightly rate', () => {
  const text = helper();
  assert.match(text, /Your lowest price \(\$\{pesoShort\(floor\)\}\) is above your usual nightly price \(\$\{pesoShort\(rate\)\}\), so every night will cost at least \$\{pesoShort\(floor\)\}\. Save anyway\?/);
  assert.match(text, /if \(!d\.min_price \|\| !\(floor > rate\)\) return true;/);
  assert.match(text, /return Boolean\(await confirmDialog\(\{ title: 'Check the lowest price\?', confirmText: 'Save anyway'/);
  assert.equal((src.match(/so every night will cost at least/g) || []).length, 1, 'the sentence is written once, in the helper');
});

test('the helper, run on its own, asks only above the nightly rate and reads a cancel as no save', async () => {
  const money = src.match(/^const moneyNumber = .*;$/m);
  assert.ok(money, 'the money reader is a one-line helper');
  const asked = [];
  let answer = true;
  const confirmDialog = async (opts) => { asked.push(opts); return answer; };
  const pesoShort = (n) => `₱${Number(n).toLocaleString('en-US')}`;
  const lowPriceOk = new Function('confirmDialog', 'pesoShort', `${money[0]}\n${helper()}\nreturn lowPriceOk;`)(confirmDialog, pesoShort);

  assert.equal(await lowPriceOk({ min_price: '', nightly_rate: '2600' }), true, 'a blank lowest price saves');
  assert.equal(await lowPriceOk({ min_price: null, nightly_rate: '2600' }), true, 'a null lowest price saves');
  assert.equal(await lowPriceOk({ min_price: '2600.00', nightly_rate: '2600' }), true, 'equal to the rate saves');
  assert.equal(await lowPriceOk({ min_price: '2000', nightly_rate: '2600.00' }), true, 'below the rate saves');
  assert.equal(await lowPriceOk({ min_price: 'abc', nightly_rate: '2600' }), true, 'an unreadable price is left to the server');
  assert.equal(asked.length, 0, 'no question for any of those');

  assert.equal(await lowPriceOk({ min_price: '5,000', nightly_rate: '2600.00' }), true, 'confirmed saves');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, 'Check the lowest price?');
  assert.equal(asked[0].confirmText, 'Save anyway');
  assert.equal(asked[0].text, 'Your lowest price (₱5,000) is above your usual nightly price (₱2,600), so every night will cost at least ₱5,000. Save anyway?');

  answer = null;
  assert.equal(await lowPriceOk({ min_price: '5000', nightly_rate: '2600' }), false, 'a cancelled question saves nothing');
});

test('Edit listing save asks before it saves, and a refused question returns before the save', () => {
  const handler = editHandler();
  const ask = handler.indexOf('if (!await lowPriceOk(d)) return;');
  const save = handler.indexOf("await patch(`/units/${l.unit_id}`");
  assert.notEqual(ask, -1, 'the Edit save asks');
  assert.ok(ask < save, 'the question comes before the save');
  assert.match(handler.slice(ask, save), /if \(!await lowPriceOk\(d\)\) return;/);
});

test('Cancel on the Edit question keeps the Edit form open with what was typed', () => {
  const handler = editHandler();
  assert.doesNotMatch(handler, /formModal\(/, 'formModal would close the form after a cancelled question');
  assert.match(handler, /const modal = openModal\(\{ title: `Edit \$\{l\.unit_name\}`/);
  assert.match(handler, /cancel: \(\) => modal\.close\(\)/);
});

test('Add listing save asks before it creates a building or a listing', () => {
  const form = addForm();
  const ask = form.indexOf('await lowPriceOk(d)');
  assert.notEqual(ask, -1, 'the Add save asks');
  assert.match(form, /if \(!await lowPriceOk\(d\)\) return;/);
  for (const write of ["await post('/properties'", 'await post(`/properties/${propertyId}/units`']) {
    const at = form.indexOf(write);
    assert.notEqual(at, -1, `found ${write}`);
    assert.ok(ask < at, `the question comes before ${write}`);
  }
});

test('Cancel on the Add question keeps the Add form open with its saved draft', () => {
  const form = addForm();
  assert.doesNotMatch(form, /formModal\(/, 'formModal would close the form after a cancelled question');
  assert.match(form, /const modal = openModal\(\{ title: 'Add listing'/);
  assert.match(form, /draftKey: 'listing-new'/);
  assert.match(form, /cancel: \(\) => modal\.close\(\)/);
});

test('the typed prices are read the way the server reads money (peso sign and commas allowed)', () => {
  const line = src.match(/^const moneyNumber = .*;$/m);
  assert.ok(line, 'the money reader is a one-line helper');
  const moneyNumber = new Function(`${line[0]} return moneyNumber;`)();
  assert.equal(moneyNumber('₱5,000'), 5000);
  assert.equal(moneyNumber(' 2,600.00 '), 2600);
  assert.equal(moneyNumber('2600'), 2600);
});

test('the question formats amounts with pesoShort, like the rest of the app', () => {
  assert.match(src, /import \{[^}]*\bpesoShort\b[^}]*\} from '\.\.\/ui\.js'/);
});
