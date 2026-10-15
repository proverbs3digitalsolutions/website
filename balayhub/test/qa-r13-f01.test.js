'use strict';

// QA r13 F01: ONE focus guard in ui.js (D-89) and the persistent shell in app.js. Frontend-only: no database.
// pickFocusMatch (pure), the guard on a tiny fake page, formErrorText, confirmDialog, and source scans of app.js and assistant.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = process.env.F01_JS_DIR || path.join(__dirname, '../public/js');
const uiSrc = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
const assistSrc = fs.readFileSync(path.join(JS, 'assistant.js'), 'utf8');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r13f01-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// ------------------------------------------------------------------ pickFocusMatch (pure)
const c = (o) => ({ key: null, tag: 'button', role: 'button', name: '', group: null, path: '#/x', ...o });

test('pickFocusMatch (1) a data-focus-key beats a name', () => {
  const snap = c({ key: 'stmt-publish', name: 'Publish' });
  assert.equal(ui.pickFocusMatch(snap, [c({ name: 'Publish' }), c({ name: 'Unpublish to correct', key: 'stmt-publish' })]), 1);
});

test('pickFocusMatch (2) same name: the one at the old ordinal', () => {
  const snap = c({ name: 'Edit' });
  assert.equal(ui.pickFocusMatch(snap, [c({ name: 'Edit' }), c({ name: 'Delete' }), c({ name: 'Edit' })], 1), 2);
});

test('pickFocusMatch (3) an ordinal past the end gives the last one', () => {
  const snap = c({ name: 'Edit' });
  assert.equal(ui.pickFocusMatch(snap, [c({ name: 'Edit' }), c({ name: 'Delete' }), c({ name: 'Edit' })], 5), 2);
});

test('pickFocusMatch (4) a renamed tab is found by its place in its tab list', () => {
  const snap = c({ role: 'tab', name: 'Income summary (3)', group: 'Report type' });
  const now = [c({ role: 'tab', name: 'Performance (2)', group: 'Report type' }), c({ role: 'tab', name: 'Income summary (4)', group: 'Report type' }), c({ role: 'tab', name: 'Other', group: 'Elsewhere' })];
  assert.equal(ui.pickFocusMatch(snap, now, 0, 1), 1);
});

test('pickFocusMatch (5) a different role is not a match', () => {
  assert.equal(ui.pickFocusMatch(c({ role: 'tab', name: 'Edit' }), [c({ name: 'Edit' })]), -1);
});

test('pickFocusMatch (6) no key, no name, no group: nothing', () => {
  assert.equal(ui.pickFocusMatch(c({}), [c({ name: 'Edit' }), c({})]), -1);
});

// ------------------------------------------------------------------ a tiny fake page
function world() {
  const w = { activeElement: null, focusCalls: [] };
  const make = (tag, attrs = {}, text = '') => {
    const n = {
      tagName: tag.toUpperCase(), isConnected: true, hidden: false, open: false, disabled: false, children: [], parentElement: null, textContent: text,
      attrs: { ...attrs }, classSet: new Set(),
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      focus(opts) { if (!this.disabled && this.isConnected) { w.activeElement = this; w.focusCalls.push({ el: this, opts }); } },
      add(x) { x.parentElement = this; this.children.push(x); return x; },
      // The guard only asks for tags ('dialog', 'h1') or for a long focusable selector (every descendant; it filters itself).
      querySelectorAll(sel) { const out = []; const tagOnly = /^\w+$/.test(sel); const walk = (p) => p.children.forEach((x) => { if (!tagOnly || x.tagName.toLowerCase() === sel) out.push(x); walk(x); }); walk(this); return out; },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    };
    n.classList = { contains: (k) => n.classSet.has(k) };
    return n;
  };
  w.make = make;
  w.body = make('body');
  w.app = w.body.add(make('div', { id: 'app' }));
  w.main = w.app.add(make('main', { id: 'main' }));
  w.h1 = w.main.add(make('h1', {}, 'Page'));
  w.querySelectorAll = (sel) => w.body.querySelectorAll(sel);
  w.querySelector = (sel) => w.body.querySelector(sel);
  w.getElementById = (id) => [w.body, ...w.body.querySelectorAll('*')].find((x) => x.attrs.id === id) || null;
  const gone = (n) => { n.isConnected = false; n.children.forEach(gone); };
  w.remove = (n) => { gone(n); n.parentElement.children.splice(n.parentElement.children.indexOf(n), 1); if (w.activeElement && !w.activeElement.isConnected) w.activeElement = w.body; };
  w.dialog = () => { const d = w.body.add(make('dialog')); d.classSet.add('modal'); d.open = true; return d; };
  w.activeElement = w.body;
  globalThis.document = w;
  globalThis.location = { hash: '#/reservations/1' };
  return w;
}
const btn = (w, parent, label, extra = {}) => parent.add(w.make('button', extra, label));

