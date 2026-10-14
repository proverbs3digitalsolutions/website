'use strict';

// QA round 7, lane C09 (listings-view). Three fixes on the Listings page:
// #20: each listing photo has alt text with its number, and its Make cover and Delete buttons name the photo.
// #23: a base nightly rate that is unreadable, 0 or negative is refused at the field before the lowest-price question.
// #19 (card): an unpriced listing on a short-term or both workspace says "No nightly rate yet. Edit to add one."
// Frontend-only: no database. Source scans for the markup, plus the rate helpers run on their own.
// node --test --test-concurrency=1 test/qa-r7-c09.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

// The real ui.js and api.js in a temp folder, for the real parseAmount (ui.js names the DOM Element class at load time).
let ui; let dir;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c09-'));
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

const baseRateHelper = () => between('function baseRateError(', 'function checkBaseRate(');
const checkBaseRateFn = () => between('function checkBaseRate(', '// A lowest price above the usual nightly rate');
const addForm = () => between('async function addListingModal(', '// Listing photos for the booking page');
// The Edit listing handler: from loading the unit to the Edit button that starts it.
const editHandler = () => between('const { units } = await get(`/properties/${l.property_id}`)', "}, 'Edit'),");
const photos = () => between('async function photosModal(', '// A failed sync');

test('a base rate must be an amount above zero: 0, negative and unreadable rates are refused, real amounts are not', () => {
  const baseRateError = new Function('parseAmount', `${baseRateHelper()}\nreturn baseRateError;`)(ui.parseAmount);
  const refused = 'Nightly rate must be greater than zero.';
  for (const text of ['-100', '0', '0.00', '-0.01']) assert.equal(baseRateError(text), refused, `"${text}" is refused`);
  // QA round 8 (#19): an unreadable rate has its own sentence; the zero and negative sentence stays for real numbers.
  for (const text of ['abc', '1,5']) assert.equal(baseRateError(text), 'Nightly rate must be a valid amount (e.g. 8500 or 8500.50).', `"${text}" is unreadable`);
  for (const text of ['2500', '2,500', '₱2,500.50', ' 2500 ']) assert.equal(baseRateError(text), null, `"${text}" is fine`);
});

test('the listing save refuses a bad base rate on the field, through the same field error the discount order uses', () => {
  class ApiError extends Error { constructor(message, { status, fields }) { super(message); this.status = status; this.fields = fields; } }
  const checkBaseRate = new Function('parseAmount', 'ApiError', `${baseRateHelper()}\n${checkBaseRateFn()}\nreturn checkBaseRate;`)(ui.parseAmount, ApiError);
  assert.throws(() => checkBaseRate({ nightly_rate: '-100' }), (err) => err.status === 400
    && err.message === 'Please check the highlighted fields.'
    && err.fields.nightly_rate === 'Nightly rate must be greater than zero.');
  assert.throws(() => checkBaseRate({ nightly_rate: 'abc' }), (err) => err.fields.nightly_rate === 'Nightly rate must be a valid amount (e.g. 8500 or 8500.50).');
  assert.doesNotThrow(() => checkBaseRate({ nightly_rate: '2500' }));
});

test('the base rate is checked before the lowest-price question, in both the Add and the Edit save', () => {
  assert.equal(src.match(/checkBaseRate\(d\);/g)?.length, 2, 'the add and the edit form both check the rate');
  const ask = "if (!await lowPriceOk(d, form, 'Save listing')) return false;";
  const add = addForm();
  assert.ok(add.indexOf('checkBaseRate(d);') !== -1 && add.indexOf('checkBaseRate(d);') < add.indexOf(ask), 'Add listing: the rate is checked before the question');
  const edit = editHandler();
  const askEdit = "if (!await lowPriceOk(d, form, 'Save changes')) return false;";
  assert.ok(edit.indexOf('checkBaseRate(d);') !== -1 && edit.indexOf('checkBaseRate(d);') < edit.indexOf(askEdit), 'Edit listing: the rate is checked before the question');
});

test('each listing photo has alt text with its number, and its two buttons name the photo they act on', () => {
  const text = photos();
  assert.match(text, /alt: `\$\{listing\.unit_name\}, photo \$\{i \+ 1\} of \$\{photos\.length\}`/, 'the alt text names the listing, the photo number and the total');
  assert.doesNotMatch(text, /alt: ''/, 'no empty alt text');
  assert.match(text, /'aria-label': `Make cover, photo \$\{i \+ 1\}`/, 'Make cover names its photo, visible words first');
  assert.match(text, /'aria-label': `Delete, photo \$\{i \+ 1\}`/, 'Delete names its photo, visible word first');
});

test('an unpriced listing card says the rate is missing, with the edit hint only for people who can edit, and a dash on a long-term workspace', () => {
  assert.match(src, /const unpricedNote = state\.user\.business_type === 'long_term' \? null : \(canManage \? 'No nightly rate yet\. Edit to add one\.' : 'No nightly rate yet\.'\);/);
  assert.match(src, /h\('dd', null, l\.nightly_rate \? peso\(l\.nightly_rate\) : \(unpricedNote \|\| '—'\)\)/);
});

test('each repeated per-card button names its listing, with the visible word first', () => {
  assert.match(src, /'aria-label': `Edit, \$\{l\.unit_name\}`/, 'Edit');
  assert.match(src, /'aria-label': `Photos, \$\{l\.unit_name\}`/, 'Photos');
  assert.match(src, /'aria-label': `Channels, \$\{l\.unit_name\}`/, 'Channels');
  assert.match(src, /'aria-label': `Guest pages, \$\{l\.unit_name\}`/, 'Guest pages');
  assert.match(src, /'aria-label': `\$\{l\.cleaning_status === 'dirty' \? 'Mark clean' : 'Mark dirty'\}, \$\{l\.unit_name\}`/, 'Mark clean or Mark dirty');
});
