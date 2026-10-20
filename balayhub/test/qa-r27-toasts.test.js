'use strict';

// QA r27 MNY-2: #toasts is the one live region; a toast carries no role of its own (D-109).
// Frontend-only: no database. UI_JS_DIR points the test at another copy of public/js (to see it fail on the old code).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = process.env.UI_JS_DIR || path.join(__dirname, '../public/js');
let ui; let box;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r27toast-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  globalThis.Node = class { };
  const make = (tag) => {
    const n = Object.assign(new globalThis.Node(), {
      tagName: tag, attrs: {}, children: [], className: '', textContent: '', dataset: {}, style: {},
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener() {},
      append(...xs) { for (const x of xs) { if (x.text !== undefined) this.textContent += x.text; else { x.parent = this; this.children.push(x); } } },
      remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); },
    });
    Object.defineProperty(n, 'firstChild', { get: () => n.children[0] });
    n.classList = { contains: (k) => n.className.split(' ').includes(k) };
    return n;
  };
  box = make('div');
  box.attrs['aria-live'] = 'polite';
  globalThis.document = { createTextNode: (text) => ({ text }), createElement: make, getElementById: (id) => (id === 'toasts' ? box : null) };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('toast: the container is the live region and no toast carries a role', () => {
  box.children.length = 0;
  ui.toast('x');
  ui.toast('y', 'error');
  assert.equal(box.getAttribute('aria-live'), 'polite');
  assert.equal(box.children.length, 2);
  for (const t of box.children) assert.equal(t.getAttribute('role'), null);
  assert.ok(box.children[1].classList.contains('toast--error'));
  assert.ok(!box.children[0].classList.contains('toast--error'));
});

test('toast: same text replaces, and at most two stay', () => {
  box.children.length = 0;
  ui.toast('a'); ui.toast('a');
  assert.equal(box.children.length, 1);
  ui.toast('b'); ui.toast('c');
  assert.deepEqual(box.children.map((t) => t.textContent), ['b', 'c']);
});
