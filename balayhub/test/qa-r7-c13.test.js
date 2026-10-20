'use strict';

// QA round 7, lane C13 "landing": when a Get started step shows field messages, focus moves to the first
// field that has one (#42), so keyboard and screen-reader users land on the problem. Step 1 has no field
// messages (its unit buttons go straight on), so only steps 2 and 3 are checked.
// Static checks on the source, since this is a browser view with no server logic (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landing = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'landing.js'), 'utf8');
// The shared error helper inside openGetStarted, used by steps 2 and 3.
const showErrors = landing.slice(landing.indexOf('const showErrors = '), landing.indexOf('const read = '));
// Step 2's submit handler: from its onsubmit to the move to step 3.
const step2Start = landing.indexOf("h('form', { class: 'form', novalidate: true, onsubmit: (e) => {");
const step2 = landing.slice(step2Start, landing.indexOf('step = 3; draw();', step2Start));
// Step 3's submit handler: from its onsubmit to the sign-up request.
const step3Start = landing.indexOf("const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {");
const step3 = landing.slice(step3Start, landing.indexOf("post('/auth/signup'", step3Start));
// Step 3's sign-up error handler: from its catch to the end of the submit handler.
const signupCatch = landing.slice(landing.indexOf('} catch (err) {', step3Start));

test('#42 showErrors: focus moves to the first field that has a message, read in form order', () => {
  assert.ok(showErrors.length > 0, 'showErrors is found');
  assert.match(showErrors, /querySelectorAll\('\[data-field\]'\)/, 'fields are read from their [data-field] wrappers, in form order');
  const written = showErrors.indexOf('f.textContent = msg');
  const focus = showErrors.indexOf('.focus()');
  assert.ok(written > 0, 'the messages are still written');
  assert.ok(focus > written, 'focus is set after the messages are written');
  assert.match(showErrors, /querySelector\('input, select, textarea'\)\?\.focus\(\)/, 'focus goes to the field control, not the message text');
});

test('#42 step 2: a missing name or business name shows its message through showErrors and stays on step 2', () => {
  assert.ok(step2.length > 0, 'step 2 submit handler is found');
  assert.match(step2, /showErrors\(errs\);\s*formError\.replaceChildren\(h\('div', \{ class: 'alert alert--error', role: 'alert' \}, t\('Please check the highlighted fields\.'\)\)\);\s*return;/, 'step 2 shows its messages through showErrors, which focuses the first one, then the summary line');
});

test('#42 step 3: the email, password and Terms checks and the sign-up error all show through showErrors, which focuses the first one', () => {
  assert.ok(step3.length > 0, 'step 3 submit handler is found');
  assert.match(step3, /if \(Object\.keys\(errs\)\.length\) \{\s*showErrors\(errs\);/, 'the checks before the request show their messages through showErrors');
  assert.match(signupCatch, /showErrors\(fields\);/, 'the server error shows its field messages through showErrors');
});
