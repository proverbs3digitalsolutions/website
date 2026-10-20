'use strict';

// QA round 28, lane GROUPS2 (public/js/views/groups.js). Frontend only.
// "Existing guest" with nobody picked: the sentence needs a keyed field box, or showErrors() drops it as unplaced
// and the summary says "check the highlighted fields" with nothing highlighted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'groups.js'), 'utf8');

test('the missing-lead-guest problem is keyed to a real [data-field] box', () => {
  const key = /GUEST_KEY\s*=\s*'([^']+)'/.exec(src)?.[1];
  assert.ok(key, 'GUEST_KEY constant exists');
  assert.match(src, /\{ \[GUEST_KEY\]: 'Search for the lead guest and pick them, or switch to "New guest"\.' \}/);
  assert.doesNotMatch(src, /\{ _guest:/);
  assert.match(src, /dataset: \{ field: GUEST_KEY \}/, 'existing-guest area is the keyed field box');
});

test('the box has a role=alert error element and the search input points at it', () => {
  assert.match(src, /class: 'error', id: `\$\{guestErrId\}`, role: 'alert'/);
  assert.match(src, /'aria-describedby': guestErrId/);
});

test('picking a guest clears the mark through the form change handler', () => {
  assert.match(src, /search\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
});
