'use strict';
require('./helpers');

// Round 36 PROPS (D-118): Archive/Restore (property) and Archive unit/Restore unit/Edit unit carry fixed focus keys, so focus follows
// the replacement button after a press. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'views/properties.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36props-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// The h('button' call (balanced parens) that ends with the given visible word.
function buttonCalls(word) {
  const out = [];
  for (let i = src.indexOf("h('button'"); i >= 0; i = src.indexOf("h('button'", i + 1)) {
    let d = 0, j = i + 1;
    for (; j < src.length; j++) { if (src[j] === '(') d++; else if (src[j] === ')') { d--; if (d === 0) break; } }
    const call = src.slice(i, j + 1);
    if (call.endsWith(`, '${word}')`)) out.push(call);
  }
  return out;
}

test('source: property Archive and Restore share prop-archive', () => {
  const a = buttonCalls('Archive').filter((c) => c.includes('archiveProperty'));
  const r = buttonCalls('Restore').filter((c) => c.includes('restoreProperty'));
  assert.equal(a.length, 1); assert.equal(r.length, 1);
  for (const c of [...a, ...r]) assert.match(c, /'data-focus-key': 'prop-archive'/);
});

test('source: unit Archive and Restore share unit-archive-<id>, Edit has unit-edit-<id>', () => {
  const a = buttonCalls('Archive').filter((c) => c.includes('Archive unit'));
  const r = buttonCalls('Restore').filter((c) => c.includes('Restore unit'));
  const e = buttonCalls('Edit').filter((c) => c.includes('Edit unit'));
  assert.equal(a.length, 1); assert.equal(r.length, 1); assert.equal(e.length, 1);
  for (const c of [...a, ...r]) assert.match(c, /'data-focus-key': `unit-archive-\$\{u\.unit_id\}`/);
  assert.match(e[0], /'data-focus-key': `unit-edit-\$\{u\.unit_id\}`/);
});

function redraw(oldKey, newKey, oldLabel, newLabel) {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const b = btn(w, w.main, oldLabel, oldKey ? { 'data-focus-key': oldKey } : {});
  b.focus(); g.note(b);
  w.remove(b);
  const n = btn(w, w.main, newLabel, newKey ? { 'data-focus-key': newKey } : {});
  g.check(100);
  return { w, n };
}

test('stand-in DOM: Archive then Restore with the same key keeps focus on the replacement', () => {
  const { w, n } = redraw('prop-archive', 'prop-archive', 'Archive', 'Restore');
  assert.equal(w.activeElement, n);
  const u = redraw('unit-archive-7', 'unit-archive-7', 'Archive', 'Restore');
  assert.equal(u.w.activeElement, u.n);
});

test('stand-in DOM: without the key the heading wins (the old behaviour)', () => {
  const { w, n } = redraw(null, null, 'Archive', 'Restore');
  assert.notEqual(w.activeElement, n);
  assert.equal(w.activeElement, w.h1);
});
