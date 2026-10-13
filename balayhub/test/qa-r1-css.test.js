// QA round 1, lane L03: CSS fixes in public/css/app.css (rules exist, dark tokens keep their contrast).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
const rule = (sel) => { const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m ? m[1] : ''; };
const darkBlock = css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)[1];
const autoDark = css.match(/:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/)[1];
const tok = (block, name) => (block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('#2/#52 .table-wrap is positioned so .sr-only stays inside it', () => {
  assert.match(rule('.table-wrap'), /position:\s*relative/);
});

test('#42/#53 filter bar tabs wrap and the check label can wrap', () => {
  assert.match(css, /\.flt__bar \.tabs\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.flt__bar > \*\s*\{\s*min-width:\s*0/);
  assert.match(rule('.flt__check'), /white-space:\s*normal/);
});

test('#59 page bottom padding clears the bottom tab bar', () => {
  assert.match(rule('.content'), /padding:[^;]*var\(--bottomnav-h\)/);
  assert.ok(parseInt(css.match(/--bottomnav-h:\s*(\d+)px/)[1], 10) >= 61);
});

test('#12 checkbox labels are normal weight', () => {
  assert.match(css, /\.field label\.check\s*\{[^}]*font-weight:\s*400/);
});

test('#56 date input shows a focus ring', () => {
  assert.match(css, /\.input:focus-within/);
  assert.match(css, /\.input:focus-visible[^{]*\{[^}]*outline:\s*2px solid/);
});

test('rules use tokens, not hard-coded colours', () => {
  assert.match(rule('.quick a, .quick button'), /var\(--teal-ink\)/);
  assert.match(css, /\.quick a:hover, \.quick button:hover \{ background: var\(--teal-soft-hover\)/);
  assert.match(rule('.badge--vacant'), /var\(--teal-ink\)/);
  assert.match(rule('.navbadge'), /var\(--badge-bg\)/);
  assert.match(css, /\.bk-code summary \{[^}]*var\(--accent\)/);
});

for (const [label, block] of [['dark', darkBlock], ['auto-dark', autoDark]]) {
  test(`dark contrast (${label} tokens)`, () => {
    const t = (n) => tok(block, n);
    assert.ok(ratio(t('teal-ink'), t('teal-soft')) >= 4.5, 'quick actions / vacant badge');
    assert.ok(ratio(t('teal-ink'), t('teal-soft-hover')) >= 4.5, 'quick actions hover');
    assert.ok(ratio('#ffffff', t('badge-bg')) >= 4.5, 'nav count badge');
    assert.ok(ratio(t('accent'), t('surface')) >= 4.5, 'discount link');
    assert.ok(ratio(t('text'), t('surface')) >= 3, 'theme switch glyph');
  });
}
