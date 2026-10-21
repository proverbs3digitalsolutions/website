'use strict';
require('./helpers');

// QA round 34, lane RENTFILE (public/js/views/rent.js). Frontend only, source scan.
// D-116: each receipt box has a visible <label for> naming it, and no aria-label.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'rent.js'), 'utf8');
const body = (name) => {
  const start = src.search(new RegExp(`function ${name}\\b`));
  assert.ok(start >= 0, name);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return src.slice(start, next < 0 ? undefined : start + 1 + next);
};

for (const [fn, id] of [['paymentDetailView', 'payment-file'], ['expenseDetailView', 'expense-file']]) {
  test(`${fn}: file box has a visible linked label and no aria-label`, () => {
    const b = body(fn);
    assert.ok(b.includes(`id: '${id}'`), 'input id');
    assert.ok(!/'aria-label': 'Choose a receipt or proof file'/.test(b), 'no aria-label on the box');
    assert.ok(b.includes(`h('label', { for: '${id}' }, 'Choose a receipt or proof file')`), 'visible label');
  });
}
