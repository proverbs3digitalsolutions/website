'use strict';
require('./helpers');

// QA round 38, lane ASSISTANT (public/js/assistant.js, row 3): the assistant's Send button keeps focus while its chat request
// waits. It is marked aria-disabled, never disabled (D-120); a second press sends nothing; the mark goes when the answer or the
// refusal lands. Frontend only: no database. The real panel is built and driven on a small stand-in page with the chat request
// held open by a fetch stub. R38_ASSIST_JS_DIR points the same tests at a copy of the original files (the red run).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = process.env.R38_ASSIST_JS_DIR || path.join(__dirname, '..', 'public', 'js');
const assistSrc = fs.readFileSync(path.join(JS, 'assistant.js'), 'utf8');

// ------------------------------------------------------------------ a stand-in page
// Just enough of the browser for assistant.js and ui.js: attributes, text, submit forms, and the focus rule this round is about:
// a control that becomes disabled while it has focus drops focus to the page body, and a disabled control can't take focus.
const evt = (target) => ({ target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
const matches = (el, sel) => (sel.startsWith('.') ? el.className.split(/\s+/).includes(sel.slice(1)) : el.tagName === sel.toUpperCase());

class FakeNode { }
class FakeText extends FakeNode {
  constructor(data) { super(); this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
class FakeElement extends FakeNode {
  constructor(tag, doc) {
    super();
    this.doc = doc;
    this.tagName = tag.toUpperCase();
    this.parentNode = null;
    this.childNodes = [];
    this.attrs = {};
    this.className = '';
    this.listeners = {};
    this.hidden = false;
    this.value = '';
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.style = {};
    this._disabled = false;
  }
  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = Boolean(v);
    if (this._disabled && this.doc.activeElement === this) this.doc.activeElement = this.doc.body;
  }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.doc.body) return true; return false; }
  get classList() { return { contains: (c) => this.className.split(/\s+/).includes(c) }; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { const t = new FakeText(v); t.parentNode = this; this.childNodes = [t]; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, ev) { for (const fn of this.listeners[type] || []) fn(ev); }
  focus() { if (!this._disabled && this.isConnected) this.doc.activeElement = this; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  closest(sel) { for (let n = this; n; n = n.parentNode) if (n instanceof FakeElement && matches(n, sel)) return n; return null; }
  querySelector(sel) {
    for (const c of this.childNodes) {
      if (!(c instanceof FakeElement)) continue;
      if (matches(c, sel)) return c;
      const found = c.querySelector(sel);
      if (found) return found;
    }
    return null;
  }
  append(...nodes) {
    for (const n of nodes) {
      if (n.parentNode) n.parentNode.childNodes = n.parentNode.childNodes.filter((c) => c !== n);
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  replaceChildren(...nodes) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this);
    this.parentNode = null;
    if (!this.doc.activeElement.isConnected) this.doc.activeElement = this.doc.body;
  }
  // A mouse press: the control takes focus, its click handler runs, and a submit button submits its form.
  click() {
    if (this._disabled) return;
    this.focus();
    this.dispatch('click', evt(this));
    if (this.tagName === 'BUTTON' && (this.attrs.type || 'submit') === 'submit') this.closest('form')?.requestSubmit();
  }
  requestSubmit() { this.dispatch('submit', evt(this)); }
}

function makeDocument() {
  const doc = {
    activeElement: null,
    createElement: (tag) => new FakeElement(tag, doc),
    createElementNS: (ns, tag) => new FakeElement(tag, doc),
    createTextNode: (t) => new FakeText(t),
    querySelector: (sel) => doc.body.querySelector(sel),
  };
  doc.body = new FakeElement('body', doc);
  doc.activeElement = doc.body;
  return doc;
}

// The chat request the page is waiting on, held open until a test answers it.
let calls = [];
let settleChat = null;
const answer = (status, body) => settleChat({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });
const settle = () => new Promise((r) => setTimeout(r, 0));

let assist;
let doc;
let dir;
test.before(async () => {
  doc = makeDocument();
  globalThis.document = doc;
  globalThis.Node = FakeNode;
  globalThis.Element = FakeElement; // ui.js wraps Element.prototype.append and replaceChildren when it loads
  globalThis.location = { hash: '#/home' };
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return new Promise((resolve) => { settleChat = resolve; }); };

  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-assistant-r38-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'assistant.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner', full_name: 'QA Owner', business_type: 'short_term' } };\nexport const navigate = () => {};\n");
  assist = await import(pathToFileURL(path.join(dir, 'assistant.js')));
});
test.after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

