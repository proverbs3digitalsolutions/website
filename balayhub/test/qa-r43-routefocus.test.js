'use strict';
require('./helpers');

// QA r43 ROUTEFOCUS (BKG43-1 / contract C2, D-125): when a page swap removes the control the person pressed (a button or link inside
// the page), focus waits on the page area (main#main, tabindex -1, no focus ring) while the next page loads, never on the page body.
// The new page's heading takes focus when it is drawn. Frontend only: no database.
//
// R43_ROUTE_DIR (optional) points the checks at another copy of public/ (used to prove the test red on an older tree).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = process.env.R43_ROUTE_DIR || path.join(__dirname, '../public');
const app = fs.readFileSync(path.join(PUBLIC, 'js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'css/app.css'), 'utf8');

// The helper is taken out of the file text and run, as qa-r34-router does for layerFocus.
const start = app.indexOf('export function holdFocusWhileLoading');
const holdFocusWhileLoading = start < 0 ? null : new Function(`${app.slice(start, app.indexOf('\n}', start) + 2).replace('export function', 'function')}; return holdFocusWhileLoading;`)();

// A stand-in page area that records every change made to it.
const stand = ({ connected = true } = {}) => {
  const calls = [];
  return {
    calls,
    isConnected: connected,
    setAttribute: (name, value) => calls.push(['setAttribute', name, value]),
    focus: (opts) => calls.push(['focus', opts]),
  };
};

test('holdFocusWhileLoading: a page area that was focused is held (tabindex -1, focus without a scroll) and true comes back', () => {
  assert.ok(holdFocusWhileLoading, 'holdFocusWhileLoading is exported from app.js');
  const content = stand();
  assert.equal(holdFocusWhileLoading(content, true), true);
  assert.deepEqual(content.calls, [['setAttribute', 'tabindex', '-1'], ['focus', { preventScroll: true }]]);
});

test('holdFocusWhileLoading: focus was not on the page, or the page is gone: nothing is touched and false comes back', () => {
  assert.ok(holdFocusWhileLoading, 'holdFocusWhileLoading is exported from app.js');
  const notHeld = stand();
  assert.equal(holdFocusWhileLoading(notHeld, false), false);
  assert.deepEqual(notHeld.calls, []);
  const gone = stand({ connected: false });
  assert.equal(holdFocusWhileLoading(gone, true), false);
  assert.deepEqual(gone.calls, []);
});

test('render: the press is read before the skeleton removes it; the hold follows the swap and comes before the one scroll', () => {
  assert.match(app, /else \{\n(?:\s*\/\/[^\n]*\n)?\s*const pressedInPage = shell\.content\.contains\(document\.activeElement\);[^\n]*\n\s*shell\.content\.removeAttribute\('aria-busy'\);\n\s*shell\.content\.replaceChildren\(skeleton\(\)\);\n\s*holdFocusWhileLoading\(shell\.content, pressedInPage\);\n\s*window\.scrollTo\(0, 0\);\n\s*\}/);
  assert.equal(app.split('holdFocusWhileLoading(shell.content, pressedInPage);').length - 1, 1, 'one call in render');
});

test('app.css: the held page area draws no focus ring, on the rule directly after the heading rule', () => {
  const heading = css.indexOf('h1[tabindex="-1"]:focus-visible, h2[tabindex="-1"]:focus-visible { outline: none; }');
  const main = css.indexOf('main[tabindex="-1"]:focus-visible { outline: none; }');
  assert.ok(heading >= 0, 'the heading rule is still there (qa-r25-css)');
  assert.ok(main > heading, 'main[tabindex="-1"]:focus-visible rule comes after the heading rule');
  assert.equal(css.split('main[tabindex="-1"]:focus-visible { outline: none; }').length - 1, 1, 'one main rule');
});
