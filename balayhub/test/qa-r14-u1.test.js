'use strict';

// QA r14 U1: the focus guard answers at once (no 800 ms on the page body), group position matches tabs and radios only, the shared scroll
// keeper (keptScroll, pure) and inFlight() in api.js, the top bar bits in ui.js, and the scans that keep views off the scroll and keyed.
// Frontend-only: no database. U1_JS_DIR points the test at another copy of public/js (to see it fail on the old code).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { world, btn } = require('./focus-world');

const JS = process.env.U1_JS_DIR || path.join(__dirname, '../public/js');
const VIEWS = path.join(__dirname, '../public/js');
const uiSrc = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
let ui; let api;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r14u1-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
});

const c = (o) => ({ key: null, tag: 'button', role: 'button', name: '', group: null, path: '#/x', ...o });
const guard = (w) => ui.installFocusGuard(w, { observe: false });

// ------------------------------------------------------------------ focus guard
test('(a) a focused button is removed and nothing matches: the h1 has focus in the same check() call, without scrolling', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const g = guard(w);
  const old = btn(w, w.main, 'Archive'); old.focus(); g.note(old);
  w.remove(old);
  g.check(0);
  assert.equal(w.activeElement, w.h1);
  assert.equal(w.h1.getAttribute('tabindex'), '-1');
  assert.deepEqual(w.focusCalls.at(-1).opts, { preventScroll: true });
  assert.equal(ui.HEADING_AFTER_MS, 0);
});

test('(a2) a match that appears 3 s later takes focus from the heading', () => {
  const w = world();
  const g = guard(w);
  const old = btn(w, w.main, 'Archive'); old.focus(); g.note(old);
  w.remove(old);
  g.check(0);
  assert.equal(w.activeElement, w.h1);
  const fresh = btn(w, w.main, 'Archive');
  g.check(3000);
  assert.equal(w.activeElement, fresh);
});

test('(b) a Remove button in a labelled group is not matched by its place (another row\'s Remove)', () => {
  const snap = c({ name: 'Remove Rio 2210 from the group', group: 'Rooms' });
  const now = [c({ name: 'Remove Tower 3 from the group', group: 'Rooms' }), c({ name: 'Remove Tower 4 from the group', group: 'Rooms' })];
  assert.equal(ui.pickFocusMatch(snap, now, 0, 1), -1);
});

test('(b2) tabs whose counts changed are still found by their place; so are radios', () => {
  const tab = c({ role: 'tab', name: 'Paid (3)', group: 'Status' });
  assert.equal(ui.pickFocusMatch(tab, [c({ role: 'tab', name: 'Open (1)', group: 'Status' }), c({ role: 'tab', name: 'Paid (4)', group: 'Status' })], 0, 1), 1);
  const radio = c({ tag: 'input', role: 'radio', name: 'Weekly (2)', group: 'Repeat' });
  assert.equal(ui.pickFocusMatch(radio, [c({ tag: 'input', role: 'radio', name: 'Daily', group: 'Repeat' }), c({ tag: 'input', role: 'radio', name: 'Weekly (3)', group: 'Repeat' })], 0, 1), 1);
});

test('(c) a data-focus-key finds the control after its label changed (automation Turn on to Turn off)', () => {
  const snap = c({ key: 'auto-toggle-x', name: 'Turn on Check-in reminder' });
  assert.equal(ui.pickFocusMatch(snap, [c({ name: 'Edit' }), c({ key: 'auto-toggle-x', name: 'Turn off Check-in reminder' })]), 1);
});

test('(d) the guard ignores the top bar search sheet like the More sheet', () => {
  const w = world();
  const g = guard(w);
  const sheet = w.body.add(w.make('dialog')); sheet.classSet.add('tb-sheet');
  g.note(btn(w, sheet, 'Close'));
  assert.equal(g.state().rec, null);
  assert.match(uiSrc, /classList\?\.contains\('tb-sheet'\)/);
  assert.match(uiSrc, /closest\('\.morenav, \.assist, \.tb-sheet'\)/);
  assert.doesNotMatch(uiSrc, /tb-pop/);
});

test('(e) Tab out of a field whose blur hides a sibling: focus is not pulled back (top bar search trap)', () => {
  const w = world();
  const g = guard(w);
  const input = w.main.add(w.make('input', { type: 'text', 'aria-label': 'Search BalayHub' })); input.focus(); g.note(input);
  const list = w.main.add(w.make('div', { id: 'tb-results' }));
  g.moved(0); // keydown Tab
  w.activeElement = w.body; // mid-move: blur has happened, the next control has not got focus yet
  list.hidden = true;
  g.check(10);
  assert.equal(w.activeElement, w.body);
  const next = btn(w, w.main, 'Next'); next.focus();
  g.check(20);
  assert.equal(w.activeElement, next);
});

test('(e2) Tab that really ends on the page: the control is forgotten, not restored, and a later redraw is not undone', () => {
  const w = world();
  const g = guard(w);
  const input = w.main.add(w.make('input', { type: 'text' })); input.focus(); g.note(input);
  g.moved(0); w.activeElement = w.body;
  g.check(10); g.check(500);
  assert.equal(w.activeElement, w.body);
  assert.equal(g.state().rec, null);
});

test('(e3) without a Tab the guard still restores at once', () => {
  const w = world();
  const g = guard(w);
  const old = btn(w, w.main, 'Save'); old.focus(); g.note(old);
  w.remove(old);
  const fresh = btn(w, w.main, 'Save');
  g.check(0);
  assert.equal(w.activeElement, fresh);
});

