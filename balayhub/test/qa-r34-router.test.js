'use strict';
require('./helpers');

// QA r34 ROUTER (INB-1 / C1, DLG-L / D-116): the router's heading focus honours data-page-heading, and a removed dialog on the same page
// leaves focus to the guard. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raw = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const app = raw.replace(/^\s*\/\/.*$/gm, '');

const start = app.indexOf('export const layerFocus');
const layerFocus = start < 0 ? null : new Function(`${app.slice(start, app.indexOf('};', start) + 2).replace('export const', 'const')}; return layerFocus;`)();
const fake = (matches) => ({ closest: () => (matches ? { matches: (s) => s === matches } : null) });

test('layerFocus: dialog on the same page -> guard; other cases -> heading; no layer -> null', () => {
  assert.ok(layerFocus, 'layerFocus exported');
  assert.equal(layerFocus(fake('dialog.modal'), true), 'guard');
  assert.equal(layerFocus(fake('dialog.modal'), false), 'heading');
  assert.equal(layerFocus(fake('.morenav'), true), 'heading');
  assert.equal(layerFocus(fake('.tb-sheet'), true), 'heading');
  assert.equal(layerFocus(fake('.tb-sheet'), false), 'heading');
  assert.equal(layerFocus(null, true), null);
  assert.equal(layerFocus(fake(null), false), null);
});

test('focusPageHeading takes [data-page-heading] first, then the h1', () => {
  const body = app.slice(app.indexOf('function focusPageHeading'), app.indexOf('let viaAddress'));
  assert.match(body, /root\.querySelector\('\[data-page-heading\]'\) \|\| root\.querySelector\('h1'\)/);
});

test('render computes layerHadFocus via layerFocus before the sweep; both draws use the two-branch form', () => {
  assert.match(app, /const layerHadFocus = layerFocus\(document\.activeElement, path === drawnPath\);\s*\n\s*document\.querySelectorAll\('dialog\.modal, \.morenav, \.tb-sheet'\)\.forEach/);
  assert.equal((app.match(/if \(layerHadFocus === 'heading'\) focusPageHeading\(mount\);/g) || []).length, 2);
  assert.equal((app.match(/else if \(layerHadFocus === 'guard'\) setTimeout\(\(\) => \{ if \(seq === renderSeq\) focusPageHeading\(mount\); \}\);/g) || []).length, 2);
  assert.doesNotMatch(app, /if \(layerHadFocus\) focusPageHeading/);
});
