'use strict';

// QA r24 FORMS-CORE (BKG-1): a saved draft keeps only what the person typed. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r24draft-'));
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

const KEY = 'bh-draft:reservation-new';
const el = (name, value = '', type = 'text') => ({ name, value, type, dataset: {}, checked: false });
function formOf(...els) {
  const listeners = {};
  return {
    elements: els,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    fire(t, target) { for (const fn of listeners[t] || []) fn({ target }); },
  };
}
const stored = () => JSON.parse(store[KEY]);

test('a box code wrote is not stored; the box the person typed is', () => {
  const unit = el('unit_id', '7'); const total = el('accommodation_total', ''); const guest = el('guest_name', '');
  const f = formOf(unit, total, guest);
  ui.persistDraft(f, 'reservation-new');
  total.value = '8400'; // the quote
  guest.value = 'Ana'; f.fire('input', guest);
  assert.deepEqual(stored(), { guest_name: 'Ana' });
});

test('a box the person typed and code then overwrote drops out', () => {
  const total = el('accommodation_total', ''); const guest = el('guest_name', '');
  const f = formOf(total, guest);
  ui.persistDraft(f, 'reservation-new');
  total.value = '9999'; f.fire('input', total);
  assert.deepEqual(stored(), { accommodation_total: '9999' });
  total.value = '5600'; // the quote, written by code
  guest.value = 'Ana'; f.fire('input', guest);
  assert.deepEqual(stored(), { guest_name: 'Ana' });
});

test('a restored value with no further event stays the person\'s and is kept', () => {
  store[KEY] = JSON.stringify({ accommodation_total: '9999', guest_name: 'Ana' });
  const total = el('accommodation_total', ''); const guest = el('guest_name', ''); const note = el('note', '');
  const f = formOf(total, guest, note);
  ui.persistDraft(f, 'reservation-new');
  assert.equal(total.value, '9999');
  note.value = 'late'; f.fire('input', note);
  assert.deepEqual(stored(), { accommodation_total: '9999', guest_name: 'Ana', note: 'late' });
});

test('the reservation repro: a quote written after restore replaces the restored box, and the next save leaves it out', () => {
  store[KEY] = JSON.stringify({ unit_id: '7', guest_name: 'Ana' });
  const unit = el('unit_id', ''); const total = el('accommodation_total', ''); const guest = el('guest_name', '');
  const f = formOf(unit, total, guest);
  ui.persistDraft(f, 'reservation-new');
  total.value = '5600'; // quote for the new listing
  unit.value = '9'; f.fire('change', unit);
  assert.equal('accommodation_total' in stored(), false);
  assert.deepEqual(stored(), { unit_id: '9', guest_name: 'Ana' });
});

test('a field code wrote that then dispatches input on itself is kept (the listings pattern)', () => {
  const slug = el('slug', '');
  const f = formOf(slug);
  ui.persistDraft(f, 'reservation-new');
  slug.value = 'loft-a'; f.fire('input', slug);
  assert.deepEqual(stored(), { slug: 'loft-a' });
});

test('passwords and files are never stored; checkbox groups count by name', () => {
  const pw = el('password', 'secret', 'password'); const file = el('doc', 'x.png', 'file'); const name = el('name', '');
  const c1 = { name: 'days', type: 'checkbox', value: 'mon', checked: true, dataset: { multi: '1' } };
  const c2 = { name: 'days', type: 'checkbox', value: 'tue', checked: false, dataset: { multi: '1' } };
  const f = formOf(pw, file, name, c1, c2);
  ui.persistDraft(f, 'reservation-new');
  name.value = 'x'; f.fire('input', name);
  pw.value = 'secret2'; f.fire('input', pw);
  c1.checked = true; f.fire('change', c1);
  const s = stored();
  assert.equal('password' in s, false);
  assert.equal('doc' in s, false);
  assert.deepEqual(s.days, ['mon']);
});

test('the returned function clears the draft', () => {
  const a = el('a', ''); const f = formOf(a);
  const clear = ui.persistDraft(f, 'reservation-new');
  a.value = '1'; f.fire('input', a);
  assert.ok(store[KEY]);
  clear();
  assert.equal(store[KEY], undefined);
});
