'use strict';

// Filter bar, QA round 2 (public/js/filters.js). initFilters() now cleans a shared link or a saved filter
// before any list loads, so a page never fetches with a bad value: a backwards date range is not applied,
// an impossible date is dropped (and so is not counted as a filter), and a non-UUID *_id is dropped. The range
// message is written only while the range is actually backwards. Loaded from a temp copy as ES modules with the
// same stand-in DOM as test/qa-r1-filters-daterange.test.js. Frontend-only: no database, no server.
// Covers settings#3, inbox#7 and inbox#8 (client side) and the rbac#6 hardening.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MSG = 'The end date is before the start date.';
const SAVED_KEY = 'bh-filters:1:reservations';
const UUID = '6f1c2e7a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

// Just enough DOM for h(), ui.js and filters.js: elements, text, attributes, listeners.
class Node { }
class Text extends Node { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
class Element extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '' });
  }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, type }); }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = { createElement: (tag) => new Element(tag), createTextNode: (data) => new Text(data) };

const textOf = (node) => (node instanceof Text ? node.data : node.children.map(textOf).join(''));
const walk = (node, pred, out = []) => {
  if (node instanceof Element) {
    if (pred(node)) out.push(node);
    node.children.forEach((c) => walk(c, pred, out));
  }
  return out;
};

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

let dir; let filters;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filters-r2-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); });

const RANGE = { name: 'from', keys: ['from', 'to'], label: 'Check-in between', type: 'daterange' };
const DEFAULTS = { from: '', to: '', property_id: '', unit_id: '' };

// Builds a filter bar with one date range under "More filters" and returns handles to its parts.
function build(values, defaults = DEFAULTS) {
  const calls = { n: 0 };
  const bar = filters.filterBar({ key: 'reservations', values, defaults, more: [RANGE], onChange: () => { calls.n += 1; } });
  const input = (side) => walk(bar, (el) => el.tagName === 'input' && el.getAttribute('aria-label') === `Check-in between ${side}`)[0];
  return {
    bar,
    calls,
    values,
    from: input('from'),
    to: input('to'),
    alert: () => walk(bar, (el) => el.getAttribute('role') === 'alert')[0],
    panel: () => walk(bar, (el) => el.className.split(' ').includes('flt__panel'))[0],
    chips: () => walk(bar, (el) => el.className === 'flt__chips')[0],
  };
}

// What a list page does: initFilters() on the shared link or saved filter, then the bar on the result.
function page(query) {
  const values = filters.initFilters('reservations', query, DEFAULTS);
  return { ...build(values), values };
}

test('a backwards range in a shared link is not applied before the first list load', () => {
  const values = filters.initFilters('reservations', { from: '2027-01-01', to: '2026-01-01' }, DEFAULTS);
  assert.equal(values.from, '');
  assert.equal(values.to, '');
});

test('a backwards range in a saved filter is not applied either', () => {
  store.set(SAVED_KEY, JSON.stringify({ from: '2027-01-01', to: '2026-01-01' }));
  const values = filters.initFilters('reservations', {}, DEFAULTS);
  assert.equal(values.from, '');
  assert.equal(values.to, '');
});

test('the bar shows a backwards shared range with the message and opens, but applies nothing', () => {
  const b = page({ from: '2027-01-01', to: '2026-01-01' });
  assert.equal(b.from.value, '2027-01-01', 'the typed dates stay visible so they can be fixed');
  assert.equal(b.to.value, '2026-01-01');
  assert.equal(b.alert().hidden, false);
  assert.equal(textOf(b.alert()), MSG);
  assert.equal(b.panel().hidden, false, 'the panel opens so the message can be seen');
  assert.equal(textOf(b.chips()), '', 'no chip for a range that is not applied');
  assert.equal(b.values.from, '');
  assert.equal(b.values.to, '');
  assert.equal(b.calls.n, 0);
});

test('fixing a backwards shared range applies it and clears the message', () => {
  const b = page({ from: '2027-01-01', to: '2026-01-01' });
  b.to.value = '2027-06-01';
  b.to.dispatch('change');
  assert.equal(b.values.from, '2027-01-01');
  assert.equal(b.values.to, '2027-06-01');
  assert.equal(b.calls.n, 1);
  assert.equal(b.alert().hidden, true);
  assert.equal(textOf(b.alert()), '');
});

test('the range message is written only while the range is backwards', () => {
  const b = build({ from: '2026-10-01', to: '2026-10-10', property_id: '', unit_id: '' });
  assert.equal(b.alert().hidden, true);
  assert.equal(textOf(b.alert()), '', 'a range that is fine has no message text');

  b.to.value = '2026-09-01';
  b.to.dispatch('change');
  assert.equal(b.alert().hidden, false);
  assert.equal(textOf(b.alert()), MSG);

  b.to.value = '2026-10-10';
  b.to.dispatch('change');
  assert.equal(textOf(b.alert()), '');
});

test('an impossible date is dropped and does not count as an active filter', () => {
  const values = filters.initFilters('reservations', { from: '2026-02-30', to: '2026-13-01' }, DEFAULTS);
  assert.deepEqual(filters.changed(values, DEFAULTS), {}, 'nothing is sent to the server');
  const b = build(values);
  assert.equal(b.panel().hidden, true, 'no active filter, so the panel stays closed');
  assert.equal(walk(b.bar, (el) => el.className === 'flt__count').length, 0, 'More filters shows no count');
  assert.equal(textOf(b.chips()), '');
  assert.equal(b.alert().hidden, true);
});

test('only real calendar dates are kept (leap day yes, 29 February in a non-leap year no)', () => {
  const pick = (v) => filters.initFilters('reservations', { from: v }, DEFAULTS).from;
  assert.equal(pick('2028-02-29'), '2028-02-29');
  assert.equal(pick('2026-10-01'), '2026-10-01');
  assert.equal(pick('2027-02-29'), '');
  assert.equal(pick('2026-04-31'), '');
  assert.equal(pick('2026-00-10'), '');
});

test('a range is checked as a pair: one side on its own is applied', () => {
  const values = filters.initFilters('reservations', { from: '2027-01-01' }, DEFAULTS);
  assert.equal(values.from, '2027-01-01');
  assert.equal(values.to, '');
});

test('the other range pairs (created, out) are checked the same way', () => {
  const defaults = { created_from: '', created_to: '', out_from: '', out_to: '' };
  const values = filters.initFilters('admin', {
    created_from: '2026-05-01', created_to: '2026-04-01', out_from: '2026-01-01', out_to: '2026-02-01',
  }, defaults);
  assert.equal(values.created_from, '');
  assert.equal(values.created_to, '');
  assert.equal(values.out_from, '2026-01-01', 'a valid pair is kept');
  assert.equal(values.out_to, '2026-02-01');
});

test('a non-UUID id is dropped before the first fetch; a UUID id (any case) is kept', () => {
  const values = filters.initFilters('reservations', {
    property_id: "1' OR '1'='1", unit_id: UUID.toUpperCase(),
  }, DEFAULTS);
  assert.equal(values.property_id, '');
  assert.equal(values.unit_id, UUID.toUpperCase());
  assert.equal(filters.initFilters('reservations', { property_id: UUID }, DEFAULTS).property_id, UUID);
});

test('search text is not a date filter, even when it looks like a bad date', () => {
  const values = filters.initFilters('reservations', { q: '2026-02-30', from: '' }, { q: '', from: '' });
  assert.equal(values.q, '2026-02-30');
});
