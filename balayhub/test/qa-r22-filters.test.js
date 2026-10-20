'use strict';

// QA r22 lane FILTERS: Escape closes the open Filters panel (focus to the Filters button), and on a bar with no visible Filters
// button and no search box (Cleaner pay) Clear all and a chip hand focus to a bar control, never to the page body. No database.

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
  dispatch(type, extra) { const ev = { target: this, type, prevented: false, preventDefault() { this.prevented = true; }, ...extra }; for (const fn of this.listeners[type] || []) fn(ev); return ev; }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
  contains(n) { return n === this || this.children.some((c) => c instanceof Element && c.contains(n)); }
  focus(opts) { document.activeElement = this; this.focusOpts = opts; }
  // Only the selectors filters.js uses: '[data-flt="x"]', '[data-flt]' (optionally under '.flt__bar'), '.cls'.
  querySelector(sel) {
    const parts = sel.split(' ');
    const last = parts[parts.length - 1];
    const m = last.match(/^\[data-flt(?:="(.*)")?\]$/);
    const pred = m ? (e) => e.getAttribute('data-flt') !== null && (m[1] === undefined || e.getAttribute('data-flt') === m[1]) : (e) => last.startsWith('.') && e.className.split(' ').includes(last.slice(1));
    const scope = parts.length > 1 ? walk(this, (e) => e.className.split(' ').includes(parts[0].slice(1)))[0] : this;
    return (scope && walk(scope, (e) => e !== scope && pred(e))[0]) || null;
  }
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filters-r22-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/filters.js'), path.join(dir, 'filters.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); globalThis.document.activeElement = null; });

const find = (bar, pred) => walk(bar, pred)[0];
const selectOf = (bar, name) => find(bar, (e) => e.tagName === 'select' && e.getAttribute('data-flt') === name);

// Cleaner pay: quick selects only, no search box, and the Filters button hidden on wide screens (place() sets display none).
const QDEF = { status: 'unpaid', cleaner: '' };
function quickBar(values) {
  const bar = filters.filterBar({ key: 'q', values, defaults: QDEF, quick: [
    { name: 'status', label: 'Status', options: [['unpaid', 'Unpaid'], ['paid', 'Paid']] },
    { name: 'cleaner', label: 'Cleaner', options: [['a', 'Ana']] }], onChange() {} });
  find(bar, (e) => e.tagName === 'button' && e.className.includes('flt__more')).style.display = 'none';
  return bar;
}

test('Clear all on a quick-only bar focuses the first bar control, without scrolling', () => {
  const values = filters.initFilters('q', { status: 'paid' }, QDEF);
  const bar = quickBar(values);
  find(bar, (e) => e.className === 'flt__clear').dispatch('click');
  assert.equal(document.activeElement, selectOf(bar, 'status'));
  assert.deepEqual(document.activeElement.focusOpts, { preventScroll: true });
  assert.equal(values.status, 'unpaid');
});

test('removing a chip on a quick-only bar focuses that filter\'s own control', () => {
  const values = filters.initFilters('q', { status: 'paid', cleaner: 'a' }, QDEF);
  const bar = quickBar(values);
  const chip = find(bar, (e) => e.className === 'flt__chip' && e.getAttribute('aria-label') === 'Remove filter Cleaner: Ana');
  chip.dispatch('click');
  assert.equal(document.activeElement, selectOf(bar, 'cleaner'));
  assert.equal(values.cleaner, '');
});

test('a bar with a visible Filters button still sends focus there (round 21)', () => {
  const values = filters.initFilters('m', { g: 'x' }, { g: '' });
  const bar = filters.filterBar({ key: 'm', values, defaults: { g: '' }, more: [{ name: 'g', label: 'G', options: [['x', 'X']] }], onChange() {} });
  find(bar, (e) => e.className === 'flt__clear').dispatch('click');
  assert.equal(document.activeElement, find(bar, (e) => e.tagName === 'button' && e.className.includes('flt__more')));
});

test('Escape closes the open Filters panel and puts focus on the Filters button', () => {
  const values = filters.initFilters('m', {}, { g: '' });
  const bar = filters.filterBar({ key: 'm', values, defaults: { g: '' }, search: { placeholder: 'Search' }, more: [{ name: 'g', label: 'G', options: [['x', 'X']] }], onChange() {} });
  const btn = find(bar, (e) => e.tagName === 'button' && e.className.includes('flt__more'));
  const panel = find(bar, (e) => e.className.includes('flt__panel'));
  btn.dispatch('click');
  assert.equal(panel.hidden, false);
  selectOf(bar, 'g').focus();
  const ev = bar.dispatch('keydown', { key: 'Escape' });
  assert.equal(panel.hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, btn);
  assert.equal(ev.prevented, true);
});

test('Escape also works with focus on the Filters button, and does nothing when focus is elsewhere or the panel is shut', () => {
  const values = filters.initFilters('m', {}, { g: '' });
  const bar = filters.filterBar({ key: 'm', values, defaults: { g: '' }, search: { placeholder: 'Search' }, more: [{ name: 'g', label: 'G', options: [['x', 'X']] }], onChange() {} });
  const btn = find(bar, (e) => e.tagName === 'button' && e.className.includes('flt__more'));
  const panel = find(bar, (e) => e.className.includes('flt__panel'));
  const box = find(bar, (e) => e.tagName === 'input' && e.getAttribute('type') === 'search');
  assert.equal(bar.dispatch('keydown', { key: 'Escape' }).prevented, false, 'panel shut');
  btn.dispatch('click');
  box.focus();
  assert.equal(bar.dispatch('keydown', { key: 'Escape' }).prevented, false, 'focus in the search box');
  assert.equal(panel.hidden, false);
  btn.focus();
  bar.dispatch('keydown', { key: 'Escape' });
  assert.equal(panel.hidden, true);
  btn.dispatch('click');
  selectOf(bar, 'g').focus();
  assert.equal(bar.dispatch('keydown', { key: 'Enter' }).prevented, false, 'other keys are left alone');
  assert.equal(panel.hidden, false);
});
