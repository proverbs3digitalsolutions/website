// QA round 9, lane C15: CSS fixes in public/css/app.css.
// #30 a long workspace name pushes the account button off a phone screen; #20 the floating Ask button covers the last row.
// Also the classes other lanes render: sidebar and More sheet groups (C13), collapsed form sections (C16), photo previews (C12).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The declarations of every rule whose selector ends exactly with `sel`.
const blocksFor = (sel, source = css) => {
  const re = new RegExp(`(?:^|[\\s},])${escapeRe(sel)}\\s*\\{([^}]*)\\}`, 'g');
  return [...source.matchAll(re)].map((m) => m[1]);
};

// The text inside one `@media <query> { ... }` block, brace-matched so nested rules are kept.
const mediaBody = (query) => {
  const head = `@media ${query} {`;
  const start = css.indexOf(head);
  assert.notEqual(start, -1, `${head} block exists`);
  let depth = 1;
  let j = start + head.length;
  for (; j < css.length && depth; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') depth--;
  }
  return css.slice(start + head.length, j - 1);
};

// Sum of the px values inside a CSS value, e.g. "calc(20px + 48px + 16px)" -> 84.
const pxSum = (value) => [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].reduce((n, m) => n + Number(m[1]), 0);

// A value written as colours must come from a token: no hex, rgb(), rgba(), hsl() or hsla() in any rule of the list.
const assertTokensOnly = (selector, source = css) => {
  const blocks = blocksFor(selector, source);
  assert.ok(blocks.length > 0, `${selector} rule exists`);
  for (const b of blocks) {
    assert.doesNotMatch(b, /#[0-9a-fA-F]{3,8}\b/, `${selector} uses no hex colour`);
    assert.doesNotMatch(b, /\b(rgb|rgba|hsl|hsla)\(/, `${selector} uses no functional colour`);
  }
};

test('#30 the account link in the top bar can shrink, so its workspace name truncates before the avatar moves', () => {
  assert.ok(blocksFor('.topbar__me').some((b) => /min-width:\s*0\b/.test(b)), '.topbar__me has min-width: 0');
  const org = blocksFor('.topbar__org').join(' ');
  assert.match(org, /overflow:\s*hidden/, 'the name box clips');
  assert.match(org, /text-overflow:\s*ellipsis/, 'the name box shows an ellipsis');
  assert.match(org, /white-space:\s*nowrap/, 'the name stays on one line');
  assert.match(blocksFor('.acct-avatar').join(' '), /flex:\s*none/, 'the avatar never shrinks');
});

test('#20 at 960px and up the content area reserves the floating Ask button plus a gap at the bottom', () => {
  const askOffset = Number(blocksFor('.assist-fab').join(' ').match(/bottom:\s*(\d+)px/)[1]);
  assert.equal(askOffset, 20, 'the Ask button sits 20px above the bottom edge');
  const desk = mediaBody('(min-width: 960px)');
  const contentRule = blocksFor('.content', desk);
  assert.ok(contentRule.length > 0, '.content has a 960px-and-up rule');
  const padding = contentRule.join(' ').match(/padding:\s*([^;]+);/);
  assert.ok(padding, 'the 960px rule sets padding');
  const bottom = padding[1].trim().split(/\s+(?![^(]*\))/).pop();
  // The Ask button is about 48px tall (12px padding, a 20px icon, a line of text); 20px offset + 48px + a 16px gap.
  assert.ok(pxSum(bottom) >= 20 + 48 + 16, `bottom padding ${bottom} clears the Ask button (84px)`);
});

test('#20 on a phone the content area still clears the bottom bar; the Ask button sits in the top bar there', () => {
  const base = blocksFor('.content')[0];
  assert.match(base, /padding:[^;]*var\(--bottomnav-h\)/, 'phone bottom padding reserves the bottom bar');
  assert.match(base, /\+\s*32px/, 'and a 32px gap above it');
  assert.match(blocksFor('.assist-fab--bar').join(' '), /position:\s*static/, 'the Ask button is not floating on a phone');
});

test('sidebar groups: each group is a grid, its title is a small muted heading, and the More tools group folds', () => {
  assert.ok(blocksFor('.nav__group').some((b) => /display:\s*grid/.test(b)), '.nav__group is a grid');
  const title = blocksFor('.nav__group-title').join(' ');
  assert.match(title, /color:\s*var\(--muted\)/, 'the group title is muted');
  assert.match(title, /font-size:\s*\.(7[5-9]|8)\d*rem/, 'the group title is a small size');
  assert.match(title, /font-weight:\s*600/, 'the group title is semibold');
  assert.doesNotMatch(title, /text-transform:\s*uppercase/, 'sentence case on screen, as CLAUDE.md requires');
  assert.ok(blocksFor('.nav__group + .nav__group').some((b) => /margin-top:\s*\d+px/.test(b)), 'groups are spaced apart');
  const more = blocksFor('details.nav__group--more > summary.nav__group-title').join(' ');
  assert.match(more, /cursor:\s*pointer/, 'the More tools row is clickable');
  assert.match(more, /list-style:\s*none/, 'the browser marker is hidden');
  assert.match(css, /details\.nav__group--more > summary\.nav__group-title::-webkit-details-marker\s*\{\s*display:\s*none/, 'the old-browser marker is hidden');
  assert.match(css, /details\.nav__group--more\[open\] > summary\.nav__group-title::after/, 'the chevron turns when open');
});

test('More sheet: each group has a visible heading in the sheet', () => {
  const head = blocksFor('.morenav__group-title').join(' ');
  assert.ok(head.length > 0, '.morenav__group-title rule exists');
  assert.match(head, /color:\s*var\(--muted\)/, 'the sheet group heading is muted');
  assert.match(head, /font-weight:\s*600/, 'and semibold, the same as the sidebar group titles');
  assert.doesNotMatch(head, /text-transform:\s*uppercase/, 'sentence case on screen, as CLAUDE.md requires');
});

test('collapsed form sections: a full-width summary row with a chevron, and open fields keep the 14px form gap', () => {
  const summary = blocksFor('details.form-section > summary').join(' ');
  assert.ok(summary.length > 0, 'details.form-section > summary rule exists');
  assert.match(summary, /display:\s*flex/, 'the row is a flex line');
  assert.match(summary, /justify-content:\s*space-between/, 'the chevron sits at the far end');
  assert.match(summary, /cursor:\s*pointer/, 'the row is clickable');
  assert.match(summary, /min-height:\s*44px/, 'the row is a 44px touch target');
  assert.match(css, /details\.form-section > summary::-webkit-details-marker\s*\{\s*display:\s*none/, 'the browser marker is hidden');
  assert.match(css, /details\.form-section\[open\] > summary::after/, 'the chevron turns when open');
  const fields = blocksFor('details.form-section > :not(summary)').join(' ');
  assert.match(fields, /margin-top:\s*14px/, 'open fields use the same 14px gap as .form');
});

test('photo previews: img.file-thumb is at most 96px square, cropped, with the radius token and no raw colours', () => {
  const thumb = blocksFor('img.file-thumb').join(' ');
  assert.ok(thumb.length > 0, 'img.file-thumb rule exists');
  assert.match(thumb, /width:\s*96px/, 'the preview is 96px wide');
  assert.match(thumb, /max-width:\s*96px/, 'and never wider than 96px');
  assert.match(thumb, /aspect-ratio:\s*1\b/, 'and square');
  assert.match(thumb, /object-fit:\s*cover/, 'cropped to fill the square');
  assert.match(thumb, /border-radius:\s*var\(--radius-sm\)/, 'uses the radius token');
  assert.match(thumb, /display:\s*(block|inline-block)/, 'block or inline-block');
  assert.match(thumb, /flex:\s*none/, 'keeps its size inside the file link row');
  assert.match(blocksFor('.file-link').join(' '), /gap:\s*6px/, 'the file name follows after the link gap');
  assertTokensOnly('img.file-thumb');
});

test('new navigation, sheet and section rules use colour tokens only', () => {
  assertTokensOnly('.nav__group-title');
  assertTokensOnly('.morenav__group-title');
  assertTokensOnly('details.form-section > summary');
  assertTokensOnly('details.nav__group--more > summary.nav__group-title');
});
