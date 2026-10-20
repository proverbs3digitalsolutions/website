'use strict';

// QA r28 APP: only the page on screen writes the address (PHN-2), Back keeps its place on guest pages (GST-1) and on an entry nobody
// scrolled (BKG-1), a table box is a Tab stop only while it scrolls sideways (PHN-3). Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const grab = (from, to) => { const i = app.indexOf(from); assert.ok(i >= 0, `${from} exists`); return app.slice(i, app.indexOf(to, i)); };
const helpers = () => {
  const block = app.slice(app.indexOf('// nav-helpers:start'), app.indexOf('// nav-helpers:end')).replace(/export /g, '');
  return new Function(`${block}; return { staleAddress: typeof staleAddress === 'function' ? staleAddress : undefined };`)();
};

test('n: staleAddress truth table', () => {
  const { staleAddress } = helpers();
  assert.equal(typeof staleAddress, 'function', 'staleAddress is in nav-helpers');
  const viewOf = (p) => (p.startsWith('/inbox') ? 'inbox' : p.startsWith('/calendar') ? 'calendar' : null);
  assert.equal(staleAddress('#/calendar?start=x', '#/inbox', viewOf), true, 'a late calendar write over the inbox');
  assert.equal(staleAddress('#/inbox/abc?view=open', '#/inbox', viewOf), false, 'one view');
  assert.equal(staleAddress('#/calendar?start=x', '#/calendar?start=y', viewOf), false, 'same page');
  assert.equal(staleAddress('/app/index.html#/calendar', '#/inbox', viewOf), true, 'a full url counts by its hash');
  assert.equal(staleAddress('/plain', '#/inbox', viewOf), false, 'no hash');
  assert.equal(staleAddress(undefined, '#/inbox', viewOf), false);
  assert.equal(staleAddress(null, '#/inbox', viewOf), false);
  assert.equal(staleAddress('#/nowhere', '#/inbox', viewOf), false, 'unknown target');
  assert.equal(staleAddress('#/calendar', '#/nowhere', viewOf), false, 'unknown page on screen');
});

test('n: the replaceState wrapper checks staleAddress first; navigate marks its own replace', () => {
  const wrap = grab('history.replaceState = (st, title, url) => {', '\n};');
  assert.ok(wrap.indexOf('staleAddress(') > 0 && wrap.indexOf('staleAddress(') < wrap.indexOf('replaceState(st'), 'check before the write');
  assert.match(wrap, /!routerWrite/);
  const nav = grab('export function navigate(', '\n}\n');
  assert.match(nav, /routerWrite = true;\s*try \{ history\.replaceState\(\{ bhEntry: newKey\(\) \}, '', hash\); \} finally \{ routerWrite = false; \}/);
});

test('k2: the scroll listener and both branches of render() remember the place of an entry', () => {
  assert.match(app, /function rememberPlace\(k\) \{\s*positions\.delete\(k\);\s*positions\.set\(k, window\.scrollY\);/);
  const scroll = grab("window.addEventListener('scroll'", '\n}, { passive');
  assert.match(scroll, /rememberPlace\(k\)/);
  const signed = grab('if (route.access === APP) {\n    // The screen someone was on', '  } else {\n    lastDrawing = null;');
  assert.match(signed, /if \(restoreTo !== null\) restoreScroll\(restoreTo\);\s*else rememberPlace\(entry\);/);
  const pub = app.slice(app.indexOf('  } else {\n    lastDrawing = null;'));
  assert.match(pub, /rememberPlace\(entry\)/);
});

test('k1: the public branch stamps bhEntry, sets lastForward, arms and restores, and attaches the mount after the view when restoring', () => {
  const pub = app.slice(app.indexOf('  } else {\n    lastDrawing = null;'), app.indexOf('// Keyboard users can only scroll a table box'));
  assert.match(pub, /bhEntry: entry/);
  assert.match(pub, /lastForward = \{ fromHash: lastHash, toKey: entry \}/);
  assert.match(pub, /armRestore\(\)/);
  assert.match(pub, /if \(restoreTo === null\) app\.replaceChildren\(mount\)/);
  assert.match(pub, /if \(!mount\.isConnected\) app\.replaceChildren\(mount\)/);
  assert.match(pub, /restoreScroll\(restoreTo\)/);
  assert.ok(pub.indexOf('document.title = RESET_TITLE') < pub.indexOf('await route.view'), 'title reset before the view, as before');
  assert.ok(pub.indexOf('await route.view') < pub.indexOf('if (!mount.isConnected)'), 'attached after the view');
});

test('k2: end to end, an entry nobody scrolled keeps the scroll on screen when it was drawn', () => {
  const pos = new Map();
  const rememberPlace = new Function('positions', 'window', 'SCROLL_KEEP', `${grab('function rememberPlace', '\n}\n')}\n}\nreturn rememberPlace;`)(pos, { scrollY: 2300 }, 50);
  pos.set('K1', 1900);
  rememberPlace('K2'); // drawn on a page kept at 2,300, no scroll event
  assert.equal(pos.get('K2'), 2300);
  assert.equal(pos.has('K1'), true);
});

test('m2: a table box is a Tab stop only while it scrolls sideways', () => {
  assert.doesNotMatch(grab('function labelTableWraps', '\n}\n'), /tabindex/);
  const body = grab('function updateScrollCue(box) {', '\n}\n');
  const fn = new Function('document', `${body}\n}\nreturn updateScrollCue;`);
  const mk = (sw, cw, focused) => {
    const attrs = new Map();
    const box = {
      scrollLeft: 0, scrollWidth: sw, clientWidth: cw,
      classList: { toggle() {}, contains: (c) => c === 'table-wrap' },
      setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), attrs,
    };
    const upd = fn({ activeElement: focused ? box : null });
    upd(box);
    return box;
  };
  assert.equal(mk(500, 300).attrs.get('tabindex'), '0');
  assert.equal(mk(300, 300).attrs.has('tabindex'), false);
  const f = (() => { const attrs = new Map([['tabindex', '0']]); const box = { scrollLeft: 0, scrollWidth: 300, clientWidth: 300, classList: { toggle() {}, contains: () => true }, setAttribute() {}, removeAttribute: (k) => attrs.delete(k), attrs }; fn({ activeElement: box })(box); return box; })();
  assert.equal(f.attrs.get('tabindex'), '0', 'a focused box keeps it');
});
