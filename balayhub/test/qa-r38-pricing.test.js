'use strict';
require('./helpers');

// QA round 38, lane PRICING (pricing.js, audit rows 4 and 5; D-120, contract C1). In Bulk changes a press on Preview or Apply
// marks that button aria-disabled while its own request runs, never disabled: a disabled button drops focus to the page.
// A second press during the wait sends no second request, and the mark goes when the request settles. Apply's switch-off after
// an edit (no fresh preview) is state and stays native. The bulk form is loaded from a temp copy of the real ui.js and
// pricing.js, with a stand-in DOM and a fetch stub; openModal and toast are captured.
// node --test --test-concurrency=1 test/qa-r38-pricing.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '..', 'public', 'js');

// Just enough DOM for ui.js (h, children, classes, attributes) and the bulk form. A control switched off while it has focus
// gives focus to the body, as a browser does; that is the behaviour under test.
class Node {
  constructor() { this.parentElement = null; }
}
class Text extends Node {
  constructor(data) { super(); this.data = String(data); }
  get textContent() { return this.data; }
}
const toNode = (n) => (n instanceof Node ? n : new Text(n));

// The selectors the bulk form uses: tags, classes, ids, [attr], [attr=value], :checked, :not([attr=value]) and descendant chains.
const TOKEN = /\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|([^\]"]*)))?\]|:checked|:not\(\[([\w-]+)=([^\]]*)\]\)/y;
function matchCompound(el, sel) {
  let pos = 0;
  const tag = /^[a-z][a-z0-9]*/i.exec(sel);
  if (tag) {
    if (el.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
    pos = tag[0].length;
  }
  while (pos < sel.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(sel);
    if (!m) throw new Error(`QA r38 stand-in DOM cannot match the selector "${sel}"`);
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined && !el.classList.contains(m[1])) return false;
    if (m[2] !== undefined && el.getAttribute('id') !== m[2]) return false;
    if (m[3] !== undefined) {
      const have = el.getAttribute(m[3]);
      const want = m[4] ?? m[5];
      if (have === null || (want !== undefined && have !== want)) return false;
    }
    if (m[0] === ':checked' && !el.checked) return false;
    if (m[6] !== undefined && el.getAttribute(m[6]) === m[7]) return false;
  }
  return true;
}
function matchesChain(el, parts) {
  if (!matchCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let a = el.parentElement; i >= 0 && a; a = a.parentElement) {
    if (a instanceof Element && matchCompound(a, parts[i])) i -= 1;
  }
  return i < 0;
}

class Element extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tagName: tag.toUpperCase(), attrs: {}, children: [], listeners: {}, style: {}, dataset: {}, _disabled: false, _checked: false, _value: undefined });
  }
  get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n === doc.body; }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = String(v); }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      add: (...c) => { this.className = [...new Set([...names(), ...c])].join(' '); },
      remove: (...c) => { this.className = names().filter((x) => !c.includes(x)).join(' '); },
      contains: (c) => names().includes(c),
    };
  }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = Boolean(v);
    if (this._disabled && doc.activeElement === this) doc.activeElement = doc.body;
  }
  get checked() { return this._checked; }
  set checked(v) { this._checked = Boolean(v); }
  get value() {
    if (this.tagName === 'OPTION') return this.getAttribute('value') ?? this.textContent;
    if (this.tagName === 'SELECT') {
      if (this._value !== undefined) return this._value;
      const first = this.descendants().find((d) => d.tagName === 'OPTION');
      return first ? first.value : '';
    }
    return this._value ?? this.getAttribute('value') ?? '';
  }
  set value(v) { this._value = String(v); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.setChildren(v === '' ? [] : [new Text(v)]); }
  // The named controls of a form; a radio group reads as the value of its checked radio.
  get elements() {
    const out = {};
    const all = this.descendants();
    for (const name of new Set(all.map((d) => d.getAttribute('name')).filter(Boolean))) {
      const group = all.filter((d) => d.getAttribute('name') === name);
      out[name] = group[0].getAttribute('type') === 'radio'
        ? { get value() { return (group.find((d) => d.checked) || group[0]).value; } }
        : group[0];
    }
    return out;
  }
  descendants() {
    const out = [];
    const walk = (node) => node.children.forEach((c) => { if (c instanceof Element) { out.push(c); walk(c); } });
    walk(this);
    return out;
  }
  querySelectorAll(sel) {
    const chains = sel.split(',').map((s) => s.trim().split(/\s+/));
    return this.descendants().filter((el) => chains.some((parts) => matchesChain(el, parts)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  // Runs the listeners the way a press or an edit would; resolves when the async handlers have settled.
  dispatch(type, event = {}) {
    const ev = { type, target: this, preventDefault() {}, ...event };
    return Promise.all((this.listeners[type] || []).map((fn) => fn(ev)));
  }
  focus() { if (!this._disabled && this.isConnected) doc.activeElement = this; }
  setChildren(list) {
    for (const c of this.children) c.parentElement = null;
    this.children = [];
    this.append(...list);
  }
  replaceChildren(...nodes) { this.setChildren(nodes); }
  append(...nodes) {
    for (const n of nodes) {
      const node = toNode(n);
      node.parentElement?.removeChild(node);
      node.parentElement = this;
      this.children.push(node);
    }
  }
  removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentElement = null; }
  remove() { this.parentElement?.removeChild(this); }
}

const doc = {
  body: null,
  activeElement: null,
  createElement: (tag) => new Element(tag),
  createElementNS: (ns, tag) => new Element(tag),
  createTextNode: (data) => new Text(data),
  getElementById: (id) => doc.body.descendants().find((d) => d.getAttribute('id') === id) || null,
};
doc.body = new Element('body');
doc.activeElement = doc.body;
globalThis.document = doc;
globalThis.Node = Node;
globalThis.Element = Element;
globalThis.Text = Text;
globalThis.CSS = { escape: (s) => String(s) };

// The fetch stub: the tag list answers; the bulk request waits until the test answers it.
let sent;
let waiting;
let toasts;
let rerendered;
let modal;
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
});
globalThis.fetch = (url, opts = {}) => {
  const call = { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined };
  sent.push(call);
  if (url === '/api/tags') return Promise.resolve(reply(200, { tags: [] }));
  if (url === '/api/bulk/prices') return new Promise((resolve) => waiting.push((status, body) => resolve(reply(status, body))));
  return Promise.reject(new Error(`QA r38 pricing test: unexpected ${opts.method} ${url}`));
};

