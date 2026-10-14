'use strict';

// QA round 6, C13 supplies cap (#21). A quantity above the server's cap (100000) is refused at the
// quantity field before the not-enough-on-hand question, for every kind of stock move. Frontend-only:
// no database.
// node --test --test-concurrency=1 test/qa-r6-c13.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const supplies = fs.readFileSync(path.join(ROOT, 'public/js/views/supplies.js'), 'utf8');
const serverRoute = fs.readFileSync(path.join(ROOT, 'src/routes/supplies.js'), 'utf8');

test('the view uses the same cap as the server', () => {
  assert.match(serverRoute, /const MAX_QTY = 100000;/, 'the server cap is 100000');
  assert.match(supplies, /const MAX_QTY = 100000;/, 'the view names the same cap');
});

test('a quantity above the cap is refused at the field before the not-enough-on-hand question, and nothing is sent', () => {
  const whole = supplies.indexOf('Number.isInteger(quantity)');
  const cap = supplies.indexOf('quantity > MAX_QTY');
  const ask = supplies.indexOf("title: 'Not enough on hand'");
  const send = supplies.indexOf('/movements`');
  assert.ok(whole > 0, 'the whole-number check is there');
  assert.ok(cap > whole, 'the cap check comes after the whole-number check');
  assert.ok(ask > cap, 'the cap check comes before the question, so a huge number never gets asked about');
  assert.ok(send > cap, 'the movement is sent only after the cap check');
  assert.match(supplies, /Quantity must be at most \$\{MAX_QTY\}\./, 'the message matches the server wording');
  assert.match(supplies.slice(cap, ask), /showErrors\(form, \{ quantity: `Quantity must be at most \$\{MAX_QTY\}\.` \}\);/,
    'the message shows at the quantity field and returns before the question');
  assert.match(supplies.slice(cap, ask), /return;/, 'the save stops at the cap check');
});
