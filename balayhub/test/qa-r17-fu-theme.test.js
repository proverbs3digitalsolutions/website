'use strict';

// QA round 17 follow-up: landing footer theme buttons are at least 44px wide on phones.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('compact theme switch buttons get min-width 44px inside the phone block', () => {
  const i = css.indexOf('.themeswitch--compact button { min-width: 44px; }');
  assert.ok(i > 0, 'phone min-width rule present');
  const media = css.lastIndexOf('@media', i);
  assert.match(css.slice(media, css.indexOf('{', media)), /max-width/);
  assert.ok(css.indexOf('\n}', media) > i, 'rule sits inside the media block');
});

test('base compact rule is unchanged and the Settings switch is not given a min-width', () => {
  assert.match(css, /\.themeswitch--compact button \{[^}]*min-width: 40px/);
  assert.doesNotMatch(css, /\.themeswitch button \{[^}]*min-width: 44px/);
});
