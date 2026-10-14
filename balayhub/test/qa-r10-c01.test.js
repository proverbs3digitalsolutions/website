'use strict';

// QA r10 C01: shared focus watcher (keepFocus), tab focus polling, makeForm check hook, menu groups. Frontend-only: no database.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r10c01-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// ---- a tiny fake page: elements with a parent, children, isConnected, focus() and a tag query
function world() {
  const w = { activeElement: null };
  const make = (tag, attrs = {}, text = '') => {
    const n = {
      tagName: tag.toUpperCase(), isConnected: true, children: [], parentElement: null, textContent: text, disabled: false, attrs: { ...attrs },
      getAttribute(k) { return this.attrs[k] ?? null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      focus() { if (!this.disabled && this.isConnected) w.activeElement = this; },
      add(c) { c.parentElement = this; this.children.push(c); return c; },
      querySelectorAll(sel) { const out = []; const walk = (x) => x.children.forEach((c) => { if (c.tagName.toLowerCase() === sel) out.push(c); walk(c); }); walk(this); return out; },
    };
    return n;
  };
  w.make = make;
  w.body = make('body');
  w.app = w.body.add(make('div', { id: 'app' }));
  w.app.id = 'app';
  w.h1 = w.app.add(make('h1', {}, 'Page'));
  w.querySelectorAll = (sel) => w.body.querySelectorAll(sel);
  w.querySelector = (sel) => w.body.querySelectorAll(sel)[0] || null;
  const gone = (n) => { n.isConnected = false; n.children.forEach(gone); };
  w.remove = (n) => { gone(n); n.parentElement.children.splice(n.parentElement.children.indexOf(n), 1); if (w.activeElement && !w.activeElement.isConnected) w.activeElement = w.body; };
  w.replace = (old, fresh) => { const p = old.parentElement; const i = p.children.indexOf(old); fresh.parentElement = p; p.children.splice(i, 1, fresh); gone(old); if (!w.activeElement?.isConnected) w.activeElement = w.body; };
  w.activeElement = w.body;
  globalThis.document = w;
  return w;
}
const btn = (w, parent, label) => parent.add(w.make('button', { 'aria-label': label }, label));

test('(a) a redraw at 300 ms: focus lands on the new button with the same name', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const box = w.app.add(w.make('div'));
  const old = btn(w, box, 'Save note'); old.focus();
  ui.keepFocus(old, { refocusOld: false });
  t.mock.timers.tick(0);
  t.mock.timers.tick(300);
  const fresh = w.make('button', { 'aria-label': 'Save note' }, 'Save note');
  w.replace(old, fresh);
  t.mock.timers.tick(1700);
  assert.equal(w.activeElement, fresh);
});

test('(b) a late redraw at 900 ms is still caught', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const box = w.app.add(w.make('div'));
  const old = btn(w, box, 'Void refund'); old.focus();
  ui.keepFocus(old, { refocusOld: false });
  t.mock.timers.tick(900);
  const fresh = w.make('button', { 'aria-label': 'Void refund' }, 'Void refund');
  w.replace(old, fresh);
  t.mock.timers.tick(1100);
  assert.equal(w.activeElement, fresh);
});

test('(c) a toggle that renamed itself: focus lands on the button at the same place', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const row = w.app.add(w.make('div'));
  btn(w, row, 'Edit');
  const old = btn(w, row, 'Mark dirty'); old.focus();
  ui.keepFocus(old, { refocusOld: false });
  t.mock.timers.tick(200);
  const fresh = w.make('button', { 'aria-label': 'Mark clean' }, 'Mark clean');
  w.replace(old, fresh);
  t.mock.timers.tick(1800);
  assert.equal(w.activeElement, fresh);
});

test('(d) the row is gone: focus lands on the page heading, made focusable', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const list = w.app.add(w.make('ul'));
  const rows = ['Archive A', 'Archive B', 'Archive C'].map((n) => { const li = list.add(w.make('li')); return btn(w, li, n); });
  rows[1].focus();
  ui.keepFocus(rows[1], { refocusOld: false });
  t.mock.timers.tick(100);
  w.remove(rows[1].parentElement);
  t.mock.timers.tick(1900);
  assert.equal(w.activeElement, w.h1);
  assert.equal(w.h1.getAttribute('tabindex'), '-1');
});

test('(e) never steals focus the person moved elsewhere', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const box = w.app.add(w.make('div'));
  const old = btn(w, box, 'Save'); old.focus();
  const input = box.add(w.make('input'));
  ui.keepFocus(old, { refocusOld: false });
  t.mock.timers.tick(200);
  input.focus();
  t.mock.timers.tick(700);
  w.replace(old, w.make('button', { 'aria-label': 'Save' }, 'Save'));
  t.mock.timers.tick(1100);
  assert.equal(w.activeElement, input);
});

test('(f) a button disabled while saving gets focus back when it is enabled again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const box = w.app.add(w.make('div'));
  const old = btn(w, box, 'Save'); old.focus();
  ui.keepFocus(old);
  old.disabled = true; w.activeElement = w.body;
  t.mock.timers.tick(400);
  old.disabled = false;
  t.mock.timers.tick(1600);
  assert.equal(w.activeElement, old);
});

test('(g) the click listener also watches buttons inside dialogs, and stops when the dialog is gone', () => {
  const listener = uiSrc.slice(uiSrc.indexOf("document.addEventListener('click'"), uiSrc.indexOf('// ---------------------------------------------------------------- modal'));
  assert.match(listener, /closest\('\[role="tablist"\]'\)/);
  assert.doesNotMatch(listener, /tablist"\], dialog/);
  assert.match(listener, /closest\('dialog'\)/);
  assert.match(listener, /keepFocus\(btn/);
  assert.doesNotMatch(uiSrc, /settleFocus/);
});

const fnSrc = (src, name) => {
  const start = src.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let k = src.indexOf('{', src.indexOf(')', start)); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(start, k + 1).replace(/^export /, '');
  }
  throw new Error('no closing brace');
};

test('(h) restoreTabFocus keeps polling until the new tablist and its tab exist', () => {
  const restore = new Function(`${fnSrc(appSrc, 'restoreTabFocus')}; return restoreTabFocus;`)();
  const doc = { body: { isConnected: true }, lists: [] };
  doc.activeElement = doc.body;
  doc.querySelectorAll = () => doc.lists;
  const mk = (label, n) => { const l = { isConnected: true, getAttribute: (k) => (k === 'aria-label' ? label : null) }; l.tabs = Array.from({ length: n }, () => ({ isConnected: true, focus() { doc.activeElement = this; } })); l.querySelectorAll = () => l.tabs; return l; };
  const old = mk('Status', 3); old.isConnected = false;
  assert.equal(restore(old, 1, old.tabs[1], doc, 0), false, 'no new list yet');
  const fresh = mk('Status', 0);
  doc.lists = [fresh];
  assert.equal(restore(old, 1, old.tabs[1], doc, 0), false, 'the tab is not drawn yet');
  fresh.tabs = mk('Status', 3).tabs.map((x) => ({ ...x, focus() { doc.activeElement = this; } }));
  assert.equal(restore(old, 1, old.tabs[1], doc, 0), true);
  assert.equal(doc.activeElement, fresh.tabs[1]);
  assert.match(appSrc, /for \(const ms of FOCUS_CHECKS\) setTimeout/); // r11: same schedule as keepFocus, to 10 s
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
