'use strict';
require('./helpers');

// QA round 40, INBOX (D-122: the thread gives up height so the reply box and Send fit under it on a laptop screen).
// From 960px wide the thread is capped at the window height less 740px (never below its 160px floor; it still opens at
// its newest message, D-119), and the reply row keeps Send beside the "Send later" field instead of wrapping it underneath.
// Below 960px nothing changes. A rule test only: the browser measurement at 1280x900, 1366x768 and 1440x900 is reported by the lane.
//
// R40_INBOX_CSS (optional) points the test at another copy of app.css (the copy at 30ba605 is used to prove this test red).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = process.env.R40_INBOX_CSS || path.join(__dirname, '..', 'public', 'css', 'app.css');
// Comments are stripped so a note that mentions a selector cannot satisfy an assertion.
const css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Declarations of the rule whose selector is `sel` and that opens a line or a block (empty string when absent).
const declsOf = (text, sel) => {
  const m = text.match(new RegExp(`(?:^|[{};])\\s*${escapeRe(sel)} \\{([^}]*)\\}`, 'm'));
  return m ? m[1] : '';
};

// Every "@media <query> { ... }" block: where it starts and what is inside it (brace matched).
const mediaBlocks = (query) => {
  const out = [];
  const re = new RegExp(`@media ${escapeRe(query)} \\{`, 'g');
  let m;
  while ((m = re.exec(css))) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') { depth -= 1; if (depth === 0) break; }
    }
    out.push({ start: m.index, body: css.slice(m.index + m[0].length, end) });
  }
  return out;
};

test('from 960px the thread is capped at the window height less 740px, never below its 160px floor (D-122)', () => {
  const wide = mediaBlocks('(min-width: 960px)').find((b) => b.body.includes('.inbox__messages'));
  assert.ok(wide, '.inbox__messages is capped inside @media (min-width: 960px)');
  const m = declsOf(wide.body, '.inbox__messages').match(/max-height:\s*max\(160px,\s*calc\(100vh - (\d+)px\)\)/);
  assert.ok(m, 'max-height is max(160px, calc(100vh - Npx))');
  assert.ok(Number(m[1]) >= 700, `N is ${m[1]}; the cap must leave room for the reply box on a 768px-tall laptop`);
});

test('the thread keeps min-height 160px and has no height cap outside the wide block; the old 500px cap is gone', () => {
  const base = declsOf(css, '.inbox__messages');
  assert.match(base, /min-height:\s*160px/);
  assert.doesNotMatch(base, /max-height/);
  assert.doesNotMatch(css, /max\(260px,\s*calc\(100vh - 500px\)\)/);
});

test('below 960px the thread keeps full height and the reply row keeps its wrap', () => {
  const phone = mediaBlocks('(max-width: 959px)').find((b) => b.body.includes('.inbox__messages'));
  assert.ok(phone, 'the phone block still lifts the cap');
  assert.match(declsOf(phone.body, '.inbox__messages'), /max-height:\s*none/);
  assert.match(declsOf(css, '.composer__actions'), /flex-wrap:\s*wrap/);
});

test('from 960px the reply row does not wrap Send under the "Send later" field (D-122)', () => {
  const wide = mediaBlocks('(min-width: 960px)').find((b) => b.body.includes('.composer__actions'));
  assert.ok(wide, '.composer__actions is set inside @media (min-width: 960px)');
  const actions = declsOf(wide.body, '.composer__actions');
  assert.match(actions, /flex-wrap:\s*nowrap/);
  // Send lines up with the top of the label, which keeps Send above the 900px fold at 1280x900 (D-122).
  assert.match(actions, /align-items:\s*flex-start/);
  const later = declsOf(wide.body, '.composer__later');
  assert.match(later, /flex:\s*1 1 auto/);
  assert.match(later, /min-width:\s*0/);
  // The date field starts at 180px and takes the rest of the label. Its intrinsic width (about 226px) would otherwise push Send
  // out of a 316px thread column at 1280px; the zero width keeps the field's minimum width at zero for the row.
  const field = declsOf(wide.body, '.composer__later .input--sm');
  assert.match(field, /(?:^|[\s;])width:\s*0(?:px)?\s*;/);
  assert.match(field, /min-width:\s*0/);
  assert.match(field, /flex:\s*1 1 180px/);
});

test('the wide block comes after the base rules it overrides, so it wins the cascade', () => {
  const wide = mediaBlocks('(min-width: 960px)');
  const thread = wide.find((b) => b.body.includes('.inbox__messages'));
  const composer = wide.find((b) => b.body.includes('.composer__actions'));
  assert.ok(thread && composer, 'both rules are in the wide block');
  assert.ok(thread.start > css.indexOf('\n.inbox__messages { display: flex'), 'after the thread base rule');
  assert.ok(composer.start > css.indexOf('\n.composer__later { display: flex'), 'after the composer base rules');
});
