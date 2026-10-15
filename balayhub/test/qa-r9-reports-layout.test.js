// QA round 9, reports layout: on Reports > Performance the period controls (the period select and its month,
// year or date boxes) render in the same flex row as the Property, Listing and Channel filters, not in a narrow
// stacked column. Also checks the Income summary (for taxes) year select row. Source and CSS scan only (no browser,
// no database): stayreports.js imports app.js, which can't load in Node.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'public', rel), 'utf8');
const src = read('js/views/stayreports.js');
const filters = read('js/filters.js');
const css = read('css/app.css');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The body of the first rule whose selector is exactly `sel` (top level, not inside a @media block).
const ruleBody = (sel) => {
  const m = css.match(new RegExp(`(?:^|[\\s}])${esc(sel)}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `${sel} rule exists`);
  return m[1];
};
// The text inside every `@media (max-width: N px) { ... }` block, brace-matched so nested rules are kept.
const phoneBody = (px) => {
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
// The shared drawBar() call for one tab, from its key to the closing `});`. drawBar() makes the filterBar() call (QA round 14, #27).
const barCall = (key) => {
  const m = src.match(new RegExp(`drawBar\\(\\{\\s*key: '${esc(key)}',[\\s\\S]*?\\}\\);`));
  assert.ok(m, `drawBar call for ${key} found`);
  return m[0];
};

test('the period controls are the filter bar\'s extra slot, not a wrapping chip box', () => {
  assert.match(src, /const periodBox = h\('div', \{ class: 'flt__period' \}\);/);
  assert.doesNotMatch(src, /periodBox = h\('div', \{ class: 'chips' \}\)/);
  const perf = barCall('stay-reports');
  assert.match(perf, /extra: periodBox\b/);
  assert.match(src, /quick: \[\.\.\.\(c\.before \|\| \[\]\), \.\.\.scopeFieldsFor\(c\.values\.property_id\)\]/, 'Property, Listing and Channel go into the same filterBar call');
});

test('filterBar() puts the extra slot and the quick filters side by side in one toolbar row', () => {
  // The toolbar is one flex row: extra, search, quick filters and More are siblings in it, in that order.
  assert.match(filters, /h\('div', \{ class: 'toolbar flt__bar' \}, extra, searchEl, quickEls, moreBtn\)/);
});

test('the period wrapper is display: contents, so its controls are items of the toolbar row itself', () => {
  assert.match(ruleBody('.flt__period'), /display:\s*contents/);
  assert.match(ruleBody('.toolbar'), /display:\s*flex/);
  assert.match(ruleBody('.toolbar'), /flex-wrap:\s*wrap/);
  // The shared select rule is a descendant selector, so it reaches the period select through the wrapper.
  // A child selector (.toolbar > select) would drop the period select out of the row.
  assert.match(css, /\.toolbar select\.input\s*\{[^}]*flex:\s*0 1 200px/);
  assert.doesNotMatch(css, /\.toolbar\s*>\s*select/);
});

test('the period select and its month, year or date boxes share the 200px row size, and the same 48px control height', () => {
  const selectBasis = ruleBody('.toolbar select.input').match(/flex:\s*0 1 200px/);
  assert.ok(selectBasis, 'selects in the row are 200px');
  const box = ruleBody('.flt__period > input.input');
  assert.match(box, /width:\s*auto/, 'a month or date box does not take the whole row');
  assert.match(box, /flex:\s*0 1 200px/);
  // input--sm is 38px high beside the 48px selects; the period controls use the plain .input size.
  assert.doesNotMatch(src, /input--sm/);
  assert.match(src, /const sel = h\('select', \{ class: 'input', 'aria-label': 'Period'/);
  assert.match(src, /inputs = h\('input', \{ class: 'input', type: 'month'/);
  assert.match(src, /inputs = h\('select', \{ class: 'input', 'aria-label': 'Year'/);
});

test('on phones the period select, its boxes and the date pair each take a full row, with no sideways scroll', () => {
  const phone = phoneBody(480);
  assert.match(phone, /\.toolbar select\.input,\s*\.flt__bar select\.input\s*\{[^}]*flex:\s*1 1 100%[^}]*width:\s*100%/);
  assert.match(phone, /\.flt__period > input\.input,\s*\.flt__period > \.flt__range\s*\{[^}]*flex:\s*1 1 100%[^}]*width:\s*100%/);
});

test('a custom date range keeps its two dates together as one unit (the existing .flt__range markup)', () => {
  assert.match(src, /inputs = h\('div', \{ class: 'flt__range' \},/);
  assert.match(ruleBody('.flt__range'), /display:\s*flex/);
  assert.match(ruleBody('.flt__range'), /flex-wrap:\s*wrap/);
  assert.match(ruleBody('.flt__range input[type=date]'), /min-width:\s*9\.5rem/);
});

test('the Income summary (for taxes) year select sits in the same filter row as Property, Listing and Channel', () => {
  const tax = barCall('stay-reports-tax');
  assert.match(tax, /before: \[\{ name: 'year', label: 'Year'/);
  assert.match(src, /quick: \[\.\.\.\(c\.before \|\| \[\]\), \.\.\.scopeFieldsFor\(c\.values\.property_id\)\]/, 'the year select and the scope fields share one filterBar call');
  assert.doesNotMatch(tax, /extra:/, 'the tax tab has no period wrapper');
  // A select with no type is placed bare in the toolbar (not in a .flt__field wrapper), like the other selects.
  assert.doesNotMatch(tax, /name: 'year'[^}]*type:/);
});

test('the period rules add no colours or !important, and the other pages keep the shared row sizing', () => {
  const block = css.slice(css.indexOf('.flt__period { display: contents; }'), css.indexOf('.flt__check { align-self'));
  assert.ok(block.length > 0, 'period block found');
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|!important/);
  // The shared toolbar and select rules are unchanged: Property, Listing and Channel on other pages keep their size.
  assert.match(ruleBody('.toolbar > *'), /min-width:\s*0/);
  assert.match(ruleBody('.toolbar select.input'), /width:\s*auto/);
});
