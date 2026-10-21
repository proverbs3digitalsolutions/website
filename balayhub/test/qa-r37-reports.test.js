'use strict';

require('./helpers');

// QA round 4, lane C15 (filters and reports). longterm#11: a date typed into the reports address that is not a real
// date showed "Invalid Date", or a one-sided range with figures for the whole of this month. filters.js let text
// through, and reports.js filled the missing side of a custom range from this month.
// Frontend only: no database, no server. filters.js and views/reports.js are loaded from a temp copy as ES modules,
// with the same stand-in DOM as test/qa-r1-filters-daterange.test.js and a stub fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MSG = 'The end date is before the start date. This date filter is off until you fix it.';
const ASK = 'Pick both dates to see this range.';
const DEFAULTS = { period: 'this_month', from: '', to: '', property_id: '', property_type: '' };
const RANGE = { name: 'from', label: 'Custom dates', type: 'daterange', keys: ['from', 'to'] };

// Just enough DOM for h(), ui.js, filters.js and reports.js: elements, text, attributes, listeners.
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
  get href() { return this.getAttribute('href'); }
  set href(v) { this.setAttribute('href', v); }
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
globalThis.history = { replaceState() {} };

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

// The page fetches: the property list answers, and any report request is recorded and answered with an error.
let calls = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url) => {
  calls.push(url);
  if (url.startsWith('/api/properties')) return json({ properties: [] });
  return json({ error: 'stub' }, 500);
};
const reportCalls = () => calls.filter((u) => u.startsWith('/api/reports'));
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };


// QA round 37, REPORTS (RPT-R): the dimmed "Export (Excel / CSV)" on long-term Reports stays in the tab order, announces
// a role and is tied to its reason (D-117, D-119). Mounts reportsView from a temp copy of the file; REPORTS_SRC swaps in
// another copy (the red run uses the round 36 file).
let dir; let reportsView;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r37-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(process.env.REPORTS_SRC || path.join(__dirname, '../public/js/views/reports.js'), path.join(dir, 'views', 'reports.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\nexport function navigate() {}\n');
  ({ reportsView } = await import(pathToFileURL(path.join(dir, 'views', 'reports.js'))));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); calls = []; });

async function openReports(query) {
  const el = new Element('div');
  await reportsView(el, { query });
  return el;
}
const exportLink = (el) => walk(el, (n) => n.tagName === 'a' && textOf(n) === 'Export (Excel / CSV)')[0];
const note = (el) => walk(el, (n) => n.getAttribute('id') === 'report-export-note')[0];

test('a custom range with no To date: the dimmed export is focusable, a link, and tied to its reason', async () => {
  const el = await openReports({ period: 'custom', from: '2026-10-01' });
  const a = exportLink(el);
  assert.equal(a.getAttribute('href'), null);
  assert.equal(a.getAttribute('aria-disabled'), 'true');
  assert.equal(a.getAttribute('tabindex'), '0');
  assert.equal(a.getAttribute('role'), 'link');
  assert.equal(a.getAttribute('aria-describedby'), 'report-export-note');
  assert.equal(textOf(note(el)), 'Pick both dates to export.');
});

test('a complete range (no two-year cap, D-118): an address and none of the dimmed attributes', async () => {
  const el = await openReports({ period: 'custom', from: '2026-10-01', to: '2030-06-01' });
  const a = exportLink(el);
  assert.equal(a.getAttribute('href'), '/api/reports/export?from=2026-10-01&to=2030-06-01');
  for (const k of ['tabindex', 'role', 'aria-describedby', 'aria-disabled']) assert.equal(a.getAttribute(k), null, k);
});

test('clearing To in the bar dims the export again, and setting it brings the address back', async () => {
  const el = await openReports({ period: 'custom', from: '2026-10-01', to: '2026-10-31' });
  const to = walk(el, (n) => n.tagName === 'input' && n.getAttribute('aria-label') === 'Custom dates, to')[0];
  to.value = ''; to.dispatch('change'); await settle();
  assert.equal(exportLink(el).getAttribute('tabindex'), '0');
  to.value = '2026-10-31'; to.dispatch('change'); await settle();
  assert.equal(exportLink(el).getAttribute('tabindex'), null);
  assert.equal(exportLink(el).getAttribute('role'), null);
});
