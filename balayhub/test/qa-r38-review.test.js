'use strict';
require('./helpers');

// QA round 38, lane REVIEW (public/js/views/review.js, D-120). The guest's Send feedback button is busy with its own request:
// it is marked aria-disabled (never disabled), keeps focus while the request waits, a second press sends nothing, and a refusal
// takes the mark off again. The view is mounted from a temp copy with stub ui and i18n modules and the real api.js (fetch is
// stubbed), on a stand-in page where a focused control that is switched off with disabled drops focus to BODY, as a browser does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PUBLIC = path.join(__dirname, '..', 'public', 'js');
const VIEW_SRC = path.join(PUBLIC, 'views', 'review.js');

// The stand-in page: only the parts review.js uses. Text is kept as text nodes.
let stage;
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.kids = [];
    this.attrs = {};
    this.classSet = new Set();
    this.handlers = {};
    this.parent = null;
    this.value = '';
    this.dataset = {};
    this.style = {};
    this.off = false;
  }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === stage.root; }
  get disabled() { return this.off; }
  // Switching the focused control off moves focus to BODY (D-105); a disabled control cannot take focus.
  set disabled(v) { this.off = Boolean(v); if (this.off && stage.activeElement === this) stage.activeElement = stage.body; }
  focus() { if (!this.off && this.isConnected) stage.activeElement = this; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  get classList() {
    const s = this.classSet;
    return { add: (c) => s.add(c), remove: (c) => s.delete(c), toggle: (c, on) => (on ? s.add(c) : s.delete(c)) };
  }
  get textContent() { return this.kids.map((k) => (k instanceof El ? k.textContent : k.text)).join(''); }
  set textContent(v) { this.detach(); this.kids = v === '' ? [] : [{ text: String(v) }]; }
  detach() { this.kids.forEach((k) => { if (k instanceof El) k.parent = null; }); }
  append(...nodes) {
    for (const n of nodes.flat(Infinity)) {
      if (n === null || n === undefined || n === false || n === true) continue;
      if (n instanceof El) { n.parent = this; this.kids.push(n); } else this.kids.push({ text: String(n) });
    }
  }
  replaceChildren(...nodes) { this.detach(); this.kids = []; this.append(...nodes); }
  matches(sel) {
    if (sel.startsWith('.')) return this.classSet.has(sel.slice(1));
    const attr = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel);
    return attr ? this.attrs[attr[1]] === attr[2] : this.tagName === sel.toUpperCase();
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => n.kids.forEach((k) => { if (k instanceof El) { if (k.matches(sel)) out.push(k); walk(k); } });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  // A real press: a click focuses a button first; a submit button then submits its form. A switched-off control takes no click.
  press() { this.focus(); return this.click(); }
  click() {
    if (this.off) return undefined;
    if (this.handlers.click) this.handlers.click({});
    if (this.attrs.type !== 'submit') return undefined;
    let form = this.parent;
    while (form && form.tagName !== 'FORM') form = form.parent;
    return form.handlers.submit({ preventDefault() {} });
  }
}

// The ui.js helper as review.js calls it (the stub module below forwards to this).
function h(tag, props, ...children) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.classSet = new Set(String(v).split(/\s+/).filter(Boolean));
    else if (k === 'style' || k === 'dataset') el[k] = v;
    else if (k.startsWith('on')) el.handlers[k.slice(2)] = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children);
  return el;
}
globalThis.__reviewStand = { h, toast: (msg, kind) => stage.toasts.push([msg, kind]) };

const UI_STUB = `
export const h = (...args) => globalThis.__reviewStand.h(...args);
export const brand = () => globalThis.__reviewStand.h('span', null, 'BalayHub');
export const toast = (msg, kind) => globalThis.__reviewStand.toast(msg, kind);
export const showErrors = () => [];
export const clearErrors = () => {};
`;

