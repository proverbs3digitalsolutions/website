'use strict';
require('./helpers');

// QA round 38, DEPOSITS (public/js/views/deposits.js, the deposit damage photo box; D-120). A picked photo uploads at once.
// While the upload waits the box is aria-disabled, not disabled: it keeps focus, a click opens no file chooser and a second
// pick sends nothing. A refused photo ends the wait, says why under the box, and the box is free again.
// Frontend only: the view is copied to a temp folder with stand-ins for ui.js, api.js, filters.js and app.js, and a small
// page that drops focus when the focused control is disabled (a browser does the same).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SENTENCE = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
const VIEW_SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'deposits.js'), 'utf8');

// Stand-ins for the modules the view imports. ui.js's uploadField and fileRefused are copied from public/js/ui.js.
const STUBS = {
  'package.json': '{"type":"module"}',
  'api.js': [
    'export const get = (...a) => globalThis.__r38.get(...a);',
    'export const post = (...a) => globalThis.__r38.post(...a);',
    'export const uploadFile = (...a) => globalThis.__r38.uploadFile(...a);',
    "export const qs = () => '';",
    "export const PHOTO_KINDS = 'JPG, PNG or WEBP';",
  ].join('\n'),
  'filters.js': [
    'export const initFilters = () => ({});',
    'export const filterBar = () => null;',
    'export const changed = () => ({});',
    'export const apiFilters = () => ({});',
  ].join('\n'),
  'app.js': "export const state = { user: { role: 'owner' } };",
  'ui.js': [
    'const S = () => globalThis.__r38;',
    'export const h = (tag, props, ...kids) => S().h(tag, props, kids);',
    "export const peso = (n) => 'PHP ' + Number(n).toFixed(2);",
    'export const fmtDate = (d) => String(d);',
    'export const fmtDateTime = (d) => String(d);',
    'export const field = () => null;',
    'export const formModal = () => null;',
    'export const confirmDialog = async () => true;',
    'export const toast = (msg, kind) => S().toast(msg, kind);',
    "export const badge = (cls, text) => h('span', { class: cls }, text);",
    "export const todayManila = () => '2026-10-21';",
    "export const emptyState = () => h('div', {});",
    "export const parseAmount = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));",
    "export const fileRefused = (err) => ['EMPTY_FILE', 'BAD_FILE_CONTENT', 'UNSUPPORTED_FILE'].includes(err?.code) || err?.status === 413 || err?.status === 415;",
    'let uploadSeq = 0;',
    'export function uploadField(input) {',
    "  const line = h('div', { class: 'error', id: 'upload-err-' + (++uploadSeq), role: 'alert' });",
    "  input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), line.id].filter(Boolean).join(' '));",
    "  const wrap = h('div', { class: 'field' }, input, line);",
    "  const clear = () => { line.textContent = ''; wrap.classList.remove('field--invalid'); input.removeAttribute('aria-invalid'); };",
    "  const show = (msg) => { line.textContent = msg; wrap.classList.add('field--invalid'); input.setAttribute('aria-invalid', 'true'); input.focus(); };",
    '  return { wrap, show, clear };',
    '}',
  ].join('\n'),
};

// The stand-in page. A node keeps its attributes, its handlers (onclick, onchange) and its children. Focus moves only to an
// enabled node, and setting `disabled` on the focused node drops focus to the body.
function makeDom() {
  const dom = { chooser: 0, body: null, active: null };
  const node = (tag) => {
    const n = {
      tagName: tag.toUpperCase(), id: '', attrs: {}, children: [], classes: new Set(), textContent: '', value: '', files: [],
      onclick: null, onchange: null, _disabled: false,
      get disabled() { return this._disabled; },
      set disabled(v) { this._disabled = Boolean(v); if (this._disabled && dom.active === this) dom.active = dom.body; },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      focus() { if (!this._disabled) dom.active = this; },
      classList: {
        add(c) { n.classes.add(c); },
        remove(c) { n.classes.delete(c); },
        contains(c) { return n.classes.has(c); },
      },
    };
    return n;
  };
  dom.body = node('body');
  dom.active = dom.body;
  dom.h = (tag, props, kids) => {
    const n = node(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'style') continue;
      if (typeof v === 'function') n[k] = v;
      else if (k === 'id') { n.id = v; n.setAttribute('id', v); }
      else n.setAttribute(k, v);
    }
    const add = (x) => {
      if (Array.isArray(x)) { x.forEach(add); return; }
      if (x === false || x === null || x === undefined || x === true) return;
      if (typeof x === 'object' && x.tagName) n.children.push(x);
      else n.children.push({ tagName: '#TEXT', textContent: String(x) });
    };
    kids.forEach(add);
    return n;
  };
  // A press: the control takes focus, then its click handler runs. A file box whose click was not stopped opens the chooser.
  dom.click = (el) => {
    el.focus();
    const ev = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    if (el.onclick) el.onclick(ev);
    if (!ev.defaultPrevented && el.tagName === 'INPUT' && el.attrs.type === 'file') dom.chooser += 1;
    return ev;
  };
  // The person chose a file: the change handler runs with the file in the box. Returns its promise.
  dom.pick = (el, file) => { el.files = [file]; return el.onchange({ target: el }); };
  return dom;
}