test('focusKeyOf reads key, role, name, group and path', () => {
  const w = world();
  const tabs = w.main.add(w.make('div', { role: 'tablist', 'aria-label': 'Report type' }));
  const tab = tabs.add(w.make('button', { role: 'tab', 'data-focus-key': 'k1' }, '  Income \n summary '));
  const k = ui.focusKeyOf(tab);
  assert.deepEqual(k, { key: 'k1', tag: 'button', role: 'tab', name: 'Income summary', group: 'Report type', path: '#/reservations/1' });
  const plain = btn(w, w.main, 'Save', { 'aria-label': 'Save note' });
  assert.deepEqual([ui.focusKeyOf(plain).role, ui.focusKeyOf(plain).name, ui.focusKeyOf(plain).group, ui.focusKeyOf(plain).key], ['button', 'Save note', null, null]);
});

// ------------------------------------------------------------------ the guard
test('(a) a removed "Record payment" button: focus lands on the new one, without scrolling', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Record payment'); old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Record payment');
  g.check(0);
  assert.equal(w.activeElement, fresh);
  assert.deepEqual(w.focusCalls.at(-1).opts, { preventScroll: true });
});

test('(a2) Publish becomes "Unpublish to correct": the shared data-focus-key finds it', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Publish', { 'data-focus-key': 'stmt-publish' }); old.focus(); g.note(old);
  w.remove(old);
  btn(w, w.main, 'Publish');
  const fresh = btn(w, w.main, 'Unpublish to correct', { 'data-focus-key': 'stmt-publish' });
  g.check(0);
  assert.equal(w.activeElement, fresh);
});

test('(b) nothing matches: the page heading gets focus at once (tabindex -1, no scroll); a match at 3 s takes over', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Void payment'); old.focus(); g.note(old);
  w.remove(old);
  g.check(0);
  assert.equal(w.activeElement, w.h1, 'r14: the heading does not wait');
  assert.equal(w.h1.getAttribute('tabindex'), '-1');
  assert.deepEqual(w.focusCalls.at(-1).opts, { preventScroll: true });
  const fresh = btn(w, w.main, 'Void payment');
  g.check(3000);
  assert.equal(w.activeElement, fresh);
});

test('(b2) the heading is not a record: it does not overwrite what the person used', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Cancel quote'); g.note(old); old.focus();
  w.remove(old);
  g.check(0); g.check(900);
  assert.equal(w.activeElement, w.h1);
  g.note(w.h1);
  assert.equal(g.state().rec.el, old);
});

test('(c) a dialog is open: nothing happens; when it closes the control is found', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Save payout'); old.focus(); g.note(old);
  const d = w.dialog();
  const ok = btn(w, d, 'Save'); ok.focus();
  w.remove(old);
  const fresh = btn(w, w.main, 'Save payout');
  w.activeElement = w.body; // the page is inert under the dialog
  g.check(0);
  assert.equal(w.activeElement, w.body);
  d.open = false; w.remove(d);
  g.check(100);
  assert.equal(w.activeElement, fresh);
});

