'use strict';

// QA r18 lane FB: Clear all / Reset filters keep the saved view; on phones quick filters move into the Filters panel;
// the Appearance switch label stays on one line. Same stand-in DOM as test/qa-r15-f1.test.js. Frontend-only: no database.

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
    this.classList = { toggle(c, on) { const s = new Set(el.className.split(' ').filter(Boolean)); if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); el.className = [...s].join(' '); } };
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
globalThis.document = { createElement: (t) => new Element(t), createElementNS: (ns, t) => new Element(t), createTextNode: (d) => new Text(d) };
const walk = (node, pred, out = []) => { if (node instanceof Element) { if (pred(node)) out.push(node); node.children.forEach((c) => walk(c, pred, out)); } return out; };
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };

let dir; let filters;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filters-r18fb-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/filters.js'), path.join(dir, 'filters.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const DEFAULTS = { view: 'upcoming', q: '', channel: '' };
const MORE = [{ name: 'channel', label: 'Channel', options: [['airbnb', 'Airbnb']] }];

test('Clear all and Reset filters clear the filter values but keep the saved view', () => {
  for (const button of ['clear', 'reset']) {
    const values = { view: 'past', q: 'ana', channel: 'airbnb' };
    const bar = filters.filterBar({ key: 't', values, defaults: DEFAULTS, search: {}, more: MORE, onChange() {} });
    const el = button === 'clear'
      ? walk(bar, (e) => e.className === 'flt__clear')[0]
      : walk(bar, (e) => e.tagName === 'button' && e.children.some((c) => c.data === 'Reset filters'))[0];
    el.dispatch('click');
    assert.deepEqual(values, { view: 'past', q: '', channel: '' }, button);
  }
});

test('a page can name other keys to keep', () => {
  const values = { view: 'past', tab: 'x', channel: 'airbnb' };
  const bar = filters.filterBar({ key: 't', values, defaults: { view: 'upcoming', tab: 'y', channel: '' }, keep: ['view', 'tab'], more: MORE, onChange() {} });
  walk(bar, (e) => e.className === 'flt__clear')[0].dispatch('click');
  assert.deepEqual(values, { view: 'past', tab: 'x', channel: '' });
});

const filtersSrc = fs.readFileSync(path.join(__dirname, '../public/js/filters.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');

test('on phones the quick filters move into the Filters panel and move back on wider screens', () => {
  assert.match(filtersSrc, /matchMedia\('\(max-width: 559px\)'\)/);
  assert.match(filtersSrc, /grid\.prepend\(\.\.\.quickEls\)/);
  assert.match(filtersSrc, /moreBtn\.before\(\.\.\.quickEls\)/);
});

test('phone CSS: search and Filters button share one row; Match device stays on one line', () => {
  assert.match(css, /@media \(max-width: 559px\) \{[^}]*\.flt__bar \.search \{[^}]*flex: 1 1 0/);
  assert.match(css, /\.themeswitch button \{ white-space: nowrap;/);
  assert.match(css, /\.themeswitch:not\(\.themeswitch--compact\) button \{[^}]*font-size: \.8rem/);
});

test('phone CSS: other bar controls (saved view select, tabs) take a full row so the search box keeps the next row', () => {
  assert.match(css, /@media \(max-width: 559px\) \{[\s\S]*?\.flt__bar > :not\(\.search, \.flt__more, \.flt__by, \.flt__check\) \{ flex: 1 1 100%; \}/);
  assert.match(css, /\.flt__bar > :not\(\.search\) select\.input \{ width: 100%; max-width: none; \}/);
});
