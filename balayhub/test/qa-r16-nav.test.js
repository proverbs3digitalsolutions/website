'use strict';

// QA r16 NAV (#35, #13): the other module's home redirects quietly; Back keeps a list's place. Frontend-only: no database.
// app.js imports every view, so the pure helpers are run from the text between its nav-helpers markers, and the rest is scanned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const privacy = fs.readFileSync(path.join(__dirname, '../public/js/views/privacy.js'), 'utf8');
const block = app.slice(app.indexOf('// nav-helpers:start'), app.indexOf('// nav-helpers:end'));
const { otherHome, backTarget, restoreY, shouldRestore } = new Function(`${block.replace(/export const/g, 'const')}; return { otherHome, backTarget, restoreY, shouldRestore };`)();

test('otherHome: only the other module\'s home is quiet', () => {
  const st = { business_type: 'short_term', role: 'owner' };
  const lt = { business_type: 'long_term', role: 'owner' };
  assert.equal(otherHome('/dashboard', st), true);
  assert.equal(otherHome('/home', lt), true);
  assert.equal(otherHome('/home', st), false);
  assert.equal(otherHome('/dashboard', lt), false);
  assert.equal(otherHome('/owners', { business_type: 'short_term', role: 'staff' }), false);
  assert.equal(otherHome('/owners', lt), false);
  assert.equal(otherHome('/dashboard', null), false);
});

test('backTarget: a ‹ link goes back only to the page you came from, on this entry', () => {
  const from = { fromHash: '#/reservations?status=confirmed', toKey: 'k2' };
  assert.equal(backTarget('#/reservations', from, 'k2'), true);
  assert.equal(backTarget('#/payments', from, 'k2'), false);
  assert.equal(backTarget('#/reservations', from, 'k3'), false);
  assert.equal(backTarget('#/reservations', { fromHash: '#/home', toKey: 'k2' }, 'k2'), false);
  assert.equal(backTarget('#/reservations', null, 'k2'), false);
});

test('restoreY clamps to the page height', () => {
  assert.equal(restoreY(900, 400), 400);
  assert.equal(restoreY(120, 400), 120);
  assert.equal(restoreY(50, -20), 0);
});

test('router: the refusal toast is guarded by otherHome; one scrollTo(0, 0) stays before the view', () => {
  assert.match(app, /if \(!otherHome\(path, state\.user\)\) toast\("That page isn't available for your role or workspace\.", 'error'\)/);
  assert.match(app, /navigate\(homeRoute\(\), \{ replace: true \}\); return; \}\n\n  document\.querySelectorAll/);
  assert.equal(app.split('scrollTo(0, 0)').length - 1, 1);
  assert.ok(app.indexOf('scrollTo(0, 0)') < app.indexOf('await route.view'));
});

test('router: scroll memory lives in app.js only', () => {
  assert.match(app, /history\.scrollRestoration = 'manual'/);
  assert.match(app, /history\.replaceState = \(st, title, url\) => replaceState\(st \?\? /);
  assert.match(app, /window\.addEventListener\('scroll'[\s\S]*?\{ passive: true \}/);
  assert.match(app, /addEventListener\('click'[\s\S]*?closest\('a\.back'\)[\s\S]*?history\.back\(\)[\s\S]*?, true\);/);
  assert.match(app, /if \(restoreTo !== null\) restoreScroll\(restoreTo\)/);
  // the activity listeners are armed before the view is awaited, so a scroll while rows load is noticed
  assert.ok(app.indexOf('if (restoreTo !== null) armRestore()') > 0 && app.indexOf('if (restoreTo !== null) armRestore()') < app.indexOf('await route.view'));
  assert.match(app, /function armRestore\(\)[\s\S]*?restoreActed = false;[\s\S]*?'wheel', 'touchstart', 'keydown', 'pointerdown'/);
  assert.match(app, /shouldRestore\(savedY[^;]*restoreActed\)/);
  assert.match(app, /window\.scrollTo\(0, restoreY\(savedY,/);
  assert.match(app, /const seq = \+\+renderSeq;\n  stopRestore\(\);/); // a new render cancels a pending restore
  // the restore comes after the new page is on screen
  assert.ok(app.indexOf('restoreScroll(restoreTo)') > app.indexOf('shell.content.replaceWith(mount)'));
  assert.match(app, /replaceState\(\{ bhEntry: newKey\(\) \}/); // a redirect gets a fresh key
});

test('privacy logo goes to the right home', () => {
  assert.match(privacy, /import \{ state, homeRoute \} from '\.\.\/app\.js'/);
  assert.match(privacy, /brand\(state\.user \? homeRoute\(\) : '#\/'\)/);
  assert.doesNotMatch(privacy, /'#\/dashboard'/);
});

test('shouldRestore: wait for the page to grow, scroll once, stop when the person acts', () => {
  assert.equal(shouldRestore(900, 700, 600, 0, false), 'wait'); // short page, rows still loading
  assert.equal(shouldRestore(900, 1600, 600, 100, false), 'scroll'); // tall enough
  assert.equal(shouldRestore(900, 700, 600, 1500, false), 'scroll'); // time is up: clamp
  assert.equal(shouldRestore(900, 1600, 600, 100, true), 'stop');
  assert.equal(shouldRestore(900, 700, 600, 2000, true), 'stop');
});
