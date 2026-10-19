'use strict';

// Card on file, lane F3: the platform admin Card column, "Waiting for card" filter and "Skip card check" button.
// The view imports the app shell (not loadable in Node), so this scans the source and runs the pure helpers read out of it.
// node --test --test-concurrency=1 test/qa-r17-cardcheck-admin-view.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'admin.js'), 'utf8');
function helpers() {
  const a = src.indexOf('// ---- helpers');
  const b = src.indexOf('// ---- end helpers');
  assert.ok(a !== -1 && b > a, 'helpers block is missing');
  return new Function(`${src.slice(a, b).replace(/export /g, '')}\nreturn { cardText, skipCardText };`)();
}

test('Card column values for the four states', () => {
  const { cardText } = helpers();
  assert.equal(cardText({ card_check: null }), '—');
  assert.equal(cardText({}), '—');
  assert.equal(cardText({ card_check: 'required' }), 'Waiting');
  assert.equal(cardText({ card_check: 'passed', card_brand: 'visa', card_last4: '4242' }), 'Visa 4242');
  assert.equal(cardText({ card_check: 'waived' }), 'Skipped');
  assert.equal(cardText({ card_check: 'passed', card_brand: null, card_last4: null }), 'Removed');
  assert.equal(cardText({ card_check: 'passed', card_brand: '', card_last4: '' }), 'Removed');
  assert.equal(cardText({ card_check: 'passed', card_last4: '4242' }), 'Card 4242');
});

test('a workspace waiting for its card shows a warning badge, not Payment due', () => {
  const a = src.indexOf("badge('partial', 'Waiting for card')");
  const b = src.indexOf("'Payment due'");
  assert.ok(a !== -1 && a < b, 'Waiting for card badge must be checked before the read_only fallthrough');
  assert.match(src, /admin_status === 'card_pending' \|\| s\.reason === 'card_check'/);
});

test('confirm text, buttons, toast and POST body follow the copy', () => {
  const { skipCardText } = helpers();
  assert.equal(skipCardText('Casa Lumen'), 'Skip the card check for Casa Lumen? Their 14-day trial starts now.');
  assert.match(src, /confirmText: 'Skip card check', cancelText: 'Cancel'/);
  assert.match(src, /post\(`\/admin\/workspaces\/\$\{w\.organization_id\}\/card-check`, \{ action: 'waive' \}\)/);
  assert.match(src, /toast\('Card check skipped\. The trial has started\.'\)/);
});

test('button only when Waiting; filter option and column header exist', () => {
  assert.match(src, /w\.card_check === 'required' \? \[[\s\S]*?'Skip card check'\)/);
  assert.match(src, /\['card_pending', 'Waiting for card'\]/);
  assert.match(src, /'Plan', 'Card', 'Paid until'/);
  assert.match(src, /colspan: 8/);
});
