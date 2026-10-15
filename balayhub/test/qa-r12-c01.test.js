'use strict';

// QA r12 C01: shared focus (re-enabled button, showErrors target), labelled reason box, page error heading, router focus. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = process.env.C01_JS_DIR || path.join(__dirname, '../public/js');
const uiSrc = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r12c01-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// ---- a tiny fake page
function world() {
  const w = { activeElement: null };
  const make = (tag, attrs = {}) => ({
    tagName: tag.toUpperCase(), isConnected: true, children: [], parentElement: null, textContent: attrs['aria-label'] || '', disabled: false, attrs: { ...attrs },
    classes: new Set(),
    classList: { add(c) { this.owner.classes.add(c); } },
    getAttribute(k) { return this.attrs[k] ?? null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    focus() { if (!this.disabled && this.isConnected) w.activeElement = this; },
    add(c) { c.parentElement = this; this.children.push(c); return c; },
    querySelectorAll(sel) { const out = []; const walk = (x) => x.children.forEach((c) => { if (c.tagName.toLowerCase() === sel) out.push(c); walk(c); }); walk(this); return out; },
  });
  w.make = make;
  w.body = make('body');
  w.activeElement = w.body;
  globalThis.document = w;
  w.querySelectorAll = (sel) => w.body.querySelectorAll(sel);
  w.querySelector = (sel) => w.body.querySelectorAll(sel)[0] || null;
  return w;
}

// (a), (a2) (a disabled button gets focus back; a button never disabled is not refocused) moved to the single focus guard: see qa-r13-f01.test.js (g).

// A field wrapper: tree of {tag, attrs, children}, with the querySelector selectors showErrors uses.
function field(w, spec) {
  const wrap = w.make('div', { 'data-field': 'x' });
  wrap.classList.owner = wrap;
  const all = [];
  const build = (parent, node) => {
    const el = w.make(node.tag, node.attrs || {});
    el.classList.owner = el;
    if (node.invalid) el.classes.add('field--invalid');
    el.spec = node;
    parent.add(el); all.push(el);
    (node.children || []).forEach((c) => build(el, c));
  };
  (spec || []).forEach((n) => build(wrap, n));
  const visible = (e) => ['input', 'select', 'textarea'].includes(e.tagName.toLowerCase()) && e.attrs.type !== 'hidden';
  const inside = (root, pred) => { const out = []; const walk = (x) => x.children.forEach((c) => { if (pred(c)) out.push(c); walk(c); }); walk(root); return out; };
  const q = (root) => (sel) => ({
    '.error': () => inside(root, (e) => e.classes.has('error'))[0],
    '.field--invalid': () => inside(root, (e) => e.classes.has('field--invalid'))[0],
    '[data-focus]': () => inside(root, (e) => 'data-focus' in e.attrs)[0],
    'input:not([type=hidden]), select, textarea': () => inside(root, visible)[0],
    '[role="group"], [role="radiogroup"]': () => inside(root, (e) => ['group', 'radiogroup'].includes(e.attrs.role))[0],
    button: () => inside(root, (e) => e.tagName === 'BUTTON')[0],
  }[sel]?.() || null);
  wrap.querySelector = q(wrap);
  all.forEach((e) => { e.querySelector = q(e); });
  const form = w.make('form');
  form.querySelector = () => wrap;
  return { form, wrap };
}

test('(b1) showErrors: hidden input plus a group of buttons: first button focused, group marked', () => {
  const w = world();
  const { form, wrap } = field(w, [
    { tag: 'input', attrs: { type: 'hidden' } },
    { tag: 'div', attrs: { role: 'group' }, children: [{ tag: 'button' }, { tag: 'button' }] },
  ]);
  ui.showErrors(form, { rating: 'Pick' });
  const group = wrap.children[1];
  assert.equal(w.activeElement, group.children[0]);
  assert.equal(group.getAttribute('aria-invalid'), 'true');
  assert.equal(wrap.children[0].getAttribute('aria-invalid'), null);
});

test('(b2) showErrors: two rows, the second invalid: that row\'s input is focused', () => {
  const w = world();
  const { form, wrap } = field(w, [
    { tag: 'div', children: [{ tag: 'input' }] },
    { tag: 'div', invalid: true, children: [{ tag: 'input' }] },
  ]);
  ui.showErrors(form, { guests: 'Fill in' });
  assert.equal(w.activeElement, wrap.children[1].children[0]);
  assert.equal(wrap.children[1].children[0].getAttribute('aria-invalid'), 'true');
});

test('(b3) showErrors: a plain field still focuses its input', () => {
  const w = world();
  const { form, wrap } = field(w, [{ tag: 'input' }]);
  ui.showErrors(form, { name: 'Required' });
  assert.equal(w.activeElement, wrap.children[0]);
});

test('(c) confirmDialog reason box: label for equals the textarea id, message linked', () => {
  const m = uiSrc.slice(uiSrc.indexOf('export function confirmDialog'), uiSrc.indexOf('export function', uiSrc.indexOf('export function confirmDialog') + 10));
  assert.match(m, /h\('label', \{ for: rid \}/);
  assert.match(m, /id: rid,/);
  assert.match(m, /'aria-describedby': `\$\{rid\}-err`/);
  assert.match(m, /id: `\$\{rid\}-err`/);
});

test('(d) pageError has an h1 title; retry only when allowed', () => {
  const walk = (x, out = []) => { out.push(x); (x.children || []).forEach((c) => walk(c, out)); return out; };
  globalThis.document = { createElement: (tag) => ({ tag, children: [], style: {}, setAttribute() { }, append(...c) { this.children.push(...c.flat(Infinity).filter((v) => v && typeof v === 'object')); }, replaceChildren() { }, addEventListener() { }, classList: { add() { } } }), createElementNS: (ns, tag) => ({ tag, children: [], style: {}, setAttribute() { }, append() { }, classList: { add() { } } }), createTextNode: (s) => s };
  let card;
  try { card = ui.pageError({ status: 404, message: 'Gone' }, () => { }); } catch { card = null; }
  if (card) assert.ok(walk(card).some((n) => n.tag === 'h1'));
  assert.match(uiSrc, /export function pageError/);
  const body = uiSrc.slice(uiSrc.indexOf('export function pageError'), uiSrc.indexOf('export const skeleton'));
  assert.match(body, /h\('h1'/);
  assert.doesNotMatch(body, /h\('h3'/);
});

test('(e) source: router focuses the page heading after a path change, keeps the old main on a same-path render, calls useHostLang', () => {
  const r = appSrc.slice(appSrc.indexOf('export async function render'));
  assert.match(appSrc, /function focusPageHeading/);
  assert.match(appSrc, /drawnPath !== null && drawnPath !== path\) focusPageHeading\(mount\)/);
  assert.match(r, /if \(seq !== renderSeq\) return;\n\s*shell\.content\.replaceWith\(mount\)/);
  assert.match(r, /aria-busy/);
  assert.match(r, /i18n\.useHostLang\?\.\(/);
  assert.match(r, /pageError\(err, render\)/);
  assert.doesNotMatch(r, /errorState\(/);
  assert.match(appSrc, /if \(a && a !== document\.body && a\.isConnected && !a\.closest\(/);
});