const tick = () => new Promise((resolve) => setImmediate(resolve));
// Reads as the control's name when it has focus, else what has it instead, so a failure says where focus went.
const focusOn = (el, name) => (doc.activeElement === el ? name : `${doc.activeElement.tagName} (focus left ${name})`);
const answerNext = (status, body) => waiting.shift()(status, body);
const bulkPosts = (dry) => sent.filter((c) => c.method === 'POST' && c.url === '/api/bulk/prices' && c.body.dry_run === dry);
const PREVIEW = { count: 2, changes: [{ unit_name: 'Loft A', date: '2027-01-01', from_price: 1000, to_price: 900 }], below_lowest: 0, skipped: [] };
const LISTINGS = [{ unit_id: 'u1', unit_name: 'Loft A', property_name: 'Pine Suites' }];

const UI_WRAPPER = [
  "export * from './ui-real.js';",
  'export function openModal(options) { return globalThis.__r38.openModal(options); }',
  'export function toast(message, kind) { return globalThis.__r38.toast(message, kind); }',
  '',
].join('\n');

let dir;
let bulkModal;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r38-pricing-'));
  fs.cpSync(JS, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  // The real ui.js moves aside; the copy's ui.js re-exports it and captures openModal and toast.
  fs.renameSync(path.join(dir, 'ui.js'), path.join(dir, 'ui-real.js'));
  fs.writeFileSync(path.join(dir, 'ui.js'), UI_WRAPPER);
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner' } };\n");
  // addDays is taken from the real reservations.js; the rest of that module is not needed by pricing.js.
  const reservations = fs.readFileSync(path.join(JS, 'views', 'reservations.js'), 'utf8');
  const addDays = /export function addDays\(dateStr, n\) \{\n[\s\S]*?\n\}\n/.exec(reservations);
  assert.ok(addDays, 'addDays is found in reservations.js');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), addDays[0]);
  // The one change to the copy: bulkModal is exported, so the test opens the bulk form the way the Bulk changes button does.
  const pricing = fs.readFileSync(path.join(JS, 'views', 'pricing.js'), 'utf8');
  const decl = '\nasync function bulkModal(';
  assert.equal(pricing.split(decl).length - 1, 1, 'bulkModal is declared once in pricing.js');
  fs.writeFileSync(path.join(dir, 'views', 'pricing.js'), pricing.replace(decl, '\nexport async function bulkModal('));
  globalThis.__r38 = {
    openModal({ body }) {
      modal = { body, closed: 0 };
      const opened = modal;
      doc.body.append(body);
      return { close: () => { opened.closed += 1; } };
    },
    toast(message, kind) { toasts.push({ message, kind }); },
  };
  ({ bulkModal } = await import(pathToFileURL(path.join(dir, 'views', 'pricing.js')).href));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test.beforeEach(() => {
  sent = [];
  waiting = [];
  toasts = [];
  rerendered = 0;
  modal = null;
  doc.body.setChildren([]);
  doc.activeElement = doc.body;
});

