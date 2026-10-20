'use strict';
// Round 23 CHARGES (BKG-3): the Void dialog names the charge the way the list shows it (description, with the category when it differs).
// node --test --test-concurrency=1 test/qa-r23-charges.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/charges.js'), 'utf8');
const m = src.match(/export function voidText[\s\S]*?\n}\n/);
const label = (c) => ({ early_checkin: 'Early check-in', other: 'Other' }[c] || c);
const peso = (n) => `₱${Number(n).toFixed(2)}`;
const voidText = m ? new Function('label', 'peso', `${m[0].replace('export ', '')}\nreturn voidText;`)(label, peso) : null;
const TAIL = 'The line stays on record, but the total and balance go down.';

test('voidText exists', () => assert.ok(voidText, 'export function voidText not found'));

test('a described charge shows description and category', () => {
  assert.equal(voidText({ description: 'QA r23 dup charge', category: 'early_checkin', amount: 250 }),
    `QA r23 dup charge (Early check-in): ₱250.00. ${TAIL}`);
});

test('a description equal to the category label shows it once', () => {
  assert.equal(voidText({ description: 'Early check-in', category: 'early_checkin', amount: 250 }),
    `Early check-in: ₱250.00. ${TAIL}`);
});

test('no description falls back to the category label', () => {
  assert.equal(voidText({ description: null, category: 'early_checkin', amount: 250 }),
    `Early check-in: ₱250.00. ${TAIL}`);
});

test('the dialog uses voidText', () => assert.match(src, /text: voidText\(c\)/));
