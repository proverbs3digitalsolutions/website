'use strict';

// QA r16 lane S: the focus guard keeps a control after "Tab, then act inside 300 ms", makeForm marks Save busy with aria-disabled (no
// .disabled, so focus stays), and a dialog with no field starts on its first action. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = process.env.U1_JS_DIR || path.join(__dirname, '../public/js');
const uiSrc = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r16ui-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});
const guard = (w) => ui.installFocusGuard(w, { observe: false });

for (const later of [50, 400]) {
  test(`(1) Tab, then focus lands on a select, the page redraws it: focus follows (check at ${later} ms)`, () => {
    const w = world();
    const g = guard(w);
    const sel = w.main.add(w.make('select', { 'aria-label': 'Assigned to' })); sel.focus(); g.note(sel);
    g.moved(0);              // keydown Tab
    g.note(sel);             // focusin on the select
    w.remove(sel);           // the change redraws the page
    const fresh = w.main.add(w.make('select', { 'aria-label': 'Assigned to' }));
    g.check(later);
    assert.equal(w.activeElement, fresh);
  });
}

test('(2) same with a data-focus-key and a button whose label changes (Snooze to Unsnooze)', () => {
  const w = world();
  const g = guard(w);
  const old = btn(w, w.main, 'Snooze', { 'data-focus-key': 'conv-snooze' }); old.focus();
  g.moved(0); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Unsnooze', { 'data-focus-key': 'conv-snooze' });
  g.check(60); g.check(400);
  assert.equal(w.activeElement, fresh);
});

test('(2b) Tab that ends on nothing is still forgotten (round 14 trap stays)', () => {
  const w = world();
  const g = guard(w);
  const input = w.main.add(w.make('input', { type: 'text' })); input.focus(); g.note(input);
  g.moved(0); w.activeElement = w.body;
  g.check(10); g.check(500);
  assert.equal(w.activeElement, w.body);
  assert.equal(g.state().rec, null);
});

test('(3) makeForm marks Save aria-disabled while saving, never .disabled, and a second submit is ignored', () => {
  const m = uiSrc.match(/export function makeForm[\s\S]*?\n}\n/)[0];
  assert.match(m, /submitBtn\.setAttribute\('aria-disabled', 'true'\)/);
  assert.match(m, /submitBtn\.removeAttribute\('aria-disabled'\)/);
  assert.doesNotMatch(m, /submitBtn\.disabled/);
  assert.match(m, /if \(busy\) return;/);
});

test('(4) openModal falls back to the first body button or link, then the × button; confirmDialog still starts on Cancel', () => {
  const m = uiSrc.match(/export function openModal[\s\S]*?\n}\n/)[0];
  assert.match(m, /input:not\(\[type=hidden\]\), select, textarea'\) \|\| dlg\.querySelector\('\.modal__body button:not\(:disabled\), \.modal__body a\[href\]'\)\)\?\.focus\(\)/);
  assert.match(uiSrc, /if \(!reasonInput\) cancelBtn\.focus\(\);/);
});
