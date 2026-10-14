'use strict';

// QA round 8, C29 cleaner pay view (#28, #29, N1, D-81, and the Cleaner filter flag). The behaviour tests run the real
// view with the same stand-in DOM as test/qa-r2-filters.test.js and a stubbed fetch. They cover: a filter that hides a
// ticked clean drops its tick; while no cleaner names are known the Cleaner filter keeps a link's value; once the names
// load an unknown key is dropped and a known key is kept. The source checks cover the rate form and the row names.
// Frontend-only: no database.
// node --test --test-concurrency=1 test/qa-r8-c29.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), 'utf8');

// Just enough DOM for h(), ui.js, filters.js and the view: elements, text, attributes, listeners.
class Node { }
class Text extends Node { constructor(data) { super(); this.data = data; } }
const toNode = (n) => (n instanceof Node ? n : new Text(String(n)));
class Element extends Node {
  constructor(tag) {
    super();
    // A new element starts unchecked and enabled, as a real one does; h() skips false props, so the defaults matter.
    Object.assign(this, { tagName: tag, attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, className: '', checked: false, disabled: false });
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
  // The view sets textContent on the Mark paid button; a real DOM replaces the children, so the stub does the same.
  get textContent() { return textOf(this); }
  set textContent(v) { this.children = [new Text(String(v))]; }
}
const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.document = {
  createElement: (tag) => new Element(tag),
  createElementNS: (ns, tag) => new Element(tag),
  createTextNode: (data) => new Text(data),
  getElementById: () => null,
  body: new Element('body'),
  documentElement: new Element('html'),
  activeElement: null,
};
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
globalThis.history = { replaceState() { } };

// The data the view is given by GET /cleaner-pay: Rio 2210 and Tower 3 are Nena Cruz's, Loft A is Bea Reyes's, and Tower 3 is paid.
const DATA = {
  tasks: [
    { task_id: 'rio', unit_name: 'Rio 2210', property_name: 'Azure', cleaner_key: 'user:nena', cleaner_name: 'Nena Cruz', cleaning_date: '2026-10-03', pay_amount: '250.00', pay_status: 'unpaid' },
    { task_id: 'loft', unit_name: 'Loft A', property_name: 'Grass', cleaner_key: 'user:bea', cleaner_name: 'Bea Reyes', cleaning_date: '2026-10-04', pay_amount: '320.00', pay_status: 'unpaid' },
    { task_id: 'tower', unit_name: 'Tower 3', property_name: 'Azure', cleaner_key: 'user:nena', cleaner_name: 'Nena Cruz', cleaning_date: '2026-10-05', pay_amount: '200.00', pay_status: 'paid' },
  ],
  cleaners: [
    { key: 'user:nena', name: 'Nena Cruz', count: 2, unpaid: '250.00', paid: '200.00', unpriced: 0 },
    { key: 'user:bea', name: 'Bea Reyes', count: 1, unpaid: '320.00', paid: '0.00', unpriced: 0 },
  ],
  totals: { total: '770.00', paid: '200.00', unpaid: '570.00' },
};

let reply = () => DATA;
const realFetch = globalThis.fetch;
let view; let ui; let dir;
test.before(async () => {
  // The view imports app.js for the signed-in user (an owner here), so load it from a temp copy with a stub app.js.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-cleanerpay-r8-c29-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner', user_id: 1 }, requireEmailVerification: true };\n");
  fs.copyFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), path.join(dir, 'views', 'cleanerpay.js'));
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
  view = await import(pathToFileURL(path.join(dir, 'views', 'cleanerpay.js')));
  globalThis.fetch = async (url) => {
    const { pathname } = new URL(url, 'http://balayhub.test');
    const body = pathname === '/api/cleaner-rates' ? { rates: [] } : pathname === '/api/team' ? { members: [] } : reply(pathname);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body };
  };
});
test.after(() => { globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { store.clear(); reply = () => DATA; });

// Helpers for finding things in the stand-in tree.
const walk = (node, pred, out = []) => {
  if (node instanceof Element) {
    if (pred(node)) out.push(node);
    node.children.forEach((c) => walk(c, pred, out));
  }
  return out;
};
const textOf = (node) => (node instanceof Text ? node.data : node.children.map(textOf).join(''));
const cleanerSelect = (root) => walk(root, (n) => n.tagName === 'select' && n.getAttribute('aria-label') === 'Cleaner')[0];
const chip = (root, text) => walk(root, (n) => n.getAttribute('aria-label') === `Remove filter ${text}`)[0];
const rowCount = (root) => walk(root, (n) => n.tagName === 'td' && n.dataset.label === 'Cleaner').length;
const markButton = (root) => walk(root, (n) => n.tagName === 'button' && n.className === 'btn btn--primary')[0];
const rowBox = (root, task) => walk(root, (n) => n.tagName === 'input' && n.dataset.task === task)[0];
const tick = (root, task) => { const b = rowBox(root, task); b.checked = true; b.dispatch('change'); };
const untick = (root, task) => { const b = rowBox(root, task); b.checked = false; b.dispatch('change'); };
const pickCleaner = (root, value) => { const s = cleanerSelect(root); s.value = value; s.dispatch('change'); };
const open = (query) => {
  const el = new Element('div');
  return { el, done: view.cleanerPayView(el, { query }) };
};

// ---- behaviour: the real view, run with the stand-in DOM

test('before the names load, a cleaner value from a link stays on the bar, since no names are known yet', async () => {
  const { el, done } = open({ cleaner: 'user:nena' });
  assert.ok(chip(el, 'Cleaner: user:nena'), 'the link value is kept on the bar with its raw key');
  await done;
});

test('once the names load, an unknown cleaner key from a link is dropped: no chip, and every clean is listed', async () => {
  const { el, done } = open({ cleaner: 'user:zzz' });
  await done;
  assert.equal(chip(el, 'Cleaner: user:zzz'), undefined, 'the unknown value is no longer a filter');
  assert.equal(rowCount(el), 3);
});

test('once the names load, a known cleaner key from a link stays and filters the list', async () => {
  const { el, done } = open({ cleaner: 'user:nena' });
  await done;
  assert.ok(chip(el, 'Cleaner: Nena Cruz'), 'the chip names the cleaner once the names are known');
  assert.equal(rowCount(el), 2);
});

test('a filter that hides a ticked clean drops its tick: the button and the total cover only rows on screen', async () => {
  const { el, done } = open({});
  await done;
  tick(el, 'rio');
  tick(el, 'loft');
  assert.equal(textOf(markButton(el)), `Mark 2 paid · ${ui.peso(570)}`);
  pickCleaner(el, 'user:nena');
  assert.equal(rowCount(el), 2);
  assert.equal(rowBox(el, 'loft'), undefined, 'Bea Reyes is not on screen');
  assert.equal(textOf(markButton(el)), `Mark 1 paid · ${ui.peso(250)}`, 'only the visible tick counts');
  pickCleaner(el, '');
  assert.equal(rowCount(el), 3);
  assert.equal(rowBox(el, 'loft').checked, false, 'the hidden tick did not come back');
  assert.equal(textOf(markButton(el)), `Mark 1 paid · ${ui.peso(250)}`);
  untick(el, 'rio');
  assert.equal(textOf(markButton(el)), 'Mark paid');
});

// ---- source checks: the rate form, the row names, the Cleaner filter flag

test('the view keeps only visible ticks on every paint, and Mark paid sends only the ticked rows on screen', () => {
  assert.match(src, /const kept = visibleSelection\(selected, rows\);/, 'paint drops ticks the filter hides');
  assert.match(src, /const ticked = \(\) => shown\(\)\.filter\(\(x\) => selected\.has\(x\.task_id\)\);/);
  assert.match(src, /function markPaid\(\) \{\s*const rows = ticked\(\);/);
  assert.match(src, /task_ids: rows\.map\(\(x\) => x\.task_id\)/, 'Mark paid sends only the ticked rows on screen');
  assert.doesNotMatch(src, /task_ids: \[\.\.\.selected\]/, 'Mark paid no longer sends the whole selection');
});

test('the helper keeps only the rows on screen that are ticked, and never adds an unticked row', () => {
  const rows = [
    { task_id: 'rio', cleaner_key: 'user:nena' },
    { task_id: 'loft', cleaner_key: 'user:bea' },
  ];
  assert.deepEqual([...view.visibleSelection(new Set(['rio', 'loft']), rows.slice(0, 1))], ['rio']);
  assert.deepEqual([...view.visibleSelection(new Set(['loft']), rows.slice(0, 1))], []);
  assert.deepEqual([...view.visibleSelection(new Set(), rows)], []);
});

test('the Cleaner filter flag is read each time the bar is drawn, and the bar is drawn again once the names load', () => {
  assert.match(src, /options: cleanerOpts, keepUnknown: !cleanerOpts\.length \}/, 'kept only while no names are known');
  assert.match(src, /cleanerOpts = opts; renderBar\(\);/, 'the bar is drawn again after the names load, so the flag is read again');
});

test('an existing outside rate shows its name as text, not as a name box that save ignores', () => {
  assert.doesNotMatch(src, /\(!r \|\| outside\) && nameF/, 'the name box is not offered for an existing rate');
  assert.match(src, /!r && nameF/, 'a new rate still gets the name box');
  assert.match(src, /To rename, remove this rate and add it again\./);
  assert.match(src, /r && outside && h\('div', null, h\('p', null, 'Name: ', h\('strong', null, r\.assignee_name\)\)/);
});

test('the rate Edit button names its rate, like the Remove button already does', () => {
  assert.ok(src.includes("onclick: () => edit(r), 'aria-label': `Edit rate for ${nameOf(r)}`"), 'Edit names the rate');
  assert.ok(src.includes("'aria-label': `Remove rate for ${nameOf(r)}`"), 'Remove keeps its name');
});

test('the row Set pay or Edit pay and Undo paid buttons name their clean', () => {
  assert.ok(src.includes("onclick: () => editPay(x), 'aria-label': `${x.pay_amount == null ? 'Set pay' : 'Edit pay'} for ${unitOf(x)} on ${fmtDate(doneDay(x))}`"));
  assert.ok(src.includes("onclick: () => unpay(x), 'aria-label': `Undo paid for ${unitOf(x)} on ${fmtDate(doneDay(x))}`"));
});

test('no window alert, confirm or prompt is used', () => {
  assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/);
});
