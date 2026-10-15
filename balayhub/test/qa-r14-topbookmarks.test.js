'use strict';

// Top bar bookmarks panel (F6, D-90): the pure helpers run in node from a temp copy; the panel's
// rules (verbatim copy, toggle updated in place, one scroll/focus mechanism) are source scans.
// Frontend-only: no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = fs.readFileSync(path.join(__dirname, '../public/js/topbookmarks.js'), 'utf8');
let m;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-topbm-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'routeaccess.js', 'topbookmarks.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  m = await import(pathToFileURL(path.join(dir, 'topbookmarks.js')));
});

test('bookmarkPath drops the one-time keys and keeps the rest', () => {
  assert.equal(m.bookmarkPath('#/reservations?new=1&view=upcoming'), '#/reservations?view=upcoming');
  assert.equal(m.bookmarkPath('#/settings?invite=1'), '#/settings');
  assert.equal(m.bookmarkPath('#/login?expired=1'), '#/login');
  assert.equal(m.bookmarkPath('#/settings?billing=1&billing_cancelled=1&assign=2&tab=team'), '#/settings?tab=team');
  assert.equal(m.bookmarkPath('#/rent?tab=expenses&new=expense'), '#/rent?tab=expenses');
  assert.equal(m.bookmarkPath('#/guests?q=ana%20cruz'), '#/guests?q=ana%20cruz');
  assert.equal(m.bookmarkPath('#/calendar'), '#/calendar');
});

test('bookmarkLabel uses the page title, else the nav label, cut to 80', () => {
  assert.equal(m.bookmarkLabel('Reservations — BalayHub', 'X'), 'Reservations');
  assert.equal(m.bookmarkLabel('', 'Calendar'), 'Calendar');
  assert.equal(m.bookmarkLabel('BalayHub', 'Calendar'), 'Calendar');
  assert.equal(m.bookmarkLabel(`${'a'.repeat(81)} — BalayHub`, 'X').length, 80);
  assert.equal(m.bookmarkLabel('a'.repeat(81), 'X'), 'a'.repeat(80));
  assert.equal(m.bookmarkLabel('', ''), '');
});

test('visibleBookmarks hides pages this role or workspace may not open (routeAllowed gets the path without its query)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-topbm2-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, '../public/js/routeaccess.js'), path.join(dir, 'routeaccess.js'));
  const { routeAllowed } = await import(pathToFileURL(path.join(dir, 'routeaccess.js')));
  const list = [{ path: '#/owners' }, { path: '#/dashboard' }, { path: '#/calendar?view=week' }];
  const seen = [];
  const spy = (p, u) => { seen.push(p); return routeAllowed(p, u); };
  assert.deepEqual(m.visibleBookmarks(list, { role: 'manager', business_type: 'both' }, spy).map((b) => b.path), ['#/dashboard', '#/calendar?view=week']);
  assert.deepEqual(seen, ['/owners', '/dashboard', '/calendar']);
  assert.deepEqual(m.visibleBookmarks(list, { role: 'owner', business_type: 'short_term' }, routeAllowed).map((b) => b.path), ['#/owners', '#/calendar?view=week']);
});

test('the toggle keeps one element and changes its text in place', () => {
  assert.match(SRC, /'data-focus-key': 'tb-bm-toggle'/);
  assert.match(SRC, /\.textContent\s*=/);
  assert.match(SRC, /aria-pressed/);
  assert.doesNotMatch(SRC, /replaceWith/);
});

test('copy from the plan is verbatim', () => {
  for (const s of ['Bookmarks', 'Bookmark this page', 'Remove this page from bookmarks', 'No bookmarks yet.',
    'Open a page you use often and press Bookmark this page.', "Couldn't load your bookmarks.", 'Try again',
    'Removed from bookmarks.', 'Bookmarked: ']) assert.ok(SRC.includes(s), s);
  assert.match(SRC, /Remove \$\{[^}]+\} from bookmarks/);
});

test('one focus and one scroll mechanism: no stray focus, scroll or window access', () => {
  assert.doesNotMatch(SRC, /scrollTo|scrollY|pageYOffset/);
  assert.doesNotMatch(SRC, /keepFocus|snapshotControl|setTimeout/);
  assert.doesNotMatch(SRC, /\balert\(|\bconfirm\(|\bprompt\(/);
  assert.doesNotMatch(SRC, /from '\.\/app\.js'|from '\.\/topbar\.js'/);
  assert.match(SRC, /\/account\/bookmarks/);
});

test('after a row is removed, focus goes to the row now at that position, else the previous, else the toggle', () => {
  assert.equal(m.focusIndexAfterRemove(0, 2), 0); // first of three removed: the next row slid up
  assert.equal(m.focusIndexAfterRemove(1, 2), 1);
  assert.equal(m.focusIndexAfterRemove(2, 2), 1); // last removed: the previous row
  assert.equal(m.focusIndexAfterRemove(0, 0), -1); // none left: the toggle
  // remove() must pick the row from the rebuilt list, not from elements detached by draw()
  assert.doesNotMatch(SRC, /nextElementSibling|previousElementSibling/);
  assert.match(SRC, /focusIndexAfterRemove\(at, rows\.length\)/);
});

test('the sub line is dropped when it repeats the label', () => {
  assert.equal(m.subLine('Reservations', 'Reservations'), null);
  assert.equal(m.subLine('reservations', 'Reservations'), null);
  assert.equal(m.subLine('Ana Cruz', 'Guests'), 'Guests');
  assert.equal(m.subLine('Calendar', null), null);
});
