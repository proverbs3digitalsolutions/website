'use strict';

// QA r22 ROUTER (CARD-1, GST-3, LT-1): the router focuses the page heading on the first draw and after a redirect. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const line = app.split('\n').find((l) => l.startsWith('export const headingFocusDue'));
const headingFocusDue = new Function(`${line.replace('export const', 'const')}; return headingFocusDue;`)();

test('headingFocusDue truth table', () => {
  const base = { drawnPath: '/home', path: '/home', prevKept: true, redirected: false };
  assert.equal(headingFocusDue({ ...base, drawnPath: null }), true, 'first draw after load');
  assert.equal(headingFocusDue(base), false, 'same-page redraw stays with the focus guard');
  assert.equal(headingFocusDue({ ...base, redirected: true }), true, 'redirect onto the page already open');
  assert.equal(headingFocusDue({ ...base, path: '/payments' }), true, 'new page');
  assert.equal(headingFocusDue({ ...base, prevKept: false }), true, 'drawn under a skeleton');
});

test('every navigate() inside render() sets viaRedirect first; both draw ends use the helper', () => {
  const body = app.slice(app.indexOf('export async function render()'), app.indexOf("document.querySelectorAll('dialog.modal, .morenav"));
  const calls = body.match(/navigate\(/g) || [];
  assert.equal(calls.length, 6);
  assert.equal((body.match(/viaRedirect = true; navigate\(/g) || []).length, calls.length);
  assert.match(body, /const redirected = viaRedirect;[^\n]*\n\s*viaRedirect = false;/);
  assert.equal((app.match(/headingFocusDue\(\{/g) || []).length, 2);
});

test('the More sheet keeps its round 21 close-focus behaviour', () => {
  assert.match(app, /if \(picked\) focusPageHeading\(document\.getElementById\('app'\)\)/);
});
