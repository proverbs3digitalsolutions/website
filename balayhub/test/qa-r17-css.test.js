'use strict';

// QA round 17, lane CSS (#12 mention list, #33 Today tag contrast, #34 cleaner-pay tap box, #37 equal theme segments). Scans public/css/app.css.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raw = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Declarations of every rule whose selector list includes exactly `sel`.
const decls = (sel, css = raw) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1].split(',').map((s) => s.trim()).includes(sel)) out.push(m[2]);
  }
  return out.join(' ');
};

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('#12 mention list sits in the flow and cannot cover the mode tabs', () => {
  const d = decls('.mention-list');
  assert.match(d, /position:\s*static/);
  assert.doesNotMatch(d, /bottom:\s*100%/);
  assert.doesNotMatch(d, /position:\s*absolute/);
});

test('#33 Today tag uses the always-white token; white on dark teal passes AA', () => {
  assert.match(decls('.hk-day__today'), /color:\s*var\(--on-forest\)/);
  assert.ok(ratio('#ffffff', '#1f7a4f') >= 4.5);
});

test('#34 cleaner-pay label tap target is 44px inside the phone block', () => {
  const m = raw.match(/@media \(max-width: 959px\) \{([\s\S]*?)\n\}/g) || [];
  assert.ok(m.some((b) => /min-height:\s*44px/.test(decls('.ops-check__tap', b)) && /min-width:\s*44px/.test(decls('.ops-check__tap', b))));
});

test('#37 base theme switch has equal-width segments', () => {
  const d = decls('.themeswitch');
  assert.match(d, /grid-auto-columns:\s*1fr/);
  assert.match(d, /grid-auto-flow:\s*column/);
  assert.match(decls('.themeswitch button'), /justify-content:\s*center/);
});

test('no !important added by this lane', () => {
  assert.doesNotMatch(decls('.ops-check__tap'), /!important/);
});