// ------------------------------------------------------------------ keptScroll (pure)
const K = (o) => ui.keptScroll({ y: 600, nowY: 0, maxY: 2000, sinceChange: 20, sinceAction: 300, sameRoute: true, ...o });

test('keptScroll: a drift right after a page change goes back to where the person was', () => {
  assert.equal(K({}), 600);
});

test('keptScroll: a scroll long after the last change is the person\'s own', () => {
  assert.equal(K({ sinceChange: 400 }), null);
  assert.equal(ui.SCROLL_SETTLE_MS, 150);
  assert.equal(ui.SCROLL_QUIET_MS, 700);
});

test('keptScroll: another route, or too long after the action, gives null', () => {
  assert.equal(K({ sameRoute: false }), null);
  assert.equal(K({ sinceAction: ui.FOCUS_WATCH_MS + 1 }), null);
});

test('keptScroll: a page now shorter than the old position goes to its bottom; within 2 px is left alone', () => {
  assert.equal(K({ maxY: 450 }), 450);
  assert.equal(K({ nowY: 599 }), null);
  assert.equal(K({ nowY: 598 }), null);
  assert.equal(K({ nowY: 597 }), 600);
});

test('keptScroll: never scrolls the focused control out of view', () => {
  // going from 0 to 600 moves an element at top 100 to -500: off the screen
  assert.equal(K({ focusTop: 100, focusBottom: 140, viewH: 800 }), null);
  // an element far below is pushed under the bottom edge when the page goes back up
  assert.equal(K({ nowY: 900, y: 100, focusTop: 700, focusBottom: 740, viewH: 800 }), null);
  // an element that stays in view is fine
  assert.equal(K({ focusTop: 700, focusBottom: 740, viewH: 800 }), 600);
});

test('shouldRelease: a timer may not let go when the clamp would move the page; the person or a route change always may', () => {
  // scrolled to 120, the result is 972 px tall in a 900 px window: max scroll 72 < 120
  assert.equal(ui.shouldRelease(120, 972, 900, 'quiet'), false);
  assert.equal(ui.shouldRelease(120, 3146, 900, 'quiet'), true);
  assert.equal(ui.shouldRelease(0, 100, 900, 'quiet'), true);
  assert.equal(ui.shouldRelease(120, 972, 900, 'person'), true);
  assert.equal(ui.shouldRelease(120, 972, 900, 'route'), true);
});

// ------------------------------------------------------------------ inFlight (api.js)
test('inFlight() rises during a fetch and returns to 0 after it settles, also on a failure', async () => {
  const realFetch = globalThis.fetch;
  let release; const gate = new Promise((r) => { release = r; });
  globalThis.fetch = async () => { await gate; return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({}) }; };
  try {
    assert.equal(api.inFlight(), 0);
    const p = api.get('/x');
    assert.equal(api.inFlight(), 1);
    release(); await p;
    assert.equal(api.inFlight(), 0);
    globalThis.fetch = async () => { throw new Error('down'); };
    await assert.rejects(api.get('/x'), (e) => e.offline === true);
    assert.equal(api.inFlight(), 0);
    globalThis.fetch = async () => ({ ok: false, status: 500, headers: { get: () => 'text/plain' } });
    await assert.rejects(api.get('/x'));
    assert.equal(api.inFlight(), 0);
  } finally { globalThis.fetch = realFetch; }
});

// ------------------------------------------------------------------ top bar bits
test('ICONS has the five top bar icons', () => {
  for (const n of ['search', 'bookmark', 'bell', 'star', 'close']) assert.match(uiSrc, new RegExp(`\\n  ${n}: '`), n);
});

test('the scroll keeper is installed with the guard and uses inFlight', () => {
  assert.match(uiSrc, /import \{[^}]*\binFlight\b[^}]*\} from '\.\/api\.js'/);
  assert.match(uiSrc, /const keeper = installScrollKeeper\(doc\)/);
  assert.doesNotMatch(uiSrc, /setAttribute\('style'/);
});

// ------------------------------------------------------------------ scans
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('no file under public/js except ui.js and app.js reads or writes the window scroll', () => {
  const bad = [];
  for (const f of files(VIEWS)) {
    const r = path.relative(VIEWS, f).split(path.sep).join('/');
    if (r === 'ui.js' || r === 'app.js') continue;
    if (/window\.scrollTo\(|scrollY|pageYOffset/.test(strip(fs.readFileSync(f, 'utf8')))) bad.push(r);
  }
  assert.deepEqual(bad, []);
});

// file, exact attribute text, at least how many (red until I1, OP1 and OB1 land)
const KEYS = [
  ['views/inbox.js', "'data-focus-key': `auto-toggle-${", 1],
  ['views/maintenance.js', "'data-focus-key': `mt-pause-${", 1],
  ['views/launchpad.js', "'data-focus-key': `lp-step-${", 2],
];
test('the controls whose label changes carry their data-focus-key', () => {
  const missing = [];
  for (const [file, attr, atLeast] of KEYS) {
    const n = fs.readFileSync(path.join(VIEWS, file), 'utf8').split(attr).length - 1;
    if (n < atLeast) missing.push(`${file}: ${attr} x${n}, need ${atLeast}`);
  }
  assert.deepEqual(missing, []);
});
