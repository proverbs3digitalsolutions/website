'use strict';

// QA round 7, lane C17 (stay reports view). Frontend source scans: the view imports app.js, which can't load in Node.
// - #34: the average stay line says what it counts (whole stays, check-ins in this period).
// - #35: a shared link whose range ends before it starts keeps its dates on screen with the message, and this month is shown.
// - K9: the By listing cleaning column says the cleaning part is already inside Revenue.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/stayreports.js'), 'utf8');

test('#34: the average stay line says it counts whole stays, with check-ins in the period', () => {
  assert.match(src, /Average stay \$\{t\.avg_stay\} nights \(whole stays, check-ins in this period\)/);
  assert.doesNotMatch(src, /Average stay \$\{t\.avg_stay\} nights\$\{/);
});

test('#35: a link range that ends before it starts is read from the link, not dropped', () => {
  assert.match(src, /isDay\(query\.from\) && isDay\(query\.to\) && query\.to < query\.from/);
  assert.match(src, /filters\.from = query\.from; filters\.to = query\.to;/);
});

test('#35: a backwards range shows the server\'s sentence and is never sent to the server', () => {
  assert.match(src, /The end date must be after the start date\. Showing this month for now\./);
  assert.match(src, /&& !backwards\) periodQ = \{ from: filters\.from, to: filters\.to \}/);
});

test('K9: the By listing cleaning column reads "Of which cleaning & extras"', () => {
  assert.match(src, /'Of which cleaning & extras'/);
  assert.doesNotMatch(src, /'Cleaning & extras'/);
});
