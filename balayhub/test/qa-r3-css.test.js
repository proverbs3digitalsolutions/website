// QA round 3, lane C07: CSS fixes in public/css/app.css (phone overflow, focus under the bottom bar,
// the Ask button in the top bar on phones, the scroll cue on wide tables and tab strips).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');

// The text inside every `@media (max-width: N px) { ... }` block, brace-matched so nested rules are kept.
const mediaBody = (px) => {
  const head = `@media (max-width: ${px}px) {`;
  const out = [];
  let i = 0;
  while ((i = css.indexOf(head, i)) !== -1) {
    let depth = 1;
    let j = i + head.length;
    for (; j < css.length && depth; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
    }
    out.push(css.slice(i + head.length, j - 1));
    i = j;
  }
  return out.join('\n');
};
const blocksFor = (sel) => {
  const re = new RegExp(`(?:^|[\\s},])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]);
};

test('.alert wraps a long unbroken word instead of pushing the page sideways (calendar#3)', () => {
  const alert = blocksFor('.alert').find((b) => /padding:\s*12px 14px/.test(b));
  assert.ok(alert, '.alert base rule found');
  assert.match(alert, /overflow-wrap:\s*anywhere/);
});

test('toolbar children and stat cards may shrink below their content width (owners#21, phone#23)', () => {
  assert.ok(blocksFor('.toolbar > *').some((b) => /min-width:\s*0/.test(b)), '.toolbar > * min-width 0');
  assert.ok(blocksFor('.stat').some((b) => /min-width:\s*0/.test(b)), '.stat min-width 0');
});

test('on phones the filter selects take the full row (owners#21, phone#23)', () => {
  const phone = mediaBody(480);
  assert.match(phone, /\.toolbar select\.input,\s*\.flt__bar select\.input\s*\{[^}]*flex:\s*1 1 100%[^}]*width:\s*100%/);
});

test('big stat figures scale down on the stay reports cards and keep the no-wrap rule (owners#21)', () => {
  const flat = blocksFor('.stat--flat .stat__value').join(' ');
  assert.match(flat, /font-size:\s*clamp\(/, 'stat--flat figure is no longer a fixed 1.6rem');
  const base = blocksFor('.stat__value').join(' ');
  assert.match(base, /white-space:\s*nowrap/, 'figures still never wrap mid-number');
});

test('the Get started sheet takes the full phone width like the other phone sheets (public#25)', () => {
  assert.match(mediaBody(559), /dialog\.modal\.modal--wide\s*\{[^}]*width:\s*100vw[^}]*margin:\s*auto 0 0/);
});

test('tab strips wrap at every width and never scroll sideways, so they need no cue (ops#16)', () => {
  assert.match(blocksFor('.tabs').join(' '), /flex-wrap:\s*wrap/);
  assert.doesNotMatch(blocksFor('.tabs').join(' '), /overflow-x:\s*auto/);
  assert.match(blocksFor('.op__tabs-in').join(' '), /flex-wrap:\s*wrap/);
  // No rule for any tab row (.tabs, .op__tabs-in, ...) may still scroll sideways.
  const scrolling = [...css.matchAll(/([^{}]*tabs[^{}]*)\{([^}]*)\}/g)].filter((m) => /overflow-x:\s*auto/.test(m[2]));
  assert.deepEqual(scrolling.map((m) => m[1].trim()), []);
});

test('low-priority table columns can hide on small phones (money#14)', () => {
  // Bare class selector, so it hides header and body cells alike (C05 puts it on Channel and Code).
  assert.match(mediaBody(480), /(?:^|[\s}])\.col-sm-hide\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(mediaBody(480), /(?:td|th)\.col-sm-hide/);
});

test('wide tables show a clear edge cue (money#14, ops#17): a mask fade on the clipped side, driven by is-more-* classes', () => {
  assert.match(blocksFor('.table-wrap.is-more-right').join(' '), /mask-image:\s*linear-gradient/);
  assert.doesNotMatch(css, /\.table-wrap,\s*\.tabs/, 'tab strips do not get the cue');
});

test('the page keeps keyboard focus clear of the bottom tab bar on phones (phone#22, WCAG 2.4.11)', () => {
  assert.match(mediaBody(959), /html\s*\{[^}]*scroll-padding-bottom:\s*calc\(var\(--bottomnav-h\)/);
});

test('the top-bar slot pushes the Ask button to the right next to the account link (C08 contract)', () => {
  assert.match(blocksFor('.topbar__assist').join(' '), /margin-left:\s*auto/);
  assert.match(blocksFor('.topbar__assist').join(' '), /display:\s*flex/);
  assert.match(blocksFor('.topbar__assist').join(' '), /flex:\s*none/);
});

test('the Ask button in the top bar is a static 40px round icon button (C08 contract)', () => {
  const bar = blocksFor('.assist-fab--bar').join(' ');
  assert.ok(bar.length > 0, '.assist-fab--bar rule');
  assert.match(bar, /position:\s*static/);
  assert.doesNotMatch(bar, /position:\s*fixed/, 'the bar button does not float');
  assert.match(bar, /bottom:\s*auto/);
  assert.match(bar, /right:\s*auto/);
  assert.match(bar, /width:\s*40px/);
  assert.match(bar, /height:\s*40px/);
  assert.match(bar, /border-radius:\s*50%/);
  assert.match(bar, /box-shadow:\s*none/);
});

test('the phone block no longer adds extra bottom room for a floating Ask button (C08 contract)', () => {
  assert.doesNotMatch(mediaBody(559), /body:has\(\.assist-fab:not\(\[hidden\]\)\) \.content/);
  assert.doesNotMatch(css, /body:has\(\.assist-fab:not\(\[hidden\]\)\) \.content/);
});

test('the Get started sheet gets the full phone width through the modal--wide class, no !important (public#25, O-c)', () => {
  assert.match(mediaBody(559), /dialog\.modal\.modal--wide\s*\{[^}]*width:\s*100vw[^}]*margin:\s*auto 0 0/);
  assert.doesNotMatch(css, /gs-modal[^{]*\{[^}]*!important/);
});
