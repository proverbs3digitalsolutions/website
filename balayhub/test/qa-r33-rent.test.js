'use strict';
require('./helpers');

// QA round 33, lane RENT (public/js/views/rent.js). Frontend source scan, no database.
// The Void payment and Void expense dialogs run their request inside the dialog (contract C1, D-115),
// so a refusal is said there and the typed reason stays.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'rent.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

for (const [name, title, url, toastText] of [
  ['payment', 'Void this payment?', '/payments/${p.payment_id}/void', 'Payment voided.'],
  ['expense', 'Void this expense?', '/expenses/${x.expense_id}/void', 'Expense voided.'],
]) {
  test(`void ${name} posts inside the dialog and keeps nothing after it`, () => {
    const i = src.indexOf(title);
    assert.ok(i > 0, 'dialog found');
    const end = src.indexOf('}, ', i);
    const block = src.slice(i, end);
    assert.match(block, /reason: true/);
    assert.ok(block.includes('onConfirm: (why) => post(`' + url + '`, { reason: why })'), 'onConfirm posts the void');
    const after = block.slice(block.indexOf('if (!reason) return;'));
    assert.ok(block.includes('if (!reason) return;'));
    assert.ok(!/post\(/.test(after), 'no post after the dialog closes');
    assert.ok(after.includes(`toast('${toastText}')`));
  });
}
