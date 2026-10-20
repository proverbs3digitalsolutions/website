'use strict';
require('./helpers');

// QA r30 SEARCHBOX (PHN-1, D-112, DESIGN-BRIEF 23): on phones the search box is a 48px input and its text field fills it.
// Source scan of topbar.css with comments stripped; the desktop bar keeps its 40px box. Frontend-only: no database use.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/css/topbar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const phone = css.slice(css.indexOf('@media (max-width: 959px)'));
const rule = (src, sel) => { const m = src.match(new RegExp('(?:^|[\\s}])' + sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; };

test('phone: .tb-search is at least 48px tall', () => {
  assert.match(rule(phone, '.tb-search'), /min-height:\s*48px/);
});
test('phone: .tb-input stretches to fill the box', () => {
  assert.match(rule(phone, '.tb-input'), /align-self:\s*stretch/);
});
test('desktop base .tb-search keeps its 40px box', () => {
  assert.match(rule(css.slice(0, css.indexOf('@media (max-width: 959px)')), '.tb-search'), /min-height:\s*40px/);
});
test('tokens only, no !important', () => {
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
});
