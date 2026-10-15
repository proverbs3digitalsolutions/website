'use strict';

// QA round 13, lane F02 (css): phone tap sizes (class C: #7, #17, #54, #55, K1), the shared .link-tap class and the
// .back link height (#17, #54), the calendar booking tile floor (#55), the skip link (#16) and the 38px desktop
// .btn--sm (DESIGN-BRIEF). Frontend-only: reads public/css/app.css; no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Comments are stripped so a note that mentions a selector cannot satisfy an assertion.
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// The text inside every `@media <query> { ... }` block (brace-matched) and the sheet with those blocks taken out.
const splitMedia = (query) => {
  const head = `@media ${query} {`;
  const inside = [];
  let outside = '';
  let i = 0;
  for (let start = css.indexOf(head, i); start !== -1; start = css.indexOf(head, i)) {
    outside += css.slice(i, start);
    let depth = 1;
    let j = start + head.length;
    for (; j < css.length && depth; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
    }
    inside.push(css.slice(start + head.length, j - 1));
    i = j;
  }
  outside += css.slice(i);
  return { inside: inside.join('\n'), outside };
};

// Every rule in a block of plain rules, one entry per selector of a comma list: { sel, decls }.
const rulesIn = (text) => [...text.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .flatMap(([, sels, decls]) => sels.split(',').map((s) => ({ sel: s.trim(), decls })));

const PHONE = splitMedia('(max-width: 959px)');
const phoneRules = rulesIn(PHONE.inside);
const baseRules = rulesIn(PHONE.outside);
const desktopRules = rulesIn(splitMedia('(min-width: 960px)').inside);

// The declarations given to a selector by the rules that match it exactly, joined.
const declsOf = (rules, sel) => rules.filter((r) => r.sel === sel).map((r) => r.decls).join(' ');

// The last min-height in a set of declarations, in px (0 when none). Later declarations win, so the last one counts.
const minHeightOf = (decls) => {
  const all = [...decls.matchAll(/min-height:\s*(\d+)px/g)];
  return all.length ? Number(all[all.length - 1][1]) : 0;
};

const PHONE_TAP_SIZES = [
  '.btn--sm',
  '.planbar .btn--sm',
  '.tabs a',
  '.tabs button',
  '[role="tab"]',
  '.flt__chip',
  '.back',
  '.inbox__back',
  '.link-tap',
  '.checks label',
  '.topbar .brand',
  '.topbar__me',
];

test('below 960px every button, tab, filter chip, back link, standalone link and checklist row is at least 44px tall (#7, #17, #54, #55, K1)', () => {
  for (const sel of PHONE_TAP_SIZES) {
    assert.ok(minHeightOf(declsOf(phoneRules, sel)) >= 44, `${sel} is at least 44px tall in the phone block`);
  }
});

test('below 960px the checklist label centres its text in the 44px row (K1)', () => {
  assert.match(declsOf(phoneRules, '.checks label'), /align-items:\s*center/);
});

test('below 960px the top-bar Ask button is 44 by 44 (#55)', () => {
  const decls = declsOf(phoneRules, '.assist-fab--bar');
  assert.match(decls, /width:\s*44px/);
  assert.match(decls, /height:\s*44px/);
});

test('the phone tap rules use colour tokens only', () => {
  assert.doesNotMatch(PHONE.inside, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour in the phone block');
  assert.doesNotMatch(PHONE.inside, /\b(?:rgb|rgba|hsl|hsla)\(/, 'no functional colour in the phone block');
});

test('.back and .link-tap are at least 24px tall on wider screens, and .link-tap lays its text out as a flex line (#17, #54)', () => {
  assert.ok(minHeightOf(declsOf(baseRules, '.back')) >= 24, '.back has a 24px floor outside the phone block');
  const link = declsOf(baseRules, '.link-tap');
  assert.ok(link, '.link-tap rule exists');
  assert.ok(minHeightOf(link) >= 24, '.link-tap has a 24px floor outside the phone block');
  assert.match(link, /display:\s*inline-flex/);
  assert.match(link, /align-items:\s*center/);
});

test('calendar booking tiles keep a 24px floor (#55)', () => {
  assert.ok(minHeightOf(declsOf(baseRules, '.cal-bar')) >= 24, '.cal-bar min-height is at least 24px');
});

test('.btn--sm stays 38px at 960px and wider (DESIGN-BRIEF)', () => {
  assert.equal(minHeightOf(declsOf(baseRules, '.btn--sm')), 38, 'the base .btn--sm rule keeps 38px');
  assert.ok(!desktopRules.some((r) => r.sel === '.btn--sm'), 'no 960px-and-up rule resizes .btn--sm');
});

test('the skip link is hidden until it has keyboard focus, then shows over the top bar, with no hex colour (#16)', () => {
  const skip = declsOf(baseRules, '.skip-link');
  assert.ok(skip, '.skip-link rule exists');
  assert.match(skip, /clip-path:\s*inset\(50%\)/, 'hidden by default');
  const shown = baseRules.filter((r) => r.sel === '.skip-link:focus' || r.sel === '.skip-link:focus-visible');
  assert.ok(shown.some((r) => /clip-path:\s*none/.test(r.decls)), 'a :focus or :focus-visible rule shows it');
  assert.ok(shown.every((r) => !/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/.test(r.decls)), 'the focus rule has no hex or functional colour');
  assert.doesNotMatch(skip, /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/, 'the base rule has no hex or functional colour');
  assert.match(skip, /z-index:\s*\d{3}/, 'above the sticky top bar (z-index 30)');
});

test('the More sheet fold title is a 44px tap target with a token focus ring (F01 fold)', () => {
  const fold = '.morenav__fold > summary.morenav__group-title';
  const decls = declsOf(baseRules, fold);
  const focus = declsOf(baseRules, `${fold}:focus-visible`);
  assert.ok(decls && focus, 'the fold title rule and its :focus-visible rule exist');
  assert.match(decls, /cursor:\s*pointer/);
  assert.ok(minHeightOf(decls) >= 44, 'the fold title is at least 44px tall');
  assert.match(decls, /display:\s*flex/);
  assert.match(decls, /align-items:\s*center/);
  assert.match(focus, /outline:\s*2px solid var\(--focus-ring\)/, 'the focus ring uses the existing token');
  assert.doesNotMatch(decls + focus, /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/, 'tokens only');
});

test('below 960px the table row checkboxes (cleaner pay and the ops tables) are at least 24 by 24 (#55 class C)', () => {
  const decls = declsOf(phoneRules, '.table .ops-check input[type="checkbox"]');
  const px = (prop) => {
    const m = decls.match(new RegExp(`${prop}:\\s*(\\d+)px`));
    return m ? Number(m[1]) : 0;
  };
  assert.ok(px('width') >= 24 && px('height') >= 24, 'the row checkbox is at least 24px wide and tall on a phone');
});
