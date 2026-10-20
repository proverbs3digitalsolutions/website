'use strict';

// QA r24 CLEANERPAY (OPS-1): Add rate says the ceiling and the zero amount on the first Save, with the other messages. Frontend-only: source scan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/cleanerpay.js'), 'utf8');
const form = src.slice(src.indexOf('const form = makeForm({'), src.indexOf('modal = openModal({ title: r ?'));

test('Add rate form: the ceiling runs in the form pass (check hook)', () => {
  assert.match(form, /check:\s*\(d\)\s*=>[\s\S]*rateCeilingProblem\(d\.rate_type, d\.amount\)[\s\S]*amount:\s*over/);
});

test('Add rate form: the amount field refuses zero on the device', () => {
  assert.match(form, /name:\s*'amount',[^\n]*type:\s*'money',[^\n]*positive:\s*true/);
});

test('the onSubmit throw stays as a safety net', () => {
  assert.match(form, /onSubmit:[\s\S]*rateCeilingProblem/);
});
