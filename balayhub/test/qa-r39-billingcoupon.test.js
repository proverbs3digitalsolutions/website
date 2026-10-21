'use strict';
require('./helpers');

// QA round 39 (BILLINGCOUPON, CRD-1, D-121 C2.4): the owner's coupon Apply button is marked aria-disabled while its preview waits,
// so a second press, or Enter in the code box, sends no second preview; the mark goes when the answer comes (accepted or refused).
// Frontend-only: billingcoupon.js is copied to a temp folder with stub ui.js and api.js (no browser, no database).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

class El {
  constructor(tag) { this.tag = tag; this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.l = {}; this.hidden = false; this.value = ''; this.open = false; this.disabled = false; this._t = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { this.l[t] = f; }
  append(...c) { this.children.push(...c); }
  focus() { global.document.activeElement = this; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  fire(t, init = {}) { return this.l[t]?.({ type: t, preventDefault() {}, target: this, ...init }); }
  all(f, out = []) { if (f(this)) out.push(this); this.children.forEach((c) => c.all && c.all(f, out)); return out; }
}

let bc; let calls; let quotes;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r39bc-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'ui.js'), `
    export function h(tag, props, ...kids) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'hidden') el.hidden = true;
        else if (k === 'class') el.className = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
      el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
      return el;
    }`);
  fs.writeFileSync(path.join(dir, 'api.js'), 'export const post = (...a) => globalThis.__post(...a);\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/billingcoupon.js'), path.join(dir, 'views', 'billingcoupon.js'));
  global.document = { activeElement: null, createElement: (t) => new El(t) };
  bc = await import(pathToFileURL(path.join(dir, 'views', 'billingcoupon.js')).href);
});

const quote = {
  coupon: { code: 'ALPHA50', kind: 'percent', percent_off: 50, amount_off: null, duration: 'months', duration_months: 3, months_left: 3 },
  plan: 'growth', months: 1, list_amount: '999.00', discount_amount: '499.50', amount: '499.50', covered_months: 1, free: false, card_only: false, message: '',
};

// The box as the Plan & billing page builds it: a current coupon of null shows the "Have a coupon code?" form.
const mount = () => {
  calls = []; quotes = [];
  return bc.couponBox({ current: null, getSelection: () => ({ plan: 'growth', months: 1 }), onQuote: (q) => quotes.push(q) });
};
const find = (root, f) => root.all(f)[0];
const input = (root) => find(root, (e) => e.tag === 'input');
const applyButton = (root) => find(root, (e) => e.tag === 'button' && e.textContent === 'Apply');
const alertBox = (root) => find(root, (e) => e.attrs.role === 'alert');
const okLine = (root) => find(root, (e) => e.className === 'alert alert--ok');
const tick = () => new Promise((r) => setTimeout(r, 0));

test('Apply is marked aria-disabled while its preview waits; a second press and Enter send no second preview', async () => {
  const waiting = [];
  globalThis.__post = (url, body) => { calls.push([url, body]); return new Promise((res) => waiting.push(res)); };
  const root = mount();
  const inp = input(root); inp.value = 'alpha50';
  const apply = applyButton(root);

  apply.fire('click');
  assert.equal(calls.length, 1, 'the first press sends one preview');
  assert.equal(apply.getAttribute('aria-disabled'), 'true', 'Apply is dimmed while its preview waits (D-120, D-121)');
  assert.notEqual(apply.disabled, true, 'not disabled: a disabled control drops focus to the page');

  apply.fire('click');
  inp.fire('keydown', { key: 'Enter' });
  assert.equal(calls.length, 1, 'a second press and Enter in the box send no second preview');

  waiting[0](quote); await tick();
  assert.equal(apply.getAttribute('aria-disabled'), null, 'the mark goes when the answer comes');
  assert.equal(okLine(root).hidden, false, 'the applied line shows');
  assert.equal(quotes.length, 1, 'the one answer reaches the page');
});

test('a refused preview clears the mark, shows the refusal under the code box, and the next press asks again', async () => {
  const waiting = [];
  globalThis.__post = (url, body) => { calls.push([url, body]); return new Promise((res, rej) => waiting.push([res, rej])); };
  const root = mount();
  input(root).value = 'nope';
  applyButton(root).fire('click');
  assert.equal(applyButton(root).getAttribute('aria-disabled'), 'true', 'Apply is dimmed while the refused preview waits');

  const err = new Error("This code isn't valid right now. Check it and try again.");
  err.code = 'COUPON_INVALID'; err.status = 400;
  waiting[0][1](err); await tick();
  assert.equal(applyButton(root).getAttribute('aria-disabled'), null, 'the mark goes when the refusal comes');
  assert.equal(alertBox(root).textContent, "This code isn't valid right now. Check it and try again.", 'the refusal shows under the box');
  assert.equal(input(root).attrs['aria-invalid'], 'true');

  applyButton(root).fire('click');
  assert.equal(calls.length, 2, 'Apply asks again on purpose after a refusal (D-116)');
  waiting[1][0](quote); await tick();
  assert.equal(applyButton(root).getAttribute('aria-disabled'), null);
});

test('Apply with an empty box is not marked, sends nothing, and puts focus in the box', () => {
  globalThis.__post = () => { throw new Error('no request expected for an empty box'); };
  const root = mount();
  const inp = input(root);
  applyButton(root).fire('click');
  assert.equal(calls.length, 0);
  assert.equal(applyButton(root).getAttribute('aria-disabled'), null);
  assert.equal(alertBox(root).textContent, 'Enter your coupon code.');
  assert.equal(global.document.activeElement, inp, 'focus goes to the code box');
});
