'use strict';

// QA round 32, lane PRICING (pricing.js): a box holding a whole grid or table is never a live region (D-114, PRC-L).
// The Price preview grid box is plain; the night detail stays live. In Bulk changes only the summary line is live and
// the table and skipped list sit in a plain box. Source scans, as qa-r31-pricing does.

require('./helpers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PRICING = fs.readFileSync(path.join(__dirname, '../public/js/views/pricing.js'), 'utf8');
const PREVIEW = PRICING.slice(PRICING.indexOf('function previewCard('));
const BULK = PRICING.slice(PRICING.indexOf("const result = h('div'") === -1 ? PRICING.indexOf('const resultLine') : PRICING.indexOf("const result = h('div'"));
const count = (text, src = PRICING) => src.split(text).length - 1;

test('PRC-L: the Price preview grid box (out) is not a live region; the night detail keeps its aria-live', () => {
  assert.match(PREVIEW, /const out = h\('div'\);/);
  assert.equal(count("const out = h('div', { 'aria-live'"), 0);
  assert.match(PREVIEW, /const detail = h\('div', \{ class: 'pr-detail card--soft', 'aria-live': 'polite' \}/);
});

test('PRC-L: in Bulk changes resultLine is the only live box', () => {
  assert.match(PRICING, /const resultLine = h\('div', \{ 'aria-live': 'polite' \}\);/);
  assert.match(PRICING, /const resultRest = h\('div'\);/);
  assert.match(PRICING, /const result = h\('div', null, resultLine, resultRest\);/);
  assert.equal(count("const result = h('div', { 'aria-live'"), 0);
});

test('PRC-L: tableOf( and skipped( are only passed to resultRest, never to resultLine', () => {
  const calls = PRICING.match(/result(?:Line|Rest)\.(?:replaceChildren|append)\([\s\S]*?\n\s{6,8}\S*?\);?\n/g) || [];
  assert.ok(PRICING.includes('resultRest.replaceChildren('));
  for (const m of PRICING.matchAll(/resultLine\.(?:replaceChildren|append)\(([\s\S]*?)\);\n/g)) {
    assert.ok(!/tableOf\(|skipped\(/.test(m[1]), 'resultLine holds no table or skipped list');
  }
  assert.ok(calls.length >= 0);
});

test('PRC-L: stale empties both boxes', () => {
  assert.match(PRICING, /const stale = \(\) => \{ applyBtn\.disabled = true; resultLine\.replaceChildren\(\); resultRest\.replaceChildren\(\); \};/);
});

test('PRC-L: the preview sentences are unchanged', () => {
  for (const s of ["would change.", "None of these nights would change.", "would be ${actSel.value === 'block' ? 'created' : 'cancelled'}.", " Showing the first ${rows.length}.", "Nothing to change for these choices.", "will be below their listing's lowest price. Those prices will be used as set."]) {
    assert.ok(PRICING.includes(s), s);
  }
});

test('PRC-L: the "Nothing to change" line is added to the live summary line', () => {
  assert.match(PRICING, /resultLine\.append\(h\('p', \{ class: 'muted small' \}, 'Nothing to change for these choices\.'\)\)/);
});
