'use strict';
// QA round 17: phone polish for the landing page (footer stack, stats 2x2, tabs 2x3, section gap). Static scans only, no database.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'landing.js'), 'utf8');
const phone = (sel) => new RegExp(`@media \\(max-width: 640px\\) \\{[^@]*?${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^}]*\\}`);

test('footer groups the two legal links in one row and stacks centred', () => {
  assert.match(js, /class: 'lp-foot__links'[\s\S]*#\/terms[\s\S]*#\/privacy/);
  assert.match(css, /\.lp-foot__inner \{[^}]*flex-direction: column[^}]*align-items: center/);
  assert.match(css, /\.lp-foot__links \{[^}]*display: flex[^}]*justify-content: center/);
  assert.match(css, /\.lp-foot a \{[^}]*min-height: 44px/);
});

test('stats band is two columns on phones, with overflow protection', () => {
  assert.match(css, phone('.lp-highlights__grid {'));
  assert.match(css, /\.lp-highlights__grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.lp-highlights__grid > div \{[^}]*overflow-wrap: anywhere/);
});

test('feature tabs are an equal-width two-column grid with 44px buttons on phones', () => {
  assert.match(css, /\.lp-tabs \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.lp-tabs button \{ width: 100%; min-height: 44px; justify-content: center/);
  // tab behaviour untouched
  assert.match(js, /role: 'tablist'/);
  assert.match(js, /role: 'tab'/);
  assert.match(js, /ArrowRight|e\.key/);
});

test('two plain sections in a row do not stack their padding at any width', () => {
  assert.match(css, /\.lp-section:not\(\.lp-section--alt\) \+ \.lp-section:not\(\.lp-section--alt\):not\(\.lp-final\) \{ padding-top: 0; \}/);
});

test('new rules use no hard-coded colours and no inline style attributes', () => {
  const block = css.slice(css.indexOf('.lp-foot__inner'), css.indexOf('/* ================================================================ plans'));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}\b|rgb\(/);
  assert.doesNotMatch(js, /style="/);
});
