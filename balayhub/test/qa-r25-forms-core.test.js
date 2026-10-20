'use strict';

// QA r25 FORMS-CORE: fromLink (INB-3), markRequired (LT-2), msgLabel and the "cannot be negative" wording (OPS-1). Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const SRC = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r25fc-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

let store;
test.beforeEach(() => {
  store = {};
  globalThis.sessionStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
});

const KEY = 'bh-draft:help-new';
const el = (name, value = '', dataset = {}) => ({ name, value, type: 'text', dataset, checked: false });
function formOf(...els) {
  const listeners = {};
  return {
    elements: els,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    fire(t, target) { for (const fn of listeners[t] || []) fn({ target }); },
  };
}

test('fromLink: the link\'s value wins over a stored draft and the old draft value is dropped', () => {
  store[KEY] = JSON.stringify({ subject: 'old', body: 'typed earlier' });
  const subject = el('subject', 'Follow-up on T-1001', { fromLink: '' });
  const body = el('body', '');
  const f = formOf(subject, body);
  ui.persistDraft(f, 'help-new');
  assert.equal(subject.value, 'Follow-up on T-1001');
  assert.equal(body.value, 'typed earlier');
  body.value = 'typed earlier!'; f.fire('input', body);
  assert.deepEqual(JSON.parse(store[KEY]), { body: 'typed earlier!' });
  subject.value = 'Follow-up on T-1001 edited'; f.fire('input', subject);
  assert.equal(JSON.parse(store[KEY]).subject, 'Follow-up on T-1001 edited');
});

test('no fromLink: the draft is restored as today', () => {
  store[KEY] = JSON.stringify({ subject: 'old' });
  const subject = el('subject', 'Follow-up on T-1001');
  ui.persistDraft(formOf(subject), 'help-new');
  assert.equal(subject.value, 'old');
});

test('fromLink with an empty value does not block the draft', () => {
  store[KEY] = JSON.stringify({ subject: 'old' });
  const subject = el('subject', '', { fromLink: '' });
  ui.persistDraft(formOf(subject), 'help-new');
  assert.equal(subject.value, 'old');
});

test('number box: min 0 below zero says cannot be negative; msgLabel is used by makeForm', () => {
  const ctl = (name, value, min) => ({ sel: 'input[type=number]', name, value, disabled: false, min, max: '', closest: () => null, hasAttribute: () => false, getAttribute: () => null });
  const form = (...els) => ({ querySelectorAll: (s) => els.filter((e) => e.sel === s) });
  const label = (e) => ({ par_level: 'Low-stock level', qty: 'Quantity' }[e.name]);
  assert.deepEqual(ui.typeProblems(form(ctl('par_level', '-2', '0')), {}, label), { par_level: 'Low-stock level cannot be negative.' });
  assert.deepEqual(ui.typeProblems(form(ctl('qty', '0', '1')), {}, label), { qty: 'Quantity must be at least 1.' });
  assert.deepEqual(ui.typeProblems(form(ctl('qty', '1.5', '1')), {}, label), { qty: 'Quantity must be a whole number.' });
  assert.match(SRC, /const labelOf = \(el\) => el\.dataset\?\.msgLabel \|\|/);
});

test('field() source: fromLink, markRequired and msgLabel set their attributes; markRequired never sets required', () => {
  assert.match(SRC, /'data-from-link': f\.fromLink \? true : undefined/);
  assert.match(SRC, /'data-msg-label': f\.msgLabel/);
  assert.match(SRC, /'aria-required': f\.markRequired && !f\.required \? 'true' : undefined/);
  assert.match(SRC, /\(f\.required \|\| f\.markRequired\) && h\('span', \{ class: 'req'/);
});
