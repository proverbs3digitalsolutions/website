'use strict';

// QA r21 lane FLT: a typed number box commits on blur, which is the mouse press on Clear all or a chip. The redraw must not
// replace the button under the pointer (its click would be lost). Same stand-in DOM as test/qa-r15-f1.test.js. No database.

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
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '' });
    const el = this;
    this.classList = { toggle(c, on) { const set = new Set(el.className.split(' ').filter(Boolean)); if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); el.className = [...set].join(' '); } };
  }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { const ev = { target: this, type, prevented: false, preventDefault() { this.prevented = true; } }; for (const fn of this.listeners[type] || []) fn(ev); return ev; }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = { createElement: (t) => new Element(t), createElementNS: (ns, t) => new Element(t), createTextNode: (d) => new Text(d) };
const textOf = (n) => (n instanceof Text ? n.data : n.children.map(textOf).join(''));
const walk = (n, pred, out = []) => { if (n instanceof Element) { if (pred(n)) out.push(n); n.children.forEach((c) => walk(c, pred, out)); } return out; };
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };

let dir; let filters;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filters-r21flt-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/filters.js'), path.join(dir, 'filters.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); });

const DEFAULTS = { q: '', guest: '', min_nights: '' };
const QUICK = [{ name: 'guest', label: 'Guest', options: [['repeat', 'Repeat guests']] }];
const MORE = [{ name: 'min_nights', label: 'Nights (at least)', type: 'number' }];
function buildBar(values) {
  const bar = filters.filterBar({ key: 't', values, defaults: DEFAULTS, search: { placeholder: 'Search' }, quick: QUICK, more: MORE, onChange() {} });
  return {
    bar,
    box: () => walk(bar, (e) => e.tagName === 'input' && e.getAttribute('data-flt') === 'min_nights')[0],
    chips: () => walk(bar, (e) => e.className === 'flt__chip'),
    clear: () => walk(bar, (e) => e.className === 'flt__clear')[0],
  };
}

test('typing a number and "pressing" Clear all: the button under the pointer survives the blur redraw', () => {
  const values = filters.initFilters('t', { guest: 'repeat' }, DEFAULTS);
  const b = buildBar(values);
  const clear = b.clear();
  const chip = b.chips()[0];
  b.box().value = '2';
  b.box().dispatch('change'); // blur on mouse press commits the number and repaints the chips
  assert.equal(b.chips().length, 2);
  assert.equal(b.clear(), clear, 'Clear all is the same element');
  assert.equal(b.chips()[0], chip, 'the untouched chip is the same element');
  clear.dispatch('click'); // the click that follows the press
  assert.equal(values.min_nights, '');
  assert.equal(values.guest, '');
  assert.equal(b.chips().length, 0);
  assert.equal(b.clear(), undefined);
});

test('a chip pressed while a number is being committed still removes its filter, and the chip text is relabelled in place', () => {
  const values = filters.initFilters('t', { min_nights: '2' }, DEFAULTS);
  const b = buildBar(values);
  const chip = b.chips()[0];
  b.box().value = '3';
  b.box().dispatch('change');
  assert.equal(b.chips()[0], chip);
  assert.equal(textOf(chip), 'Nights (at least): 3 ×');
  assert.equal(chip.getAttribute('aria-label'), 'Remove filter Nights (at least): 3');
  chip.dispatch('click');
  assert.equal(values.min_nights, '');
  assert.equal(b.chips().length, 0);
});

test('chips come back in order after a clear, and a later filter gets a working chip again', () => {
  const values = filters.initFilters('t', { guest: 'repeat', q: 'ana' }, DEFAULTS);
  const b = buildBar(values);
  assert.equal(b.chips().length, 2);
  b.clear().dispatch('click');
  assert.equal(b.chips().length, 0);
  b.box().value = '4';
  b.box().dispatch('change');
  assert.equal(b.chips().length, 1);
  b.chips()[0].dispatch('click');
  assert.equal(values.min_nights, '');
});

test('a mouse press on Clear all or a chip does not take focus (so a typed number never blurs and repaints under the pointer)', () => {
  const values = filters.initFilters('t', { guest: 'repeat' }, DEFAULTS);
  const b = buildBar(values);
  assert.equal(b.clear().dispatch('mousedown').prevented, true);
  assert.equal(b.chips()[0].dispatch('mousedown').prevented, true);
  b.box().value = '2'; // typed, not committed
  b.clear().dispatch('click');
  assert.equal(b.box().value, '', 'the uncommitted number is dropped by Clear all');
  assert.equal(values.min_nights, '');
  assert.equal(b.chips().length, 0);
});
