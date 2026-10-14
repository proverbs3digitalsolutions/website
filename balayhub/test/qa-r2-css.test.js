'use strict';

// QA round 2, lane A12: contrast of the dark-mode fixes, the focus ring, and the phone layout rules.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');

// Tokens declared in a block that starts with `selector {` (first match).
function tokens(selector) {
  const i = css.indexOf(selector + ' {');
  assert.ok(i >= 0, `${selector} block`);
  const body = css.slice(i, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
}
const light = tokens(':root');
const dark = { ...light, ...tokens(':root[data-theme="dark"]') };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rule = (sel) => { const m = css.match(new RegExp('^' + sel.replace(/[.[\]]/g, '\\$&') + ' \\{([^}]*)\\}', 'm')); assert.ok(m, sel); return m[1]; };

for (const [name, t] of [['light', light], ['dark', dark]]) {
  test(`${name}: today's day number, @mention and cancelled message are readable`, () => {
    assert.match(rule('.cal-day-head.is-today b'), /var\(--teal-ink\)/);
    assert.ok(ratio(t['--teal-ink'], t['--teal-soft']) >= 4.5, 'today number');
    assert.match(rule('.mention'), /color: var\(--teal-ink\)/);
    assert.ok(ratio(t['--teal-ink'], t['--teal-soft']) >= 4.5, 'mention');
    assert.doesNotMatch(rule('.msg--cancelled'), /opacity/);
    assert.ok(ratio(t['--muted'], t['--surface']) >= 4.5, 'cancelled text');
  });
  test(`${name}: focus ring is at least 3:1 against the surface and page`, () => {
    assert.ok(ratio(t['--focus-ring'], t['--surface']) >= 3, 'surface');
    assert.ok(ratio(t['--focus-ring'], t['--bg']) >= 3, 'page');
  });
}

test('Airbnb bar keeps white text above 4.5:1', () => {
  const bg = rule('.cal-bar--airbnb').match(/#[0-9a-f]{6}/i)[0];
  assert.ok(ratio(bg, '#ffffff') >= 4.5);
});

test('global focus-visible uses the solid ring', () => {
  assert.match(css, /^:focus-visible \{ outline: 2px solid var\(--focus-ring\)/m);
});

test('scroll cue on .table-wrap is a mask fade driven by is-more-right; tab strips have none (they wrap)', () => {
  assert.match(rule('.table-wrap.is-more-right'), /mask-image: linear-gradient/);
  assert.doesNotMatch(rule('.table-wrap'), /background/);
  assert.doesNotMatch(css, /\.table-wrap, \.tabs/);
  assert.doesNotMatch(css, /\.tabs[^{]*is-more/);
  assert.doesNotMatch(rule('.tabs'), /mask-image|background-attachment|no-repeat local/);
});

test('money values do not break mid-number; long words wrap in rows', () => {
  assert.doesNotMatch(rule('.stat__value'), /anywhere/);
  assert.match(rule('.stat__value'), /white-space: nowrap/);
  assert.match(rule('.row__sub'), /overflow-wrap: anywhere/);
  assert.match(rule('.row__main'), /min-width: 0/);
});

test('phone rules: stacked row actions, icon-only Ask button, wrapping date range', () => {
  assert.match(css, /max-width: 480px\) \{ \.row:has\(/);
  assert.match(css, /row--stack-sm/);
  assert.match(css, /\.assist-fab--bar \{[^}]*width: 40px; height: 40px/);
  assert.doesNotMatch(css, /body:has\(\.assist-fab:not\(\[hidden\]\)\) \.content/);
  assert.match(rule('.flt__range'), /flex-wrap: wrap/);
});
