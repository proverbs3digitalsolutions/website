'use strict';

// QA r11 C01: focus with no opener (#37, K9) and slow redraws (K13). Frontend-only: no database.
// QA r13 F01: keepFocus is gone; the same rules now run on the single focus guard in ui.js (D-89).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const uiSrc = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r11c01-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

const guard = (w) => ui.installFocusGuard(w, { observe: false });

test('(a) no opener: the dialog closes onto the page heading, which is made focusable', () => {
  const modal = uiSrc.slice(uiSrc.indexOf('export function openModal'), uiSrc.indexOf('let reasonSeq'));
  assert.match(modal, /const hadOpener = Boolean\(document\.activeElement && document\.activeElement !== document\.body/);
  assert.match(modal, /if \(!hadOpener\) focusHeadingIfFree\(\)/);
  const fn = uiSrc.slice(uiSrc.indexOf('function focusHeadingIfFree'), uiSrc.indexOf('// ---------------------------------------------------------------- modal'));
  assert.match(fn, /setAttribute\('tabindex', '-1'\)/);
});

test('(b) the heading is replaced by a redraw at 3000 ms: the new heading gets focus', () => {
  const w = world();
  const g = guard(w);
  const old = btn(w, w.main, 'Save'); old.focus(); g.note(old);
  w.remove(old);
  g.check(0); g.check(900);
  assert.equal(w.activeElement, w.h1);
  w.remove(w.h1);
  const h1 = w.main.add(w.make('h1', {}, 'Page'));
  g.check(3000);
  assert.equal(w.activeElement, h1);
});

test('(c) a redraw that lands at 4500 ms: focus moves from the heading to the new button', () => {
  const w = world();
  const g = guard(w);
  const box = w.main.add(w.make('div'));
  const old = btn(w, box, 'Save'); old.focus(); g.note(old);
  w.remove(old);
  g.check(100); g.check(900);
  assert.equal(w.activeElement, w.h1, 'fallback heading while nothing replaced it');
  const fresh = btn(w, box, 'Save');
  g.check(4500);
  assert.equal(w.activeElement, fresh);
});

test('(d) never steals late: an input focused at 3000 ms keeps focus to 10000 ms', () => {
  const w = world();
  const g = guard(w);
  const box = w.main.add(w.make('div'));
  const old = btn(w, box, 'Save'); old.focus(); g.note(old);
  const input = box.add(w.make('input', { type: 'text' }));
  w.remove(old);
  g.check(100);
  input.focus();
  g.check(3000);
  btn(w, box, 'Save');
  g.check(4500); g.check(9000);
  assert.equal(w.activeElement, input);
});

test('(e) bounded: a replacement that appears after 10000 ms is not focused', () => {
  const w = world();
  const g = guard(w);
  const box = w.main.add(w.make('div'));
  const old = btn(w, box, 'Save'); old.focus(); g.note(old);
  w.remove(old);
  g.check(100); g.check(900);
  g.check(10400);
  const fresh = btn(w, box, 'Save');
  g.check(11000);
  assert.notEqual(w.activeElement, fresh);
  assert.equal(ui.FOCUS_WATCH_MS, 10000);
});

test('(f) source: the guard waits up to FOCUS_WATCH_MS and the heading comes after HEADING_AFTER_MS', () => {
  assert.equal(ui.HEADING_AFTER_MS, 800);
  assert.match(uiSrc, /setTimeout\(\(\) => \{ if \(lossAt === mine\) check\(mine \+ FOCUS_WATCH_MS \+ 1\); \}, FOCUS_WATCH_MS\)/);
  assert.doesNotMatch(appSrc, /FOCUS_CHECKS|restoreTabFocus/);
});
