'use strict';

// QA round 11, lane C08 (reports-filters).
// #20: a Reports link with a year outside 2000 to 2100 says so, not "Pick both dates", and the note ends at the first change.
// K2b: the filter bar sits in a no-print box and the print sheet hides .no-print (already in place; guard).
// K6: a single date box outside 2000 to 2100 says so at the box, is marked invalid, and applies nothing.
// N2: the stay report's occupancy total counts only the nights of listings that have capacity.
// Frontend tests load reports.js and filters.js from a temp copy with the stand-in DOM of test/qa-r4-c15.test.js.
// The stay report test runs against TEST_DATABASE_URL.
// node --test --test-concurrency=1 test/qa-r11-c08.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEFAULTS = { period: 'this_month', from: '', to: '', property_id: '', property_type: '' };
const RANGE = { name: 'from', label: 'Custom dates', type: 'daterange', keys: ['from', 'to'] };
const ASK = 'Pick both dates to see this range.';
const WINDOW_ASK = 'The dates in this link must be between 2000 and 2100. Pick both dates to see this range.';

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
// Absolute URLs are the database test's server (test/helpers.js), so they go to the real fetch.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('http')) return realFetch(url, init);
  calls.push(url);
  if (url.startsWith('/api/properties')) return json({ properties: [] });
  return json({ error: 'stub' }, 500);
};
const reportCalls = () => calls.filter((u) => u.startsWith('/api/reports'));
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r)); };

let dir; let filters; let reportsView;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r11-c08-'));
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/views/reports.js'), path.join(dir, 'views', 'reports.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { user_id: 1 } };\nexport function navigate() {}\n');
  filters = await import(pathToFileURL(path.join(dir, 'filters.js')));
  ({ reportsView } = await import(pathToFileURL(path.join(dir, 'views', 'reports.js'))));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); calls = []; });

// Opens the reports page with a link query and returns its root element once the first load has finished.
async function openReports(query) {
  calls = [];
  const el = new Element('div');
  await reportsView(el, { query });
  return el;
}
const noteShown = (el, text) => walk(el, (n) => n.tagName === 'p' && textOf(n) === text).length > 0;
const exportLink = (el) => walk(el, (n) => n.tagName === 'a' && textOf(n) === 'Export (Excel / CSV)')[0];

// #20: a link with a year outside the window

test('#20: a link with a start or end outside 2000 to 2100 says the dates must be in that window', async () => {
  const el = await openReports({ period: 'custom', from: '1900-01-01', to: '2200-01-01' });
  assert.equal(reportCalls().length, 0, 'no report is requested for the dates in this link');
  assert.ok(noteShown(el, WINDOW_ASK), 'the note names the window, and still asks for both dates');
  assert.equal(noteShown(el, ASK), false, 'the plain note is not shown for this link');
  assert.equal(exportLink(el).getAttribute('href'), null, 'no export for a period the page does not show');
});

test('#20: a link with one good end and one end outside the window gets the same note', async () => {
  const el = await openReports({ period: 'custom', from: '2026-10-01', to: '2200-01-01' });
  assert.equal(reportCalls().length, 0);
  assert.ok(noteShown(el, WINDOW_ASK));
});

test('#20: the window note ends at the first change the person makes in the bar', async () => {
  const el = await openReports({ period: 'custom', from: '1900-01-01', to: '2200-01-01' });
  assert.ok(noteShown(el, WINDOW_ASK));
  const start = walk(el, (n) => n.tagName === 'input' && n.getAttribute('aria-label') === 'Custom dates, from')[0];
  start.value = '2026-10-01';
  start.dispatch('change');
  await settle();
  assert.equal(noteShown(el, WINDOW_ASK), false, 'the window note is gone once the person has changed a date');
  assert.ok(noteShown(el, ASK), 'a one-sided range asks for the other date in the plain wording');
});

// K2b: the filter bar is in a box the print sheet hides

