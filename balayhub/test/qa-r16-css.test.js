'use strict';

// QA round 16, lane CSS (class E2 layout fits, #10 #15 #18 #27 #29 #30, and #31 contrast). Frontend-only: scans public/css/app.css.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Declarations of every rule whose selector list is exactly `sel` (outside or inside media blocks).
const decls = (sel) => {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1].split(',').map((s) => s.trim().replace(/^.*\{\s*/, '')).includes(sel)) out.push(m[2]);
  }
  return out.join(' ');
};

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('#10 filter bar column can shrink and long chips wrap', () => {
  assert.match(decls('.flt'), /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  const chip = decls('.flt__chip');
  assert.match(chip, /overflow-wrap:\s*anywhere/);
  assert.match(chip, /max-width:\s*100%/);
  assert.match(chip, /min-width:\s*0/);
});

test('#15 quick select sizes to content above 480px', () => {
  assert.match(decls('.flt__bar select.input'), /width:\s*auto;[^}]*max-width:\s*min\(100%,\s*18rem\)/);
  // The 200px flex-basis from `.toolbar select.input` must be overridden, or the name is still cut off (V5).
  assert.match(decls('.flt__bar select.input'), /flex:\s*0 1 auto/);
  assert.match(decls('.flt__bar select.input'), /field-sizing:\s*content/);
  assert.match(decls('.flt__bar select.input'), /min-width:\s*min\(100%,\s*16rem\)/);
});

test('#18 coupon row keeps Apply beside the code box', () => {
  assert.match(decls('.coupon-row'), /display:\s*flex/);
  assert.match(decls('.coupon-row .input'), /min-width:\s*0/);
});

test('#27 calendar unit name is block level so the ellipsis applies', () => {
  const d = decls('.cal-name');
  assert.match(d, /display:\s*block/);
  assert.match(d, /max-width:\s*100%/);
});

test('#29 calendar nav grows on the toolbar row', () => {
  assert.match(decls('.toolbar > .cal-nav'), /flex:\s*1 1 auto/);
});

test('#30 short desktop screens get a compact sidebar', () => {
  const i = css.indexOf('@media (min-width: 960px) and (max-height: 960px)');
  assert.ok(i !== -1, 'compact sidebar media query exists');
  assert.match(css.slice(i, i + 600), /\.sidebar nav a/);
});

test('#31 landing Airbnb bar is dark enough for white text', () => {
  assert.match(decls('.lp-cal__bar--airbnb'), /background:\s*#c8344a/);
  assert.ok(!/#d93a50/i.test(css));
  assert.ok(contrast('#c8344a', '#ffffff') >= 4.5);
});

test('#34 Later fold summary is tappable and 44px on phones', () => {
  assert.match(decls('.lpad-later > summary'), /cursor:\s*pointer/);
  assert.match(decls('.lpad-later > summary'), /min-height:\s*44px/);
  assert.match(decls('.lpad-later'), /margin-top:\s*16px/);
});

test('#41 phone calendar month bar is two rows', () => {
  assert.match(decls('.toolbar > .cal-nav'), /display:\s*grid/);
  assert.match(decls('.toolbar > .cal-nav > :nth-child(5)'), /grid-column:\s*1 \/ 3/);
  assert.match(decls('.toolbar > .cal-nav > :nth-child(6)'), /grid-column:\s*3 \/ 5/);
});

test('theme switch: equal segments, full width in the sidebar footer, no stray button margin', () => {
  assert.match(decls('.sidebar__foot .themeswitch'), /display:\s*flex;\s*width:\s*100%/);
  assert.match(decls('.sidebar__foot .themeswitch button'), /margin-top:\s*0/);
  assert.match(decls('.themeswitch--compact button'), /flex:\s*1 1 0/);
  assert.match(decls('.themeswitch--compact button'), /justify-content:\s*center/);
  assert.match(decls('.tb-theme .themeswitch'), /width:\s*100%/);
  assert.match(decls('.morenav__theme .themeswitch button'), /flex:\s*1 1 0/);
});
