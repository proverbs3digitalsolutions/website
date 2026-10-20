'use strict';

// QA round 25, GST-1 and GST-3: the check-in form reports a bad email and a bad mobile number in the
// same pass as its other problems, and says "place" (not "unit") for the guest limit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/checkin.js'), 'utf8');
const start = src.indexOf('const problems = {};');
const block = src.slice(start, src.indexOf('if (Object.keys(problems).length)', start));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+\d][\d\s()-]{6,19}$/;

function run(d, consentChecked) {
  const row = { classList: { add() {} } };
  const others = { querySelectorAll: () => [] };
  const form = { elements: { consent: { checked: consentChecked }, accept_rules: { checked: true } } };
  return new Function('d', 'others', 'form', 'picked', 'r', 'rules', 'rulesAt', 't', 'ID_PHOTO_TYPE', 'EMAIL_RE', 'PHONE_RE',
    `${block}; return problems;`)(d, others, form, [{ type: 'image/png' }], { id_count: 0 }, null, null, (s) => s, /^image\/(jpeg|png|webp)$/, EMAIL_RE, PHONE_RE);
}

test('x@y, abc and an empty consent box give all three messages in one submit', () => {
  const p = run({ lead_name: 'Ana Cruz', phone: 'abc', email: 'x@y' }, false);
  assert.equal(p.email, 'Enter a valid email address.');
  assert.equal(p.phone, 'Enter a valid phone number.');
  assert.ok(p.consent);
});

test('blank email is fine, good values add no problem', () => {
  assert.deepEqual(run({ lead_name: 'Ana Cruz', phone: '0917 123 4567', email: '' }, true), {});
  assert.deepEqual(run({ lead_name: 'Ana Cruz', phone: '+639171234567', email: 'a@b.co' }, true), {});
});

test('a blank mobile number keeps its own sentence', () => {
  assert.equal(run({ lead_name: 'A', phone: ' ', email: '' }, true).phone, 'Please enter your mobile number.');
});

test('guest limit says place, with Tagalog in this file', () => {
  assert.match(src, /t\('This place allows up to \{n\} guests\.'/);
  assert.doesNotMatch(src, /This unit allows up to/);
  assert.match(src, /'This place allows up to \{n\} guests\.': 'Hanggang \{n\} guests lang ang puwede sa lugar na ito\.'/);
  assert.match(src, /import \{[^}]*\bEMAIL_RE\b[^}]*\bPHONE_RE\b[^}]*\} from '\.\.\/ui\.js'/);
});
