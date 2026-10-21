'use strict';
require('./helpers');

// Round 36 LATE-SUPPLIES (D-118): Edit/Count/History live inside a row's More disclosure. After the dialog's redraw
// that disclosure must be drawn open again, or the focus guard lands on the "More for <name>" summary. Frontend only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(process.env.R36_SUP_SRC || path.join(JS, 'views/supplies.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r36late-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

test('source: the row disclosure is drawn open for the row the dialog came from', () => {
  assert.match(src, /h\('details', \{ class: 'ops-more', open: s\.supply_id === reopenId \}/);
  assert.match(src, /const reopenId = reopen; reopen = null;/);
  for (const call of ["move(s, 'count')", 'showHistory(s)', 'addOrEdit(s)']) {
    assert.ok(src.includes(`fromMore(s, () => ${call})`), `${call} goes through fromMore`);
  }
});

// Redraw: the old Edit button is removed; the new row has Edit inside More, open or closed.
function redraw(open) {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const oldEdit = btn(w, w.main, 'Edit', { 'aria-label': 'Edit Towels', 'data-focus-key': 'supply-edit-7' });
  oldEdit.focus(); g.note(oldEdit);
  w.remove(oldEdit);
  const details = w.main.add(w.make('details', {}));
  details.open = open;
  const summary = details.add(w.make('summary', { 'aria-label': 'More for Bath towels' }, 'More'));
  const edit = btn(w, details, 'Edit', { 'aria-label': 'Edit Bath towels', 'data-focus-key': 'supply-edit-7' });
  g.check(100);
  return { w, edit, summary };
}

test('open disclosure: focus returns to the keyed Edit button', () => {
  const { w, edit } = redraw(true);
  assert.equal(w.activeElement, edit);
});

test('closed disclosure (the bug): focus falls on the More summary', () => {
  const { w, summary } = redraw(false);
  assert.equal(w.activeElement, summary);
});
