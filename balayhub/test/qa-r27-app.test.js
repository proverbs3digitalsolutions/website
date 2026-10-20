'use strict';

// QA r27 APP (SCR-1, rule k): a link or address to the page already on screen wipes its history entry's key; the router gives it back,
// so the scroll is still remembered and Back still returns to the place. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(process.env.APP_SRC || path.join(__dirname, '../public/js/app.js'), 'utf8');
const grab = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
const keptKey = () => {
  const m = app.match(/export const keptKey = (.*);\n/);
  assert.ok(m, 'keptKey is exported in nav-helpers');
  return new Function(`return ${m[1]}`)();
};

test('k: keptKey gives the last key back only for a null state on the page last drawn', () => {
  const kk = keptKey();
  assert.equal(kk(null, '#/r?view=all', '#/r?view=all', 'K1'), 'K1', 'wiped entry, same hash');
  assert.equal(kk('K1', '#/r?view=all', '#/r?view=all', 'K1'), null, 'state key present');
  assert.equal(kk(null, '#/r/5', '#/r?view=all', 'K1'), null, 'different hash');
  assert.equal(kk(null, '#/r?view=all', '#/r?view=all', null), null, 'no last key');
});

test('k: keepEntryKey uses the bound replaceState and runs first in the scroll, a.back and popstate listeners', () => {
  assert.match(app, /function keepEntryKey\(\) \{[^}]*keptKey\(entryKey\(\), location\.hash, lastHash, lastKey\)[^}]*\n?[^}]*\breplaceState\(\{ bhEntry: k \}, ''\)/);
  assert.doesNotMatch(grab('function keepEntryKey', '\n}\n'), /history\.replaceState/);
  const scroll = grab("window.addEventListener('scroll'", '\n}, { passive');
  assert.ok(scroll.indexOf('keepEntryKey();') > 0 && scroll.indexOf('keepEntryKey();') < scroll.indexOf('entryKey()'), 'scroll listener');
  const back = grab("document.addEventListener('click', (e) => {\n  const a = e.target instanceof Element ? e.target.closest('a.back')", '}, true);');
  assert.ok(back.indexOf('keepEntryKey();') > 0 && back.indexOf('keepEntryKey();') < back.indexOf('backTarget('), 'a.back handler');
  const pop = grab("window.addEventListener('popstate'", '\n});');
  assert.ok(pop.indexOf('keepEntryKey();') > 0 && pop.indexOf('keepEntryKey();') < pop.indexOf('location.hash !== lastHash'), 'popstate listener');
});

test('k: end to end, a wiped entry gets its key back and the next scroll is recorded under it', () => {
  const kk = keptKey();
  const hist = { state: { bhEntry: 'K1' } };
  const loc = { hash: '#/reservations?view=all' };
  const positions = new Map();
  const lastHash = '#/reservations?view=all', lastKey = 'K1';
  const entryKey = () => hist.state?.bhEntry || null;
  const keep = () => { const k = kk(entryKey(), loc.hash, lastHash, lastKey); if (k) hist.state = { bhEntry: k }; };
  const onScroll = (y) => { keep(); const k = entryKey(); if (k) positions.set(k, y); };
  hist.state = null; // the browser replaced the entry on a same-address navigation
  onScroll(980);
  assert.equal(positions.get('K1'), 980);
});
