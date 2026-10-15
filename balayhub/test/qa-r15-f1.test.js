'use strict';

// Filter bar, QA round 15 (public/js/filters.js): the Filters button has a funnel icon, the word "Filters" and a count of
// every active filter except search; a quick select that is off its default is marked is-set; Clear all shows with a
// single chip. Same stand-in DOM as test/qa-r2-filters.test.js plus classList and SVG. Frontend-only: no database.

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
    this.classList = {
      toggle(c, on) {
        const set = new Set(el.className.split(' ').filter(Boolean));
        if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c);
        el.className = [...set].join(' ');
      },
    };
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
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (ns, tag) => new Element(tag),
  createTextNode: (data) => new Text(data),
};
const textOf = (node) => (node instanceof Text ? node.data : node.children.map(textOf).join(''));
const walk = (node, pred, out = []) => {
  if (node instanceof Element) {
    if (pred(node)) out.push(node);
    node.children.forEach((c) => walk(c, pred, out));
  }
  return out;
};
const hasClass = (el, c) => el.className.split(' ').includes(c);
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };

let dir; let filters;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filters-r15f1-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(process.env.FILTERS_SRC || path.join(__dirname, '../public/js/filters.js'), path.join(dir, 'filters.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); });

const DEFAULTS = { q: '', status: '', channel: '' };
const QUICK = [{ name: 'status', label: 'Status', options: [['paid', 'Paid'], ['open', 'Open']] }];
const MORE = [{ name: 'channel', label: 'Channel', options: [['airbnb', 'Airbnb']] }];
function buildBar(values) {
  const calls = { n: 0 };
  const bar = filters.filterBar({ key: 't', values, defaults: DEFAULTS, search: { placeholder: 'Search' }, quick: QUICK, more: MORE, onChange: () => { calls.n += 1; } });
  return {
    bar, calls,
    btn: () => walk(bar, (el) => hasClass(el, 'flt__more'))[0],
    select: () => walk(bar, (el) => el.tagName === 'select' && el.getAttribute('aria-label') === 'Status')[0],
    chips: () => walk(bar, (el) => el.className === 'flt__chip'),
    clear: () => walk(bar, (el) => el.className === 'flt__clear'),
  };
}

test('Filters button: icon, word, count of every active filter except search, and its name', () => {
  const values = filters.initFilters('t', { status: 'paid', q: 'ana', channel: 'airbnb' }, DEFAULTS);
  const b = buildBar(values);
  const btn = b.btn();
  assert.equal(walk(btn, (el) => el.tagName === 'svg').length, 1);
  assert.ok(textOf(btn).startsWith('Filters'));
  assert.equal(textOf(walk(btn, (el) => el.className === 'flt__count')[0]), '2');
  assert.equal(btn.getAttribute('aria-label'), 'Filters, 2 active');
  assert.ok(hasClass(btn, 'is-active'));
});

test('with nothing active the button says just Filters, with no count', () => {
  const b = buildBar(filters.initFilters('t', {}, DEFAULTS));
  assert.equal(b.btn().getAttribute('aria-label'), 'Filters');
  assert.equal(walk(b.btn(), (el) => el.className === 'flt__count').length, 0);
  assert.ok(!hasClass(b.btn(), 'is-active'));
});

test('a quick select off its default is marked is-set, and loses it when its chip is cleared', () => {
  const b = buildBar(filters.initFilters('t', {}, DEFAULTS));
  assert.ok(!hasClass(b.select(), 'is-set'));
  b.select().value = 'paid';
  b.select().dispatch('change');
  assert.ok(hasClass(b.select(), 'is-set'));
  b.chips()[0].dispatch('click');
  assert.ok(!hasClass(b.select(), 'is-set'));
  assert.equal(b.select().value, '');
});

test('Clear all shows with a single chip, and with search alone', () => {
  assert.equal(buildBar(filters.initFilters('t', { status: 'paid' }, DEFAULTS)).clear().length, 1);
  assert.equal(buildBar(filters.initFilters('t', { q: 'ana' }, DEFAULTS)).clear().length, 1);
  assert.equal(buildBar(filters.initFilters('t', {}, DEFAULTS)).clear().length, 0);
});

test('the Filters button is the same element after a change (focus is kept)', () => {
  const b = buildBar(filters.initFilters('t', {}, DEFAULTS));
  const before = b.btn();
  b.select().value = 'open';
  b.select().dispatch('change');
  assert.equal(b.btn(), before);
  assert.equal(before.getAttribute('aria-label'), 'Filters, 1 active');
});

// ---- follow-up: panel and focus survive a rebuild of the same bar; "Filter by" on bars without a Filters button.
test('a rebuilt bar for the same page reopens the panel that was open', () => {
  const values = filters.initFilters('reb', {}, DEFAULTS);
  const first = filters.filterBar({ key: 'reb', values, defaults: DEFAULTS, quick: QUICK, more: MORE, onChange() {} });
  const open = (bar) => walk(bar, (el) => hasClass(el, 'flt__panel'))[0];
  assert.equal(open(first).hidden, true);
  walk(first, (el) => hasClass(el, 'flt__more'))[0].dispatch('click');
  assert.equal(open(first).hidden, false);
  const second = filters.filterBar({ key: 'reb', values, defaults: DEFAULTS, quick: QUICK, more: MORE, onChange() {} });
  assert.equal(open(second).hidden, false);
  walk(second, (el) => hasClass(el, 'flt__more'))[0].dispatch('click');
  const third = filters.filterBar({ key: 'reb', values, defaults: DEFAULTS, quick: QUICK, more: MORE, onChange() {} });
  assert.equal(open(third).hidden, true, 'a panel closed on purpose stays closed');
});

test('focus moves to the control with the same name in the rebuilt bar', async () => {
  const values = filters.initFilters('foc', {}, DEFAULTS);
  const old = filters.filterBar({ key: 'foc', values, defaults: DEFAULTS, quick: QUICK, more: MORE, onChange() {} });
  const oldSel = walk(old, (el) => el.tagName === 'select')[0];
  old.closest = () => old;
  oldSel.closest = () => old;
  globalThis.document.activeElement = oldSel;
  const next = filters.filterBar({ key: 'foc', values, defaults: DEFAULTS, quick: QUICK, more: MORE, onChange() {} });
  next.isConnected = true;
  let focused = null;
  const newSel = walk(next, (el) => el.tagName === 'select')[0];
  next.querySelector = (sel) => (sel === '[data-flt="status"]' ? { focus: (o) => { focused = o; } } : null);
  await new Promise((r) => setTimeout(r, 20));
  delete globalThis.document.activeElement;
  assert.deepEqual(focused, { preventScroll: true });
  assert.equal(newSel.getAttribute('data-flt'), 'status');
});

test('a bar with a select and no Filters button starts with "Filter by"; search-only bars do not', () => {
  const by = (bar) => walk(bar, (el) => hasClass(el, 'flt__by'));
  const withSel = filters.filterBar({ key: 'by1', values: { status: '' }, defaults: { status: '' }, quick: QUICK, onChange() {} });
  assert.equal(by(withSel).length, 1);
  assert.equal(textOf(by(withSel)[0]), 'Filter by');
  assert.equal(walk(by(withSel)[0], (el) => el.tagName === 'svg').length, 1);
  const searchOnly = filters.filterBar({ key: 'by2', values: { q: '' }, defaults: { q: '' }, search: {}, onChange() {} });
  assert.equal(by(searchOnly).length, 0);
  const withMore = filters.filterBar({ key: 'by3', values: { status: '', channel: '' }, defaults: DEFAULTS, quick: QUICK, more: MORE, onChange() {} });
  assert.equal(by(withMore).length, 0);
});
