'use strict';

// QA r22 FORMS-CORE: makeForm marks a bad email in the same pass as a missing required field. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r22fc-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

const formOf = (...emails) => ({ querySelectorAll: () => emails.map(([name, value]) => ({ name, value })) });

test('a blank required fee does not hide a bad email', () => {
  const missing = { fee: 'Fee is required.' };
  assert.deepEqual(ui.emailProblems(formOf(['email', 'not-an-email']), missing), { email: 'Enter a valid email address.' });
});

test('an empty optional email, a good one and one already flagged are left alone', () => {
  assert.deepEqual(ui.emailProblems(formOf(['a', ''], ['b', ' x@y.ph '], ['c', 'bad']), { c: 'Email is required.' }), {});
});

test('makeForm runs the email check in its submit pass, before the view check', () => {
  const src = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
  const i = src.indexOf('emailProblems(form, missing)');
  assert.ok(i > 0 && i < src.indexOf('check?.(readForm(form), form)'));
  assert.ok(ui.EMAIL_RE.test('a@b.co') && !ui.EMAIL_RE.test('a@b'));
});
