'use strict';

// Round 22 CSS: picked calendar days keep white price text (also on holidays, last rule wins);
// on phones the assistant sheet ends above the bottom bar so its tabs stay tappable.

process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_30';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
const lastIndex = (re) => { let i = -1; for (const m of css.matchAll(re)) i = m.index; return i; };

test('picked-day price text is white and comes after the holiday rule', () => {
  const holiday = css.indexOf('.bk-cal__day.is-holiday small');
  const picked = lastIndex(/\.bk-cal__day\.is-picked(?:\.is-holiday)? small\s*\{\s*color:\s*var\(--on-forest\)/g);
  assert.ok(picked > holiday && holiday > 0, 'picked small rule must follow the holiday small rule');
  assert.ok(lastIndex(/\.bk-cal__day\.is-picked\.is-holiday\s*\{[^}]*background:\s*var\(--teal\)/g) > css.indexOf('.bk-cal__day.is-holiday {'), 'picked background must follow holiday');
});

test('phone assistant sheet sits above the bottom bar', () => {
  const m = css.match(/@media \(max-width: 559px\) \{ \.assist \{([^}]*)\}/);
  assert.ok(m, 'phone .assist rule');
  assert.match(m[1], /bottom:\s*calc\(var\(--bottomnav-h\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(m[1], /height:\s*calc\(100dvh - \(max\(12px, env\(safe-area-inset-top\)\) \+ 56px\) - var\(--bottomnav-h\) - env\(safe-area-inset-bottom\)\)/);
});
