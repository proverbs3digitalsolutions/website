'use strict';

// QA r14 F2: top bar search UI (D-90). Frontend-only: no database. Pure helpers plus source scans.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'topsearch.js'), 'utf8');
let ts; let routeAllowed;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r14f2-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'topsearch.js', 'routeaccess.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ts = await import(pathToFileURL(path.join(dir, 'topsearch.js')));
  ({ routeAllowed } = await import(pathToFileURL(path.join(dir, 'routeaccess.js'))));
});

const NAV = [['/home', 'Home', 'home'], ['/reservations', 'Reservations', 'bed'], ['/guests', 'Guests', 'users'], ['/pricing', 'Pricing', 'file'], ['/settings', 'Settings', 'settings'], ['/help', 'Help & support', 'help']];
const owner = { role: 'owner', business_type: 'short_term' };
const titles = (r) => r.map((x) => x.title);

test('pageResults: "res" starts with Reservations', () => {
  const r = ts.pageResults('res', owner, NAV, routeAllowed);
  assert.equal(r[0].title, 'Reservations');
  assert.equal(r[0].href, '#/reservations');
  assert.ok(r.length <= 5);
});

test('pageResults: "team" finds Team and permissions for an owner, nothing for a manager', () => {
  assert.ok(titles(ts.pageResults('team', owner, NAV, routeAllowed)).includes('Team and permissions'));
  assert.deepEqual(ts.pageResults('team', { role: 'manager', business_type: 'short_term' }, NAV, routeAllowed), []);
});

test('pageResults: "pricing" gives nothing for a long_term owner', () => {
  assert.deepEqual(ts.pageResults('pricing', { role: 'owner', business_type: 'long_term' }, NAV.filter((n) => n[0] !== '/pricing'), routeAllowed), []);
  assert.ok(ts.pageResults('pricing', owner, NAV, routeAllowed).length > 0);
});

test('pageResults: a cleaner gets only their nav', () => {
  const nav = [['/housekeeping', 'Cleaning', 'sparkle'], ['/my-pay', 'My pay', 'wallet'], ['/help', 'Help & support', 'help']];
  const cl = { role: 'cleaner', business_type: 'short_term' };
  assert.deepEqual(titles(ts.pageResults('password', cl, nav, routeAllowed)), []);
  assert.deepEqual(titles(ts.pageResults('pay', cl, nav, routeAllowed)), ['My pay']);
});

test('pageResults: label prefix ranks before word prefix before keyword', () => {
  const nav = [['/a', 'Daily close', 'x'], ['/b', 'Close out', 'x']];
  assert.deepEqual(titles(ts.pageResults('clo', owner, nav, routeAllowed)), ['Close out', 'Daily close']);
  const k = ts.pageResults('theme', owner, [], routeAllowed);
  assert.equal(k[0].title, 'Light or dark mode');
});

test('moveActive wraps both ways and ignores other keys', () => {
  assert.equal(ts.moveActive(-1, 3, 'ArrowDown'), 0);
  assert.equal(ts.moveActive(2, 3, 'ArrowDown'), 0);
  assert.equal(ts.moveActive(0, 3, 'ArrowUp'), 2);
  assert.equal(ts.moveActive(-1, 3, 'ArrowUp'), 2);
  assert.equal(ts.moveActive(1, 3, 'ArrowUp'), 0);
  assert.equal(ts.moveActive(1, 3, 'a'), 1);
  assert.equal(ts.moveActive(-1, 0, 'ArrowDown'), -1);
});

test('pushRecent dedupes ignoring case, keeps 5, newest first', () => {
  let l = [];
  for (const q of ['a1', 'b2', 'c3', 'd4', 'e5', 'f6']) l = ts.pushRecent(l, q);
  assert.deepEqual(l, ['f6', 'e5', 'd4', 'c3', 'b2']);
  assert.deepEqual(ts.pushRecent(l, 'C3'), ['C3', 'f6', 'e5', 'd4', 'b2']);
  assert.deepEqual(ts.pushRecent(['x'], '  '), ['x']);
});

