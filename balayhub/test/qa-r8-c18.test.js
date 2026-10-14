'use strict';

// Filter bar, QA round 8 (public/js/filters.js). initFilters trims text (spaces only is the default), and a select
// whose value is not one of its options is reset to its default before the bar draws (no chip, no filtering), unless
// the caller says its options arrive later (keepUnknown). Same stand-in DOM as test/qa-r3-filters.test.js.
// Frontend-only: no database, no server. Covers reviews/owners#37, spaces#4.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');


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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filters-r8-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); });


const OPTS = [['low', '3 stars or less'], ['4', '4 stars']];
const DEF = { q: '', rating: '', sort: '' };
const chips = (bar) => textOf(walk(bar, (el) => el.className === 'flt__chips')[0]);
const bar = (values, field = {}, defaults = DEF) => filters.filterBar({ key: 'reviews', values, defaults, quick: [{ name: 'rating', label: 'Rating', all: 'Any', options: OPTS, ...field }], onChange() {} });

test('initFilters turns a search of spaces into the default and trims other text', () => {
  assert.equal(filters.initFilters('spaces', { q: ' ' }, { q: '' }).q, '');
  assert.equal(filters.initFilters('spaces', { q: '   ', view: 'x' }, { q: '', view: 'upcoming' }).q, '');
  assert.equal(filters.initFilters('spaces', { q: '  ', view: ' ' }, { q: '', view: 'upcoming' }).view, 'upcoming');
  assert.equal(filters.initFilters('spaces', { q: ' ana ' }, { q: '' }).q, 'ana');
});

test('a select value that is not an option is reset: no chip, nothing filtered', () => {
  for (const bad of ['9', 'abc']) {
    const values = { ...DEF, rating: bad };
    const b = bar(values);
    assert.equal(values.rating, '', `${bad} is dropped`);
    assert.equal(chips(b), '');
  }
});

test('a valid option is kept and shows its chip', () => {
  const values = { ...DEF, rating: '4' };
  const b = bar(values);
  assert.equal(values.rating, '4');
  assert.match(chips(b), /Rating: 4 stars/);
});

test('keepUnknown keeps a value whose options arrive later', () => {
  const values = { ...DEF, rating: '9' };
  bar(values, { keepUnknown: true });
  assert.equal(values.rating, '9');
});

test('a default value is never dropped, even when it is not an option', () => {
  const values = { q: '', rating: 'low', sort: '' };
  bar(values, { options: [['4', '4 stars']] }, { ...DEF, rating: 'low' });
  assert.equal(values.rating, 'low');
});

test('a reset also covers fields under More filters, and a field with no options list is left alone', () => {
  const values = { ...DEF, sort: 'bogus', rating: 'x' };
  filters.filterBar({ key: 'reviews', values, defaults: DEF, more: [{ name: 'sort', label: 'Sort by', options: [['oldest', 'Oldest']] }, { name: 'rating', label: 'Rating' }], onChange() {} });
  assert.equal(values.sort, '');
  assert.equal(values.rating, 'x');
});