test('(c2) a control inside the dialog that the dialog redraws is found inside the dialog', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const d = w.dialog();
  const old = btn(w, d, 'Add line'); old.focus(); g.note(old);
  btn(w, w.main, 'Add line'); // same name on the page behind: must not be chosen
  w.remove(old);
  const fresh = btn(w, d, 'Add line');
  g.check(0);
  assert.equal(w.activeElement, fresh);
});

test('(d) the route changed: the guard stays out of the router\'s way', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Open'); old.focus(); g.note(old);
  w.remove(old);
  btn(w, w.main, 'Open');
  globalThis.location.hash = '#/guests';
  g.check(0);
  assert.equal(w.activeElement, w.body);
  assert.equal(g.state().rec, null);
});

test('(d2) a query change on the same path is a redraw, not a route change', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Apply'); old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Apply');
  globalThis.location.hash = '#/reservations/1?status=paid';
  g.check(0);
  assert.equal(w.activeElement, fresh);
});

test('(e) the person focused another control: the guard leaves it alone', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Save'); old.focus(); g.note(old);
  const input = w.main.add(w.make('input', { type: 'text' })); input.focus();
  w.remove(old);
  btn(w, w.main, 'Save');
  g.check(0);
  assert.equal(w.activeElement, input);
});

test('(f) the match sits in a closed "More" fold: its summary gets focus', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Count', { 'aria-label': 'Count Soap' }); old.focus(); g.note(old);
  w.remove(old);
  const fold = w.main.add(w.make('details'));
  const sum = fold.add(w.make('summary', { 'aria-label': 'More for Soap' }, 'More'));
  btn(w, fold, 'Count', { 'aria-label': 'Count Soap' });
  g.check(0);
  assert.equal(w.activeElement, sum);
});

test('(g) a control that is disabled while saving gets focus back when it is enabled again', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const b = btn(w, w.main, 'Save'); b.focus(); g.note(b);
  b.disabled = true; w.activeElement = w.body;
  g.check(0);
  assert.equal(w.activeElement, w.body, 'waits while disabled');
  b.disabled = false;
  g.check(50);
  assert.equal(w.activeElement, b);
});

test('(h) a hidden match waits instead of taking the heading', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Ask'); old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Ask'); fresh.hidden = true;
  g.check(0); g.check(900);
  assert.equal(w.activeElement, w.body);
  fresh.hidden = false;
  g.check(1000);
  assert.equal(w.activeElement, fresh);
});

test('(i) the assistant panel and the More sheet are not recorded', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const panel = w.body.add(w.make('section')); panel.classSet.add('assist');
  g.note(btn(w, panel, 'Send'));
  assert.equal(g.state().rec, null);
});

test('(j) it gives up after 10 s: a match that appears later is not focused', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const old = btn(w, w.main, 'Void'); old.focus(); g.note(old);
  w.remove(old);
  g.check(0); g.check(900);
  g.check(10500);
  btn(w, w.main, 'Void');
  g.check(10600);
  assert.notEqual(w.activeElement?.textContent, 'Void');
});

// ------------------------------------------------------------------ formErrorText
test('formErrorText: a placed field message is not repeated in the summary', () => {
  const generic = { text: 'Please check the highlighted fields.', fieldNote: true };
  assert.deepEqual(ui.formErrorText({ message: 'Enter a whole number of guests, 1 or more.', fields: { guests: 'Enter a whole number of guests, 1 or more.' } }, []), generic);
  assert.deepEqual(ui.formErrorText({ message: 'A. B.', summary: 'Check the fields.', fields: { a: 'A.', b: 'B.' } }, []), generic);
});

test('formErrorText: an unplaced message shows; a plain error shows its message', () => {
  assert.deepEqual(ui.formErrorText({ message: 'x', summary: 'g', fields: { room: 'Pick a room.' } }, ['Pick a room.']), { text: 'Pick a room.', fieldNote: false });
  assert.deepEqual(ui.formErrorText({ message: 'This email is taken.', fields: { name: 'Name is used.' } }, []), { text: 'This email is taken.', fieldNote: false });
  assert.deepEqual(ui.formErrorText({ message: 'Server said no.', fields: {} }, []), { text: 'Server said no.', fieldNote: false });
});