test('K2b: the filter bar sits in a no-print box, and the print sheet hides .no-print', async () => {
  const el = await openReports({ period: 'this_month' });
  const boxes = el.children.filter((c) => c.className === 'no-print');
  assert.equal(boxes.length, 1, 'one box holds the filter bar and is marked no-print');
  assert.equal(walk(boxes[0], (n) => n.className === 'flt').length, 1, 'the filter bar is inside that box');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
  assert.match(css, /@media print \{\s*\.sidebar,[^{]*\.no-print,[^{]*\{ display: none !important; \}/);
});

// K6: a single date box

test('K6: a single date box outside 2000 to 2100 says so at the box, marks it, and applies nothing', () => {
  const values = { d: '2026-10-01' };
  let n = 0;
  const bar = filters.filterBar({ key: 'c08-k6', values, defaults: { d: '' }, more: [{ name: 'd', label: 'Arrival', type: 'date' }], onChange: () => { n += 1; } });
  const box = walk(bar, (el) => el.tagName === 'input' && el.getAttribute('type') === 'date')[0];
  const alert = walk(bar, (el) => el.getAttribute('role') === 'alert')[0];
  box.value = '0202-10-01';
  box.dispatch('change');
  assert.equal(values.d, '', 'the year 0202 is not applied');
  assert.equal(n, 1, 'the applied date changed, so the list reloads without it');
  assert.equal(box.getAttribute('aria-invalid'), 'true');
  assert.equal(box.getAttribute('aria-describedby'), alert.getAttribute('id'), 'the message is linked to the box');
  assert.equal(alert.hidden, false);
  assert.equal(textOf(alert), filters.OUT_OF_WINDOW);
  box.value = '2026-10-05';
  box.dispatch('change');
  assert.equal(values.d, '2026-10-05', 'a fixed date applies');
  assert.equal(box.getAttribute('aria-invalid'), null);
  assert.equal(alert.hidden, true);
  assert.equal(n, 2);
});

test('K6: a half-typed year over an empty box shows the message and does not reload the list', () => {
  const values = { d: '' };
  let n = 0;
  const bar = filters.filterBar({ key: 'c08-k6b', values, defaults: { d: '' }, more: [{ name: 'd', label: 'Arrival', type: 'date' }], onChange: () => { n += 1; } });
  const box = walk(bar, (el) => el.tagName === 'input' && el.getAttribute('type') === 'date')[0];
  box.value = '0202-10-01';
  box.dispatch('change');
  assert.equal(n, 0, 'nothing applied changed, so the list is not reloaded');
  assert.equal(box.getAttribute('aria-invalid'), 'true');
  assert.equal(walk(bar, (el) => el.getAttribute('role') === 'alert')[0].hidden, false);
});

// N2: the stay report occupancy total (real database, one fresh schema for this file)

test('N2: the occupancy total counts only the nights of listings that have capacity', async () => {
  const { startServer, sql, ownerAccount } = require('./helpers');
  const srv = await startServer();
  try {
    const host = await ownerAccount(srv.base, 'c08-host@example.com', 'C08 Reports');
    const p = (await host.post('/api/properties', { property_name: 'Kalayaan', property_type: 'condominium', address: 'Kalayaan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
    const unit = async (name, rate) => (await host.post(`/api/properties/${p.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: rate })).data.unit;
    const a = await unit('1A', '2000');
    const b = await unit('2B', '1500');
    const stay = (u, ci, co) => host.post('/api/reservations', { unit_id: u.unit_id, check_in: ci, check_out: co, guest_name: 'G' });
    await stay(a, '2026-09-01', '2026-09-03');
    await stay(b, '2026-09-10', '2026-09-15');
    // An archived listing keeps its past stays in the report, but its capacity leaves the occupancy total.
    await sql(`UPDATE units SET status = 'archived' WHERE unit_id = $1`, [b.unit_id]);
    const r = (await host.get('/api/stay-reports?month=2026-09')).data;
    const ua = r.units.find((u) => u.unit_id === a.unit_id);
    const ub = r.units.find((u) => u.unit_id === b.unit_id);
    assert.deepEqual([ub.nights, ub.occupancy], [5, null], 'the archived listing keeps its own row');
    assert.deepEqual([ua.nights, ua.occupancy], [2, 7], 'the active listing keeps its own occupancy');
    assert.equal(r.totals.nights, 7, 'the nights total is unchanged');
    assert.equal(r.totals.occupancy, 7, 'occupancy is the 2 active nights over 30, not all 7 nights over 30');
    // RevPAR divides the same revenue by the same capacity: the archived listing's 7,500 leaves with its capacity.
    assert.equal(r.totals.revpar, '133.33', 'revpar is the 4,000 earned at the active listing over its 30 nights');
    // ADR is unchanged: nights and accommodation both include the archived listing.
    assert.equal(r.totals.adr, '1642.86', 'adr counts every night and every peso of accommodation');
  } finally {
    await srv.close();
  }
});
