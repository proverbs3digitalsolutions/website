'use strict';
require('./helpers');

// QA r31 lane UPLOADFIELD (contract C1): fileRefused and uploadField in ui.js. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ui;
// A tiny element: enough for h(), classList, attributes and focus.
function el(tag) {
  const n = Object.assign(new globalThis.Node(), {
    tagName: tag.toUpperCase(), attrs: {}, children: [], className: '', textContent: '', focused: 0, dataset: {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; }, addEventListener() {}, focus() { this.focused++; },
    append(...c) { this.children.push(...c); }, style: {},
  });
  Object.defineProperty(n, 'id', { get() { return this.attrs.id; } });
  const set = new Set();
  n.classList = { add: (k) => set.add(k), remove: (k) => set.delete(k), contains: (k) => set.has(k) };
  return n;
}
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r31uf-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.document = { createElement: el, createTextNode: (t) => ({ text: t }) };
  globalThis.Element = class { append() {} prepend() {} };
  globalThis.Node = class {};
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('fileRefused: the three codes and 413/415 are refusals; offline, 500, 403 and nothing are not', () => {
  for (const code of ['EMPTY_FILE', 'BAD_FILE_CONTENT', 'UNSUPPORTED_FILE']) assert.equal(ui.fileRefused({ code }), true, code);
  for (const status of [413, 415]) assert.equal(ui.fileRefused({ status }), true, String(status));
  for (const e of [{ offline: true }, { status: 500 }, { status: 403 }, undefined, null]) assert.equal(ui.fileRefused(e), false);
});

test('uploadField: wrapper, aria-describedby, show, clear, unique ids', () => {
  const input = el('input');
  input.setAttribute('aria-describedby', 'hint-1');
  const up = ui.uploadField(input);
  assert.ok(up.wrap.classList.contains('field') || up.wrap.className === 'field');
  assert.equal(up.wrap.children[0], input);
  const line = up.wrap.children[1];
  assert.equal(line.className, 'error');
  assert.equal(line.getAttribute('role'), 'alert');
  assert.match(line.id, /^upload-err-\d+$/);
  assert.equal(input.getAttribute('aria-describedby'), `hint-1 ${line.id}`);
  up.show('X');
  assert.equal(line.textContent, 'X');
  assert.equal(up.wrap.classList.contains('field--invalid'), true);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(input.focused, 1);
  up.clear();
  assert.equal(line.textContent, '');
  assert.equal(up.wrap.classList.contains('field--invalid'), false);
  assert.equal(input.getAttribute('aria-invalid'), null);
  const other = ui.uploadField(el('input'));
  assert.notEqual(other.wrap.children[1].id, line.id);
});