// Opens Bulk changes with one listing and the "Change prices by %" action (-10), as a person would fill it.
async function openBulk() {
  await bulkModal({ listings: LISTINGS, rerender: () => { rerendered += 1; } });
  const form = modal.body;
  form.elements.action.value = 'percent';
  form.elements.percent.value = '-10';
  form.querySelector('input[name=unit]').checked = true;
  return { form, previewBtn: form.querySelector('[type=submit]'), applyBtn: form.querySelector('.btn--primary') };
}

// Opens the form and lets one preview succeed, so Apply is on.
async function openPreviewed() {
  const opened = await openBulk();
  const pressed = opened.form.dispatch('submit');
  await tick();
  answerNext(200, PREVIEW);
  await pressed;
  return opened;
}

const applyPosts = () => bulkPosts(false);

test('Preview keeps focus while its request runs, is aria-disabled and not disabled, and a second press sends nothing', async () => {
  const { form, previewBtn, applyBtn } = await openBulk();
  previewBtn.focus();
  const pressed = form.dispatch('submit');
  await tick();
  assert.equal(previewBtn.getAttribute('aria-disabled'), 'true');
  assert.equal(previewBtn.disabled, false);
  assert.equal(focusOn(previewBtn, 'Preview'), 'Preview');
  assert.equal(bulkPosts(true).length, 1);
  form.dispatch('submit'); // a second press (or Enter in a field) during the wait
  await tick();
  assert.equal(bulkPosts(true).length, 1);
  assert.equal(focusOn(previewBtn, 'Preview'), 'Preview');
  answerNext(200, PREVIEW);
  await pressed;
  assert.equal(previewBtn.getAttribute('aria-disabled'), null);
  assert.equal(previewBtn.disabled, false);
  assert.equal(previewBtn.textContent, 'Preview');
  assert.equal(focusOn(previewBtn, 'Preview'), 'Preview');
  assert.equal(applyBtn.disabled, false, 'a preview with changes turns Apply on');
});

