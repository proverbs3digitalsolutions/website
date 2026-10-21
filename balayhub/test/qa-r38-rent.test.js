'use strict';
require('./helpers');

// QA round 38 RENT (rows 6 and 7, D-120): a receipt Upload that waits for its own request keeps focus.
// It is marked aria-disabled, not disabled (a disabled control drops focus to the page), a second press sends nothing,
// and a refusal takes the mark off again. The two press handlers are taken out of views/rent.js by brace matching and run with stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'rent.js'), 'utf8');

// The stand-in page: setting disabled on the focused button moves focus to BODY, as a browser does.
function stage() {
  const world = { body: { tagName: 'BODY' }, activeElement: null };
  world.activeElement = world.body;
  const button = (label) => ({
    tagName: 'BUTTON', textContent: label, attrs: {}, _disabled: false,
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    get disabled() { return this._disabled; },
    set disabled(v) { this._disabled = Boolean(v); if (this._disabled && world.activeElement === this) world.activeElement = world.body; },
    focus() { if (!this._disabled) world.activeElement = this; },
  });
  return { world, button };
}

// The press handler that follows the upload call named by the marker, taken out by brace matching (quoted strings skipped).
function pressHandler(marker) {
  const at = src.lastIndexOf('onclick: async (e) => {', src.indexOf(marker));
  assert.ok(at > -1, `press handler before ${marker}`);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i];
    if (c === "'") { i = src.indexOf("'", i + 1); continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return src.slice(at + 'onclick: '.length, i + 1);
  }
  assert.fail(`press handler before ${marker} is not closed`);
}

function rig(kind) {
  const { world, button } = stage();
  const btn = button(kind === 'payment' ? 'Upload attachment' : 'Upload receipt');
  const calls = { upload: [], shown: [], toasts: [], redraws: 0 };
  const pending = [];
  const stubs = {
    up: { clear() {}, show(msg) { calls.shown.push(msg); } },
    upload: { files: [{ name: 'receipt.png', size: 1000, type: 'image/png' }] },
    fileProblem: () => undefined,
    uploadFile: (...args) => { calls.upload.push(args); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    toast: (msg, kind) => calls.toasts.push([msg, kind]),
    rerender: () => { calls.redraws++; },
    fileRefused: (err) => ['EMPTY_FILE', 'BAD_FILE_CONTENT', 'UNSUPPORTED_FILE'].includes(err?.code) || err?.status === 413 || err?.status === 415,
    p: { payment_id: 'pay-1' },
    x: { expense_id: 'exp-1' },
  };
  const names = Object.keys(stubs);
  const handler = new Function(...names, `return ${pressHandler(`uploadFile('${kind}'`)};`)(...names.map((n) => stubs[n]));
  const press = () => handler({ currentTarget: btn, target: btn });
  return { world, btn, calls, pending, press };
}

for (const kind of ['payment', 'expense']) {
  test(`${kind} upload: while the upload waits the button keeps focus, is aria-disabled and a second press sends nothing`, async () => {
    const r = rig(kind);
    r.btn.focus(); // a real press focuses the button first
    const run = r.press();
    assert.equal(r.calls.upload.length, 1, 'one upload request');
    assert.equal(r.btn.getAttribute('aria-disabled'), 'true', 'busy mark while the request is pending');
    assert.notEqual(r.btn.disabled, true, 'not switched off with disabled');
    assert.equal(r.world.activeElement, r.btn, 'focus stays on the button');
    r.press(); // a second press during the wait
    assert.equal(r.calls.upload.length, 1, 'a second press sends no second request');
    r.pending[0].reject(Object.assign(new Error('QA r38 refused.'), { status: 415, code: 'BAD_FILE_CONTENT' }));
    await run;
    assert.equal(r.btn.getAttribute('aria-disabled'), null, 'busy mark gone after a refusal');
    assert.deepEqual(r.calls.shown, ['QA r38 refused.'], 'the refusal is shown on the file box');
    assert.equal(r.calls.redraws, 0);
  });

  test(`${kind} upload: a successful upload redraws the view, which replaces the busy button`, async () => {
    const r = rig(kind);
    const run = r.press();
    r.pending[0].resolve({});
    await run;
    assert.equal(r.calls.redraws, 1, 'the view is redrawn');
    assert.deepEqual(r.calls.toasts, [['Uploaded.', undefined]]);
  });
}

test('both upload handlers read their button from e.currentTarget before any await, and switch nothing off with disabled', () => {
  for (const marker of ["uploadFile('payment'", "uploadFile('expense'"]) {
    assert.match(pressHandler(marker), /^async \(e\) => \{\s*const btn = e\.currentTarget;/);
  }
  assert.doesNotMatch(src, /\.disabled\s*=/);
});
