'use strict';

// QA r17 lane S: confirmDialog's reason box has no maxlength (it cut a paste silently); Confirm checks 500 characters and says so.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r17s-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

function ask() {
  class El {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.isConnected = true; this.listeners = {}; this.classList = { add() { } }; this.value = ''; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; }
    hasAttribute(k) { return k in this.attrs; }
    addEventListener(k, f) { this.listeners[k] = f; }
    append(...c) { for (const x of c.flat(Infinity)) { if (x && typeof x === 'object') { x.parentElement = this; this.children.push(x); } } }
    get textContent() { return this.text ?? this.children.map((x) => x.textContent).join(''); }
    set textContent(v) { this.text = v; this.children = []; }
    all(out = []) { this.children.forEach((x) => { out.push(x); x.all(out); }); return out; }
    querySelector(sel) { return sel.startsWith('input') ? this.all().find((x) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(x.tagName)) || null : null; }
    querySelectorAll() { return []; }
    focus() { document.activeElement = this; }
    showModal() { }
    close() { }
    remove() { }
  }
  globalThis.Node = El;
  const body = new El('body');
  globalThis.document = {
    activeElement: body, body,
    createElement: (t) => new El(t), createTextNode: (s) => { const x = new El('#text'); x.text = String(s); return x; },
    querySelectorAll: () => [],
  };
  let result = 'pending';
  ui.confirmDialog({ title: 'Void?', text: 'Sure?', reason: true, confirmText: 'Void' }).then((v) => { result = v; });
  const all = body.children[0].all();
  const box = all.find((x) => x.tagName === 'TEXTAREA');
  const confirm = all.find((x) => x.tagName === 'BUTTON' && x.textContent === 'Void');
  const err = all.find((x) => x.attrs.role === 'alert');
  return { box, confirm, err, result: () => result };
}

test('REASON_MAX is 500 and the reason box has no maxlength', () => {
  assert.equal(ui.REASON_MAX, 500);
  const { box } = ask();
  assert.equal(box.hasAttribute('maxlength'), false);
});

test('501 characters: the sentence shows, aria-invalid is set, the dialog stays open', async () => {
  const { box, confirm, err, result } = ask();
  box.value = 'x'.repeat(501);
  confirm.listeners.click();
  await Promise.resolve();
  assert.equal(err.textContent, 'Reason must be at most 500 characters.');
  assert.equal(box.getAttribute('aria-invalid'), 'true');
  assert.equal(result(), 'pending');
});

test('500 characters resolves with the trimmed reason', async () => {
  const { box, confirm, result } = ask();
  box.value = 'x'.repeat(500);
  confirm.listeners.click();
  await Promise.resolve();
  assert.equal(result(), 'x'.repeat(500));
});
