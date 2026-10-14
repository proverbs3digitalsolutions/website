'use strict';

// QA r11 C01: focus watcher with no opener (#37, K9) and slow redraws (K13). Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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

// ---- a tiny fake page (same shape as qa-r10-c01)
function world() {
  const w = { activeElement: null };
  const make = (tag, attrs = {}, text = '') => ({
    tagName: tag.toUpperCase(), isConnected: true, children: [], parentElement: null, textContent: text, disabled: false, attrs: { ...attrs },
    getAttribute(k) { return this.attrs[k] ?? null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    focus() { if (!this.disabled && this.isConnected) w.activeElement = this; },
    add(c) { c.parentElement = this; this.children.push(c); return c; },
    querySelectorAll(sel) { const out = []; const walk = (x) => x.children.forEach((c) => { if (c.tagName.toLowerCase() === sel) out.push(c); walk(c); }); walk(this); return out; },
  });
  w.make = make;
  w.body = make('body');
  w.app = w.body.add(make('div', { id: 'app' }));
  w.app.id = 'app';
  w.h1 = w.app.add(make('h1', {}, 'Page'));
  w.querySelectorAll = (sel) => w.body.querySelectorAll(sel);
  w.querySelector = (sel) => w.body.querySelectorAll(sel)[0] || null;
  const gone = (n) => { n.isConnected = false; n.children.forEach(gone); };
  w.remove = (n) => { gone(n); n.parentElement.children.splice(n.parentElement.children.indexOf(n), 1); if (w.activeElement && !w.activeElement.isConnected) w.activeElement = w.body; };
  w.activeElement = w.body;
  globalThis.document = w;
  return w;
}
const btn = (w, parent, label) => parent.add(w.make('button', { 'aria-label': label }, label));

test('(a) no opener: the page heading gets focus at once and is made focusable', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  ui.keepFocus(null, { headingAfter: 0 });
  t.mock.timers.tick(0);
  assert.equal(w.activeElement, w.h1);
  assert.equal(w.h1.getAttribute('tabindex'), '-1');
});

test('(b) the heading is replaced by a redraw at 3000 ms: the new heading gets focus', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  ui.keepFocus(null, { headingAfter: 0 });
  t.mock.timers.tick(3000);
  w.remove(w.h1);
  const h1 = w.app.add(w.make('h1', {}, 'Page'));
  t.mock.timers.tick(500);
  assert.equal(w.activeElement, h1);
});

test('(c) a redraw that lands at 4500 ms: focus moves from the heading to the new button', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const box = w.app.add(w.make('div'));
  const old = btn(w, box, 'Save'); old.focus();
  ui.keepFocus(old, { refocusOld: false });
  t.mock.timers.tick(100);
  w.remove(old);
  t.mock.timers.tick(4400);
  assert.equal(w.activeElement, w.h1, 'fallback heading while nothing replaced it');
  const fresh = box.add(w.make('button', { 'aria-label': 'Save' }, 'Save'));
  t.mock.timers.tick(500);
  assert.equal(w.activeElement, fresh);
});

test('(d) never steals late: an input focused at 3000 ms keeps focus to 10000 ms', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const box = w.app.add(w.make('div'));
  const old = btn(w, box, 'Save'); old.focus();
  const input = box.add(w.make('input'));
  ui.keepFocus(old, { refocusOld: false });
  t.mock.timers.tick(100);
  w.remove(old);
  t.mock.timers.tick(2900);
  input.focus();
  t.mock.timers.tick(1500);
  box.add(w.make('button', { 'aria-label': 'Save' }, 'Save'));
  t.mock.timers.tick(5500);
  assert.equal(w.activeElement, input);
});

test('(e) bounded: a replacement that appears after 10000 ms is not focused', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const box = w.app.add(w.make('div'));
  const old = btn(w, box, 'Save'); old.focus();
  ui.keepFocus(old, { refocusOld: false });
  t.mock.timers.tick(100);
  w.remove(old);
  t.mock.timers.tick(10400);
  const fresh = box.add(w.make('button', { 'aria-label': 'Save' }, 'Save'));
  t.mock.timers.tick(1000);
  assert.notEqual(w.activeElement, fresh);
  assert.equal(ui.FOCUS_WATCH_MS, 10000);
});

test('(f) source: openModal without an opener asks for the heading; tab polling runs to FOCUS_WATCH_MS', () => {
  const modal = uiSrc.slice(uiSrc.indexOf('export function openModal'), uiSrc.indexOf('export function confirmDialog'));
  assert.match(modal, /keepFocus\(null, \{ headingAfter: 0 \}\)/);
  assert.match(modal, /keepFocus\(opener, \{ snap: openerSnap \}\)/);
  assert.match(appSrc, /FOCUS_CHECKS/);
  assert.doesNotMatch(appSrc, /\[0, 40, 100, 200, 350, 500, 800, 1200, 1600, 2000\]/);
  assert.equal(ui.FOCUS_CHECKS.at(-1), ui.FOCUS_WATCH_MS);
});
