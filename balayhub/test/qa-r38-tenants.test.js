'use strict';
require('./helpers');

// QA round 38, TENANTS (lease document Upload, audit row 36). A press that waits for its upload keeps focus:
// it is marked aria-disabled, never disabled, because a disabled control drops focus to the page (D-97, D-105, D-120).
// Frontend only: the lease documents handler is pulled out of the source by brace matching and run against a stand-in page.

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'tenants.js'), 'utf8');
const UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ui.js'), 'utf8');

// Index of the closing brace for the "{" at `open`. Skips strings, template literals and comments.
function blockEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; continue; }
    if (c === "'" || c === '"' || c === '`') {
      for (let j = i + 1; ; j++) { if (text[j] === '\\') { j++; continue; } if (text[j] === c) { i = j; break; } }
      continue;
    }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces');
}

const docsStart = SRC.indexOf('const leaseDocs = async (lease) => {');
assert.ok(docsStart > 0, 'leaseDocs is in tenants.js');
const docsOpen = SRC.indexOf('{', docsStart);
// The arrow function as written: "async (lease) => { ... }".
const leaseDocsSrc = `async (lease) => ${SRC.slice(docsOpen, blockEnd(SRC, docsOpen) + 1)}`;

const fileRefusedSrc = UI.match(/^export const fileRefused = .*;$/m)[0].replace(/^export /, '');
const fileRefused = new Function(`${fileRefusedSrc} return fileRefused;`)();

const NAMES = ['get', 'filesList', 'h', 'uploadField', 'openModal', 'unitLabel', 'uploadFile', 'toast', 'fileRefused', 'document'];

// A stand-in page: a focused control that becomes disabled drops focus to the body, as a browser does.
function makeWorld() {
  const w = { active: null, body: null };
  const make = (tag) => {
    const el = {
      tagName: tag.toUpperCase(), attrs: {}, children: [], textContent: '', listeners: {}, files: [], _disabled: false,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      focus() { if (!this._disabled) w.active = this; },
      replaceChildren(...nodes) { this.children = nodes.flat(Infinity); this.textContent = ''; },
      get disabled() { return this._disabled; },
      set disabled(v) { this._disabled = Boolean(v); if (this._disabled && w.active === this) w.active = w.body; },
    };
    return el;
  };
  w.body = make('body');
  w.active = w.body;
  const h = (tag, props, ...kids) => {
    const el = make(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'disabled') el.disabled = Boolean(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(Infinity)) {
      if (c === null || c === undefined || c === false || c === true) continue;
      if (typeof c === 'string' || typeof c === 'number') el.textContent += String(c);
      else el.children.push(c);
    }
    return el;
  };
  return { w, make, h };
}

function world() {
  const { w, make, h } = makeWorld();
  const log = { requests: [], pending: [], toasts: [], modal: null, input: null, shown: [] };
  const stubs = {
    get: async () => ({ files: [] }),
    filesList: () => make('div'),
    h,
    uploadField: (input) => {
      log.input = input;
      return {
        wrap: make('div'),
        // Like the real uploadField: a refusal is shown under the box, and the box takes focus.
        show: (msg) => { log.shown.push(msg); input.focus(); },
        clear: () => {},
      };
    },
    openModal: (m) => { log.modal = m; },
    unitLabel: (n) => n,
    uploadFile: (...args) => { log.requests.push(args); return new Promise((resolve, reject) => log.pending.push({ resolve, reject })); },
    toast: (m) => log.toasts.push(m),
    fileRefused,
    document: { querySelector: () => null },
  };
  const leaseDocs = new Function(...NAMES, `return (${leaseDocsSrc});`)(...NAMES.map((n) => stubs[n]));
  return { w, log, leaseDocs };
}

