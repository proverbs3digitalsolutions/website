// QA round 10, lane C14: CSS fixes in public/css/app.css.
// #31 "Change" and "Edit notes" link buttons were 23px tall on a phone (.linkbtn had no minimum height);
// #34 "Show as table" was 20px tall on a phone (.link-btn had no minimum height, the chart link needs 32px on a phone);
// #14 the print-only acknowledgement block shows on paper and stays hidden on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The declarations of each rule whose whole selector is `sel` and that starts its own line in `source`.
const rulesFor = (sel, source = css) => {
  const re = new RegExp(`^\\s*${escapeRe(sel)}\\s*\\{([^}]*)\\}`, 'gm');
  return [...source.matchAll(re)].map((m) => m[1]);
};

// The text inside every `@media <query> { ... }` block, brace-matched so the nested rules are kept.
const mediaBlocks = (query) => {
  const head = `@media ${query} {`;
  const out = [];
  for (let start = css.indexOf(head); start !== -1; start = css.indexOf(head, start + head.length)) {
    let depth = 1;
    let j = start + head.length;
    for (; j < css.length && depth; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    out.push(css.slice(start + head.length, j - 1));
  }
  return out;
};

const minHeight = (declarations) => {
  const m = declarations.match(/min-height:\s*(\d+)px/);
  return m ? Number(m[1]) : 0;
};

test('#31 and #34: the text link buttons are at least 24px tall, with their text centred in that height', () => {
  for (const sel of ['.link-btn', '.linkbtn']) {
    const [rule] = rulesFor(sel);
    assert.ok(rule, `${sel} rule exists`);
    assert.ok(minHeight(rule) >= 24, `${sel} has a min-height of at least 24px`);
    assert.match(rule, /display:\s*inline-flex/, `${sel} lays its text out as a flex line`);
    assert.match(rule, /align-items:\s*center/, `${sel} centres its text vertically`);
    assert.match(rule, /padding:\s*[1-9]\d*px\s+0\b/, `${sel} has a small vertical padding`);
  }
});

test('#34 on a phone the chart "Show as table" link is at least 32px tall', () => {
  const phone = mediaBlocks('(max-width: 480px)').flatMap((b) => rulesFor('.chart-foot .link-btn', b));
  assert.ok(phone.length > 0, 'a rule up to 480px wide sets .chart-foot .link-btn');
  assert.ok(minHeight(phone.join(' ')) >= 32, 'the chart link is at least 32px tall on a phone');
});

test('#14 print-only blocks are hidden on screen and shown on paper', () => {
  assert.ok(rulesFor('.print-only').some((b) => /display:\s*none/.test(b)), '.print-only is hidden on screen');
  const printRules = mediaBlocks('print').flatMap((b) => rulesFor('.print-only', b));
  assert.ok(printRules.some((b) => /display:\s*block\s*!important/.test(b)), '.print-only is shown inside @media print');
});

test('C14 link and print rules use colour tokens only', () => {
  const touched = [
    ...rulesFor('.link-btn'),
    ...rulesFor('.linkbtn'),
    ...rulesFor('.print-only'),
    ...mediaBlocks('(max-width: 480px)').flatMap((b) => rulesFor('.chart-foot .link-btn', b)),
  ];
  assert.ok(touched.length >= 4, 'every touched rule is found');
  for (const b of touched) {
    assert.doesNotMatch(b, /#[0-9a-fA-F]{3,8}\b/, 'no hex colour');
    assert.doesNotMatch(b, /\b(rgb|rgba|hsl|hsla)\(/, 'no functional colour');
  }
});
