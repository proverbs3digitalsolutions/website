// QA round 29 MNY-1: discount code, both boxes filled. A percent with its own problem keeps its box; "not both" moves to the amount box.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/guestcare.js'), 'utf8');
const m = src.match(/export function discountCodeProblems[\s\S]*?\n}\n/);
const check = new Function('parseAmount', `${m[0].replace('export ', '')}; return discountCodeProblems;`)((t) => Number(String(t).replace(/[,₱\s]/g, '')));
const NOT_BOTH = 'Choose one: a percent off or an amount off, not both.';

for (const bad of ['150', '2.5', '0']) {
  test(`percent ${bad} with an amount: not-both goes on the amount box`, () => {
    const p = check({ code: 'QA-R29-BAD', percent_off: bad, amount_off: '100' });
    assert.equal(p.amount_off, NOT_BOTH);
    assert.equal(p.percent_off, undefined);
  });
}

test('valid percent with an amount keeps not-both on percent', () => {
  const p = check({ code: 'QA-R29-OK', percent_off: '10', amount_off: '50' });
  assert.equal(p.percent_off, NOT_BOTH);
  assert.equal(p.amount_off, undefined);
});

test('percent 150 alone is left to the box range rule', () => {
  assert.equal(check({ code: 'QA-R29-ONE', percent_off: '150', amount_off: '' }), null);
});
