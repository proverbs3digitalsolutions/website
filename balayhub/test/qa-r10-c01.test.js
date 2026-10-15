'use strict';

// QA r10 C01: focus after a redraw, tab focus, makeForm check hook, menu groups. Frontend-only: no database.
// QA r13 F01: the keepFocus watcher and the tab polling were replaced by the single focus guard in ui.js (D-89); (a) to (h) now run on the guard.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r10c01-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

const guard = (w) => ui.installFocusGuard(w, { observe: false });

test('(a) a redraw at 300 ms: focus lands on the new button with the same name', () => {
  const w = world();
  const g = guard(w);
  const old = btn(w, w.main, 'Save note', { 'aria-label': 'Save note' }); old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Save note', { 'aria-label': 'Save note' });
  g.check(300);
  assert.equal(w.activeElement, fresh);
});

test('(b) a late redraw at 900 ms is still caught', () => {
  const w = world();
  const g = guard(w);
  const old = btn(w, w.main, 'Void refund', { 'aria-label': 'Void refund' }); old.focus(); g.note(old);
  w.remove(old);
  g.check(0);
  const fresh = btn(w, w.main, 'Void refund', { 'aria-label': 'Void refund' });
  g.check(900);
  assert.equal(w.activeElement, fresh);
});

test('(c) a toggle that renamed itself is found by its data-focus-key', () => {
  const w = world();
  const g = guard(w);
  const row = w.main.add(w.make('div'));
  btn(w, row, 'Edit');
  const old = btn(w, row, 'Mark dirty', { 'data-focus-key': 'clean-toggle' }); old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, row, 'Mark clean', { 'data-focus-key': 'clean-toggle' });
  g.check(200);
  assert.equal(w.activeElement, fresh);
});

test('(d) the row is gone: focus lands on the page heading, made focusable', () => {
  const w = world();
  const g = guard(w);
  const list = w.main.add(w.make('ul'));
  const rows = ['Archive A', 'Archive B', 'Archive C'].map((n) => { const li = list.add(w.make('li')); return btn(w, li, n); });
  rows[1].focus(); g.note(rows[1]);
  w.remove(rows[1].parentElement);
  g.check(0); g.check(900);
  assert.equal(w.activeElement, w.h1);
  assert.equal(w.h1.getAttribute('tabindex'), '-1');
});

test('(e) never steals focus the person moved elsewhere', () => {
  const w = world();
  const g = guard(w);
  const box = w.main.add(w.make('div'));
  const old = btn(w, box, 'Save'); old.focus(); g.note(old);
  const input = box.add(w.make('input', { type: 'text' }));
  input.focus();
  w.remove(old);
  btn(w, box, 'Save');
  g.check(700);
  assert.equal(w.activeElement, input);
});

test('(f) a button disabled while saving gets focus back when it is enabled again', () => {
  const w = world();
  const g = guard(w);
  const old = btn(w, w.main, 'Save'); old.focus(); g.note(old);
  old.disabled = true; w.activeElement = w.body;
  g.check(400);
  assert.equal(w.activeElement, w.body);
  old.disabled = false;
  g.check(500);
  assert.equal(w.activeElement, old);
});

test('(g) the guard listens to focus, pointer and DOM changes; there is no click watcher', () => {
  assert.match(uiSrc, /doc\.addEventListener\('focusin'/);
  assert.match(uiSrc, /doc\.addEventListener\('pointerdown'/);
  assert.match(uiSrc, /new MutationObserver\(\(\) => check\(\)\)/);
  assert.doesNotMatch(uiSrc, /document\.addEventListener\('click'/);
  assert.doesNotMatch(uiSrc, /keepFocus|settleFocus/);
});

test('(h) a view that builds a whole new tablist: focus lands on the tab at the same place of the same labelled tab list', () => {
  const w = world();
  const g = guard(w);
  const mk = (n) => { const list = w.main.add(w.make('div', { role: 'tablist', 'aria-label': 'Status' })); return [list, [...Array(n)].map((_, i) => list.add(w.make('button', { role: 'tab' }, `Tab ${i} (${n})`)))]; };
  const [oldList, oldTabs] = mk(3);
  oldTabs[1].focus(); g.note(oldTabs[1]);
  w.remove(oldList);
  const [, freshTabs] = mk(3);
  g.check(0);
  assert.equal(w.activeElement, freshTabs[1]);
});

test('(i) makeForm check hook runs in the quick pass, before onSubmit, and never replaces a required message', () => {
  const form = uiSrc.slice(uiSrc.indexOf('export function makeForm'), uiSrc.indexOf('export function formModal'));
  assert.match(form, /check\?\.\(readForm\(form\), form\)/);
  assert.ok(form.indexOf('check?.(readForm(form), form)') < form.indexOf('await onSubmit'));
  assert.ok(form.indexOf('check?.(readForm(form), form)') > form.indexOf('must be between 2000 and 2100.'));
  assert.match(form, /'Please check the highlighted fields\.'/);
  assert.deepEqual(ui.mergeChecks({ a: 'A is required.' }, { a: 'other', b: 'B bad' }), { a: 'A is required.', b: 'B bad' });
  assert.deepEqual(ui.mergeChecks({}, null), {});
});

test('(j) Cleaner pay and Unit owners sit in More tools for the owner, nothing dropped', () => {
  const navSrc = appSrc.slice(appSrc.indexOf('const NAV_SHORT'), appSrc.indexOf('// Trial / read-only'));
  const build = new Function('state', `${navSrc.replace(/export /g, '')}; return { navFor, navGroups };`);
  const owner = { role: 'owner', business_type: 'short_term' };
  const { navFor, navGroups } = build({ user: owner });
  const groups = navGroups(owner);
  const inGroup = (id) => groups.find((g) => g.id === id)?.items.map((n) => n[0]) || [];
  assert.ok(inGroup('more').includes('/cleaner-pay') && inGroup('more').includes('/owners'));
  assert.ok(!inGroup('money').includes('/cleaner-pay') && !inGroup('money').includes('/owners'));
  assert.deepEqual(groups.flatMap((g) => g.items.map((n) => n[0])).sort(), navFor(owner).map((n) => n[0]).sort());
});
