'use strict';
require('./helpers');

// Round 34 CSS (D-116): the bottom bar is as tall as the space reserved for it, the phone assistant sheet sits flush on it,
// and the booking page's discount toggle is 44px on a phone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');

test('bottom bar is at least --bottomnav-h tall plus the safe area', () => {
  const m = css.match(/\n\.bottomnav \{([^}]*)\}/);
  assert.ok(m, '.bottomnav rule');
  assert.match(m[1], /min-height:\s*calc\(var\(--bottomnav-h\) \+ env\(safe-area-inset-bottom\)\)/);
});

test('phone assistant sheet has square bottom corners and keeps its bottom and height', () => {
  const m = css.match(/@media \(max-width: 559px\) \{ \.assist \{([^}]*)\}/);
  assert.ok(m, 'phone .assist rule');
  assert.match(m[1], /border-radius:\s*18px 18px 0 0/);
  assert.match(m[1], /bottom:\s*calc\(var\(--bottomnav-h\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(m[1], /height:\s*calc\(100dvh - \(max\(12px, env\(safe-area-inset-top\)\) \+ 56px\) - var\(--bottomnav-h\) - env\(safe-area-inset-bottom\)\)/);
});

test('discount code toggle is 44px tall on phones', () => {
  const m = css.match(/@media \(max-width: 559px\) \{ \.bk-code summary \{([^}]*)\}/);
  assert.ok(m, 'phone .bk-code summary rule');
  assert.match(m[1], /min-height:\s*44px/);
});
