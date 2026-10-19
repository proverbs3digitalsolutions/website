'use strict';

// QA r18 OPS: status buttons and Reopen day must not disable the focused button (focus would drop to BODY); aria-busy + a flag instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');

for (const [file, re] of [['maintenance.js', /statusButtons[\s\S]*?\}, s === 'resolved'/], ['dailyclose.js', /const reopen = async[\s\S]*?\n  \};/]]) {
  test(`${file}: pressed button is never disabled`, () => {
    const block = read(file).match(re)[0];
    assert.ok(!/\.disabled = true/.test(block), 'no disabled = true');
    assert.ok(block.includes("setAttribute('aria-busy', 'true')"));
    assert.ok(/const btn = e\.currentTarget/.test(block), 'target captured before any await');
  });
}