const find = (root, pred) => {
  for (const c of root.children || []) {
    if (pred(c)) return c;
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
};

const DEPOSIT = {
  suggested: 1000,
  suggested_deduction: 0,
  deposit: {
    deposit_id: 9, amount: '1000.00', method: 'cash', received_date: '2026-10-20', reference_number: null,
    deduction_amount: '0.00', deduction_reason: null, refund_amount: null, refund_method: null, refund_reference: null,
    settled_at: null, status: 'held', files: [],
  },
};

const FILE_A = { name: 'damage-a.png', type: 'image/png' };
const FILE_B = { name: 'damage-b.png', type: 'image/png' };

let deposits;
let tmp;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-deposits-r38-'));
  for (const [name, text] of Object.entries(STUBS)) fs.writeFileSync(path.join(tmp, name), text);
  fs.mkdirSync(path.join(tmp, 'views'));
  fs.writeFileSync(path.join(tmp, 'views', 'deposits.js'), VIEW_SRC);
  deposits = await import(pathToFileURL(path.join(tmp, 'views', 'deposits.js')).href);
});
test.after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

function setup() {
  const dom = makeDom();
  const ctx = {
    dom, h: dom.h, toasts: [], uploads: [], rerenders: 0,
    get: async () => DEPOSIT,
    post: async () => { throw new Error('no post expected'); },
    uploadFile: (kind, id, file) => new Promise((resolve, reject) => { ctx.uploads.push({ kind, id, file, resolve, reject }); }),
    toast: (msg, kind) => { ctx.toasts.push({ msg, kind }); },
  };
  globalThis.__r38 = ctx;
  return ctx;
}

async function mountCard(ctx) {
  const r = { booking_id: 7, status: 'checked_in', check_out: '2026-10-25', checked_out_at: null, guest_email: null, guest_has_email: false };
  const card = await deposits.depositCard(r, () => { ctx.rerenders += 1; });
  const input = find(card, (n) => n.tagName === 'INPUT' && n.attrs.type === 'file');
  assert.ok(input, 'the deposit card has its photo box');
  return { card, input };
}

function assertBusy(ctx, input) {
  assert.equal(input.getAttribute('aria-disabled'), 'true', 'the box is marked busy while the upload waits');
  assert.notEqual(input.disabled, true, 'the box is not disabled');
  assert.equal(ctx.dom.active, input, 'the box keeps focus while the upload waits');
}

test('a picked photo keeps the box focused while it uploads: a click or a second pick sends nothing', async () => {
  const ctx = setup();
  const { input } = await mountCard(ctx);
  ctx.dom.click(input);
  assert.equal(ctx.dom.chooser, 1, 'the first press opens the chooser');

  const first = ctx.dom.pick(input, FILE_A);
  assert.equal(ctx.uploads.length, 1, 'one upload is sent');
  assertBusy(ctx, input);

  const during = ctx.dom.click(input);
  assert.equal(during.defaultPrevented, true, 'a click during the upload is stopped');
  assert.equal(ctx.dom.chooser, 1, 'and opens no file chooser');
  await ctx.dom.pick(input, FILE_B);
  assert.equal(ctx.uploads.length, 1, 'a second pick sends no second upload');
  assertBusy(ctx, input);

  ctx.uploads[0].resolve({});
  await first;
  assert.deepEqual(ctx.toasts.map((t) => t.msg), ['Photo added.']);
  assert.equal(ctx.rerenders, 1, 'the redraw replaces the box, so its mark goes with it');
});

test('a refused photo ends the wait: the box is free and focused, and the line under it says why', async () => {
  const ctx = setup();
  const { card, input } = await mountCard(ctx);
  ctx.dom.click(input);
  const pending = ctx.dom.pick(input, FILE_A);
  assertBusy(ctx, input);

  ctx.uploads[0].reject(Object.assign(new Error(SENTENCE), { code: 'BAD_FILE_CONTENT', status: 415 }));
  await pending;
  assert.equal(input.getAttribute('aria-disabled'), null, 'the mark goes when the wait ends');
  assert.notEqual(input.disabled, true, 'the box is not disabled');
  assert.equal(ctx.dom.active, input, 'focus stays on the box');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(input.value, '', 'the chosen file is cleared');
  assert.equal(find(card, (n) => n.attrs?.role === 'alert').textContent, SENTENCE);
  assert.deepEqual(ctx.toasts, [], 'a file refusal is said under the box, not in a toast');

  ctx.dom.click(input);
  assert.equal(ctx.dom.chooser, 2, 'the chooser opens again');
});

test('a refusal that is not about the file goes to a toast, and the box is free again', async () => {
  const ctx = setup();
  const { card, input } = await mountCard(ctx);
  ctx.dom.click(input);
  const pending = ctx.dom.pick(input, FILE_A);
  assertBusy(ctx, input);

  ctx.uploads[0].reject(Object.assign(new Error('QA r38 refused.'), { status: 409 }));
  await pending;
  assert.equal(input.getAttribute('aria-disabled'), null, 'the mark goes when the wait ends');
  assert.notEqual(input.disabled, true, 'the box is not disabled');
  assert.deepEqual(ctx.toasts, [{ msg: 'QA r38 refused.', kind: 'error' }]);
  assert.equal(find(card, (n) => n.attrs?.role === 'alert').textContent, '');

  ctx.dom.click(input);
  assert.equal(ctx.dom.chooser, 2, 'the chooser opens again');
});
