'use strict';

// QA round 12, lane C14 (css-charts): star picker tokens with 3:1 contrast in light and both dark themes (#9),
// stacked phone tables hide their low-priority cells below 480px (#1), notification switch rows at least 44px
// with the list not clipped (#39), the chart hover band filled from a token (K3), and the aria-disabled button
// look (C08). Frontend-only: reads the stylesheet and two scripts; no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
// Comments are stripped so a note that mentions a selector cannot satisfy an assertion.
const css = fs.readFileSync(path.join(publicDir, 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const chartsSrc = fs.readFileSync(path.join(publicDir, 'js', 'charts.js'), 'utf8');
const notifSrc = fs.readFileSync(path.join(publicDir, 'js', 'notifications.js'), 'utf8');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Declarations of the rule whose whole selector is `sel` and that starts its own line (empty string when absent).
const ruleOf = (sel) => {
  const m = css.match(new RegExp(`^\\s*${escapeRe(sel)} \\{([^}]*)\\}`, 'm'));
  return m ? m[1] : '';
};

// Declarations of the token block that starts with `re` (empty string when absent).
const blockOf = (re) => {
  const m = css.match(re);
  return m ? m[1] : '';
};
const lightBlock = blockOf(/^:root \{([^}]*)\}/m);
const darkBlock = blockOf(/^:root\[data-theme="dark"\] \{([^}]*)\}/m);
const autoDarkBlock = blockOf(/^\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/m);

const tok = (block, name) => (block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`)) || [])[1];

// WCAG relative luminance and contrast ratio for #rrggbb values.
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// The bodies of every @media block whose query is exactly `query`, brace-matched so nested rules are kept.
const mediaBodies = (query) => {
  const out = [];
  const re = /@media ([^{]+)\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (m[1].trim() !== query) continue;
    let depth = 1;
    let j = m.index + m[0].length;
    for (; j < css.length && depth; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
    }
    out.push(css.slice(m.index + m[0].length, j - 1));
  }
  return out.join('\n');
};

// Specificity as [ids, classes (incl. attributes and pseudo-classes), elements]. :not(x) counts as x.
const specificity = (sel) => {
  const s = sel.replace(/\[[^\]]*\]/g, ' [a] ').replace(/:not\(|\)/g, ' ');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+/g) || []).length
    + (s.match(/\[a\]/g) || []).length
    + (s.match(/:(?!:)[\w-]+/g) || []).length;
  const elements = (s.replace(/#[\w-]+|\.[\w-]+|\[a\]|:(?!:)[\w-]+/g, ' ').match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [ids, classes, elements];
};
const compareSpecificity = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const themes = [
  ['light', lightBlock],
  ['dark, data-theme', darkBlock],
  ['dark, system', autoDarkBlock],
];

for (const [label, block] of themes) {
  test(`star tokens exist and reach 3:1 on the surface (${label})`, () => {
    const surface = tok(block, 'surface');
    assert.ok(surface, '--surface defined in this block');
    const off = tok(block, 'star-off');
    const on = tok(block, 'star-on');
    assert.ok(off, '--star-off defined in this block');
    assert.ok(on, '--star-on defined in this block');
    assert.ok(ratio(off, surface) >= 3, `--star-off ${off} is ${ratio(off, surface).toFixed(2)}:1 on ${surface}`);
    assert.ok(ratio(on, surface) >= 3, `--star-on ${on} is ${ratio(on, surface).toFixed(2)}:1 on ${surface}`);
    assert.notEqual(off, on, 'a selected star looks different from an unselected one');
  });
}

test('the star buttons take their colours from the star tokens only (#9)', () => {
  assert.match(ruleOf('.stars button'), /color:\s*var\(--star-off\)/);
  assert.match(ruleOf('.stars button.is-on'), /color:\s*var\(--star-on\)/);
  for (const sel of ['.stars button', '.stars button.is-on', '.stars button:focus-visible']) {
    const body = ruleOf(sel);
    assert.ok(body, `${sel} rule exists`);
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, `${sel} has no hex colour`);
    assert.doesNotMatch(body, /\b(?:rgb|rgba|hsl|hsla)\(/, `${sel} has no functional colour`);
  }
});

test('the star focus ring is the app focus token in both themes (#9)', () => {
  assert.match(ruleOf('.stars button:focus-visible'), /outline:\s*2px solid var\(--focus-ring\)/);
});

test('a stacked table hides its low-priority cells below 480px, beating the labelled-cell grid rule (#1)', () => {
  const stackedCell = '.table--stack td[data-label]:not([data-label=""])';
  assert.ok(css.includes(`${stackedCell} { display: grid;`), 'the labelled-cell grid rule exists (the rule to beat)');
  const phone = mediaBodies('(max-width: 480px)');
  const hide = [...phone.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, sel, body]) => /display:\s*none/.test(body)
      && /\.table--stack\s+\.col-sm-hide\[data-label\]:not\(\[data-label=""\]\)/.test(sel));
  assert.ok(hide.length >= 1, 'a stacked col-sm-hide rule sits in the max-width 480px block');
  const [, sel] = hide[0];
  assert.ok(compareSpecificity(specificity(sel.trim()), specificity(stackedCell)) > 0,
    `${sel.trim()} must outrank ${stackedCell}`);
});

test('the Reservations table still hides Channel and Code on phones through the shared class (#1)', () => {
  assert.match(mediaBodies('(max-width: 480px)'), /(?:^|[\s}])\.col-sm-hide\s*\{[^}]*display:\s*none/);
});

test('notification switch rows are at least 44px and the list is not clipped (#39)', () => {
  assert.match(notifSrc, /h\('fieldset', \{ class: 'checks notify-list'/);
  assert.match(ruleOf('.notify-list'), /max-height:\s*none/, 'five rows must not scroll inside the 220px cap');
  const row = ruleOf('.notify-list .check');
  assert.match(row, /min-height:\s*44px/);
  assert.match(row, /align-items:\s*center/);
});

test('the chart hover band takes its fill from a token, not an rgba (K3)', () => {
  assert.doesNotMatch(chartsSrc, /rgba\(/);
  assert.doesNotMatch(chartsSrc, /setAttribute\('fill'/, 'hover no longer writes a colour into the markup');
  assert.match(chartsSrc, /class: 'chart-band'/);
  assert.match(chartsSrc, /classList\.add\('chart-band--on'\)/);
  assert.match(chartsSrc, /classList\.remove\('chart-band--on'\)/);
  assert.match(ruleOf('.chart-band'), /fill:\s*transparent/);
  const on = ruleOf('.chart-band--on');
  assert.match(on, /fill:\s*var\(--navy\)/, 'a token fill, so the band follows the theme');
  assert.match(on, /fill-opacity:\s*\.05/, 'translucent, so the bars under the band stay visible');
  assert.doesNotMatch(on, /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/);
});

test('an aria-disabled button dims like :disabled but shows a not-allowed cursor (C08)', () => {
  const disabled = ruleOf('.btn:disabled');
  assert.match(disabled, /opacity:\s*\.6/, '.btn:disabled keeps its dimming');
  assert.match(disabled, /cursor:\s*progress/, '.btn:disabled keeps its progress cursor (loading state)');
  const ariaDisabled = ruleOf('.btn[aria-disabled="true"]');
  assert.ok(ariaDisabled, 'a separate rule covers aria-disabled="true"');
  assert.match(ariaDisabled, /opacity:\s*\.6/);
  assert.match(ariaDisabled, /cursor:\s*not-allowed/);
});
