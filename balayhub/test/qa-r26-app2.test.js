'use strict';

// QA r26 APP2 (PHN-2): a page rewriting its own address keeps lastHash in step, so Back onto that address redraws a stale dialog;
// the tab-stop observer only runs for batches that touch tabs. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(process.env.APP_SRC || path.join(__dirname, '../public/js/app.js'), 'utf8');
const grab = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

test('PHN-2: replaceState wrapper moves lastHash with the address it rewrote', () => {
  const src = grab('history.replaceState = (st, title, url) =>', '\n};') + '\n};';
  assert.ok(src.includes('lastHash'), 'wrapper updates lastHash');
  const run = (last) => {
    const loc = { hash: '#/reservations?new=1' };
    const st = { lastHash: last };
    const fn = new Function('location', 'replaceState', 'entryKey', 'st', `let lastHash = st.lastHash; const history = {}; let routerWrite = false; const staleAddress = () => false; const match = () => null; ${src}; history.replaceState(null, '', 'x'); st.lastHash = lastHash;`);
    fn(loc, () => { loc.hash = '#/reservations?view=upcoming'; }, () => null, st);
    return st.lastHash;
  };
  assert.equal(run('#/reservations?new=1'), '#/reservations?view=upcoming', 'in step with the rewrite');
  assert.equal(run('#/other'), '#/other', 'a stale unrelated lastHash is left alone');
});

test('observer: only batches that touch tab lists run rovingTabs', () => {
  const src = grab('export function touchesTabs', 'export function rovingTabs');
  assert.ok(src, 'touchesTabs exists');
  const touchesTabs = new Function(`${src.replace('export function', 'function')}; return touchesTabs;`)();
  const el = (matches, inner) => ({ nodeType: 1, matches: () => matches, querySelector: () => inner });
  assert.equal(touchesTabs([{ type: 'attributes', target: {}, addedNodes: [], removedNodes: [] }]), true, 'aria-selected write');
  assert.equal(touchesTabs([{ type: 'childList', target: { closest: () => null }, addedNodes: [el(false, null)], removedNodes: [] }]), false, 'plain node');
  assert.equal(touchesTabs([{ type: 'childList', target: { closest: () => null }, addedNodes: [el(false, {})], removedNodes: [] }]), true, 'subtree holds a tab list');
  assert.equal(touchesTabs([{ type: 'childList', target: { closest: () => ({}) }, addedNodes: [], removedNodes: [] }]), true, 'change inside a tab list');
  assert.match(app, /new MutationObserver\(\(records\) => \{ if \(touchesTabs\(records\)\) rovingTabs\(document\.body\); \}\)/);
});
