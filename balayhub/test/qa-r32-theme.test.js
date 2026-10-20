'use strict';
require('./helpers');

// QA round 32, lane THEME (ONB-1, DRK-R, D-114): text on a tinted fill uses the ink token, not a fill colour that stays
// dark green in dark mode. Frontend-only: reads public/css/app.css; no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raw = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].flatMap(([, sels, decls]) => sels.split(',').map((s) => ({ sel: s.trim(), decls })));
const textColour = (decls) => (decls.match(/(?:^|[;\s])color:\s*([^;]+)/) || [])[1];
const colourOf = (sel) => rules.filter((r) => r.sel === sel).map((r) => textColour(r.decls)).filter(Boolean).pop();

const WANT = {
  '.hp-rules summary': 'var(--accent)',
  '.badge--ch-direct': 'var(--teal-ink)',
  '.saved-views button[aria-current="true"]': 'var(--teal-ink)',
  '.op__tabs a[aria-current="page"]': 'var(--accent)',
  '.op__kind': 'var(--teal-ink)',
  '.mention-list__item[aria-selected="true"]': 'var(--teal-ink)',
  '.mention-list__item:hover': 'var(--teal-ink)',
  '.tag-chip': 'var(--teal-ink)',
};
for (const [sel, want] of Object.entries(WANT)) {
  test(`${sel} text colour is ${want}`, () => assert.equal(colourOf(sel), want));
}

test('no text colour in the sheet is a fill token (teal-2 / forest)', () => {
  const bad = rules.filter((r) => /(?:^|[;\s])color:\s*var\(--(teal-2|forest)\)/.test(r.decls)).map((r) => r.sel);
  assert.deepEqual(bad, []);
});

test('a comment above the saved-view rule explains the ink token', () => {
  assert.match(raw, /Text on a tinted fill uses the ink token: --teal-2 and --forest are fill colours and stay dark green in dark mode \(D-114\)\.\s*\*\/\s*\n\.saved-views button\[aria-current="true"\]/);
});

// WCAG contrast
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const block = (head) => { const i = raw.indexOf(head); assert.ok(i >= 0, head); return raw.slice(i, raw.indexOf('\n}', i)); };
const tokens = (text) => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const themes = {
  light: tokens(block(':root {')),
  dark: tokens(block(':root[data-theme="dark"] {')),
  device: tokens(block('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {')),
};
for (const [name, t] of Object.entries(themes)) {
  test(`${name}: ink on the tinted fills and accent on the surface are 4.5:1 or better`, () => {
    for (const [fg, bg] of [['teal-ink', 'teal-soft'], ['teal-ink', 'teal-soft-hover'], ['accent', 'surface'], ['accent', 'bg']]) {
      assert.ok(t[fg] && t[bg], `${fg}/${bg} parsed`);
      assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${fg} on ${bg} = ${ratio(t[fg], t[bg]).toFixed(2)}`);
    }
  });
}
