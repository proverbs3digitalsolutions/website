'use strict';

// QA round 5, lane C02 "signup-setup": a mobile number that is not a phone number is refused on Get started
// step 2, before the account is made (#48). The workspace setup page can always fix a saved number the server
// refuses: its fallback form has a Mobile number box, sends what is typed there, and shows the server's message
// at that box. Also the Taglish name for Business name (O-j).
// Static checks on the source, since these are browser views with no server logic (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landing = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'landing.js'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'auth.js'), 'utf8');
const validate = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'validate.js'), 'utf8');

// The server's phone rule as written in validate.js, e.g. /^[+\d][\d\s()-]{6,19}$/
const serverPhone = validate.match(/case 'phone':[\s\S]*?!(\/[^\n]+?\/)\.test\(v\)/);
// Get started step 2: from its submit handler to the step change that follows the checks.
const step2Start = landing.indexOf('onsubmit: (e) => {');
const step2 = landing.slice(step2Start, landing.indexOf('step = 3; draw();', step2Start));
// The workspace setup page: from setupView to the end of auth.js.
const setupView = auth.slice(auth.indexOf('export async function setupView'));

test('phone rule: the Get started check uses the server pattern, and the pattern accepts and refuses the right numbers', () => {
  assert.ok(serverPhone, 'validate.js still has the phone rule');
  const literal = serverPhone[1];
  assert.ok(landing.includes(`const PHONE_RE = ${literal};`), 'landing.js copies the same pattern as validate.js');
  const re = new RegExp(literal.slice(1, literal.lastIndexOf('/')));
  for (const ok of ['0917 123 4567', '+63 917 123 4567', '02 8123 4567']) assert.ok(re.test(ok), `accepted: ${ok}`);
  for (const bad of ['abc', '12345', '0917 123 4567 890 1234']) assert.ok(!re.test(bad), `refused: ${bad}`);
});

test('Get started step 2: a mobile number that is not a phone number is refused on the page, before step 3', () => {
  assert.ok(step2Start > 0, 'step 2 submit handler is found');
  assert.match(step2, /data\.phone && !PHONE_RE\.test\(data\.phone\)/, 'a typed number is checked; a blank one is allowed');
  assert.match(step2, /errs\.phone = t\('Enter a valid phone number\.'\)/, 'the message sits at the phone field');
  assert.match(step2, /if \(Object\.keys\(errs\)\.length\) \{ showErrors\(errs\); return; \}/, 'the step does not move on while a check fails');
});

test('Get started step 2: the phone message has Taglish wording registered in landing.js', () => {
  assert.ok(landing.includes("'Enter a valid phone number.': 'Maglagay ng tamang numero ng telepono.'"));
});

test('Taglish step 2: Business name reads "Pangalan ng negosyo", not the English word', () => {
  assert.ok(landing.includes("'Business name': 'Pangalan ng negosyo'"));
  assert.ok(!landing.includes("'Business name': 'Pangalan ng business'"));
  assert.ok(landing.includes("'First name': 'Pangalan'"), 'First name keeps its own word');
});

test('workspace setup: the fallback form has a Mobile number box, filled from the saved answer as a tel field', () => {
  assert.ok(setupView.includes("name: 'phone', label: 'Mobile number'"), 'the form has a phone field');
  assert.match(setupView, /name: 'phone'[\s\S]{0,200}type: 'tel'/, 'it is a tel box');
  assert.match(setupView, /name: 'phone'[\s\S]{0,300}value: saved\?\.phone/, 'it starts from the saved number, so the user can correct it');
});

test('workspace setup: the form sends the number typed in its box, and nothing when the box is blank', () => {
  assert.doesNotMatch(setupView, /phone: saved\?\.phone/, 'the saved number is never re-sent');
  assert.match(setupView, /phone: data\.phone \|\| undefined/, 'the typed number is sent, and a blank box sends nothing');
});

test('workspace setup: nothing is sent until the button is pressed, and the phone box starts from the saved answers (C23, privacy)', () => {
  const posts = setupView.match(/post\('\/workspace'/g) || [];
  assert.equal(posts.length, 1, 'setupView posts to /workspace exactly once');
  const onSubmit = setupView.slice(setupView.indexOf('onSubmit:'));
  assert.ok(onSubmit.includes("post('/workspace'"), 'the one post is inside onSubmit');
  assert.ok(setupView.indexOf("post('/workspace'") > setupView.indexOf('onSubmit:'), 'no post runs before the form is submitted');
  assert.match(setupView, /name: 'phone'[\s\S]{0,300}value: saved\?\.phone/, 'the phone field still starts from the saved answers');
});

test('the Get started and setup pages do not use window.alert, confirm or prompt', () => {
  for (const src of [landing, auth]) assert.doesNotMatch(src, /window\.(alert|confirm|prompt)\(/);
});
