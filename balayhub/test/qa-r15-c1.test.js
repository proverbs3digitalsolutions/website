'use strict';

// QA round 15, lane C1 (css): the call-to-action card and the card adjacency rule (D-94), filters that look like filters,
// the phone 44px list (class E: #5, #6, #12, #15/#26, #39, #44, K6), and the layout fits (class E2: #2, #13, #33, #36).
// Frontend-only: reads public/css/app.css and topbar.css; no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const css = read('app.css');
const topbar = read('topbar.css');
const rawCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');

// The text inside every `@media <query> {` block (brace-matched) and the sheet with those blocks taken out.
const splitMedia = (text, query) => {
  const head = `@media ${query} {`;
  const inside = [];
  let outside = '';
  let i = 0;
  for (let start = text.indexOf(head, i); start !== -1; start = text.indexOf(head, i)) {
    outside += text.slice(i, start);
    let depth = 1;
    let j = start + head.length;
    for (; j < text.length && depth; j += 1) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
    }
    inside.push(text.slice(start + head.length, j - 1));
    i = j;
  }
  outside += text.slice(i);
  return { inside: inside.join('\n'), outside };
};
const rulesIn = (text) => [...text.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .flatMap(([, sels, decls]) => sels.split(',').map((s) => ({ sel: s.trim(), decls })));
const declsOf = (rules, sel) => rules.filter((r) => r.sel === sel).map((r) => r.decls).join(' ');
const lastPx = (decls, prop) => {
  const all = [...decls.matchAll(new RegExp(`(?:^|[\\s;])${prop}:\\s*(\\d+)px`, 'g'))];
  return all.length ? Number(all[all.length - 1][1]) : 0;
};

const phone = splitMedia(css, '(max-width: 959px)');
const phoneRules = rulesIn(phone.inside);
// The order matters for min-height: the phone block, then anything after it in the sheet (the new blocks come last).
// The declarations of every rule with this exact selector, in sheet order, from the start of the round 13 phone block on,
// each tagged with whether it sits inside a phone media block. The last min-height wins, so a later base rule counts too.
const phoneThenLater = (sel) => {
  const at = css.indexOf('@media (max-width: 959px) {\n  .btn--sm');
  const rest = css.slice(at);
  const phoneBlocks = splitMedia(rest, '(max-width: 959px)').inside;
  return rulesIn(phoneBlocks.replace(/@media[^{]*\{/g, '')).filter((r) => r.sel === sel).map((r) => r.decls).join(' ');
};
const phoneMin = (sel) => lastPx(phoneThenLater(sel), 'min-height');
const FOUNDER = rawCss.slice(rawCss.indexOf('/* ===== QA round 15: call-to-action cards and clear filters (D-94)'));
const SWEEP = rawCss.slice(rawCss.indexOf('/* ===== QA round 15: sweep fixes (D-95)'));

test('the founder block and the sweep block exist, in that order, at the end of app.css', () => {
  assert.ok(rawCss.includes('/* ===== QA round 15: call-to-action cards and clear filters (D-94)'));
  assert.ok(rawCss.indexOf('QA round 15: sweep fixes (D-95)') > rawCss.indexOf('call-to-action cards and clear filters (D-94)'));
});

test('on phones the call-to-action text shares the row with the icon and the actions take their own row', () => {
  const small = rulesIn(splitMedia(css, '(max-width: 559px)').inside);
  assert.match(declsOf(small, '.cta-card__text'), /flex:\s*1 1 0/);
  assert.match(declsOf(small, '.cta-card__text'), /min-width:\s*0/);
  assert.match(declsOf(small, '.cta-card'), /align-items:\s*flex-start/);
  assert.match(declsOf(small, '.cta-card__actions'), /flex:\s*1 1 100%/);
});

test('the call-to-action card has an icon, a text block and actions, and stacks on phones', () => {
  for (const sel of ['.cta-card', '.cta-card__icon', '.cta-card__text', '.cta-card__actions', '.cta-card__icon svg']) {
    assert.ok(declsOf(rulesIn(css), sel), `${sel} has a rule`);
  }
  assert.match(declsOf(rulesIn(css), '.cta-card'), /display:\s*flex/);
  assert.match(declsOf(rulesIn(css), '.cta-card'), /flex-wrap:\s*wrap/);
});

test('a card sentence followed straight by a button, chips or form actions gets 12px of space', () => {
  assert.match(css, /\.card > :is\(p, \.muted\) \+ :is\(\.btn, \.chips, \.form-actions\)\s*\{\s*margin-top:\s*12px/);
});

test('selects show one chevron, keep room for it, and a chosen filter select is highlighted', () => {
  const sel = declsOf(rulesIn(css), 'select.input');
  assert.match(sel, /appearance:\s*none/);
  assert.match(sel, /padding-right:\s*36px/);
  assert.match(declsOf(rulesIn(css), '.flt select.input.is-set'), /background-color:/);
  assert.doesNotMatch(declsOf(rulesIn(css), '.flt select.input.is-set'), /(?:^|[\s;])background:/, 'background-color only, so the chevron stays');
});

test('filter chips, the clear link and the check pill look like controls', () => {
  const chip = declsOf(rulesIn(css), '.flt__chip');
  assert.match(chip, /var\(--teal-soft\)/);
  assert.ok(declsOf(rulesIn(css), '.flt__chip::before'), 'check mark');
  assert.ok(declsOf(rulesIn(css), '.flt__chip:active'), 'pressed state');
  assert.match(declsOf(rulesIn(css), '.flt__clear'), /border:\s*1px solid/);
  assert.ok(declsOf(rulesIn(css), '.flt__check:has(input:checked)'), 'checked pill');
  assert.ok(declsOf(rulesIn(css), '.flt__more.is-active'), 'Filters button when filters are set');
});

test('tab text is the body colour, not muted; tabs and saved views show hover and the current one', () => {
  assert.match(declsOf(rulesIn(css), '.tabs a, .tabs button') || css.match(/\.tabs a, \.tabs button\s*\{[^}]*\}/)[0], /color:\s*var\(--text\)/);
  assert.ok(declsOf(rulesIn(css), '.tabs a:hover') || /\.tabs a:hover, \.tabs button:hover/.test(css));
  assert.match(declsOf(rulesIn(css), '.saved-views button[aria-current="true"]'), /border-left-color:\s*var\(--forest\)/);
});

test('both new blocks use tokens only: no hex at all, no functional colours, no !important', () => {
  for (const block of [FOUNDER, SWEEP]) {
    const text = block.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(text, /\b(?:rgb|rgba|hsl|hsla)\(/);
    assert.doesNotMatch(text, /!important/);
  }
});

test('every variable the new blocks use is defined in :root, and the dark theme redefines the soft green and forest', () => {
  const root = css.match(/:root\s*\{([^}]*)\}/)[1];
  const dark = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)[1];
  const used = new Set([...(FOUNDER + SWEEP).matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const own = new Set([...root.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
  for (const v of used) assert.ok(own.has(v) || css.includes(`${v}:`), `${v} is defined`);
  for (const v of ['--teal-soft', '--forest']) assert.match(dark, new RegExp(`${v}:`));
});

test('below 960px the filter chip, clear link and check pill are 44px tall even though the new block sets 32px and 38px', () => {
  for (const sel of ['.flt__chip', '.flt__clear', '.flt__check']) assert.equal(phoneMin(sel), 44, sel);
  // the phone override must come after the base rules that set 32px and 38px
  const lastPhone = css.lastIndexOf('@media (max-width: 959px) { .flt__chip, .flt__clear, .flt__check { min-height: 44px; } }');
  assert.ok(lastPhone > css.lastIndexOf('.flt__check { border:'), 'override after .flt__check base');
  assert.ok(lastPhone > css.lastIndexOf('.flt__clear { border:'), 'override after .flt__clear base');
  assert.ok(lastPhone > css.lastIndexOf('.flt__chip { display:'), 'override after .flt__chip base');
});

test('below 960px these phone controls are 44px tall (class E)', () => {
  for (const sel of ['.themeswitch button', '.themeswitch--compact button', '.morenav__theme .themeswitch button',
    '.bk__foot a', '.lp-foot a', '.stars button', '.stars--sm button', '.hk-job__unit', '.flt__check']) {
    assert.equal(phoneMin(sel), 44, `${sel} is 44px in the phone block`);
  }
  for (const sel of ['.bk__foot a', '.lp-foot a', '.hk-job__unit']) {
    const d = phoneThenLater(sel);
    assert.match(d, /display:\s*inline-flex/, `${sel} inline-flex`);
    assert.match(d, /align-items:\s*center/, `${sel} centred`);
  }
  assert.doesNotMatch(phone.outside, /\.themeswitch button\s*\{[^}]*min-height:\s*44px/, 'only in the phone block');
});

test('below 960px stars are 44 by 44 with a 4px gap', () => {
  for (const sel of ['.stars button', '.stars--sm button']) {
    const d = phoneThenLater(sel);
    assert.equal(lastPx(d, 'min-width'), 44);
    assert.equal(lastPx(d, 'min-height'), 44);
  }
  assert.equal(lastPx(phoneThenLater('.stars'), 'gap'), 4);
});

test('below 960px every small button is at least 44px wide', () => {
  assert.equal(lastPx(declsOf(phoneRules, '.btn--sm'), 'min-width'), 44);
});

test('the top bar panel footer link is 44px tall below 960px (#12)', () => {
  const p = rulesIn(splitMedia(topbar, '(max-width: 959px)').inside);
  const d = declsOf(p, '.tb-pop__foot a');
  assert.equal(lastPx(d, 'min-height'), 44);
  assert.match(d, /display:\s*inline-flex/);
  assert.match(d, /align-items:\s*center/);
});

test('the Reservations Channel column folds away only between 960 and 1439px, and its replacement shows only then (#2)', () => {
  const mid = rulesIn(splitMedia(css, '(min-width: 960px) and (max-width: 1439px)').inside);
  assert.match(declsOf(mid, '.col-md-hide'), /display:\s*none/);
  assert.match(declsOf(mid, '.col-md-show'), /display:\s*block/);
  assert.match(declsOf(rulesIn(splitMedia(css, '(min-width: 960px) and (max-width: 1439px)').outside), '.col-md-hide'), /^\s*$/);
  assert.match(declsOf(rulesIn(css), '.col-md-show'), /display:\s*none/, 'hidden outside the band');
  const cell = declsOf(rulesIn(css), '.res-listing');
  assert.doesNotMatch(cell, /line-clamp|overflow:\s*hidden/, 'the cell itself is not clamped');
  const name = declsOf(rulesIn(css), '.res-listing__name');
  assert.match(name, /display:\s*-webkit-box/);
  assert.match(name, /-webkit-line-clamp:\s*2/);
  assert.match(name, /(?:^|[\s;])line-clamp:\s*2/);
  assert.match(name, /overflow:\s*hidden/);
  assert.match(name, /overflow-wrap:\s*anywhere/);
});

test('on phones the Ask sheet starts under the top bar, using the same offset as the top bar panels (#13)', () => {
  const small = rulesIn(splitMedia(css, '(max-width: 559px)').inside);
  const d = declsOf(small, '.assist');
  const offset = 'calc(max(12px, env(safe-area-inset-top)) + 56px)';
  assert.ok(d.includes(`top: ${offset}`), 'top offset');
  assert.ok(d.includes('height: calc(100dvh - (max(12px, env(safe-area-inset-top)) + 56px))'), 'height reduced by the same amount');
  assert.ok(topbar.includes(`top: ${offset}`), 'top bar panels use the same offset');
});

test('the sidebar list shows a scroll cue while more links are below, with tokens only (#33)', () => {
  const nav = css.match(/\.sidebar nav\s*\{([^}]*)\}/)[1];
  assert.match(nav, /background-attachment:\s*local,\s*scroll/);
  assert.match(nav, /var\(--surface\)/);
  assert.match(nav, /var\(--line\)/);
  assert.equal(lastPx(nav.replace(/background-size:\s*100%\s*/, 'background-size: '), 'background-size'), 40, 'the shade is 40px tall');
});

test('the cleaner pay action bar wraps; on phones its button takes a full line and the select-all label stays on one line (#36)', () => {
  assert.match(declsOf(rulesIn(css), '.ops-bar'), /flex-wrap:\s*wrap/);
  assert.match(declsOf(rulesIn(css), '.ops-bar .check span'), /white-space:\s*nowrap/);
  const small = rulesIn(splitMedia(css, '(max-width: 559px)').inside);
  const d = declsOf(small, '.ops-bar .btn');
  assert.match(d, /flex:\s*1 1 100%/);
  assert.match(d, /white-space:\s*normal/);
});

test('the "Filter by" lead-in sits inline with the selects, in the muted token, with a 16px funnel', () => {
  const by = declsOf(rulesIn(css), '.flt__by');
  assert.match(by, /display:\s*inline-flex/);
  assert.match(by, /align-items:\s*center/);
  assert.match(by, /gap:\s*6px/);
  assert.match(by, /white-space:\s*nowrap/);
  assert.match(by, /flex:\s*none/, 'it never forces a row of its own');
  assert.match(by, /color:\s*var\(--muted\)/);
  const svg = declsOf(rulesIn(css), '.flt__by svg');
  assert.equal(lastPx(svg, 'width'), 16);
  assert.equal(lastPx(svg, 'height'), 16);
  assert.match(svg, /flex-shrink:\s*0/);
  assert.match(svg, /currentColor/);
});
