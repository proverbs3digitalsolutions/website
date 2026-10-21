'use strict';
require('./helpers');

// Card on file, round 41 lane WAIVEVIEW (D-123): the platform admin's "Skip card check" is replaced by its reason while a
// deletion is scheduled. The view imports the app shell (not loadable in Node), so this runs the helpers block read out of
// the source and scans the panel's branch.
// node --test --test-concurrency=1 test/qa-r41-waiveview.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'admin.js'), 'utf8');
function helpers() {
  const a = src.indexOf('// ---- helpers');
  const b = src.indexOf('// ---- end helpers');
  assert.ok(a !== -1 && b > a, 'helpers block is missing');
  return new Function(`${src.slice(a, b).replace(/export /g, '')}\nreturn { canSkipCard, SKIP_CARD_DELETING };`)();
}

test('canSkipCard: only a workspace waiting for its card with no deletion scheduled', () => {
  const { canSkipCard } = helpers();
  assert.equal(canSkipCard({ card_check: 'required' }), true);
  assert.equal(canSkipCard({ card_check: 'required', deletion_scheduled_at: null }), true);
  assert.equal(canSkipCard({ card_check: 'required', deletion_scheduled_at: '2026-11-04T00:00:00Z' }), false);
  assert.equal(canSkipCard({ card_check: 'passed', deletion_scheduled_at: null }), false);
  assert.equal(canSkipCard({ card_check: 'waived' }), false);
  assert.equal(canSkipCard({}), false);
});

test('SKIP_CARD_DELETING is the sentence the panel and the server both give', () => {
  const { SKIP_CARD_DELETING } = helpers();
  assert.equal(SKIP_CARD_DELETING, 'This workspace is scheduled for deletion, so the card check can\'t be skipped. Cancel the deletion first.');
});

test('the panel draws the button only under canSkipCard, the reason in its place, inside the Waiting branch', () => {
  const start = src.indexOf("...(w.card_check === 'required' ? [");
  assert.ok(start !== -1, 'the Waiting branch is missing');
  const end = src.indexOf('] : []),', start);
  assert.ok(end > start, 'the Waiting branch does not end where expected');
  const branch = src.slice(start, end);
  assert.match(branch, /'Waiting for the owner to save a card\. The trial has not started\.'/);
  assert.match(branch, /canSkipCard\(w\) \? h\('button', \{ type: 'button', class: 'btn btn--secondary', id: 'skip-card-check', onclick: skipCard \}, 'Skip card check'\) : h\('p', \{ class: 'muted small' \}, SKIP_CARD_DELETING\)/);
  assert.equal(src.match(/id: 'skip-card-check'/g).length, 1, 'only one Skip card check button is drawn');
  assert.equal(src.match(/canSkipCard\(w\)/g).length, 1, 'the button is the only place the panel asks canSkipCard');
});