// ------------------------------------------------------------------ confirmDialog starts on Cancel
test('confirmDialog without a reason box focuses its Cancel button; with one it does not', () => {
  class El {
    constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.isConnected = true; this.listeners = {}; this.classList = { add() { } }; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    addEventListener(k, f) { this.listeners[k] = f; }
    append(...c) { for (const x of c.flat(Infinity)) { if (x && typeof x === 'object') { x.parentElement = this; this.children.push(x); } } }
    get textContent() { return this.text ?? this.children.map((x) => x.textContent).join(''); }
    all(out = []) { this.children.forEach((x) => { out.push(x); x.all(out); }); return out; }
    querySelector(sel) { return sel.startsWith('input') ? this.all().find((x) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(x.tagName)) || null : null; }
    querySelectorAll() { return []; }
    focus() { document.activeElement = this; }
    showModal() { }
    close() { }
    remove() { }
  }
  const prevNode = globalThis.Node;
  globalThis.Node = El;
  const body = new El('body');
  globalThis.document = {
    activeElement: body, body,
    createElement: (t) => new El(t), createTextNode: (s) => { const x = new El('#text'); x.text = String(s); return x; },
    querySelectorAll: () => [],
  };
  try {
    ui.confirmDialog({ title: 'Delete?', text: 'Sure?' });
    const dlg = body.children[0];
    const cancel = dlg.all().find((x) => x.tagName === 'BUTTON' && x.textContent === 'Cancel');
    assert.ok(cancel, 'a Cancel button');
    assert.equal(document.activeElement, cancel);
    body.children.length = 0; document.activeElement = body;
    ui.confirmDialog({ title: 'Why?', text: 'Say why', reason: true });
    assert.notEqual(document.activeElement.textContent, 'Cancel');
  } finally { globalThis.Node = prevNode; }
});

