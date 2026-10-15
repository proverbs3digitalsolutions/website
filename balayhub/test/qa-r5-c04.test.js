// QA round 5, lane C04: phone shell (D-80 stacked cards, More sheet dialog, placeholder contrast, overflow, theme icons).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const rawCss = read('public', 'css', 'app.css').replace(/\/\*[\s\S]*?\*\//g, '');
const appJs = read('public', 'js', 'app.js');
const themeJs = read('public', 'js', 'themeswitch.js');
// Rules whose selector list includes `sel` (top level and inside @media blocks).
const rules = (sel) => [...rawCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === sel)).map((m) => m[2]).join(' ');
// Body of the first @media block whose query contains `q`.
function media(q) {
  const i = rawCss.indexOf(`@media ${q}`);
  if (i < 0) return '';
  let depth = 0; let start = -1;
  for (let k = rawCss.indexOf('{', i); k < rawCss.length; k++) {
    if (rawCss[k] === '{') { depth++; if (start < 0) start = k + 1; } else if (rawCss[k] === '}' && --depth === 0) return rawCss.slice(start, k);
  }
  return '';
}

test('D-80: table--stack block inside the phone screen media query uses data-label', () => {
  const m = media('screen and (max-width: 559px)');
  assert.match(m, /\.table--stack/);
  assert.match(m, /content:\s*attr\(data-label\)/);
  assert.match(m, /\.table--stack tr\s*\{[^}]*border:/);
  assert.match(m, /\.table--stack thead\s*\{[^}]*clip/);
  assert.match(m, /\.table--stack td[^{]*\{[^}]*display:\s*flex/);
});

test('D-80: stackTables helper is defined, called from the observer, and respects opt-outs', () => {
  assert.match(appJs, /function stackTables\(/);
  const obs = appJs.slice(appJs.indexOf('new MutationObserver'));
  assert.match(obs, /stackTables\(app\)/);
  for (const c of ['op-stack', 'ops-stack', 'op-pnl', 'table--nostack']) assert.ok(appJs.includes(c), c);
  assert.match(appJs, />=\s*4|<\s*4/);
  assert.match(appJs, /table--stack/);
  assert.match(appJs, /'columnheader'/);
  assert.match(appJs, /'rowgroup'/);
  assert.match(appJs, /data-label/);
});

test('scroll cue helper still watches table boxes and the calendar', () => {
  assert.match(appJs, /watchScrollCues\(app\)/);
  assert.match(appJs, /'\.table-wrap, \.cal-scroll'/);
});

test('#47: unnamed table box falls back to the page heading', () => {
  assert.match(appJs, /document\.querySelector\('main h1'\)/);
});

test('#41/#42: the More sheet is a native dialog with showModal, no role=menu, scrolls inside', () => {
  const fn = appJs.slice(appJs.indexOf('function openMore'), appJs.indexOf('const initials'));
  assert.match(fn, /h\('dialog'/);
  assert.match(fn, /showModal\(\)/);
  assert.doesNotMatch(fn, /role: 'menu'/);
  assert.match(fn, /aria-label': 'More'|'aria-label': t/);
  assert.match(fn, /\.focus\(\)/);
  const r = rules('.morenav__sheet');
  assert.match(r, /max-height:\s*calc\(100dvh - 16px\)/);
  assert.match(r, /overflow-y:\s*auto/);
  assert.match(r, /overscroll-behavior:\s*contain/);
  assert.match(rules('dialog.morenav::backdrop'), /background:\s*var\(--scrim\)/);
});

test('#43: top-bar account button has an accessible name that includes who it is (topbar.js, QA r14 F1)', () => {
  // The workspace name moved into the account menu header; the button's own name carries the person's name.
  assert.match(read('public', 'js', 'topbar.js'), /'aria-label': `\$\{u\.full_name\}, account menu`/);
});

test('#45: placeholders use the muted token at full opacity', () => {
  const r = rules('input::placeholder');
  assert.match(r, /color:\s*var\(--muted\)/);
  assert.match(r, /opacity:\s*1/);
});

test('#12/#28/#52: long words cannot widen the page at 390px', () => {
  assert.match(rawCss, /@media \(max-width: 759px\)\s*\{\s*\.listing-grid\s*\{[^}]*minmax\(0, 1fr\)/);
  assert.match(rules('.lpad-hero__text'), /min-width:\s*0/);
  assert.match(rules('.lpad-hero .btn'), /white-space:\s*normal/);
  for (const sel of ['h1', 'h2', 'h3', '.row__title']) assert.match(rules(sel) || rawCss.match(new RegExp(`${sel.replace('.', '\\.')}[^{]*\\{[^}]*overflow-wrap:\\s*anywhere`))?.[0] || '', /overflow-wrap:\s*anywhere/, sel);
  assert.match(rules('.page-head__title'), /min-width:\s*0/);
});

test('O-e: theme switch buttons keep one line', () => {
  assert.match(rules('.themeswitch button'), /white-space:\s*nowrap/);
});

test('#55: theme icons are equal-size inline SVGs, no glyph', () => {
  assert.doesNotMatch(themeJs, /◐/);
  assert.match(themeJs, /createElementNS/);
  assert.match(themeJs, /aria-hidden/);
});

test('D-80: rows added after the first pass are still labelled and given roles', () => {
  const fn = appJs.slice(appJs.indexOf('const stackLabels'), appJs.indexOf('new MutationObserver'));
  assert.doesNotMatch(fn, /:not\(\.table--stack\)/, 'already-stacked tables must be revisited');
  assert.match(fn, /new WeakMap\(\)/);
  assert.match(fn, /stackLabels\.get\(table\)/);
  // Row labelling and role assignment must happen outside the one-time setup (no early return between them and the lookup).
  const rowPart = fn.slice(fn.indexOf('tbody tr, tfoot tr'));
  assert.match(rowPart, /setAttribute\('role', 'row'\)/);
  assert.match(rowPart, /setAttribute\('role', cell\.tagName === 'TH' \? 'rowheader' : 'cell'\)/);
  assert.match(rowPart, /!\w+\.hasAttribute\('role'\)/);
});

test('forms: a wide button cannot widen the single-column form grid at 390px', () => {
  assert.match(rules('.form'), /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(rules('.form-row'), /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(rules('.form .btn'), /white-space:\s*normal/);
});

test('More sheet: Tab and Shift+Tab wrap between the first and last item', () => {
  const fn = appJs.slice(appJs.indexOf('function openMore'), appJs.indexOf('const initials'));
  assert.match(fn, /onkeydown/);
  assert.match(fn, /e\.key !== 'Tab'|e\.key === 'Tab'/);
  assert.match(fn, /e\.shiftKey/);
  assert.match(fn, /first\.focus\(\)/);
  assert.match(fn, /last\.focus\(\)/);
});

test('D-80: a labelled card cell keeps a two-part value together on the right', () => {
  const m = media('screen and (max-width: 559px)');
  const r = [...m.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((x) => x[1].includes('.table--stack td')).map((x) => x[1] + '{' + x[2]).join('\n');
  assert.match(r, /grid-template-columns:\s*fit-content\(45%\) minmax\(0, 1fr\)/);
  assert.match(m, /\.table--stack td\[data-label\]:not\(\[data-label=""\]\) > \*\s*\{[^}]*grid-column:\s*2/);
  assert.match(m, /::before\s*\{[^}]*grid-row:\s*1;/);
});

test('D-80: the card label takes one grid row (no tall empty cells) and is never broken mid-word', () => {
  const m = media('screen and (max-width: 559px)');
  assert.doesNotMatch(m, /grid-row:\s*1 \/ span/);
  const lab = [...m.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((x) => /::before/.test(x[1]) && /table--stack td/.test(x[1])).map((x) => x[2]).join(' ');
  assert.match(lab, /overflow-wrap:\s*normal/);
  assert.match(lab, /word-break:\s*normal/);
  assert.match(m, /grid-template-columns:\s*fit-content\(45%\) minmax\(0, 1fr\)/);
  assert.match(lab, /align-self:\s*start/);
});
