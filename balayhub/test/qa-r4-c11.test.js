'use strict';

// QA round 4, lane C11 (listings-view), finding #10: the "Share link for" label is not tied to its dropdown,
// and the dropdown's spoken name ("Where will you share it?") differs from the words on screen. The fix ties
// the label to the dropdown with for/id and drops the separate aria-label, so the spoken name is the visible text.
// Frontend source scan only: listings.js imports the app shell, which does not load in Node.
// node --test --test-concurrency=1 test/qa-r4-c11.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

// The share-source dropdown is declared on one line.
const srcLine = src.split('\n').find((l) => /const src = h\('select'/.test(l));

test('the share-source dropdown has a fixed id', () => {
  assert.ok(srcLine, 'the share-source select is declared');
  assert.match(srcLine, /\bid: '[a-z-]+'/, 'the select has an id');
});

test('the "Share link for" label is tied to that dropdown with for/id', () => {
  const id = srcLine.match(/\bid: '([a-z-]+)'/)?.[1];
  assert.ok(id, 'the id is readable');
  assert.equal(src.split(`id: '${id}'`).length - 1, 1, 'the id is set once, on the dropdown');
  assert.ok(
    src.includes(`h('label', { for: '${id}' }, 'Share link for')`),
    'the visible label points at the dropdown with for',
  );
});

test('the dropdown has no separate spoken name, so its name is the visible label', () => {
  assert.doesNotMatch(srcLine, /aria-label/);
  assert.equal(src.includes('Where will you share it?'), false);
});
