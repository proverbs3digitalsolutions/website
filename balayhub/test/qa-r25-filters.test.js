'use strict';

// QA r25 lane FILTERS (INB-1, D-107): a rebuilt filter bar puts focus back on the same control, including a page's own control passed as
// `extra` (no data-flt); a removed chip still falls back to Filters. Stand-in DOM, no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const parents = new WeakMap(); const connected = new WeakSet();
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
  get parentElement() { return parents.get(this) || null; }
  get textContent() { return textOf(this); }
  get ownerDocument() { return document; }
  get isConnected() { return connected.has(this); }
  closest(sel) { for (let p = this; p; p = p.parentElement) if (p.className.split(' ').includes(sel.slice(1))) return p; return null; }
  querySelectorAll(sel) {
    const want = sel.split(',').map((s) => s.trim());
    const ok = (e) => want.some((w) => { const t = w.replace(/\[.*$/, '').replace(/:not.*$/, ''); return (t === e.tagName) || (w === 'a[href]' && e.tagName === 'a' && e.getAttribute('href') !== null) || (w.startsWith('[role=') && e.getAttribute('role') === w.slice(7, -2)); });
    return walk(this, (e) => e !== this && ok(e));
  }
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
globalThis.CSS = { escape: (s) => s };
globalThis.document = { querySelector: () => null, activeElement: null, createElement: (t) => new Element(t), createElementNS: (ns, t) => new Element(t), createTextNode: (d) => new Text(d) };
const textOf = (n) => (n instanceof Text ? n.data : n.children.map(textOf).join(''));
const walk = (n, pred, out = []) => { if (n instanceof Element) { if (pred(n)) out.push(n); n.children.forEach((c) => walk(c, pred, out)); } return out; };
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };


let dir; let filters;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filters-r25-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/filters.js'), path.join(dir, 'filters.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); globalThis.document.activeElement = null; });

const find = (bar, pred) => walk(bar, pred)[0];

const tick = () => new Promise((r) => setTimeout(r, 20));
const DEF = { view: 'upcoming', q: '', channel: '' };
// Put a built bar into "the page": parents are set, the bar counts as connected (what a router redraw does).
function mount(bar) {
  const link = (n) => { for (const c of n.children) if (c instanceof Element) { parents.set(c, n); link(c); } };
  link(bar); connected.add(bar);
  return bar;
}
const mk = (tag, attrs) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const opt = (v) => { const o = document.createElement('option'); o.setAttribute('value', v); o.append(v); return o; };
function pageBar(extra, values) {
  return filters.filterBar({ key: 'inbox', values, defaults: DEF, extra, search: { placeholder: 'Search' },
    more: [{ name: 'channel', label: 'Channel', options: [['a', 'A']] }], onChange() {} });
}
const showSelect = () => { const s = mk('select', { 'aria-label': 'Show' }); s.append(opt('all'), opt('unread')); return s; };
const monthInput = () => mk('input', { type: 'month', 'aria-label': 'Month' });

test('a rebuilt bar puts focus back on the page\'s own Show select, not on Filters', async () => {
  const values = filters.initFilters('inbox', {}, DEF);
  const first = mount(pageBar(showSelect(), values));
  const oldShow = find(first, (e) => e.tagName === 'select' && e.getAttribute('aria-label') === 'Show');
  oldShow.focus();
  const second = pageBar(showSelect(), values); // the page redraws while focus is still on the old control
  mount(second);
  await tick();
  const newShow = find(second, (e) => e.tagName === 'select' && e.getAttribute('aria-label') === 'Show');
  assert.equal(document.activeElement, newShow);
  assert.deepEqual(document.activeElement.focusOpts, { preventScroll: true });
});

test('the same for a Month input passed as extra', async () => {
  const values = filters.initFilters('pl', {}, DEF);
  const first = mount(pageBar(monthInput(), values));
  find(first, (e) => e.tagName === 'input' && e.getAttribute('type') === 'month').focus();
  const second = mount(pageBar(monthInput(), values));
  await tick();
  assert.equal(document.activeElement, find(second, (e) => e.tagName === 'input' && e.getAttribute('type') === 'month'));
});

test('a focused data-flt control still lands on its namesake', async () => {
  const values = filters.initFilters('inbox', {}, DEF);
  const mkq = () => filters.filterBar({ key: 'inbox', values, defaults: DEF, quick: [{ name: 'view', label: 'View', options: [['upcoming', 'Upcoming'], ['past', 'Past']] }], onChange() {} });
  const first = mount(mkq());
  find(first, (e) => e.tagName === 'select' && e.getAttribute('data-flt') === 'view').focus();
  const second = mount(mkq());
  await tick();
  assert.equal(document.activeElement, find(second, (e) => e.tagName === 'select' && e.getAttribute('data-flt') === 'view'));
});

test('a control that is gone (a removed chip) still falls back to Filters', async () => {
  const values = filters.initFilters('inbox', { channel: 'a' }, DEF);
  const first = mount(pageBar(showSelect(), values));
  const chip = find(first, (e) => e.className === 'flt__chip');
  chip.focus();
  const second = mount(pageBar(showSelect(), filters.initFilters('inbox', {}, DEF)));
  await tick();
  assert.equal(document.activeElement, find(second, (e) => e.tagName === 'button' && e.className.includes('flt__more')));
});

test('a matching control that is hidden does not take focus', async () => {
  const values = filters.initFilters('inbox', {}, DEF);
  const first = mount(pageBar(showSelect(), values));
  find(first, (e) => e.tagName === 'select' && e.getAttribute('aria-label') === 'Show').focus();
  const hiddenShow = showSelect(); hiddenShow.hidden = true;
  const second = mount(pageBar(hiddenShow, values));
  await tick();
  assert.equal(document.activeElement, find(second, (e) => e.tagName === 'button' && e.className.includes('flt__more')));
});