test('Preview after a refusal clears its busy mark, keeps focus on Preview and shows the refusal', async () => {
  const { form, previewBtn } = await openBulk();
  previewBtn.focus();
  const pressed = form.dispatch('submit');
  await tick();
  answerNext(409, { error: 'QA r38 refused.' });
  await pressed;
  assert.equal(previewBtn.getAttribute('aria-disabled'), null);
  assert.equal(previewBtn.disabled, false);
  assert.equal(previewBtn.textContent, 'Preview');
  assert.equal(focusOn(previewBtn, 'Preview'), 'Preview');
  assert.ok(form.querySelector('.alert--error'), 'the refusal is shown on the form');
});

test('Apply keeps focus while its request runs, is aria-disabled, and a second press sends nothing', async () => {
  const { form, applyBtn } = await openPreviewed();
  applyBtn.focus();
  const pressed = applyBtn.dispatch('click');
  await tick();
  assert.equal(applyBtn.getAttribute('aria-disabled'), 'true');
  assert.equal(applyBtn.disabled, false);
  assert.equal(focusOn(applyBtn, 'Apply'), 'Apply');
  assert.equal(applyPosts().length, 1);
  applyBtn.dispatch('click'); // a second press during the wait
  await tick();
  assert.equal(applyPosts().length, 1);
  assert.equal(focusOn(applyBtn, 'Apply'), 'Apply');
  answerNext(409, { error: 'QA r38 refused.' });
  await pressed;
  assert.equal(applyBtn.getAttribute('aria-disabled'), null);
  assert.equal(applyBtn.disabled, false);
  assert.equal(applyBtn.textContent, 'Apply');
  assert.equal(focusOn(applyBtn, 'Apply'), 'Apply');
  assert.ok(form.querySelector('.alert--error'), 'the refusal is shown on the form');
});

test('Apply on success closes the form, redraws the page and says what changed', async () => {
  const { applyBtn } = await openPreviewed();
  applyBtn.focus();
  const pressed = applyBtn.dispatch('click');
  await tick();
  answerNext(200, { count: 2, skipped: [] });
  await pressed;
  assert.equal(modal.closed, 1);
  assert.equal(rerendered, 1);
  assert.equal(toasts.at(-1).message, '2 nights updated.');
});

test('an edit after a preview switches Apply off as state (native disabled), not as a busy mark', async () => {
  const { form, applyBtn } = await openPreviewed();
  form.dispatch('change', { target: form.elements.percent });
  assert.equal(applyBtn.disabled, true);
  assert.equal(applyBtn.getAttribute('aria-disabled'), null);
});

test('an edit while Apply waits, then a refusal, leaves Apply off until a fresh preview', async () => {
  const { form, applyBtn } = await openPreviewed();
  const pressed = applyBtn.dispatch('click');
  await tick();
  form.elements.percent.focus();
  form.dispatch('input', { target: form.elements.percent }); // the preview is no longer fresh
  answerNext(409, { error: 'QA r38 refused.' });
  await pressed;
  assert.equal(applyBtn.disabled, true);
  assert.equal(applyBtn.getAttribute('aria-disabled'), null);
});

test('a refusal with no field messages shows the server\'s own words, not the generic line', async () => {
  const { form, previewBtn } = await openBulk();
  previewBtn.focus();
  const pressed = form.dispatch('submit');
  await tick();
  answerNext(409, { error: 'QA r38 refused.' });
  await pressed;
  assert.equal(form.querySelector('.alert--error').textContent, 'QA r38 refused.');
});

test('a refusal that names a field marks that field and keeps the generic line on the form', async () => {
  const { form } = await openBulk();
  const pressed = form.dispatch('submit');
  await tick();
  answerNext(400, { error: 'QA r38 refused.', code: 'VALIDATION', fields: { from: 'QA r38 first night.' } });
  await pressed;
  assert.ok(form.querySelector('[data-field="from"]').classList.contains('field--invalid'), 'the first night is marked');
  assert.equal(form.querySelector('[data-field="from"] .error').textContent, 'QA r38 first night.');
  assert.equal(form.querySelector('.alert--error').textContent, 'Please check the highlighted fields.');
});