const find = (node, pred) => {
  for (const c of node.children) {
    if (pred(c)) return c;
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
};

// A mouse press: the control takes focus, then its click handler runs. A disabled control takes no click.
function press(btn) {
  if (btn.disabled) return null;
  btn.focus();
  return btn.listeners.click[0]({ currentTarget: btn, target: btn, preventDefault() {} });
}

async function open() {
  const env = world();
  await env.leaseDocs({ lease_id: 7, unit_name: 'Unit 1' });
  const body = env.log.modal.body;
  const btn = find(body, (n) => n.tagName === 'BUTTON' && n.textContent === 'Upload');
  const status = find(body, (n) => n.attrs.role === 'alert');
  assert.ok(btn && status, 'the Upload button and the status line are in the modal');
  env.log.input.files = [{ name: 'lease.pdf', type: 'application/pdf', size: 2000 }];
  return { ...env, btn, status, input: env.log.input };
}

test('a press that waits for its upload keeps focus on Upload: aria-disabled, never disabled', async () => {
  const t = await open();
  const done = press(t.btn);
  assert.equal(t.w.active, t.btn, 'focus stays on Upload while the upload runs');
  assert.equal(t.btn.getAttribute('aria-disabled'), 'true');
  assert.equal(t.btn.disabled, false);
  assert.equal(t.log.requests.length, 1);
  // A second press while the upload runs sends nothing.
  press(t.btn);
  assert.equal(t.log.requests.length, 1);
  t.log.pending[0].resolve();
  await done;
  assert.deepEqual(t.log.toasts, ['Document uploaded.']);
  assert.equal(t.btn.getAttribute('aria-disabled'), null);
  assert.equal(t.btn.disabled, false);
});

test('a refused file goes under the box, frees Upload, and the box takes focus', async () => {
  const t = await open();
  const done = press(t.btn);
  const err = Object.assign(new Error("This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again."), { code: 'BAD_FILE_CONTENT' });
  t.log.pending[0].reject(err);
  await done;
  assert.deepEqual(t.log.shown, [err.message]);
  assert.equal(t.status.children.length, 0, 'the refusal is not repeated in the status line');
  assert.equal(t.btn.getAttribute('aria-disabled'), null);
  assert.equal(t.btn.disabled, false);
  assert.equal(t.w.active, t.input, 'focus moves to the file box, the point of the refusal');
});

test('another failure shows in the status line and frees Upload', async () => {
  const t = await open();
  const done = press(t.btn);
  t.log.pending[0].reject(new Error('Server is busy. Try again.'));
  await done;
  assert.deepEqual(t.log.shown, []);
  assert.equal(t.status.children.length, 1);
  assert.equal(t.status.children[0].textContent, 'Server is busy. Try again.');
  assert.equal(t.btn.getAttribute('aria-disabled'), null);
  assert.equal(t.btn.disabled, false);
});

test('Upload with no file chosen says so, sends nothing, and never marks itself busy', async () => {
  const t = await open();
  t.input.files = [];
  press(t.btn);
  assert.deepEqual(t.log.shown, ['Choose a file first.']);
  assert.equal(t.log.requests.length, 0);
  assert.equal(t.btn.getAttribute('aria-disabled'), null);
  assert.equal(t.btn.disabled, false);
});

test('source: the Upload handler reads its button first, checks busy before any check, and never sets disabled', () => {
  const at = (s) => leaseDocsSrc.indexOf(s);
  assert.ok(at('const btn = e.currentTarget;') > 0, 'the handler reads its button from the event');
  assert.ok(at('const btn = e.currentTarget;') < at("getAttribute('aria-disabled') === 'true') return;"), 'busy check after the button read');
  assert.ok(at("getAttribute('aria-disabled') === 'true') return;") < at('up.clear();'), 'busy check before any check');
  assert.ok(at("btn.setAttribute('aria-disabled', 'true');") > at("if (!file) { up.show('Choose a file first.'); return; }"), 'the busy mark is set after the file check');
  assert.doesNotMatch(leaseDocsSrc, /\.disabled\s*=/);
  assert.doesNotMatch(leaseDocsSrc, /e\.target/);
});

test('source: the D-120 comment is written once in the file', () => {
  const comment = 'aria-disabled, not disabled: a disabled control drops focus to the page while it waits (D-97, D-105, D-120).';
  assert.equal(SRC.split(comment).length - 1, 1);
});
