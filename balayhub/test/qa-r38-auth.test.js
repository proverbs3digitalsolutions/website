'use strict';
require('./helpers');

// QA round 38, AUTH (D-120). Resend verification email on the verify screen: while its request waits the button is busy
// with aria-disabled and keeps focus (a natively disabled button drops focus to the page), a second press sends nothing,
// and the busy mark goes when the request settles. Runs verifyPendingView from a copy of views/auth.js, with stub app,
// landing and i18n modules and a stand-in DOM that drops focus from a control that turns disabled while focused.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');

// Stand-in DOM: the parts of the element API that auth.js and ui.js use on the verify screen.
class FakeNode {
  constructor() { this.parentNode = null; this.children = []; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === document.body; }
  contains(x) { return x === this || this.children.some((c) => c.contains(x)); }
}
class FakeText extends FakeNode {
  constructor(text) { super(); this.data = text; }
  get textContent() { return this.data; }
}
class FakeEl extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.className = '';
    this._disabled = false;
  }
  get disabled() { return this._disabled; }
  set disabled(v) {
    this._disabled = Boolean(v);
    // A control that turns disabled while it has focus loses focus to the page, as in a browser.
    if (this._disabled && document.activeElement === this) document.activeElement = document.body;
  }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(String(v)); }
  append(...nodes) { for (const n of nodes) this.adopt(n); }
  replaceChildren(...nodes) {
    if (this.children.some((c) => c.contains(document.activeElement))) document.activeElement = document.body;
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    for (const n of nodes) this.adopt(n);
  }
  adopt(n) {
    const node = n instanceof FakeNode ? n : new FakeText(String(n));
    node.parentNode = this;
    this.children.push(node);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  // A natively disabled control gets no click, as in a browser. An aria-disabled control still gets it.
  click() {
    if (this._disabled) return;
    for (const fn of this.listeners.click || []) fn({ type: 'click', target: this, currentTarget: this, preventDefault() {} });
  }
  focus() { if (!this._disabled && this.isConnected) document.activeElement = this; }
}

const body = new FakeEl('body');
globalThis.document = {
  body,
  activeElement: body,
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (ns, tag) => new FakeEl(tag),
  createTextNode: (text) => new FakeText(text),
};
globalThis.Node = FakeNode;
globalThis.Element = FakeEl;

// Network stand-in: every request waits until the test answers it.
const realFetch = globalThis.fetch;
let sent = [];
let answer = null;
globalThis.fetch = (url, opts) => {
  sent.push({ url, method: opts.method });
  return new Promise((resolve) => { answer = resolve; });
};
const respond = (status, data) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => data });
const settle = () => new Promise((resolve) => setImmediate(resolve));
const all = (node, out = []) => { out.push(node); node.children.forEach((c) => { if (c instanceof FakeEl) all(c, out); }); return out; };

const APP_STUB = `export const state = { user: { email: 'stays@balayhub.test', email_verified: false }, requireEmailVerification: true };
export const navigate = () => {};
export const refreshUser = async () => {};
export const afterLogin = () => {};
`;
const I18N_STUB = `export function t(en) { return en; }
export const tServer = (msg) => msg;
export function initGuestLang() {}
export function extendTranslations() {}
`;

let auth;
let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r38-auth-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(JS, 'api.js'), path.join(dir, 'api.js'));
  fs.copyFileSync(path.join(JS, 'ui.js'), path.join(dir, 'ui.js'));
  fs.writeFileSync(path.join(dir, 'app.js'), APP_STUB);
  fs.writeFileSync(path.join(dir, 'i18n.js'), I18N_STUB);
  fs.mkdirSync(path.join(dir, 'views'));
  fs.copyFileSync(path.join(JS, 'views', 'auth.js'), path.join(dir, 'views', 'auth.js'));
  fs.writeFileSync(path.join(dir, 'views', 'landing.js'), 'export const tryDemo = () => {};\n');
  auth = await import(pathToFileURL(path.join(dir, 'views', 'auth.js')));
});
test.after(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(dir, { recursive: true, force: true });
});

// Mounts the verify screen on a fresh page and returns its Resend button.
async function mount() {
  sent = [];
  const root = new FakeEl('div');
  body.replaceChildren(root);
  await auth.verifyPendingView(root);
  const resend = all(root).find((el) => el.tagName === 'BUTTON' && el.textContent === 'Resend verification email');
  assert.ok(resend, 'the verify screen has a Resend button');
  return { root, resend };
}

test('Resend is busy with aria-disabled and keeps focus while its request waits; a second press sends nothing', async () => {
  const { root, resend } = await mount();
  resend.focus();
  resend.click();
  assert.deepEqual(sent, [{ url: '/api/auth/resend-verification', method: 'POST' }]);
  assert.equal(resend.getAttribute('aria-disabled'), 'true', 'busy while the request waits');
  assert.equal(resend.disabled, false, 'not natively disabled, so focus is not dropped');
  assert.equal(document.activeElement, resend, 'focus stays on Resend while the request waits');
  resend.click();
  assert.equal(sent.length, 1, 'a second press during the wait sends no second request');
  answer(respond(200, {}));
  await settle();
  assert.equal(resend.getAttribute('aria-disabled'), null, 'the busy mark goes when the request succeeds');
  assert.equal(document.activeElement, resend, 'focus is still on Resend after the success message');
  assert.ok(root.textContent.includes('A new verification email is on its way.'), 'the success message is shown');
});

test('a refused resend shows the refusal, clears the busy mark and keeps focus on Resend', async () => {
  const { root, resend } = await mount();
  resend.focus();
  resend.click();
  answer(respond(409, { error: 'QA r38 refused.' }));
  await settle();
  assert.ok(root.textContent.includes('QA r38 refused.'), 'the refusal is shown');
  assert.equal(resend.getAttribute('aria-disabled'), null, 'the busy mark goes after a refusal');
  assert.equal(document.activeElement, resend, 'focus stays on Resend after a refusal');
  resend.click();
  assert.equal(sent.length, 2, 'Resend works again after a refusal');
  answer(respond(200, {}));
  await settle();
});
