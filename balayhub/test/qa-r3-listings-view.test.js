'use strict';

// QA round 3, lane C22 (listings-view): the lowest-price question. Add listing and Edit listing both ask
// before they save a lowest price above the usual nightly rate, and Cancel keeps the form open.
// QA round 5, lane C14: the question takes the form and its save label, a cancelled question returns false
// (so the Add draft is kept), and typed prices are read with parseAmount from ui.js.
// Frontend source scan plus the one helper run on its own. listings.js imports app.js (the signed-in user), so the
// file is read as text rather than imported; ui.js is loaded from a temp copy for the real parseAmount.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

// The real ui.js and api.js in a temp folder (ui.js names the DOM Element class at load time; a stub is enough here).
let ui; let dir;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-listings-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', f), path.join(dir, f));
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

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
  assert.match(text, /const floor = parseAmount\(d\.min_price\); const rate = parseAmount\(d\.nightly_rate\);/);
  assert.match(text, /if \(!d\.min_price\) return true;/, 'a blank lowest price saves');
  assert.match(text, /if \(!\(floor > rate\)\) return true;/, 'a lowest price at or below the rate saves');
  assert.match(text, /const ok = Boolean\(await confirmDialog\(\{ title: 'Check the lowest price\?', confirmText: 'Save anyway'/);
  assert.match(text, /return ok;/);
  assert.equal((src.match(/so every night will cost at least/g) || []).length, 1, 'the sentence is written once, in the helper');
});

test('the helper, run on its own, asks only above the nightly rate and reads a cancel as no save', async () => {
  const asked = [];
  let answer = true;
  let labelWhenAsked = null;
  let submit = { textContent: 'Save listing' };
  const confirmDialog = async (opts) => { asked.push(opts); labelWhenAsked = submit.textContent; return answer; };
  const pesoShort = (n) => `₱${Number(n).toLocaleString('en-US')}`;
  const lowPriceOk = new Function('parseAmount', 'confirmDialog', 'pesoShort', `${helper()}\nreturn lowPriceOk;`)(ui.parseAmount, confirmDialog, pesoShort);
  const form = { querySelector: (sel) => (sel === '[type=submit]' ? submit : null) };

  assert.equal(await lowPriceOk({ min_price: '', nightly_rate: '2600' }, form, 'Save listing'), true, 'a blank lowest price saves');
  assert.equal(await lowPriceOk({ min_price: null, nightly_rate: '2600' }, form, 'Save listing'), true, 'a null lowest price saves');
  assert.equal(await lowPriceOk({ min_price: '2600.00', nightly_rate: '2600' }, form, 'Save listing'), true, 'equal to the rate saves');
  assert.equal(await lowPriceOk({ min_price: '2000', nightly_rate: '2600.00' }, form, 'Save listing'), true, 'below the rate saves');
  assert.equal(await lowPriceOk({ min_price: 'abc', nightly_rate: '2600' }, form, 'Save listing'), true, 'an unreadable price is left to the server');
  assert.equal(asked.length, 0, 'no question for any of those');

  assert.equal(await lowPriceOk({ min_price: '5,000', nightly_rate: '2600.00' }, form, 'Save changes'), true, 'confirmed saves');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, 'Check the lowest price?');
  assert.equal(asked[0].confirmText, 'Save anyway');
  assert.equal(asked[0].text, 'Your lowest price (₱5,000) is above your usual nightly price (₱2,600), so every night will cost at least ₱5,000. Save anyway?');
  assert.equal(labelWhenAsked, 'Save changes', 'the save label shows while the question waits');
  assert.equal(submit.textContent, 'Saving…', 'after Save anyway the button reads Saving… again');

  answer = null;
  submit = { textContent: 'Save listing' };
  assert.equal(await lowPriceOk({ min_price: '5000', nightly_rate: '2600' }, form, 'Save listing'), false, 'a cancelled question saves nothing');
  assert.equal(labelWhenAsked, 'Save listing', 'the Add label shows while the question waits');
});

test('Edit listing save asks before it saves, and a refused question returns before the save', () => {
  const handler = editHandler();
  assert.match(handler, /onSubmit: async \(d, \{ form \}\) => \{/, 'the Edit save handler takes the form');
  const ask = handler.indexOf("if (!await lowPriceOk(d, form, 'Save changes')) return false;");
  const save = handler.indexOf("await patch(`/units/${l.unit_id}`");
  assert.notEqual(ask, -1, 'the Edit save asks');
  assert.ok(ask < save, 'the question comes before the save');
  assert.match(handler.slice(ask, save), /if \(!await lowPriceOk\(d, form, 'Save changes'\)\) return false;/, 'a cancelled question returns false before the save');
});

test('Cancel on the Edit question keeps the Edit form open with what was typed', () => {
  const handler = editHandler();
  assert.doesNotMatch(handler, /formModal\(/, 'formModal would close the form after a cancelled question');
  assert.match(handler, /const modal = openModal\(\{ title: `Edit \$\{l\.unit_name\}`/);
  assert.match(handler, /cancel: \(\) => modal\.close\(\)/);
});

test('Add listing save asks before it creates a building or a listing', () => {
  const form = addForm();
  const ask = form.indexOf("if (!await lowPriceOk(d, form, 'Save listing')) return false;");
  assert.notEqual(ask, -1, 'the Add save asks');
  assert.match(form, /onSubmit: async \(raw, \{ form \}\) => \{/, 'the Add save handler takes the form');
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
  assert.match(form, /if \(!await lowPriceOk\(d, form, 'Save listing'\)\) return false;/, 'a cancelled question returns false, so makeForm keeps the saved draft');
});

test('the typed prices are read the way the server reads money (peso sign and commas allowed)', () => {
  assert.match(src, /import \{[^}]*\bparseAmount\b[^}]*\} from '\.\.\/ui\.js'/, 'the typed prices are read with parseAmount from ui.js');
  assert.doesNotMatch(src, /^const moneyNumber\b/m, 'the old local comma-stripping reader is gone');
  assert.equal(ui.parseAmount('₱5,000'), 5000);
  assert.equal(ui.parseAmount(' 2,600.00 '), 2600);
  assert.equal(ui.parseAmount('2600'), 2600);
  assert.ok(Number.isNaN(ui.parseAmount('1,5')), '"1,5" is refused, not read as 15');
});

test('the question formats amounts with pesoShort, like the rest of the app', () => {
  assert.match(src, /import \{[^}]*\bpesoShort\b[^}]*\} from '\.\.\/ui\.js'/);
});
