'use strict';
// QA round 16, lane RP (#22): a date-field 400 keeps the last report and marks the date box (frontend only, no database).
// node --test --test-concurrency=1 test/qa-r16-rp.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const reports = read('public/js/views/reports.js');
const stayreports = read('public/js/views/stayreports.js');

const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const dateFieldError = new Function(`${grab(reports, 'dateFieldError')}\nreturn dateFieldError;`)();

test('dateFieldError reads a 400 that names to or from', () => {
  assert.deepEqual(dateFieldError({ status: 400, fields: { to: 'Choose up to two years.' } }), { field: 'to', text: 'Choose up to two years.' });
  assert.deepEqual(dateFieldError({ status: 400, fields: { from: 'Must be before end date' } }), { field: 'from', text: 'Must be before end date' });
});

test('dateFieldError is null for other errors', () => {
  assert.equal(dateFieldError({ status: 500, fields: {} }), null);
  assert.equal(dateFieldError({ status: 400, fields: { property_id: 'Bad' } }), null);
  assert.equal(dateFieldError(new Error('x')), null);
});

test('both views take the field path before the card replacer', () => {
  assert.match(stayreports, /dateFieldError\(err\)/);
  assert.match(reports, /dateFieldError\(err\)/);
  // stayreports: the field branch returns before fail(err) in the performance load
  const at = stayreports.indexOf('const fe = dateFieldError(err);');
  const ret = stayreports.indexOf('return;', at);
  assert.ok(at > 0 && ret > at && ret < stayreports.indexOf('fail(err); return;', at));
});
