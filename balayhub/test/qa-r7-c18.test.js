'use strict';

// QA round 7, lane C18 (reviews view).
// - #36: the empty Reviews page told everyone to turn on the "thank-you the day after check-out" automation in
//   Inbox settings. Only owners can edit automations (src/routes/inbox.js uses owners() on PATCH), so owners keep
//   the hint and managers and staff read "Reviews from your guests show here."
// Frontend-only: source scan of guestcare.js (no database).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/guestcare.js'), 'utf8');
const HINT = 'Your thank-you message after check-out includes a private link where guests rate their stay. Turn on the "thank-you the day after check-out" automation in Inbox settings.';
const SHORT = 'Reviews from your guests show here.';

test('#36 the Inbox settings hint on an empty Reviews page is shown to owners only', () => {
  const lines = src.split('\n').filter((l) => l.includes(HINT));
  assert.equal(lines.length, 1, 'the hint text appears once');
  const before = lines[0].slice(0, lines[0].indexOf(HINT));
  assert.match(before, /state\.user\.role === 'owner' \? '$/, 'the hint is the owner branch of a role check');
});

test('#36 managers and staff read the short line on an empty Reviews page', () => {
  const m = src.match(/text: state\.user\.role === 'owner' \? '([^']*)' : '([^']*)'/);
  assert.ok(m, 'the empty-state text is a role check');
  assert.equal(m[1], HINT, 'the owner branch keeps the full hint');
  assert.equal(m[2], SHORT, 'the other roles read the short line');
});

test('#36 the empty Reviews page keeps its title and the no-results branch', () => {
  assert.match(src, /title: 'No reviews yet'/);
  assert.match(src, /title: 'No results found'/);
});
