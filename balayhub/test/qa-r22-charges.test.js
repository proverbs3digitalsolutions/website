'use strict';
// Round 22 CHARGES (BKG-2): two charges with the same description get different Void labels, and every Void button has a per-charge focus key.
// node --test --test-concurrency=1 test/qa-r22-charges.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/charges.js'), 'utf8');
const m = src.match(/export function voidLabel[\s\S]*?\n}\n/);
const voidLabel = m ? new Function(`${m[0].replace('export ', '')}\nreturn voidLabel;`)() : null;

test('voidLabel exists', () => assert.ok(voidLabel, 'export function voidLabel not found'));

test('unique description keeps the plain label', () => {
  const list = [{ description: 'Late check-out' }, { description: 'Damage' }];
  assert.equal(voidLabel(list, list[0]), 'Void Late check-out');
});

test('same descriptions are numbered in list order, voided rows counted, so the place never shifts', () => {
  const a = { charge_id: 'a', description: 'Extra towel' };
  const b = { charge_id: 'b', description: 'Extra towel' };
  const list = [a, b];
  assert.equal(voidLabel(list, a), 'Void Extra towel (1 of 2)');
  assert.equal(voidLabel(list, b), 'Void Extra towel (2 of 2)');
  a.voided_at = '2026-10-20T00:00:00Z';
  assert.equal(voidLabel(list, b), 'Void Extra towel (2 of 2)');
});

test('the Void button uses voidLabel and a per-charge focus key', () => {
  assert.match(src, /'aria-label': voidLabel\(data\.charges, c\)/);
  assert.match(src, /'data-focus-key': `charge-void-\$\{c\.charge_id\}`/);
});
