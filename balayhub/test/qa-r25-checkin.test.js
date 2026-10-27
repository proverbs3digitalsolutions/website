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

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor; // the block awaits each photo's first-bytes check (D-113)
async function run(d, consentChecked) {
  const row = { classList: { add() {} } };
  const others = { querySelectorAll: () => [] };
  const form = { elements: { consent: { checked: consentChecked }, accept_rules: { checked: true } } };
  return new AsyncFunction('d', 'others', 'form', 'picked', 'r', 'rules', 'rulesAt', 't', 'ID_PHOTO_TYPE', 'EMAIL_RE', 'PHONE_RE', 'fileContentError', 'PHOTO_KINDS',
    `${block}; return problems;`)(d, others, form, [{ type: 'image/png' }], { id_count: 0 }, null, null, (s) => s, /^image\/(jpeg|png|webp)$/, EMAIL_RE, PHONE_RE, async () => null, 'JPG, PNG or WEBP');
}

test('x@y, abc and an empty consent box give all three messages in one submit', async () => {
  const p = await run({ lead_name: 'Ana Cruz', phone: 'abc', email: 'x@y' }, false);
  assert.equal(p.email, 'Enter a valid email address.');
  assert.equal(p.phone, 'Enter a valid phone number.');
  assert.ok(p.consent);
});

test('blank email is fine, good values add no problem', async () => {
  assert.deepEqual(await run({ lead_name: 'Ana Cruz', phone: '0917 123 4567', email: '' }, true), {});
  assert.deepEqual(await run({ lead_name: 'Ana Cruz', phone: '+639171234567', email: 'a@b.co' }, true), {});
});

test('a blank mobile number keeps its own sentence', async () => {
  assert.equal((await run({ lead_name: 'A', phone: ' ', email: '' }, true)).phone, 'Please enter your mobile number.');
});

test('guest limit says place, with Tagalog in this file', () => {
  assert.match(src, /t\('This place allows up to \{n\} guests\.'/);
  assert.doesNotMatch(src, /This unit allows up to/);
  assert.match(src, /'This place allows up to \{n\} guests\.': 'Hanggang \{n\} guests lang ang puwede sa lugar na ito\.'/);
  assert.match(src, /import \{[^}]*\bEMAIL_RE\b[^}]*\bPHONE_RE\b[^}]*\} from '\.\.\/ui\.js'/);
});