// ------------------------------------------------------------------ source scans
test('ui.js exports the guard and no longer exports the old watchers', () => {
  for (const n of ['focusKeyOf', 'pickFocusMatch', 'installFocusGuard', 'formErrorText']) assert.equal(typeof ui[n], 'function', n);
  assert.equal(ui.HEADING_AFTER_MS, 0); // r14: the heading gets focus at once
  assert.equal(ui.FOCUS_WATCH_MS, 10000);
  for (const n of ['keepFocus', 'sameControl', 'snapshotControl', 'findReplacement', 'FOCUS_CHECKS']) assert.equal(ui[n], undefined, n);
  assert.doesNotMatch(uiSrc, /document\.addEventListener\('click'/);
});

test('openModal has no keepFocus; a dialog with no opener closes onto the heading', () => {
  const modal = uiSrc.slice(uiSrc.indexOf('export function openModal'), uiSrc.indexOf('let reasonSeq'));
  assert.doesNotMatch(modal, /keepFocus/);
  assert.match(modal, /if \(!hadOpener\) focusHeadingIfFree\(\)/);
  assert.match(uiSrc, /h1\.focus\(\{ preventScroll: true \}\)/);
});

test('app.js: the shell is built only when its key changed; one scroll, before the view runs', () => {
  const r = appSrc.slice(appSrc.indexOf('export async function render'), appSrc.indexOf('// Keyboard users can only scroll'));
  assert.equal(appSrc.split('buildShell(').length - 1, 2, 'defined once, called once');
  assert.match(r, /if \(shell\?\.el\.isConnected && shellSig === key\) updateShell\(shell, path\);\s*\n\s*else \{/);
  assert.match(appSrc, /const shellKey = /);
  assert.equal(appSrc.split('scrollTo(0, 0)').length - 1, 1, 'one scroll in app.js');
  assert.ok(r.indexOf('scrollTo(0, 0)') < r.indexOf('await route.view'));
  assert.match(r, /shell\.content\.replaceChildren\(skeleton\(\)\);\s*\n\s*window\.scrollTo\(0, 0\)/);
  assert.match(r, /shell = null;\s*\n\s*shellSig = null;/);
});

test('app.js: heading focus does not scroll and treats the menu link as free; the skip link is first; the guard is installed', () => {
  assert.match(appSrc, /a\.closest\('\.sidebar, \.topbar, \.bottomnav, \.skip-link, \.assist-fab'\)/);
  assert.match(appSrc, /h1\.focus\(\{ preventScroll: true \}\)/);
  assert.match(appSrc, /h\('div', \{ class: 'shell' \},\s*\n\s*h\('a', \{ class: 'skip-link', href: '#main', onclick: skipToMain \}, 'Skip to main content'\)/);
  assert.match(appSrc, /function skipToMain\(e\) \{\s*\n\s*e\.preventDefault\(\);/);
  assert.match(appSrc, /installFocusGuard\(\);\s*\n\s*render\(\);/);
  assert.doesNotMatch(appSrc, /restoreTabFocus|FOCUS_CHECKS/);
  assert.match(appSrc, /function tabKeyTarget/, 'arrow keys stay');
});

test('app.js: updateShell moves only the page marks; the phone More sheet folds More tools like the sidebar', () => {
  const u = appSrc.slice(appSrc.indexOf('function updateShell'), appSrc.indexOf('// ---------------------------------------------------------------- render'));
  assert.match(u, /aria-current/);
  assert.doesNotMatch(u, /replaceChildren|buildShell|navGroup\(/);
  const m = appSrc.slice(appSrc.indexOf('function openMore'), appSrc.indexOf('const initials'));
  assert.match(m, /h\('details', \{ class: 'morenav__fold', open: moreSaved\(\)/);
  assert.match(m, /onclick: saveMore/);
  assert.match(m, /summary/);
  assert.match(appSrc, /const NAV_MORE_KEY = 'bh-nav-more'/);
});

test('assistant.js: closing the panel with focus inside gives focus to the Ask button', () => {
  const close = assistSrc.slice(assistSrc.indexOf('export function closeAssistant'), assistSrc.indexOf('export function openAssistant'));
  assert.match(close, /panel\.contains\(document\.activeElement\)/);
  assert.match(close, /if \(hadFocus\) fab\?\.focus\(\)/);
  assert.match(close, /'\.assist-fab'/);
});

test('app.js: the phone More button reads the current page when pressed, not the page the shell was built on', () => {
  const b = appSrc.slice(appSrc.indexOf('function buildShell'), appSrc.indexOf('function skipToMain'));
  assert.match(appSrc, /function openMore\(\) \{\s*\n\s*const current = parseHash\(\)\.path;/);
  assert.doesNotMatch(b, /openMore\(path\)|openMore\(current\)/);
  // The other build-time uses of path only set the first marks; updateShell rewrites them on every route change.
  assert.doesNotMatch(b, /onclick: \(\) => [^\n]*\bpath\b/);
});

test('daily close: after Reopen day is removed, a button in the group is no match (r14: groups match tabs and radios only), so the heading gets focus', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const mk = (label) => { const grp = w.main.add(w.make('div', { role: 'group', 'aria-label': 'Daily close actions' })); return [grp, btn(w, grp, label)]; };
  const [oldGrp, reopen] = mk('Reopen day'); reopen.focus(); g.note(reopen);
  w.remove(oldGrp);
  mk('Close the day');
  g.check(0);
  assert.equal(w.activeElement, w.h1);
});

test('a control in the header outside #main (guest language toggle) is found before the heading', () => {
  const w = world();
  const g = ui.installFocusGuard(w, { observe: false });
  const mk = () => { const head = w.app.add(w.make('header')); const grp = head.add(w.make('div', { role: 'group', 'aria-label': 'Language' })); btn(w, grp, 'English'); return [head, btn(w, grp, 'Tagalog')]; };
  const [oldHead, old] = mk(); old.focus(); g.note(old);
  w.remove(oldHead);
  const [, fresh] = mk();
  g.check(0);
  assert.equal(w.activeElement, fresh);
});
