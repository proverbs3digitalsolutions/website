'use strict';
require('./helpers');

// QA round 34, lane LISTPHOTOS (public/js/views/listings.js). Frontend only: source scan of photosModal.
// The listing photos box is named by a visible linked label, and the first draw puts focus on it, not on x (D-105, D-116).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');
const start = src.indexOf('async function photosModal');
const fn = src.slice(start, src.indexOf('\n}\n', start) + 3).replace(/\/\/.*$/gm, '');

test('the file box has an id and no aria-label', () => {
  // The input's props run over several lines (click guard, busy guard), so read its whole block to the closing "} });".
  const at = fn.indexOf("const input = h('input'");
  assert.ok(at > 0, 'the file input is found');
  const input = fn.slice(at, fn.indexOf('} });', at));
  assert.match(input, /id: 'listing-photos-file'/);
  assert.doesNotMatch(input, /aria-label/);
});

test('a visible label linked by for carries the name', () => {
  assert.match(fn, /h\('label', \{ for: 'listing-photos-file' \}, 'Listing photos'\)/);
});

test('the first draw puts focus on the file box', () => {
  assert.match(fn, /try \{ await draw\(\(root\) => root\.querySelector\('input\[type="file"\]'\)\?\.focus\(\)\); \}/);
});

test('the refusal line and Make cover / Delete focus code are unchanged', () => {
  assert.match(fn, /if \(refusal\) \{ up\.show\(refusal\); refusal = ''; \}/);
  assert.match(fn, /root\.querySelector\('\.ph-item'\)\?\.focus\(\)/);
  assert.match(fn, /button\[aria-label\^="Delete,"\]/);
});