const I18N_STUB = `
export const t = (en, vars) => String(en).replace(/\\{(\\w+)\\}/g, (m, k) => (vars && k in vars ? vars[k] : m));
export const tServer = (msg) => msg;
export const fmtDateL = (d) => String(d);
export const initGuestLang = () => {};
export const extendTranslations = () => {};
export const keepFormValues = () => null;
export const restoreFormValues = () => {};
export const langToggle = () => globalThis.__reviewStand.h('button', { type: 'button' }, 'Tagalog');
`;

const DETAIL = { host: 'QA r38 host', guest_first_name: 'Ana', listing: 'QA r38 Loft', check_in: '2027-08-05', check_out: '2027-08-07', open: true, reviewed: false, guest_language: 'en' };
const reply = (status, body) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body });

// The POST requests the page has sent and not yet had answered, oldest first.
let posts = [];
globalThis.fetch = (url, opts) => {
  if (opts.method === 'GET') return Promise.resolve(reply(200, { ...DETAIL })); // a copy: the page marks its own copy reviewed
  return new Promise((resolve) => posts.push({ url, resolve }));
};

let dir;
let view;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-review-r38-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(PUBLIC, 'api.js'), path.join(dir, 'api.js'));
  fs.writeFileSync(path.join(dir, 'ui.js'), UI_STUB);
  fs.writeFileSync(path.join(dir, 'i18n.js'), I18N_STUB);
  fs.mkdirSync(path.join(dir, 'views'));
  fs.copyFileSync(VIEW_SRC, path.join(dir, 'views', 'review.js'));
  view = await import(pathToFileURL(path.join(dir, 'views', 'review.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function resetStage() {
  stage = { body: new El('body'), root: new El('div'), activeElement: null, toasts: [] };
  stage.activeElement = stage.body;
}

async function mount() {
  resetStage();
  posts = [];
  await view.guestReviewView(stage.root, { params: { token: 'qa-r38-review-token' } }, undefined);
  const form = stage.root.querySelector('form');
  const buttons = form.querySelectorAll('button');
  return { form, stars: buttons.slice(0, 5), send: buttons[buttons.length - 1] };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('Send feedback keeps focus while its request waits, and a second press sends nothing', async () => {
  const { stars, send } = await mount();
  stars[3].press(); // four stars
  send.press();
  await settle();
  assert.equal(posts.length, 1);
  assert.equal(send.getAttribute('aria-disabled'), 'true', 'the busy mark is set while the request waits');
  assert.equal(send.disabled, false, 'a switched-off control would drop focus');
  assert.equal(stage.activeElement, send, 'focus stays on the button while the request waits');
  send.press();
  await settle();
  assert.equal(posts.length, 1, 'a second press sent a second request');
  posts[0].resolve(reply(201, { share_links: [] }));
  await settle();
  assert.match(stage.root.textContent, /Thank you!/);
  assert.equal(send.isConnected, false, 'the thank-you card replaces the form');
});

test('a refused request clears the busy mark, shows the error, and the next press sends again', async () => {
  const { stars, send } = await mount();
  stars[3].press();
  send.press();
  await settle();
  assert.equal(send.getAttribute('aria-disabled'), 'true');
  assert.equal(stage.activeElement, send);
  posts[0].resolve(reply(409, { error: 'QA r38 refused.' }));
  await settle();
  assert.deepEqual(stage.toasts, [['QA r38 refused.', 'error']]);
  assert.equal(send.getAttribute('aria-disabled'), null, 'the mark is gone after the refusal');
  assert.equal(send.disabled, false);
  assert.equal(send.isConnected, true, 'the form stays for another try');
  assert.equal(stage.activeElement, send, 'focus is still on Send feedback');
  send.press();
  await settle();
  assert.equal(posts.length, 2, 'the button sends again once it is usable');
  posts[1].resolve(reply(409, { error: 'QA r38 refused.' }));
  await settle();
});
