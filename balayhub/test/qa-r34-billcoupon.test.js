'use strict';
require('./helpers');

// QA round 34 (BILLCOUPON, GATE-1): a coupon the server refuses at pay time leaves no "applied" line, no discounted total and
// no code to send with the next payment. Runs billingcoupon.js against a tiny fake DOM (ui.js and api.js stubbed).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

class El {
  constructor(tag) { this.tag = tag; this.tagName = tag.toUpperCase(); this.attrs = {}; this.children = []; this.l = {}; this.hidden = false; this.value = ''; this.open = false; this._t = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { this.l[t] = f; }
  append(...c) { this.children.push(...c); }
  focus() {}
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  fire(t, init = {}) { return this.l[t]?.({ type: t, preventDefault() {}, target: this, ...init }); }
  all(f, out = []) { if (f(this)) out.push(this); this.children.forEach((c) => c.all && c.all(f, out)); return out; }
}

let bc; let calls; let quotes;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r34bc-'));
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

const quote = { coupon: { code: 'ALPHA50', kind: 'percent', percent_off: 50, duration: 'months', duration_months: 3 }, amount: '499.50', message: '' };
const mk = (current = null) => {
  calls = []; quotes = [];
  globalThis.__post = async (url, body) => { calls.push(body); return quote; };
  const box = bc.couponBox({ current, getSelection: () => ({ plan: 'growth', months: 1 }), onQuote: (q) => quotes.push(q) });
  const input = box.all((e) => e.tag === 'input')[0];
  const apply = box.all((e) => e.tag === 'button' && e.textContent === 'Apply')[0];
  const okLine = box.all((e) => e.className === 'alert alert--ok')[0];
  return { box, input, apply, okLine };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test('a refusal at pay time drops the applied line, the total and the code', async () => {
  const { box, input, apply, okLine } = mk();
  input.value = 'alpha50'; apply.fire('click'); await tick();
  assert.equal(okLine.hidden, false);
  assert.equal(box.getCode(), 'alpha50');
  box.showError('This coupon code is not valid.');
  assert.equal(okLine.hidden, true, 'applied line hidden');
  assert.equal(quotes.at(-1), null, 'total back to list price');
  assert.equal(box.getCode(), '', 'refused code is not sent with a payment');
  assert.equal(input.value, 'alpha50', 'typed text stays');
  assert.equal(input.attrs['aria-invalid'], 'true');
  const n = calls.length;
  await box.refresh(); // a plan change
  assert.equal(calls.length, n, 'no preview for the refused code');
  assert.equal(box.getCode(), '');
  apply.fire('click'); await tick();
  assert.equal(calls.length, n + 1, 'Apply asks again on purpose');
});

test('a held coupon only shows the message', () => {
  const { box } = mk({ status: 'active', code: 'HELD', kind: 'percent', percent_off: 10, duration: 'forever' });
  box.showError('x');
  assert.equal(quotes.length, 0);
});