test('likeTerms: 1 character is not enough', () => {
  assert.equal(ts.likeTerms('a').ok, false);
  assert.equal(ts.likeTerms(' a ').ok, false);
  assert.deepEqual(ts.likeTerms(' an '), { q: 'an', ok: true });
});

test('emptyHint gives the three sentences', () => {
  assert.equal(ts.emptyHint({ role: 'owner', business_type: 'short_term' }), 'Try a guest name, a confirmation code or a listing name.');
  assert.equal(ts.emptyHint({ role: 'owner', business_type: 'both' }), 'Try a guest name, a confirmation code or a listing name.');
  assert.equal(ts.emptyHint({ role: 'owner', business_type: 'long_term' }), 'Try a tenant, a property or a repair.');
  assert.equal(ts.emptyHint({ role: 'cleaner', business_type: 'long_term' }), 'Try a page name or a help topic.');
});

test('source: combobox pattern, exact copy, cleaner never calls /search, no app.js import', () => {
  for (const s of ["role: 'combobox'", "'aria-autocomplete': 'list'", "'aria-controls': 'tb-results'", "'aria-activedescendant'", "role: 'listbox'", "role: 'option'", "role: 'status'", "'aria-live': 'polite'",
    'Type / to search', 'Search BalayHub', 'Search results', 'Recent searches', 'Type 2 or more letters to search records.', 'Searching…',
    "Search isn't working right now. Try again.", 'Too many searches in a minute. Wait a moment and try again.', "You're offline. Only pages can be searched.",
    'No results', 'Help articles', 'bh-recent-search-', '#/help?q=']) assert.ok(src.includes(s), s);
  assert.match(src, /role === 'cleaner'[\s\S]{0,400}\/help\/articles/);
  assert.ok(!/from '\.\/app\.js'/.test(src));
  assert.ok(!/scrollTo|scrollY|pageYOffset/.test(src));
  assert.ok(/startsWith\('#\/'\)/.test(src), 'href check');
  assert.ok(/get\(`\/search\?q=/.test(src));
});

test('source: group order is fixed', () => {
  const order = ['pages', 'reservations', 'guests', 'listings', 'properties', 'tenants', 'owners', 'quotes', 'maintenance', 'housekeeping', 'supplies', 'expenses', 'discount_codes', 'addons', 'help'];
  const m = src.match(/GROUP_ORDER = \[([^\]]*)\]/);
  assert.ok(m);
  assert.deepEqual([...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]), order);
});

test('source: the listbox holds only option groups; notes, errors, no-results and Clear sit beside it (axe aria-required-children)', () => {
  assert.match(src, /const list = h\('div', \{ id: 'tb-results', role: 'listbox'/);
  assert.match(src, /h\('div', \{ class: 'tb-results'[^)]*\}, list, extras\)/);
  for (const s of ['tb-note--error', 'Searching…', 'Type 2 or more letters']) {
    const line = src.split('\n').find((l) => l.includes(s) && /push\(/.test(l));
    assert.ok(line && line.includes('extra.push('), s);
  }
  // No-results is a disabled option inside the listbox (r15 #32), so the combobox never points at an empty list.
  assert.match(src, /empty = h\('div', \{ class: 'tb-empty', role: 'option', 'aria-disabled': 'true'/);
  assert.match(src, /list\.replaceChildren\(\.\.\.kids, \.\.\.\(empty/);
  assert.equal(src.match(/kids\.push\(/g).length, 1, 'only the option group goes into the listbox');
  assert.match(src, /list\.hidden = kids\.length === 0/);
});

test('source: Clear is a real tab stop outside the listbox and Tab to it keeps the list open', () => {
  assert.match(src, /extra\.push\(h\('button', \{ type: 'button', class: 'tb-clear'/);
  assert.ok(!/tabindex/i.test(src));
  assert.match(src, /addEventListener\('focusout'[\s\S]{0,120}contains\(e\.relatedTarget\)/);
});
