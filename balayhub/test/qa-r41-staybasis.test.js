'use strict';
require('./helpers');

// QA round 41 STAYBASIS (MNY41-2, D-123). Frontend only: no database, no server.
// The Revenue tile's stays count is by check-in date (Reports, DECISIONS 1275); owner statements and Profit and loss count check-outs (D-37),
// so the tile's sub-line says "check-ins" where it says the count, and the nights beside it keep their name.
// The page is mounted from a temp copy of public/js with a stand-in DOM and a stub fetch (as test/qa-r37-stayreports.test.js does).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

class Node { }
class Text extends Node { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
class Element extends Node {
  constructor(tag) { super(); Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: { setProperty() {} }, dataset: {}, className: '' }); }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get href() { return this.getAttribute('href'); }
  set href(v) { this.setAttribute('href', v); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
  contains() { return false; }
  focus() {}
}
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = { createElement: (tag) => new Element(tag), createElementNS: (ns, tag) => new Element(tag), createTextNode: (data) => new Text(data), activeElement: null };
globalThis.history = { replaceState() {} };
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };

const textOf = (node) => (node instanceof Text ? node.data : node.children.map(textOf).join(''));
function walk(node, pred, out = []) {
  if (node instanceof Element) { if (pred(node)) out.push(node); node.children.forEach((c) => walk(c, pred, out)); }
  return out;
}

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
// The performance answer the page reads (src/routes/stayreports.js shape), for September 2026.
let report = null;
function performance(stays, nights) {
  return {
    period: '2026-09', month: '2026-09', from: '2026-09-01', to_exclusive: '2026-10-01', partial: false, month_invalid: false,
    totals: { stays, nights, revenue: 100000, accommodation: 90000, fees: 10000, occupancy: 50, adr: 3000, revpar: 1500, net: 80000, channel_fees: 0, expenses: 0, avg_stay: 2, cancelled: 0 },
    channels: [], units: [], expenses_by_category: [], expenses_excluded: false, building_expenses: 0,
  };
}
globalThis.fetch = async (url) => {
  if (url.startsWith('/api/listings')) return json({ listings: [] });
  if (url.startsWith('/api/stay-reports?')) return json(report);
  return json({});
};

const SRC = path.join(__dirname, '../public/js');
const dirs = [];
// Mounts a copy of the app's scripts with `viewSource` as views/stayreports.js; returns its view function.
async function load(viewSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r41-sb-'));
  dirs.push(dir);
  fs.cpSync(SRC, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { role: "owner" } };\nexport const navigate = () => {};\nexport const refreshUser = async () => {};\nexport const logout = () => {};\nexport const homeRoute = () => "#/home";\nexport const afterLogin = async () => {};\n');
  fs.writeFileSync(path.join(dir, 'views', 'stayreports.js'), viewSource);
  return (await import(pathToFileURL(path.join(dir, 'views', 'stayreports.js')))).stayReportsView;
}
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const now = fs.readFileSync(path.join(SRC, 'views/stayreports.js'), 'utf8');
const before = () => execFileSync('git', ['-C', path.join(__dirname, '../..'), 'show', '60362bd:balayhub/public/js/views/stayreports.js'], { encoding: 'utf8' });

// Draws the page with a report of `stays` stays and `nights` nights; returns the drawn tree.
async function draw(view, stays, nights) {
  report = performance(stays, nights);
  const el = new Element('div');
  await view(el, { query: {} });
  return el;
}
// The Revenue tile is a stat with the label Revenue; its sub-line is the third child (value, label, sub-line).
const revenueTile = (el) => walk(el, (n) => n.className === 'stat stat--flat' && textOf(n).includes('Revenue'))[0];
const revenueSub = (el) => textOf(revenueTile(el).children[2]);

test('the Revenue tile says its stays are check-ins, and keeps the nights and the note', async () => {
  const el = await draw(await load(now), 34, 87);
  assert.ok(revenueSub(el).startsWith('34 check-ins · 87 nights'), `sub-line reads "${revenueSub(el)}"`);
  assert.ok(!revenueSub(el).includes('34 stays'), 'the tile no longer says "stays" for the count');
  const note = walk(el, (n) => n.tagName === 'p' && textOf(n).startsWith('Counts nights in'))[0];
  assert.match(textOf(note), /^Counts nights in September 2026, including upcoming confirmed stays\. Profit and loss counts only stays that have checked out\.$/);
  const stayHeader = walk(el, (n) => n.tagName === 'th' && textOf(n) === 'Stays');
  assert.equal(stayHeader.length, 1, 'the channel table keeps its Stays column name');
});

test('one stay reads "1 check-in" (singular)', async () => {
  const el = await draw(await load(now), 1, 2);
  assert.ok(revenueSub(el).startsWith('1 check-in · 2 nights'), `sub-line reads "${revenueSub(el)}"`);
});

test('no stays and no nights keeps the empty state and draws no Revenue tile', async () => {
  const el = await draw(await load(now), 0, 0);
  assert.equal(revenueTile(el), undefined, 'no tile');
  const text = textOf(el);
  assert.ok(text.includes('No stays in this period'), 'the empty state title is shown');
  assert.ok(text.includes('Choose another month, or add reservations.'), 'the empty state text is shown');
});

test('red: the round 40 file reads "34 stays" in the same scenario', async () => {
  const el = await draw(await load(before()), 34, 87);
  assert.ok(revenueSub(el).startsWith('34 stays · 87 nights'), `old sub-line reads "${revenueSub(el)}"`);
});
