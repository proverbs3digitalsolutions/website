// QA r23 RENT: amount boxes that the server refuses at 0 are marked positive, so the device says so on the first save.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/rent.js'), 'utf8');
const line = (needle) => src.split('\n').find((l) => l.includes(needle)) || '';

test('Record payment amount is positive', () => {
  assert.match(line("name: 'amount_paid'"), /positive: true/);
});
test('Add expense amount is positive', () => {
  assert.match(line("name: 'amount', label: 'Amount', type: 'money'"), /positive: true/);
});
test('method check hook (D-92) is still there', () => {
  assert.match(src, /Choose how the money was received\./);
});
