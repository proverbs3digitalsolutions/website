require('./helpers');
// QA r32 HELP: INB-1 (the screenshot box is named by its visible label) and INB-3 (short message name on the body field).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/help.js'), 'utf8');
const line = (needle) => src.split('\n').find((l) => l.includes(needle)) || '';

test('INB-1: the screenshot input has no aria-label, so its visible label names it', () => {
  const l = line("id: 'support-screenshot'");
  assert.ok(l.includes("name: 'screenshot'"), 'screenshot input found');
  assert.ok(!l.includes('aria-label'), 'no aria-label on the screenshot input');
  assert.ok(l.includes("'aria-describedby': 'support-screenshot-err'") && l.includes('accept:'), 'other attributes stay');
  assert.ok(/h\('label', \{ for: 'support-screenshot' \}, 'Screenshot \(optional\)'\)/.test(src), 'label reads Screenshot (optional)');
});

test('INB-3: the body field gives a short message name', () => {
  assert.ok(/name: 'body', label: 'What happened\?', msgLabel: 'What happened', /.test(src));
});

test('INB-4: the Ask placeholder stays as decided (D-101)', () => {
  assert.ok(src.includes("'e.g. I-connect Airbnb?'"));
});
