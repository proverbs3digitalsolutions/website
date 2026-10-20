'use strict';

// QA r23 FORMS-CORE: the device pass learns the server's field-type rules (money, whole numbers, phone). Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r23fc-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// Stand-in control: attrs holds min, max, step, data-positive; hidden/disabled mimic a [hidden] ancestor or a disabled box.
const ctl = (sel, name, value, o = {}) => ({
  sel, name, value, disabled: !!o.disabled, min: o.min ?? '', max: o.max ?? '',
  closest: () => (o.hidden ? {} : null),
  hasAttribute: (a) => a === 'data-positive' && !!o.positive,
  getAttribute: (a) => (a === 'step' ? (o.step ?? null) : null),
});
const formOf = (...els) => ({ querySelectorAll: (s) => els.filter((e) => e.sel === s) });
const label = (el) => ({ amount: 'Amount', fee: 'Fee', guests: 'Max guests', phone: 'Phone' }[el.name] || el.name);
const M = '.input-money input';
const N = 'input[type=number]';
const T = 'input[type=tel]';

test('expense shape: a bad amount is named; a bad date is left to the date check', () => {
  const out = ui.typeProblems(formOf(ctl(M, 'amount', '100.555')), {}, label);
  assert.deepEqual(out, { amount: 'Amount must be a valid amount (e.g. 8500 or 8500.50).' });
});

test('blank name (required) and tel abc give both', () => {
  const out = ui.typeProblems(formOf(ctl(T, 'phone', 'abc')), { name: 'Name is required.' }, label);
  assert.deepEqual(out, { phone: 'Enter a valid phone number.' });
  assert.deepEqual(ui.typeProblems(formOf(ctl(T, 'phone', '+63 917 123 4567')), {}, label), {});
});

test('money -5 and number 0 with min=1 give both; zero needs data-positive', () => {
  const out = ui.typeProblems(formOf(ctl(M, 'fee', '-5'), ctl(N, 'guests', '0', { min: '1' })), {}, label);
  assert.deepEqual(out, { fee: 'Fee cannot be negative.', guests: 'Max guests must be at least 1.' });
  assert.deepEqual(ui.typeProblems(formOf(ctl(M, 'amount', '0')), {}, label), {});
  assert.deepEqual(ui.typeProblems(formOf(ctl(M, 'amount', '0', { positive: true })), {}, label), { amount: 'Amount must be greater than zero.' });
});

test('number: step 0.01 accepts 12.5, no step wants a whole number, max is enforced', () => {
  assert.deepEqual(ui.typeProblems(formOf(ctl(N, 'fee', '12.5', { step: '0.01' })), {}, label), {});
  assert.deepEqual(ui.typeProblems(formOf(ctl(N, 'guests', '2.5')), {}, label), { guests: 'Max guests must be a whole number.' });
  assert.deepEqual(ui.typeProblems(formOf(ctl(N, 'guests', '30', { max: '20' })), {}, label), { guests: 'Max guests must be at most 20.' });
});

test('hidden, disabled, empty and already-flagged controls are ignored', () => {
  const f = formOf(ctl(M, 'a', '1.234', { hidden: true }), ctl(M, 'b', 'x', { disabled: true }), ctl(T, 'c', ''), ctl(T, 'd', 'abc'));
  assert.deepEqual(ui.typeProblems(f, { d: 'Phone is required.' }, label), {});
});

test('a view check message on the same field wins (merge keeps the first)', () => {
  const missing = { amount: 'Pick an amount first.' };
  const typed = ui.typeProblems(formOf(ctl(M, 'amount', 'abc')), missing, label);
  assert.deepEqual(typed, {});
  assert.equal(ui.mergeChecks(missing, typed).amount, 'Pick an amount first.');
});

test('makeForm runs typeProblems after the view check, and field() writes data-positive', () => {
  const src = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
  const i = src.indexOf('= typeProblems(form, missing, labelOf)');
  assert.ok(i > src.indexOf('check?.(readForm(form), form)'));
  assert.ok(i < src.indexOf('if (Object.keys(missing).length) {'));
  assert.match(src, /'data-positive'/);
});
