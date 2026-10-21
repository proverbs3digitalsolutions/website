'use strict';
require('./helpers');

// QA round 5, lane C08 (forms and money reads).
// - parseAmount in public/js/ui.js reads typed money the way the server does (src/lib/validate.js parseMoney).
// - makeForm keeps the draft and formModal keeps the dialog open when onSubmit returns false (nothing saved).
// - a field's message clears when the person changes that field.
// - charges, deposits and quotes read typed money with parseAmount, so "1,5" is never read as 15.
// Frontend-only: no database. ui.js is loaded from a temp copy as an ES module (as qa-r1-frontend-shared.test.js does).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseMoney } = require('../src/lib/validate');

const PUB = path.join(__dirname, '../public/js');
const read = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf8');
// The source text from one marker up to the next (the whole rest of the file when there is no next marker).
const between = (src, start, end) => {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `missing ${start}`);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b > a ? b : undefined);
};

let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c08-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(PUB, f), path.join(dir, f));
  globalThis.Element = class { };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// Twenty-six typed amounts, from clean ones to the ones the server refuses.
const SAMPLES = ['1,000.50', '₱1,250', 'PHP 12,500', 'php 3,000.5', '8500', '8500.50', '1000.5', '0', '-5', '-1,500.00',
  ' 2,000 ', '1,000,000', '1.5', '1.234', '1,5', '1,50', '1,5000', ',500', '1,,000', '1,000.', '12.345', 'abc', '', '₱', '--5', '1e3'];

test('parseAmount reads money like the server: commas only between thousands, ₱ and PHP ignored', () => {
  assert.equal(typeof ui.parseAmount, 'function', 'ui.js exports parseAmount');
  assert.equal(ui.parseAmount('1,000.50'), 1000.5);
  assert.equal(ui.parseAmount('₱1,250'), 1250);
  assert.equal(ui.parseAmount('PHP 12,500'), 12500);
  assert.equal(ui.parseAmount('-5'), -5);
  for (const bad of ['1,5', '1,50', ',500', '1,,000', 'abc', '', '₱']) {
    assert.ok(Number.isNaN(ui.parseAmount(bad)), `"${bad}" is refused`);
  }
});

test('parseAmount gives the same answer as the server parser for every sample', () => {
  for (const s of SAMPLES) {
    const server = parseMoney(s);
    const mine = ui.parseAmount(s);
    if (server === null) assert.ok(Number.isNaN(mine), `"${s}" should be refused`);
    else assert.equal(mine, Number(server), `"${s}" should read as ${server}`);
  }
});

test('makeForm keeps the draft and formModal keeps the dialog open when onSubmit returns false', () => {
  const src = read('ui.js');
  const makeForm = between(src, 'export function makeForm', 'export function formModal');
  // The draft is cleared only after a save. false means nothing was saved, so the draft stays.
  assert.match(makeForm, /const result = await onSubmit\(readForm\(form\), \{ idempotencyKey: idemKey, form \}\);/);
  assert.match(makeForm, /if \(result !== false\) clearDraft\(\);/);
  assert.doesNotMatch(makeForm, /await onSubmit\(readForm\(form\), \{ idempotencyKey: idemKey, form \}\);\s*clearDraft\(\);/);
  // The button label is put back by makeForm's finally, whatever onSubmit returned.
  assert.match(makeForm, /finally \{[\s\S]*submitBtn\.textContent = original;/);
  const formModal = between(src, 'export function formModal', '// Debounced search');
  assert.match(formModal, /const result = await formOpts\.onSubmit\(data, ctx\);/);
  assert.match(formModal, /if \(result !== false\) modal\.close\(\);/);
});

test('a field\'s message clears when the person changes that field; the summary goes once no field is marked', () => {
  const makeForm = between(read('ui.js'), 'export function makeForm', 'export function formModal');
  assert.match(makeForm, /form\.addEventListener\('input', clearFieldError\);/);
  assert.match(makeForm, /form\.addEventListener\('change', clearFieldError\);/);
  const handler = between(makeForm, 'const clearFieldError = (e) => {', 'form.addEventListener(\'input\'');
  assert.match(handler, /classList\.remove\('field--invalid'\)/);
  assert.match(handler, /removeAttribute\('aria-invalid'\)/);
  assert.match(handler, /textContent = ''/);
  assert.match(handler, /if \(!form\.querySelector\('\.field--invalid'\)\)/);
  // Only the summary that names the highlighted fields goes; a server message with no field (say "Dates taken.") stays.
  assert.ok((makeForm.match(/dataset: \{ fieldNote: '' \}|dataset: fieldNote \? \{ fieldNote: '' \} : undefined/g) || []).length >= 2,
    'both field summaries are marked');
});

test('charges, deposits and quotes read typed money with parseAmount, never by stripping commas', () => {
  for (const rel of ['views/charges.js', 'views/deposits.js', 'views/quotes.js']) {
    const src = read(rel);
    assert.match(src, /import \{[^}]*\bparseAmount\b[^}]*\} from '\.\.\/ui\.js';/, `${rel} imports parseAmount`);
    assert.ok(!src.includes("replace(/[₱,\\s]/g"), `${rel} still strips every comma`);
  }
  assert.ok(!read('views/deposits.js').includes("replace(/,/g, '')"), 'deposits still strips every comma');
});

test('charges and deposits show no figure for an amount that cannot be read', () => {
  const chg = read('views/charges.js');
  assert.match(chg, /Number\.isNaN\(unit\) \? '' : `Charge total:/);
  const dep = read('views/deposits.js');
  assert.match(dep, /const typed = raw\.trim\(\) === '' \? 0 : parseAmount\(raw\);/);
  // QA round 7 (C16): the read moved into returnLine(), which gives no figure for an unreadable or negative amount.
  assert.match(dep, /if \(Number\.isNaN\(typed\) \|\| typed < 0\) return '';/);
  assert.match(dep, /refundLine\.textContent = returnLine\(dedInput\.querySelector\('input'\)\.value, dep\);/);
});

test('quotes: a typed amount that cannot be read gives no total; a blank box is 0; a negative stays unreadable', () => {
  const src = read('views/quotes.js');
  const body = between(src, 'const money = (v) => {', '\nconst nightsBetween');
  const money = new Function('parseAmount', `${body}\nreturn money;`)(ui.parseAmount);
  assert.equal(money('1,000.50'), 1000.5);
  assert.equal(money('₱2,500'), 2500);
  assert.equal(money(''), 0);
  assert.equal(money(undefined), 0);
  assert.ok(Number.isNaN(money('1,5')), 'a typed 1,5 is not 15');
  assert.ok(Number.isNaN(money('abc')));
  assert.ok(Number.isNaN(money('-500')), 'a negative amount keeps the "-" total, as before');
});
