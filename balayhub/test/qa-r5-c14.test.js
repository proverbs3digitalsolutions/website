'use strict';

// QA round 5, lane C14 (listings-view). Two fixes in the Add and Edit listing forms:
// #13: Cancel on "Check the lowest price?" keeps the form's saved draft (the save returns false), and the
//      save button shows its own label while the question waits, not "Saving…".
// #26: typed prices are read with parseAmount from ui.js, the same rule the server uses, not a local regex.
// Frontend-only: no database. A source scan, plus a run of the price question on its own.
// node --test --test-concurrency=1 test/qa-r5-c14.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

// The price question's function, from its header to the closing brace at the start of a line.
function lowPriceOkSource() {
  const m = src.match(/^async function lowPriceOk\([\s\S]*?^}$/m);
  assert.ok(m, 'lowPriceOk is one function');
  return m[0];
}

test('Cancel on the price question returns false from both save handlers, so the Add draft is kept', () => {
  const refusals = src.match(/if \(!await lowPriceOk\([^)]*\)\) return false;/g) || [];
  assert.equal(refusals.length, 2, 'Add listing and Edit listing both return false when the question is cancelled');
  assert.doesNotMatch(src, /lowPriceOk\([^)]*\)\) return;/, 'no bare return after the question');
});

test('the save handlers take their form and pass their own save label to the question', () => {
  assert.match(src, /onSubmit: async \(raw, \{ form \}\) => \{/, 'Add listing gets the form');
  assert.match(src, /onSubmit: async \(d, \{ form \}\) => \{/, 'Edit listing gets the form');
  assert.match(src, /lowPriceOk\(d, form, 'Save listing'\)/, 'Add passes "Save listing"');
  assert.match(src, /lowPriceOk\(d, form, 'Save changes'\)/, 'Edit passes "Save changes"');
});

test('the save label goes back before the question asks, and "Saving…" comes back only after Save anyway', () => {
  const fn = lowPriceOkSource();
  const back = fn.indexOf('textContent = saveText');
  const ask = fn.indexOf('confirmDialog(');
  const saving = fn.indexOf("textContent = 'Saving…'");
  assert.notEqual(back, -1, 'the save label is put back');
  assert.notEqual(saving, -1, '"Saving…" is set again after Save anyway');
  assert.ok(back < ask, 'the label is restored before the question');
  assert.ok(ask < saving, '"Saving…" only after the question is confirmed');
});

test('typed prices are read with parseAmount from ui.js, not a local comma-stripping regex', () => {
  assert.match(src, /import \{[^}]*\bparseAmount\b[^}]*\} from '\.\.\/ui\.js'/, 'parseAmount is imported from ui.js');
  assert.equal(src.includes('replace(/[₱,\\s]/g'), false, 'the old local money read is gone');
  assert.doesNotMatch(src, /const moneyNumber\b/, 'the local money helper is gone');
  const fn = lowPriceOkSource();
  assert.match(fn, /parseAmount\(d\.min_price\)/, 'the lowest price is read with parseAmount');
  assert.match(fn, /parseAmount\(d\.nightly_rate\)/, 'the nightly rate is read with parseAmount');
});

test('run on its own: a cancelled question saves nothing, and the label is the save label while it waits', async () => {
  // parseAmount and pesoShort come from ui.js in the app; these stand-ins read the same plain amounts.
  const parseAmount = (v) => Number(String(v ?? '').replace(/,/g, ''));
  const pesoShort = (n) => `₱${Number(n).toLocaleString('en-US')}`;
  let answer;
  let submit = { textContent: 'Saving…' };
  let labelWhenAsked = null;
  const asked = [];
  const confirmDialog = async (opts) => { asked.push(opts); labelWhenAsked = submit.textContent; return answer; };
  const lowPriceOk = new Function('parseAmount', 'confirmDialog', 'pesoShort', `${lowPriceOkSource()}\nreturn lowPriceOk;`)(parseAmount, confirmDialog, pesoShort);
  const form = { querySelector: (sel) => (sel === '[type=submit]' ? submit : null) };

  assert.equal(await lowPriceOk({ min_price: '2000', nightly_rate: '2600' }, form, 'Save listing'), true, 'a lowest price below the rate saves');
  assert.equal(asked.length, 0, 'no question for that one');
  assert.equal(submit.textContent, 'Saving…', 'the label is left as makeForm set it when nothing is asked');

  answer = undefined;
  assert.equal(await lowPriceOk({ min_price: '5,000', nightly_rate: '2,600' }, form, 'Save listing'), false, 'a cancelled question saves nothing');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, 'Check the lowest price?');
  assert.equal(labelWhenAsked, 'Save listing', 'the save label shows while the question waits');

  submit = { textContent: 'Saving…' };
  answer = true;
  assert.equal(await lowPriceOk({ min_price: '5,000', nightly_rate: '2,600' }, form, 'Save changes'), true, 'confirmed saves');
  assert.equal(labelWhenAsked, 'Save changes', 'the question is asked with the save label');
  assert.equal(submit.textContent, 'Saving…', 'after Save anyway the label reads "Saving…" again');
});
