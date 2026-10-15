'use strict';

// QA round 15 (T1): the theme switch is one radio group. Its buttons are built once and updated in place (so focus is
// never lost in the More sheet); one Tab stop; arrow keys, Home and End move focus and the selection.
// themeswitch.js runs here against a tiny fake DOM, with ui.js stubbed (the real h() needs a browser).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.l = {}; this.replaced = 0; this.isConnected = true; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, f) { this.l[t] = f; }
  append(...c) { this.children.push(...c); }
  replaceChildren(...c) { this.replaced++; this.children = c; }
  focus() { global.document.activeElement = this; }
  fire(t, init = {}) { const e = { type: t, prevented: false, preventDefault() { this.prevented = true; }, target: this, ...init }; this.l[t]?.(e); return e; }
}

let m; let ls;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r15t1-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'ui.js'), `export function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
    return el;
  }`);
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'js', 'themeswitch.js'), path.join(dir, 'themeswitch.js'));
  ls = {};
  global.localStorage = { getItem: (k) => ls[k] ?? null, setItem: (k, v) => { ls[k] = String(v); } };
  global.document = {
    activeElement: null,
    createElement: (t) => new El(t),
    createElementNS: (_n, t) => new El(t),
    documentElement: new El('html'),
  };
  global.document.documentElement.removeAttribute = function (k) { delete this.attrs[k]; };
  m = await import(pathToFileURL(path.join(dir, 'themeswitch.js')));
});

const fresh = (cur) => { ls = cur ? { 'bh-theme': cur } : {}; return m.themeSwitch({ compact: true }); };
const state = (w) => w.children.map((b) => [b.attrs['aria-checked'], b.attrs.tabindex]);

test('one Tab stop: only the checked button has tabindex 0', () => {
  assert.deepEqual(state(fresh('dark')), [['false', '-1'], ['true', '0'], ['false', '-1']]);
  assert.deepEqual(state(fresh()), [['false', '-1'], ['false', '-1'], ['true', '0']]);
});

test('clicking updates the buttons in place and never rebuilds them', () => {
  const w = fresh('system');
  const before = [...w.children];
  before[0].focus();
  before[0].fire('click');
  assert.equal(w.replaced, 0, 'replaceChildren must not run');
  assert.deepEqual(w.children, before, 'same button elements');
  assert.equal(global.document.activeElement, before[0], 'focus stays on the clicked button');
  assert.deepEqual(state(w), [['true', '0'], ['false', '-1'], ['false', '-1']]);
  assert.equal(ls['bh-theme'], 'light');
});

test('arrow keys move focus and selection, with wrap; Home and End jump', () => {
  const w = fresh('light');
  const [a, b, c] = w.children;
  a.focus();
  assert.equal(a.fire('keydown', { key: 'ArrowRight' }).prevented, true);
  assert.equal(global.document.activeElement, b); assert.equal(ls['bh-theme'], 'dark');
  b.fire('keydown', { key: 'ArrowDown' });
  assert.equal(global.document.activeElement, c); assert.equal(ls['bh-theme'], 'system');
  c.fire('keydown', { key: 'ArrowRight' });
  assert.equal(global.document.activeElement, a); assert.equal(ls['bh-theme'], 'light');
  a.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(global.document.activeElement, c);
  c.fire('keydown', { key: 'ArrowUp' });
  assert.equal(global.document.activeElement, b);
  b.fire('keydown', { key: 'Home' });
  assert.equal(global.document.activeElement, a);
  a.fire('keydown', { key: 'End' });
  assert.equal(global.document.activeElement, c);
  assert.deepEqual(state(w), [['false', '-1'], ['false', '-1'], ['true', '0']]);
  assert.equal(w.replaced, 0);
});

test('other keys are left alone; onChange fires on a key move', () => {
  const seen = [];
  ls = { 'bh-theme': 'light' };
  const w = m.themeSwitch({ onChange: (k) => seen.push(k) });
  const e = w.children[0].fire('keydown', { key: 'Tab' });
  assert.equal(e.prevented, false);
  w.children[0].fire('keydown', { key: 'ArrowRight' });
  assert.deepEqual(seen, ['dark']);
});

test('every mounted switch follows a change made in another one; removed switches are forgotten', () => {
  ls = {};
  const a = m.themeSwitch(); const b = m.themeSwitch({ compact: true });
  const bBtns = [...b.children];
  bBtns[1].focus();
  a.children[1].fire('click');
  assert.deepEqual(state(b), [['false', '-1'], ['true', '0'], ['false', '-1']]);
  assert.equal(b.replaced, 0);
  assert.deepEqual(b.children, bBtns);
  assert.equal(global.document.activeElement, bBtns[1]);
  b.isConnected = false;
  a.children[0].fire('click'); // b is dropped here
  a.children[2].fire('click');
  assert.equal(b.children[2].attrs['aria-checked'], 'false', 'a removed switch is no longer redrawn');
});
