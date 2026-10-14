// QA round 4, lane C04: shell and CSS fixes (scroll cue, theme switch, rating, long words, wide dialogs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const css = read('public', 'css', 'app.css').replace(/\/\*[\s\S]*?\*\//g, '');
const appJs = read('public', 'js', 'app.js');
const uiJs = read('public', 'js', 'ui.js');
const rules = (sel) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').some((s) => s.trim() === sel)).map((m) => m[2]).join(' ');

test('guest star rating uses the amber token (phone#23)', () => {
  assert.match(rules('.rating'), /color:\s*var\(--amber\)/);
});

test('selected theme-switch icon inherits the white of its button (settings#28)', () => {
  assert.match(rules('.sidebar__foot .themeswitch button[aria-checked="true"] > [aria-hidden]'), /color:\s*inherit/);
});

test('cleaning task history wraps long words (ops#22)', () => {
  const r = rules('.hk-history li');
  assert.match(r, /overflow-wrap:\s*anywhere/);
  assert.match(r, /min-width:\s*0/);
});

test('the scroll cue is a mask fade driven by is-more classes, on the table box and the calendar (phone#25)', () => {
  assert.match(rules('.table-wrap.is-more-right'), /mask-image:\s*linear-gradient/);
  assert.match(rules('.cal-scroll.is-more-right'), /mask-image:\s*linear-gradient/);
  assert.equal(rules('.cal-scroll.is-more-left'), '', 'calendar has a sticky left column: right fade only');
  assert.doesNotMatch(rules('.table-wrap'), /background:/, 'the old background gradient is gone');
  assert.doesNotMatch(css, /\.tabs[^{]*is-more/, 'the cue never goes on tab strips');
  assert.match(css, /@media print\s*\{[^}]*mask-image:\s*none/);
});

test('app.js sets the is-more classes from the scroll position', () => {
  assert.match(appJs, /toggle\('is-more-right'/);
  assert.match(appJs, /toggle\('is-more-left'/);
  assert.match(appJs, /addEventListener\('scroll'/);
  assert.match(appJs, /ResizeObserver/);
});

test('wide dialogs use a class, not an inline width, and are full-width sheets on phones (O-c)', () => {
  assert.doesNotMatch(uiJs, /style\.width/);
  assert.match(uiJs, /classList\.add\('modal--wide'\)/);
  assert.match(rules('dialog.modal.modal--wide'), /width:\s*min\(760px/);
  assert.doesNotMatch(css, /gs-modal[^{]*\{[^}]*!important/);
  const i = css.indexOf('@media (max-width: 559px) {\n  dialog.modal, dialog.modal.modal--wide');
  assert.ok(i >= 0, 'phone sheet rule covers modal--wide');
});

test('in the history lists the status keeps its width and the text column wraps (re-verify SEV3)', () => {
  assert.match(rules('.hk-history .hk-card__top > :not(:first-child)'), /flex-shrink:\s*0/);
  assert.match(rules('.hk-history .hk-card__top > :not(:first-child)'), /white-space:\s*nowrap/);
  const t = rules('.hk-history .hk-card__top > :first-child');
  assert.match(t, /min-width:\s*0/);
  assert.match(t, /overflow-wrap:\s*anywhere/);
});
