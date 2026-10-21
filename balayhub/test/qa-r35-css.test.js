'use strict';
require('./helpers');

// Round 35 CSS (D-117): the assistant header line is full white (opacity on the dark green fell under 4.5:1), and the
// remaining tappable summaries are 44px on a phone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('no opacity inside the .assist__head rules', () => {
  const rules = [...css.matchAll(/(^|\n)([^{}\n]*\.assist__head[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 1);
  for (const r of rules) assert.doesNotMatch(r[3], /opacity/, r[2]);
});

test('.assist__head background and colour are unchanged', () => {
  const m = css.match(/\n\.assist__head \{([^}]*)\}/);
  assert.ok(m);
  assert.match(m[1], /background:\s*var\(--forest\)/);
  assert.match(m[1], /color:\s*#fff/);
});

test('white on the dark-theme --forest is at least 4.5:1', () => {
  const dark = [...raw.matchAll(/--forest:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
  assert.ok(dark.length >= 2);
  for (const f of dark) assert.ok(ratio('#ffffff', f) >= 4.5, `${f} ${ratio('#ffffff', f)}`);
});

test('tappable summaries are 44px inside the phone block', () => {
  const start = css.indexOf('@media (max-width: 959px) {\n  .btn--sm, .planbar .btn--sm');
  assert.ok(start > -1, 'phone tap block');
  const block = css.slice(start, start + 4000);
  const m = block.match(/(\.lp-faq summary[^{]*)\{([^}]*)\}/);
  assert.ok(m, 'summary rule in the block');
  for (const sel of ['.lp-faq summary', '.help-article summary', '.assist__articles .help-article summary', '.hp-rules summary', 'details.card > summary']) {
    assert.ok(m[1].includes(sel), sel);
  }
  assert.match(m[2], /min-height:\s*44px/);
});