const QUESTION = 'QA r38 question';

// The module keeps one panel, so each test starts with a new one.
function openChat() {
  assist.resetAssistant();
  calls = [];
  assist.openAssistant();
  const panel = doc.body.querySelector('.assist');
  const form = panel.querySelector('form');
  return {
    input: form.childNodes.find((n) => n.tagName === 'TEXTAREA'),
    send: form.childNodes.find((n) => n.tagName === 'BUTTON'),
    said: panel.querySelector('.sr-only'),
  };
}

test('while the answer is pending, Send keeps focus, is aria-disabled and not disabled, and a second press sends nothing', async () => {
  const { input, send, said } = openChat();
  input.value = QUESTION;
  send.click(); // the press: the form submits and the chat request goes out
  assert.equal(calls.length, 1, 'one chat request is sent');
  assert.equal(send.getAttribute('aria-disabled'), 'true', 'Send is marked busy while the answer is pending');
  assert.notEqual(send.disabled, true, 'Send is not natively disabled: a disabled button drops focus (D-120)');
  assert.equal(doc.activeElement, send, 'focus stays on Send while the answer is pending');
  send.click(); // a second press while the answer is pending
  assert.equal(calls.length, 1, 'a second press sends no second request');
  assert.equal(doc.activeElement, send, 'focus is still on Send after the second press');
  answer(200, { reply: 'QA r38 answer', articles: [], offer_ticket: false });
  await settle();
  assert.equal(send.getAttribute('aria-disabled'), null, 'the busy mark goes when the answer lands');
  assert.equal(send.disabled, false);
  assert.equal(said.textContent, 'QA r38 answer', 'the answer is read out');
  assert.equal(doc.activeElement, input, 'focus moves to the question box once the answer is in (the existing input.focus())');
});

test('a refused question ends the wait: Send drops the busy mark and keeps focus, and the note says it could not answer', async () => {
  const { input, send, said } = openChat();
  input.value = QUESTION;
  send.click();
  assert.equal(calls.length, 1, 'one chat request is sent');
  assert.equal(send.getAttribute('aria-disabled'), 'true', 'Send is marked busy while the request waits');
  assert.notEqual(send.disabled, true, 'Send is not natively disabled (D-120)');
  assert.equal(doc.activeElement, send, 'focus stays on Send while the request waits');
  answer(409, { error: 'QA r38 refused.' });
  await settle();
  assert.equal(send.getAttribute('aria-disabled'), null, 'the busy mark goes when the refusal lands');
  assert.equal(send.disabled, false);
  assert.equal(said.textContent, "Couldn't answer. Try again or contact support.");
  assert.equal(doc.activeElement, input, 'focus moves to the question box after the refusal (the existing input.focus())');
});

test('source: Send is busy with aria-disabled in the submit handler and finally, and the busy flag stays the guard', () => {
  assert.doesNotMatch(assistSrc, /sendBtn\.disabled/, 'no native disabled on Send');
  assert.match(assistSrc, /busy = true; sendBtn\.setAttribute\('aria-disabled', 'true'\); draw\(\);/);
  assert.match(assistSrc, /finally \{\s*busy = false; sendBtn\.removeAttribute\('aria-disabled'\);/);
  assert.match(assistSrc, /if \(busy\) return;/);
});
