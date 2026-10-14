'use strict';

// Filter bar, QA round 9 (public/js/filters.js), K13. A value the bar refuses (unknown option, date outside 2000 to
// 2100) is also removed from the address; a half-typed year in a date box is not applied. Frontend-only: no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

class Node { }
class Text extends Node { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
class Element extends Node {
  constructor(tag) { super(); Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '' }); }
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
const walk = (node, pred, out = []) => {
  if (node instanceof Element) { if (pred(node)) out.push(node); node.children.forEach((c) => walk(c, pred, out)); }
  return out;
};
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
const replaced = [];
globalThis.location = { hash: '' };
globalThis.history = { replaceState: (s, t, url) => { replaced.push(url); globalThis.location.hash = url; } };

let dir; let filters;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filters-r9-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); replaced.length = 0; location.hash = ''; });

test('initFilters drops dates outside 2000 to 2100 and keeps 2000-01-01', () => {
  location.hash = '#/reservations?from=1900-01-01&to=2200-01-01&q=x';
  const d = { from: '', to: '', q: '' };
  const f = filters.initFilters('reservations', { from: '1900-01-01', to: '2200-01-01', q: 'x' }, d);
  assert.equal(f.from, ''); assert.equal(f.to, ''); assert.equal(f.q, 'x');
  assert.equal(location.hash, '#/reservations?q=x', 'the address loses the dropped dates and keeps the rest');
  assert.equal(filters.initFilters('reservations', { from: '2000-01-01' }, d).from, '2000-01-01');
  assert.equal(filters.initFilters('reservations', { to: '2100-12-31' }, d).to, '2100-12-31');
});

test('filterBar dropping an unknown option rewrites the address without that key only', () => {
  location.hash = '#/x?rating=9&q=hi';
  const defaults = { rating: '', q: '' };
  const values = { rating: '9', q: 'hi' };
  filters.filterBar({ key: 'x', values, defaults, quick: [{ name: 'rating', label: 'Rating', options: [['5', 'Five']] }], onChange() {} });
  assert.equal(values.rating, '');
  assert.deepEqual(replaced, ['#/x?q=hi']);
});

test('a key that is not in the address causes no rewrite', () => {
  location.hash = '#/x';
  const values = { rating: '9' };
  filters.filterBar({ key: 'x', values, defaults: { rating: '' }, quick: [{ name: 'rating', label: 'Rating', options: [['5', 'Five']] }], onChange() {} });
  assert.deepEqual(replaced, []);
});

test('the date-range control does not emit for a half-typed year', () => {
  const values = { from: '', to: '' };
  let n = 0;
  const bar = filters.filterBar({ key: 'x', values, defaults: { from: '', to: '' }, more: [{ name: 'from', keys: ['from', 'to'], label: 'Between', type: 'daterange' }], onChange: () => { n += 1; } });
  const from = walk(bar, (el) => el.tagName === 'input' && el.getAttribute('aria-label') === 'Between, from')[0];
  from.value = '0202-01-01'; from.dispatch('change');
  assert.equal(n, 0); assert.equal(values.from, '');
  from.value = '2026-01-01'; from.dispatch('change');
  assert.equal(n, 1); assert.equal(values.from, '2026-01-01');
});
