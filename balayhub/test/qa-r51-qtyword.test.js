'use strict';
require('./helpers');

// QA round 51, QTYWORD (contract C3). The Supplies used refusal says "Quantity cannot be negative." like every other negative-number
// sentence in the app (it said "can't"). Runs the real suppliesModal (view copied to a temp folder, imports stubbed; frontend only).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const SRC = process.env.QA_R51_HOUSEKEEPING || path.join(JS, 'views', 'housekeeping.js');

// ---- stand-in DOM -------------------------------------------------------------------------------------------------------------
// Selectors: comma lists of compound parts (tag, .class, [attr], [attr=value], :not([attr=value])), and '*'.
function compile(selector) {
  const unquote = (v) => v.replace(/^"|"$/g, '');
  const one = (part) => {
    const p = part.trim();
    const nots = [...p.matchAll(/:not\(\[([\w-]+)=([^\]]*)\]\)/g)].map((m) => [m[1], unquote(m[2])]);
    const rest = p.replace(/:not\([^)]*\)/g, '');
    const tag = /^[a-z][\w-]*/i.exec(rest)?.[0];
    const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    const attrs = [...rest.matchAll(/\[([\w-]+)(?:=([^\]]*))?\]/g)].map((m) => [m[1], m[2] === undefined ? undefined : unquote(m[2])]);
    return (el) => (!tag || el.tagName === tag.toUpperCase())
      && classes.every((c) => el.classList.contains(c))
      && attrs.every(([k, v]) => (v === undefined ? el.hasAttribute(k) : el.getAttribute(k) === v))
      && nots.every(([k, v]) => el.getAttribute(k) !== v);
  };
  const preds = selector.split(',').map(one);
  return (el) => preds.some((p) => p(el));
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.style = {};
    this.value = '';
    this.text = undefined;
  }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => names().includes(c),
      add: (c) => { this.className = [...new Set([...names(), c])].join(' '); },
      remove: (c) => { this.className = names().filter((x) => x !== c).join(' '); },
    };
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() { }
  append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get textContent() { return this.text !== undefined ? this.text : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.text = String(v); this.children = []; }
  querySelectorAll(sel) {
    const match = compile(sel);
    const out = [];
    const walk = (n) => { for (const c of n.children) { if (match(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  focus() { globalThis.document.activeElement = this; }
}
globalThis.Element = El;
globalThis.Node = El;
globalThis.CSS = { escape: (s) => s };
globalThis.document = {
  activeElement: null,
  createElement: (tag) => new El(tag),
  createTextNode: (s) => { const n = new El('#text'); n.text = String(s); return n; },
};

// ---- the view and ui.js, loaded from a temp folder ------------------------------------------------------------------------
// The view's imports: api.js and ui.js re-export the real modules, with the one call or dialog this test drives stubbed. Other
// imports are inert stubs (the view runs them only when a screen opens, which this test does not do).
const SUPPLIES = [
  { supply_id: 's1', name: 'Towels', on_hand: 5, unit_label: '' },
  { supply_id: 's2', name: 'Soap', on_hand: 5, unit_label: '' },
];
let tmp;
let ui;
let view;

test.before(async () => {
  globalThis.__qtyState = { user: { role: 'owner' } };
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r51qty-'));
  const put = (rel, text) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put('package.json', '{"type":"module"}');
  put('api-real.js', fs.readFileSync(path.join(JS, 'api.js'), 'utf8'));
  put('ui-real.js', fs.readFileSync(path.join(JS, 'ui.js'), 'utf8'));
  put('api.js', [
    "export * from './api-real.js';",
    'export async function get() { return { supplies: globalThis.__qtySupplies }; }',
    'export async function post() { return {}; }',
  ].join('\n'));
  put('ui.js', [
    "export * from './ui-real.js';",
    '// The dialog is recorded, not drawn: the test reads its fields and onSubmit.',
    'export function formModal(opts) { globalThis.__qtyModals.push(opts); return { close() { } }; }',
  ].join('\n'));
  put('i18n.js', [
    'export const t = (en) => (globalThis.__qtyMap && globalThis.__qtyMap[en]) || en;',
    'export const extendTranslations = (m) => { globalThis.__qtyMap = m; };',
    'export const initGuestLang = () => { };',
    "export const locale = 'en';",
  ].join('\n'));
  put('app.js', 'export const state = globalThis.__qtyState;\n');
  put('filters.js', [
    'export const initFilters = () => { };',
    'export const filterBar = () => null;',
    'export const rememberFilters = () => { };',
    'export const changed = () => false;',
    'export const apiFilters = () => ({});',
  ].join('\n'));
  put(path.join('views', 'reservations.js'), 'export const addDays = (d) => d;\n');
  put(path.join('views', 'supplies.js'), "export const qtyLabel = (n, unit) => [n, unit].filter(Boolean).join(' ');\n");
  // suppliesModal is private in the view; the copy exports it and nothing else changes.
  put(path.join('views', 'housekeeping.js'), `${fs.readFileSync(SRC, 'utf8')}\nexport { suppliesModal };\n`);
  globalThis.__qtyModals = [];
  globalThis.__qtySupplies = [];
  ui = await import(pathToFileURL(path.join(tmp, 'ui.js')).href);
  view = await import(pathToFileURL(path.join(tmp, 'views', 'housekeeping.js')).href);
});

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// Opens "Supplies used" for a task with two supplies; returns the dialog's options and its field list (the form root).
async function openSupplies() {
  globalThis.__qtySupplies = SUPPLIES;
  globalThis.__qtyModals.length = 0;
  await view.suppliesModal({ task_id: 'task-1' }, () => { });
  assert.equal(globalThis.__qtyModals.length, 1, 'the dialog opens once');
  const [opts] = globalThis.__qtyModals;
  return { opts, list: opts.fields };
}
const row = (list, id) => list.querySelector(`[data-field="qty-${id}"]`);
const box = (list, id) => row(list, id).querySelector('input.hk-qty');
const line = (list, id) => row(list, id).querySelector('.error');
const byId = (root, id) => (id ? root.querySelectorAll('*').find((el) => el.getAttribute('id') === id) || null : null);

// The refused row says it the way a screen reader needs: its quantity box names an alert on its own row, and the alert holds the message.
function assertSaid(list, id, message) {
  const b = box(list, id);
  const described = byId(list, b.getAttribute('aria-describedby'));
  assert.ok(described, `the quantity box for ${id} names an element that exists`);
  assert.equal(described, line(list, id), "the named element is the row's own error line");
  assert.equal(described.getAttribute('role'), 'alert');
  assert.equal(described.textContent, message);
  assert.equal(b.getAttribute('aria-invalid'), 'true');
  assert.equal(globalThis.document.activeElement, b, 'focus is on the first wrong box');
}

const WORD = 'Quantity cannot be negative.';

test('a negative quantity is refused on its row with "Quantity cannot be negative."', async () => {
  globalThis.__qtyState.user.role = 'owner';
  const { opts, list } = await openSupplies();
  box(list, 's1').value = '-1';
  const err = await opts.onSubmit({}).catch((e) => e);
  assert.deepEqual(err.fields, { 'qty-s1': WORD });
  ui.showErrors(list, err.fields);
  assert.equal(line(list, 's1').textContent, WORD);
  assert.equal(line(list, 's2').textContent, '');
});

test('a cleaner in Taglish reads "Hindi puwedeng negatibo ang dami."', async () => {
  globalThis.__qtyState.user.role = 'cleaner';
  const { opts, list } = await openSupplies();
  box(list, 's2').value = '-3';
  const err = await opts.onSubmit({}).catch((e) => e);
  assert.deepEqual(err.fields, { 'qty-s2': 'Hindi puwedeng negatibo ang dami.' });
  globalThis.__qtyState.user.role = 'owner';
});

test("the view no longer contains \"can't be negative\"", () => {
  assert.equal(/can(?:'|\\')t be negative/.test(fs.readFileSync(SRC, 'utf8')), false);
});
