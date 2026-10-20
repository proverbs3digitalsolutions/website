'use strict';

// QA r23 SHELL (BKG-1, MNY-3, N-2, OPS-1, MNY-4): an address change on the same page refocuses the heading; the More sheet's Log out
// has its own divider; the phone stats stack. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
const line = app.split('\n').find((l) => l.startsWith('export const headingFocusDue'));
const headingFocusDue = new Function(`${line.replace('export const', 'const')}; return headingFocusDue;`)();

test('headingFocusDue truth table with addressChange', () => {
  const base = { drawnPath: '/home', path: '/home', prevKept: true, redirected: false, addressChange: false };
  assert.equal(headingFocusDue(base), false, 'same-page redraw stays with the focus guard');
  assert.equal(headingFocusDue({ ...base, addressChange: true }), true, 'same path, address changed while focus was free');
  assert.equal(headingFocusDue({ ...base, drawnPath: null }), true);
  assert.equal(headingFocusDue({ ...base, redirected: true }), true);
  assert.equal(headingFocusDue({ ...base, path: '/payments' }), true);
  assert.equal(headingFocusDue({ ...base, prevKept: false }), true);
});

test('the hashchange listener records whether focus was free; focusPageHeading uses the same test', () => {
  assert.match(app, /const focusFree = /);
  assert.match(app, /window\.addEventListener\('hashchange', \(\) => \{ viaAddress = focusFree\(\); render\(\); \}\);/);
  assert.match(app, /const addressChange = viaAddress;[^\n]*\n\s*viaAddress = false;/);
  const fn = app.slice(app.indexOf('function focusPageHeading'), app.indexOf('let viaRedirect'));
  assert.match(fn, /if \(!focusFree\(\)\) return;/);
  assert.equal((app.match(/headingFocusDue\(\{[^}]*addressChange \}\)/g) || []).length, 2);
});

test('More sheet: Log out has its own class with a divider; stats stack on phones', () => {
  assert.match(app, /class: 'morenav__logout'/);
  assert.match(css, /\.morenav__sheet \.morenav__logout \{[^}]*margin-top: 16px;[^}]*border-top: 1px solid var\(--line\)/);
  assert.match(css, /@media \(max-width: 559px\) \{ \.stats--stack-phone \{ grid-template-columns: 1fr; \} \}/);
});
