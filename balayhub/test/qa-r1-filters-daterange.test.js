'use strict';

// Shared date-range control in the filter bar (public/js/filters.js), loaded from a temp copy
// as ES modules with a small stand-in for the DOM. Frontend-only: no database, no server.
// Bug #86: a backwards range (end before start) was applied, so every list said "No results found".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MSG = 'The end date is before the start date. This date filter is off until you fix it.';
const SAVED_KEY = 'bh-filters:1:reservations';

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-daterange-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); });

const RANGE = { name: 'from', keys: ['from', 'to'], label: 'Check-in between', type: 'daterange' };
const DEFAULTS = { from: '', to: '' };

// Builds a filter bar with one date range under "More filters" and returns handles to its parts.
function build(values) {
  const calls = { n: 0 };
  const bar = filters.filterBar({ key: 'reservations', values, defaults: DEFAULTS, more: [RANGE], onChange: () => { calls.n += 1; } });
  const input = (side) => walk(bar, (el) => el.tagName === 'input' && el.getAttribute('aria-label') === `Check-in between, ${side}`)[0];
  return {
    bar,
    calls,
    values,
    from: input('from'),
    to: input('to'),
    alert: () => walk(bar, (el) => el.getAttribute('role') === 'alert')[0],
    panel: () => walk(bar, (el) => el.className.split(' ').includes('flt__panel'))[0],
    chips: () => walk(bar, (el) => el.className === 'flt__chips')[0],
    button: (label) => walk(bar, (el) => el.tagName === 'button' && textOf(el) === label)[0],
  };
}

test('a backwards range typed into the bar is flagged inline and not applied', () => {
  const values = { from: '', to: '' };
  const b = build(values);
  b.from.value = '2026-10-20';
  b.from.dispatch('change');
  assert.equal(b.calls.n, 1, 'a start date on its own is applied');

  b.to.value = '2026-10-10';
  b.to.dispatch('change');
  assert.equal(b.calls.n, 2, 'the list reloads without the backwards range');
  assert.equal(values.from, '', 'the start date that was applied is dropped too');
  assert.equal(values.to, '', 'the end date is not written to the filters');
  assert.equal(JSON.parse(store.get(SAVED_KEY)).to, '', 'the end date is not remembered either');

  assert.equal(b.alert().hidden, false);
  assert.equal(textOf(b.alert()), MSG);
  assert.equal(b.from.getAttribute('aria-invalid'), 'true');
  assert.equal(b.to.getAttribute('aria-invalid'), 'true');
  assert.equal(b.to.getAttribute('aria-describedby'), b.alert().getAttribute('id'), 'the message is tied to the end date input');
});

test('correcting the pair clears the message and applies the range', () => {
  const values = { from: '', to: '' };
  const b = build(values);
  b.from.value = '2026-10-20';
  b.from.dispatch('change');
  b.to.value = '2026-10-10';
  b.to.dispatch('change');

  b.from.value = '2026-10-01';
  b.from.dispatch('change');
  assert.equal(b.calls.n, 3);
  assert.equal(values.from, '2026-10-01');
  assert.equal(values.to, '2026-10-10');
  assert.equal(b.alert().hidden, true);
  assert.equal(b.from.getAttribute('aria-invalid'), null);
  assert.equal(b.to.getAttribute('aria-invalid'), null);
});

test('a range that starts and ends on the same day is valid', () => {
  const values = { from: '', to: '' };
  const b = build(values);
  b.from.value = '2026-10-13';
  b.from.dispatch('change');
  b.to.value = '2026-10-13';
  b.to.dispatch('change');
  assert.equal(b.calls.n, 2);
  assert.equal(values.to, '2026-10-13');
  assert.equal(b.alert().hidden, true);
});

test('a backwards range from a shared link is not applied, and is flagged when the bar opens', () => {
  const values = { from: '2027-01-01', to: '2026-01-01' };
  const b = build(values);
  assert.equal(values.from, '', 'the list is not filtered by the inverted range');
  assert.equal(values.to, '');
  assert.equal(b.from.value, '2027-01-01', 'the typed dates stay visible so they can be fixed');
  assert.equal(b.to.value, '2026-01-01');
  assert.equal(b.alert().hidden, false);
  assert.equal(textOf(b.alert()), MSG);
  assert.equal(b.panel().hidden, false, 'the panel opens so the message can be seen');
  assert.equal(textOf(b.chips()), '', 'no chip for a range that is not applied');
  assert.equal(b.calls.n, 0);
});

test('Reset filters clears a flagged range and its message', () => {
  const values = { from: '', to: '' };
  const b = build(values);
  b.from.value = '2026-10-20';
  b.from.dispatch('change');
  b.to.value = '2026-10-10';
  b.to.dispatch('change');
  assert.equal(b.alert().hidden, false);

  b.button('Reset filters').dispatch('click');
  assert.equal(b.alert().hidden, true);
  assert.equal(b.from.value, '');
  assert.equal(b.to.value, '');
  assert.equal(b.from.getAttribute('aria-invalid'), null);
  assert.equal(b.to.getAttribute('aria-invalid'), null);
});
