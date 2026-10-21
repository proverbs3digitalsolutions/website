'use strict';
require('./helpers');

// D-116: every file box is named by its own visible label; this closes the label class (ledger 3x, rounds 32 to 34).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/r2_34_pins node --test --test-concurrency=1 test/qa-r34-filelabels.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public', 'js');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

// The argument object of each h('input', { ... }) call, from its opening brace to the matching close brace.
function inputCalls(src) {
  const calls = [];
  const opener = /h\('input',\s*\{/g;
  let m;
  while ((m = opener.exec(src))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < src.length; close++) {
      if (src[close] === '{') depth++;
      else if (src[close] === '}' && --depth === 0) break;
    }
    calls.push({ at: m.index, body: src.slice(open, close + 1) });
  }
  return calls;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const inputs = walk(ROOT).flatMap((file) => {
  // Full-line comments go; line breaks stay so the reported line numbers still match the file.
  const src = fs.readFileSync(file, 'utf8').replace(/^[ \t]*\/\/.*$/gm, '');
  return inputCalls(src)
    .filter((call) => /\btype:\s*'file'/.test(call.body))
    .map((call) => ({ file: path.relative(ROOT, file), line: src.slice(0, call.at).split('\n').length, src, body: call.body }));
});

test('the scan finds all 14 file boxes under public/js', () => {
  assert.equal(inputs.length, 14, `found ${inputs.length}: ${inputs.map((i) => `${i.file}:${i.line}`).join(', ')}`);
});

for (const input of inputs) {
  test(`${input.file}:${input.line} file box has an id, no aria-label, and a visible label linked by that id`, () => {
    // The visible name is the linked label alone (D-116): an aria-label on the box would override it.
    assert.doesNotMatch(input.body, /aria-label['"]?\s*:/);

    const id = input.body.match(/\bid:\s*('([^']+)'|`([^`]+)`)/);
    assert.ok(id, 'the file box has an id');

    if (id[2] !== undefined) {
      // A plain id: some label in the same file says for: that id.
      assert.match(input.src, new RegExp(`\\bfor:\\s*'${escapeRe(id[2])}'`));
      return;
    }

    // A template id (one box per row or per dialog): the label names the same template, or it takes the box's own id.
    // housekeeping.js photoField() links its box with for: input.id, which is the same element, so that link counts.
    const template = id[3];
    const literal = new RegExp(`\\bfor:\\s*\`${escapeRe(template)}\``);
    if (!literal.test(input.src)) {
      assert.match(input.src, /\bfor:\s*\w+\.id\b/, `no label links the template id ${template}`);
    }
  });
}
