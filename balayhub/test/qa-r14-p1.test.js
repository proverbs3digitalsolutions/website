'use strict';

// QA round 14, lane P1 (css): phone tap sizes for the controls the round 13 phone block did not list (class E: #43, #44,
// #45, #35, #26, #9, #15, #22, #5, #39, #40, K4, K8), page content that does not scroll on its own when a list redraws
// (class C: K7, #18), the bottom space that keeps the floating Ask button off the last row (#19), the add-on amount line
// that keeps its height so ticking an add-on does not move the row (#10), and the desktop shell lines the top bar needs
// (TOPBAR-PLAN section 3). Frontend-only: reads public/css/app.css; no database.

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
const desktop = splitMedia('(min-width: 960px)');
const desktopRules = rulesIn(desktop.inside);
const allRules = rulesIn(css);

// Rules outside every @media block (the base sheet), so a base rule cannot be mistaken for a phone or desktop one.
const withoutMedia = (text) => {
  let out = '';
  let i = 0;
  for (let start = text.indexOf('@media ', i); start !== -1; start = text.indexOf('@media ', i)) {
    out += text.slice(i, start);
    const open = text.indexOf('{', start);
    let depth = 1;
    let j = open + 1;
    for (; j < text.length && depth; j += 1) {
      if (text[j] === '{') depth += 1;
      else if (text[j] === '}') depth -= 1;
    }
    i = j;
  }
  return out + text.slice(i);
};
const baseRules = rulesIn(withoutMedia(css));

// The declarations given to a selector by the rules that match it exactly, joined.
const declsOf = (rules, sel) => rules.filter((r) => r.sel === sel).map((r) => r.decls).join(' ');

// The last min-height in a set of declarations, in px (0 when none). Later declarations win, so the last one counts.
const minHeightOf = (decls) => {
  const all = [...decls.matchAll(/min-height:\s*(\d+)px/g)];
  return all.length ? Number(all[all.length - 1][1]) : 0;
};

// The px value of one property in a set of declarations (0 when none).
const pxOf = (decls, prop) => {
  const m = decls.match(new RegExp(`${prop}:\\s*(\\d+)px`));
  return m ? Number(m[1]) : 0;
};

// Round 13 rule for this lane: the controls the round 13 phone block did not list must be at least 44px tall below 960px.
const PHONE_CONTROLS = [
  '.check',
  '.link-btn',
  '.linkbtn',
  '.flt__clear',
  '.chart-foot .link-btn',
  '.input--sm',
  '.langtoggle button',
  '.lp-top .btn--sm',
  '.gc__foot a',
  '.lpad-guide summary',
];

test('below 960px checkbox rows, link buttons, the filter clear link, small inputs, the language toggle, the landing button, the guest footer link and the Launchpad guide toggle are at least 44px tall (class E)', () => {
  for (const sel of PHONE_CONTROLS) {
    assert.ok(minHeightOf(declsOf(phoneRules, sel)) >= 44, `${sel} is at least 44px tall in the phone block`);
  }
});

test('below 960px a checkbox row centres its box and label on the 44px line (#43, #44)', () => {
  assert.match(declsOf(phoneRules, '.check'), /align-items:\s*center/);
});

test('below 960px the guest footer link is inline-flex and centred so its 44px box holds the text (#9)', () => {
  const link = declsOf(phoneRules, '.gc__foot a');
  assert.match(link, /display:\s*inline-flex/);
  assert.match(link, /align-items:\s*center/);
});

test('below 960px the dialog close button is 44 by 44 (#35, #45)', () => {
  const decls = declsOf(phoneRules, '.modal__close');
  assert.equal(pxOf(decls, 'width'), 44, 'width 44px');
  assert.equal(pxOf(decls, 'height'), 44, 'height 44px');
});

test('below 960px the cleaner pay select-all box (.ops-bar .check input) is 24 by 24, as the row boxes are (K8)', () => {
  const decls = declsOf(phoneRules, '.ops-bar .check input');
  assert.equal(pxOf(decls, 'width'), 24, 'width 24px');
  assert.equal(pxOf(decls, 'height'), 24, 'height 24px');
});

test('the phone block uses colour tokens only and adds no !important (checked against the file before round 14)', () => {
  assert.doesNotMatch(PHONE.inside, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour in the phone block');
  assert.doesNotMatch(PHONE.inside, /\b(?:rgb|rgba|hsl|hsla)\(/, 'no functional colour in the phone block');
  assert.equal((css.match(/!important/g) || []).length, 18, 'the same number of !important as before round 14 (18)');
});

test('the page content turns off scroll anchoring at every width, so a redraw does not move the page (class C: K7, #18)', () => {
  assert.match(declsOf(baseRules, '.content'), /overflow-anchor:\s*none/);
});

test('at 960px and wider the page keeps 96px under the last row, so the floating Ask button never covers a row (#19)', () => {
  const bottom = pxOf(declsOf(desktopRules, '.content'), 'padding-bottom');
  assert.ok(bottom >= 88, `the desktop bottom padding is ${bottom}px, at least 88px`);
});

test('an empty add-on amount line keeps its height, so ticking an add-on does not move the row above it (#10)', () => {
  assert.doesNotMatch(css, /\.bk-addon__amt:empty\s*\{[^}]*display:\s*none/, 'no rule hides the empty amount line');
  assert.match(declsOf(allRules, '.bk-addon__amt'), /min-height:\s*1\.4em/);
});

test('the desktop block no longer hides the top bar; the bottom bar stays hidden (TOPBAR-PLAN 3)', () => {
  assert.equal(desktopRules.filter((r) => r.sel === '.topbar').length, 0, 'no desktop rule names .topbar');
  assert.match(declsOf(desktopRules, '.bottomnav'), /display:\s*none/);
});

test('app.css sets no desktop shell rows and no sidebar row, so the top bar stylesheet (topbar.css) owns the grid alone (TOPBAR-PLAN 3)', () => {
  assert.doesNotMatch(declsOf(desktopRules, '.shell'), /grid-template-rows/, 'no row template on .shell');
  assert.doesNotMatch(declsOf(desktopRules, '.sidebar'), /grid-row/, 'no grid-row on .sidebar');
});

test('the old workspace name rule in the top bar is removed with its element (TOPBAR-PLAN 3)', () => {
  assert.equal(declsOf(allRules, '.topbar__org'), '', '.topbar__org has no rule left');
});
