'use strict';

// QA round 4, lane C13 (owners view). Frontend source scan of the owner statements table.
// 1. Every column header in the statements table has a spoken name, including the last one, which holds the Open / Review button (phone#24).
// node --test --test-concurrency=1 test/qa-r4-c13.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'owners.js'), 'utf8');
const between = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const listView = between('export async function ownerStatementsView', 'export async function ownerStatementView');

// The header labels are one array literal: ['Owner', ..., ''].map((x, i) => h('th', ...)).
// Read that literal out and evaluate it with a stub h(), so the check looks at what each header would contain.
function headerLabels() {
  const start = listView.indexOf("h('thead', null, h('tr', null, [");
  assert.notEqual(start, -1, 'statements table header row is missing');
  const open = listView.indexOf('[', start);
  const close = listView.indexOf('].map(', open);
  assert.notEqual(close, -1, 'statements table header array is missing');
  const literal = listView.slice(open, close + 1);
  const h = (tag, attrs, ...kids) => ({ tag, attrs, text: kids.flat().join('') });
  return new Function('h', `return ${literal};`)(h);
}

test('every statements table header has a spoken name (phone#24)', () => {
  const labels = headerLabels();
  assert.equal(labels.length, 6, 'the table has six columns');
  labels.forEach((label, i) => {
    const text = typeof label === 'string' ? label : label.text;
    assert.ok(text.trim().length > 0, `header ${i + 1} is empty`);
  });
});

test('the last statements column is named for screen readers as Actions (phone#24)', () => {
  const last = headerLabels()[5];
  assert.equal(typeof last, 'object', 'the last header is a node, not a bare empty string');
  assert.equal(last.tag, 'span');
  assert.deepEqual(last.attrs, { class: 'sr-only' });
  assert.equal(last.text, 'Actions');
});
