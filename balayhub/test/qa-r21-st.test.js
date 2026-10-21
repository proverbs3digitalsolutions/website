'use strict';
// QA round 21 (ST): coupon box focus on an empty Apply, and the card sentence said once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.l = {}; this.hidden = false; this.value = ''; this._t = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { this.l[t] = f; }
  append(...c) { this.children.push(...c); }
  focus() { global.document.activeElement = this; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  all(f, out = []) { if (f(this)) out.push(this); this.children.forEach((c) => c.all && c.all(f, out)); return out; }
}
let bc; let reply;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r21st-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  fs.writeFileSync(path.join(dir, 'ui.js'), `
    export function h(tag, props, ...kids) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'hidden') el.hidden = true;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
      el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
      return el;
    }`);
  fs.writeFileSync(path.join(dir, 'api.js'), 'export const post = async () => globalThis.__reply;\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/billingcoupon.js'), path.join(dir, 'views', 'billingcoupon.js'));
  global.document = { activeElement: null, createElement: (t) => new El(t) };
  bc = await import(pathToFileURL(path.join(dir, 'views', 'billingcoupon.js')).href);
});
const mount = () => bc.couponBox({ current: null, getSelection: () => ({ plan: 'growth', months: 1 }), onQuote: () => {} });
const find = (root, f) => root.all(f)[0];
const tick = () => new Promise((r) => setTimeout(r, 0));

test('Apply with an empty code puts focus in the code box, marked invalid and described by the message', () => {
  const root = mount();
  const input = find(root, (e) => e.tag === 'input');
  find(root, (e) => e.tag === 'button' && e.textContent === 'Apply').l.click();
  assert.equal(global.document.activeElement, input);
  assert.equal(input.attrs['aria-invalid'], 'true');
  assert.equal(input.attrs['aria-describedby'], 'coupon-code-err');
  assert.equal(find(root, (e) => e.attrs.id === 'coupon-code-err').textContent, 'Enter your coupon code.');
});

test('a free card-only coupon says "You pay ... once by card." once', async () => {
  globalThis.__reply = {
    coupon: { code: 'FREE1', kind: 'free', percent_off: null, amount_off: null, duration: 'once', duration_months: 1, months_left: 1 },
    card_only: true, min_charge_applied: true, amount: '20.00', free: false,
    message: 'Free for your first month. You pay ₱20.00 once by card.',
  };
  const root = mount();
  find(root, (e) => e.tag === 'input').value = 'free1';
  find(root, (e) => e.tag === 'button' && e.textContent === 'Apply').l.click(); await tick();
  const okLine = find(root, (e) => e.tag === 'span').textContent;
  assert.equal(okLine, 'FREE1 applied.');
  assert.doesNotMatch(okLine, /once by card/);
});

test('without the sentence in the picker line, the box still says it', async () => {
  globalThis.__reply = {
    coupon: { code: 'FREE1', kind: 'free', percent_off: null, amount_off: null, duration: 'once', duration_months: 1, months_left: 1 },
    card_only: true, min_charge_applied: true, amount: '20.00', free: false, message: null,
  };
  const root = mount();
  find(root, (e) => e.tag === 'input').value = 'free1';
  find(root, (e) => e.tag === 'button' && e.textContent === 'Apply').l.click(); await tick();
  assert.match(find(root, (e) => e.tag === 'span').textContent, /You pay ₱20\.00 once by card\./);
});
