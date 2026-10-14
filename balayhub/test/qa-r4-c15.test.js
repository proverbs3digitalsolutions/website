'use strict';

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

let dir; let filters; let reportsView; let reportsSrc;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c15-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/views/reports.js'), path.join(dir, 'views', 'reports.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
  ({ reportsView } = await import(pathToFileURL(path.join(dir, 'views', 'reports.js'))));
  reportsSrc = fs.readFileSync(path.join(__dirname, '../public/js/views/reports.js'), 'utf8');
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); calls = []; });

// The filter bar as the reports page builds it: one custom date range under "More filters".
function bar(values) {
  const root = filters.filterBar({ key: 'reports', values, defaults: DEFAULTS, more: [RANGE], onChange: () => {} });
  return {
    root,
    alert: () => walk(root, (el) => el.getAttribute('role') === 'alert')[0],
    chips: () => walk(root, (el) => el.className === 'flt__chips')[0],
  };
}

// Opens the reports page with a link query and returns its root element once the first load has finished.
async function openReports(query) {
  calls = [];
  const el = new Element('div');
  await reportsView(el, { query });
  return el;
}
const askShown = (el) => walk(el, (n) => n.tagName === 'p' && textOf(n) === ASK).length > 0;
const exportLink = (el) => walk(el, (n) => n.tagName === 'a' && textOf(n) === 'Export (Excel / CSV)')[0];

// ---------------------------------------------------------------- filters.js: what a link may carry
test('a from or to that is not a real date is dropped, whatever it looks like', () => {
  for (const v of ['abc', 'yesterday', '2026-2-3', '10/14/2026', '2026-10-14T00:00', '2026-02-30', '2026-13-01']) {
    assert.equal(filters.initFilters('reports', { from: v }, DEFAULTS).from, '', `from=${v}`);
    assert.equal(filters.initFilters('reports', { to: v }, DEFAULTS).to, '', `to=${v}`);
  }
});

test('a bad start and a bad end leave the range empty', () => {
  const values = filters.initFilters('reports', { from: 'abc', to: '2026-02-30' }, DEFAULTS);
  assert.equal(values.from, '');
  assert.equal(values.to, '');
});

test('a bad start with a good end is one side on its own, not a backwards range', () => {
  const values = filters.initFilters('reports', { from: 'abc', to: '2026-10-14' }, DEFAULTS);
  assert.equal(values.from, '');
  assert.equal(values.to, '2026-10-14', 'the end date is kept as a one-sided range');
  assert.equal(bar(values).alert().hidden, true, 'the bar does not say the end is before the start');
});

test('the bar never shows "Invalid Date", even for a value it is handed unchecked', () => {
  const b = bar({ from: 'abc', to: '', property_type: '' });
  assert.doesNotMatch(textOf(b.chips()), /Invalid Date/);
  assert.match(textOf(b.chips()), /abc/, 'the typed text is shown as it is');
  const due = filters.filterBar({ key: 'x', values: { due: 'abc' }, defaults: { due: '' }, quick: [{ name: 'due', label: 'Due on', type: 'date' }], onChange: () => {} });
  assert.doesNotMatch(textOf(walk(due, (el) => el.className === 'flt__chips')[0]), /Invalid Date/);
});

// ---------------------------------------------------------------- reports.js: a custom range needs both dates
test('a custom range with a date that is not real asks for both dates and runs no report', async () => {
  const el = await openReports({ from: '2026-02-30', to: '2026-10-14' });
  assert.equal(reportCalls().length, 0, 'no report is requested for the one date that is left');
  assert.ok(askShown(el));
  assert.equal(exportLink(el).getAttribute('href'), null, 'no export for a period the page does not show');
  assert.doesNotMatch(textOf(el), /Invalid Date/);
});

test('a custom range with a text date asks for both dates, and the bar does not call it backwards', async () => {
  const el = await openReports({ from: 'abc', to: '2024-03-31' });
  assert.equal(reportCalls().length, 0);
  assert.ok(askShown(el));
  assert.equal(walk(el, (n) => n.getAttribute('role') === 'alert')[0].hidden, true);
});

test('a custom range with only a start date asks for both dates instead of reporting this month', async () => {
  const el = await openReports({ from: '2024-03-01' });
  assert.equal(reportCalls().length, 0);
  assert.ok(askShown(el));
});

test('a custom range with both dates runs the report for those dates and offers the export', async () => {
  const el = await openReports({ from: '2024-03-01', to: '2024-03-31' });
  assert.deepEqual(reportCalls(), ['/api/reports?from=2024-03-01&to=2024-03-31']);
  assert.equal(exportLink(el).getAttribute('href'), '/api/reports/export?from=2024-03-01&to=2024-03-31');
  assert.equal(askShown(el), false);
});

test('clearing the start date in the bar stops the report until both dates are set again', async () => {
  const el = await openReports({ from: '2024-03-01', to: '2024-03-31' });
  calls = [];
  const start = walk(el, (n) => n.tagName === 'input' && n.getAttribute('aria-label') === 'Custom dates from')[0];
  start.value = '';
  start.dispatch('change');
  await settle();
  assert.equal(reportCalls().length, 0, 'no report for a range with only an end date');
  assert.ok(askShown(el));
  assert.equal(exportLink(el).getAttribute('href'), null);
});

test('reports never fills a missing side of a custom range from this month or from today', () => {
  assert.doesNotMatch(reportsSrc, /filters\.from \|\| P\.this_month/);
  assert.doesNotMatch(reportsSrc, /filters\.to \|\| today/);
});
