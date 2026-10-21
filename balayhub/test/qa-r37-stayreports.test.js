'use strict';
require('./helpers');

// QA round 37 STAYREPORTS (D-119). Frontend only: no database, no server.
// MNY-1: a dimmed Download CSV is an <a> with no href, which is not focusable; it gets tabindex and the link role (D-117).
// MNY-2: a custom range over two years is not sent; this month is shown and the status line says so.
// The page is mounted from a temp copy of public/js with a stand-in DOM and a stub fetch (as test/qa-r4-c15.test.js does).
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
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this, currentTarget: this, type }); }
  append(...nodes) { this.children.push(...nodes.map(toNode)); }
  replaceChildren(...nodes) { this.children = nodes.map(toNode); }
  contains() { return false; }
  focus() {}
  querySelector(sel) { const m = /^\[aria-label="(.+)"\]$/.exec(sel); return m ? walk(this, (n) => n.getAttribute('aria-label') === m[1])[0] || null : null; }
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

let calls = [];
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const EMPTY = { period: '2026-10', month: '2026-10', from: '2026-10-01', to_exclusive: '2026-11-01', totals: { nights: 0, stays: 0 }, channels: [], units: [], expenses_by_category: [] };
globalThis.fetch = async (url) => {
  calls.push(url);
  if (url.startsWith('/api/listings')) return json({ listings: [] });
  return json(EMPTY);
};
const reportCalls = () => calls.filter((u) => u.startsWith('/api/stay-reports?'));
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };

const SRC = path.join(__dirname, '../public/js');
const dirs = [];
// Mounts a copy of the app's scripts with `viewSource` as views/stayreports.js; returns its view function.
async function load(viewSource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r37-sr-'));
  dirs.push(dir);
  fs.cpSync(SRC, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: { role: "owner" } };\nexport const navigate = () => {};\nexport const refreshUser = async () => {};\nexport const logout = () => {};\nexport const homeRoute = () => "#/home";\nexport const afterLogin = async () => {};\n');
  fs.writeFileSync(path.join(dir, 'views', 'stayreports.js'), viewSource);
  return (await import(pathToFileURL(path.join(dir, 'views', 'stayreports.js')))).stayReportsView;
}
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); calls = []; });

async function open(view, query) {
  calls = [];
  const el = new Element('div');
  await view(el, { query });
  return el;
}
const exportLink = (el) => walk(el, (n) => n.tagName === 'a' && textOf(n) === 'Download CSV')[0];
const exportNote = (el) => ({ text: walk(el, (n) => n.getAttribute('id') === 'stay-report-export-note')[0].textContent });
const statusLine = (el) => walk(el, (n) => n.getAttribute('id') === 'stay-report-status')[0];
const box = (el, name) => walk(el, (n) => n.tagName === 'input' && n.getAttribute('aria-label') === name)[0];
async function typeDate(el, name, value) { const b = box(el, name); b.value = value; b.dispatch('change'); await settle(); }

const now = fs.readFileSync(path.join(SRC, 'views/stayreports.js'), 'utf8');
const before = () => execFileSync('git', ['-C', path.join(__dirname, '../..'), 'show', '926e041:balayhub/public/js/views/stayreports.js'], { encoding: 'utf8' });
const dimmed = (el) => {
  const a = exportLink(el);
  return a.getAttribute('href') === null && a.getAttribute('aria-disabled') === 'true' && a.getAttribute('tabindex') === '0' && a.getAttribute('role') === 'link'
    && a.getAttribute('aria-describedby') === 'stay-report-export-note';
};

async function scenario(view) {
  const out = {};
  // (a) a range over two years
  let el = await open(view, { period: 'range', from: '2026-10-01', to: '2030-06-01' });
  out.aDimmed = dimmed(el);
  out.aNote = exportNote(el).text;
  out.aSent = reportCalls().map((u) => u);
  out.aStatus = statusLine(el).textContent;
  out.aToInvalid = box(el, 'To').getAttribute('aria-invalid');
  // (b) fixed by shortening the end
  await typeDate(el, 'To', '2026-10-31');
  const a = exportLink(el);
  out.bHref = a.getAttribute('href');
  out.bClean = ['tabindex', 'role', 'aria-disabled'].every((k) => a.getAttribute(k) === null);
  out.bSent = reportCalls();
  // (c) a typed year outside 2000 to 2100
  await typeDate(el, 'From', '1900-01-01');
  out.cDimmed = dimmed(el);
  out.cNote = exportNote(el).text;
  return out;
}

test('a range over two years is not sent, this month is shown, and the dimmed export stays in the tab order', async () => {
  const r = await scenario(await load(now));
  assert.equal(r.aDimmed, true, 'dimmed link has tabindex 0, role link, aria-describedby, no href');
  assert.equal(r.aNote, 'Choose up to two years to export.');
  assert.equal(r.aSent.length, 1);
  assert.ok(!r.aSent[0].includes('from=2026-10-01&to=2030-06-01'), 'the refused range is not sent');
  assert.match(r.aSent[0], /month=/);
  assert.equal(r.aStatus, 'Choose up to two years. Showing this month for now.');
  assert.equal(r.aToInvalid, 'true', 'the To box is marked');
});

test('shortening the range sends it and gives the export its address back', async () => {
  const r = await scenario(await load(now));
  assert.match(r.bHref, /^\/api\/stay-reports\/export.*from=2026-10-01&to=2026-10-31/);
  assert.equal(r.bClean, true, 'no tabindex, role or aria-disabled once it has an address');
  assert.ok(r.bSent.some((u) => u.includes('from=2026-10-01&to=2026-10-31')), 'the report request carried the range');
});

test('a typed year outside 2000 to 2100 dims the export but keeps it focusable', async () => {
  const r = await scenario(await load(now));
  assert.equal(r.cDimmed, true);
  assert.equal(r.cNote, 'Fix the dates to export.');
});

test('red: the round 36 file fails the same scenario', async () => {
  const r = await scenario(await load(before()));
  assert.equal(r.aDimmed, false, 'no tabindex before the fix');
  assert.ok(r.aSent[0].includes('from=2026-10-01&to=2030-06-01'), 'the refused range was sent');
  assert.equal(r.cDimmed, false);
});
