'use strict';

// QA round 6, lane C16 "signup-and-landing": four guest and sign-up screen fixes.
// #31: the language switch's accessible name carries its visible EN/TL label (WCAG 2.5.3).
// #32: Get started step 3 keeps the password and the Terms tick when Back then Continue is used; the password
//      stays in memory only and is never written to storage.
// #33: a sign-up error that carries field messages shows them at the fields, and the banner only points at them.
// #36: the Taglish option for short-term stays is translated.
// Static checks on the source, since these are browser views with no server logic (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landing = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'landing.js'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'auth.js'), 'utf8');

// The language menu: from its function to the next section heading.
const langStart = landing.indexOf('function langMenu');
const langMenu = landing.slice(langStart, landing.indexOf('// ----', langStart + 10));
// Get started step 3: from the step-3 branch to the end of the sheet's draw function.
const step3Start = landing.indexOf('} else {\n      const submit = h(');
const step3 = landing.slice(step3Start, landing.indexOf('box.querySelector(\'input:not([type=checkbox]), .gs-card\')', step3Start));
// The sign-up error handler inside step 3: from its catch to the end of the submit handler.
const catchStart = step3.indexOf('} catch (err) {');
const signupCatch = step3.slice(catchStart, step3.indexOf('submit.disabled = false;', catchStart));

test('#31 language switch: its accessible name is "Language: EN" or "Wika: TL", built from the visible label', () => {
  assert.match(langMenu, /'aria-label': `\$\{t\('Language'\)\}: \$\{label\}`/, 'the name is the translated word plus the same label the summary shows');
  assert.doesNotMatch(langMenu, /'aria-label': t\('Language'\)/, 'the bare word "Language" is no longer the whole name');
  assert.ok(landing.includes("'Language': 'Wika'"), 'the Taglish word for the name is registered');
});

test('#32 Get started step 3: the password box is redrawn from the typed answer', () => {
  assert.ok(step3Start > 0, 'step 3 branch is found');
  assert.match(step3, /id: 'gs-password'[^\n]*value: data\.password \|\| ''/, 'the password field starts from the in-memory answer');
});

test('#32 Get started step 3: the Terms tick is redrawn from the typed answer', () => {
  assert.match(step3, /type: 'checkbox', name: 'accept_privacy', checked: data\.accept_privacy/, 'the checkbox starts from the in-memory answer');
});

test('#32 Get started step 3: the email box is still redrawn from the typed answer', () => {
  assert.match(landing, /value: data\[name\] \|\| ''/, 'the input() helper reads each value from the answers');
});

test('#32 the password never reaches localStorage or sessionStorage (bh-setup holds only the workspace answers)', () => {
  const storageLines = landing.split('\n').filter((l) => /(local|session)Storage/.test(l));
  assert.ok(storageLines.length >= 3, 'the storage writes are found');
  for (const line of storageLines) assert.doesNotMatch(line, /password/i, `no password in: ${line.trim()}`);
  assert.doesNotMatch(auth, /(local|session)Storage[^\n]*password/i, 'auth.js writes no password either');
});

test('#33 landing sign-up: a field message is not repeated in the banner; the banner only points at the fields', () => {
  assert.ok(catchStart > 0, 'the sign-up catch is found');
  assert.match(signupCatch, /if \(Object\.keys\(fields\)\.length\) message = t\('Please check the highlighted fields\.'\);\s*else if \(err instanceof ApiError && err\.code !== 'VALIDATION'\) message = err\.message;/,
    'the server message is shown in the banner only when no field carries a message');
  assert.match(signupCatch, /showErrors\(fields\);/, 'the field messages still show at their fields');
});

test('#33 auth.js sign-up: a field message is not repeated in the banner (the summary is the pointer)', () => {
  assert.match(auth, /if \(Object\.keys\(err\.fields \|\| \{\}\)\.length\) err\.summary \|\|= 'Please check the highlighted fields\.';/,
    'the form uses the pointer as its banner text when the error has field messages');
  assert.match(auth, /err\.summary \|\|= 'Please check the highlighted fields\.';\s*throw err;/, 'the error is rethrown to makeForm with that summary');
});

test('#33 sign-up with an email that has an account: the email field reads the log-in and reset guidance', () => {
  // The server sends code EMAIL_TAKEN (src/routes/auth.js) with fields.email; the screen swaps in the guidance at that field.
  assert.match(signupCatch, /if \(err\.code === 'EMAIL_TAKEN'\) fields\.email = t\('This email is already registered\. Log in or reset your password instead\.'\);/,
    'the landing sheet swaps in the guidance for the taken-email code');
  assert.ok(landing.includes("'This email is already registered. Log in or reset your password instead.': 'Nakarehistro na ang email na ito. Mag-log in o i-reset ang password mo.'"),
    'the Taglish wording is registered');
  assert.match(auth, /if \(err\.code === 'EMAIL_TAKEN'\) err\.fields = \{ \.\.\.err\.fields, email: 'This email is already registered\. Log in or reset your password instead\.' \};/,
    'auth.js swaps in the same guidance at the email field');
});

test('#33 the Log in link stays on both sign-up screens, beside the guidance', () => {
  assert.match(step3, /t\('Already have an account\? '\), h\('a', \{ href: '#\/login', onclick: \(\) => m\.close\(\) \}, t\('Log in'\)\)/, 'landing sheet keeps its Log in link');
  assert.match(auth, /'Already have an account\? ', h\('a', \{ href: '#\/login' \}, 'Log in'\)/, 'sign-up page keeps its Log in link');
});

test('#36 Taglish: the short-term option reads "Panandaliang stays (Airbnb, staycation)", not the English words', () => {
  assert.ok(landing.includes("'Short-term stays (Airbnb, staycations)': 'Panandaliang stays (Airbnb, staycation)'"));
  assert.doesNotMatch(landing, /'Short-term stays \(Airbnb, staycations\)': 'Short-term stays/);
});

test('the Get started and setup pages do not use window.alert, confirm or prompt', () => {
  for (const src of [landing, auth]) assert.doesNotMatch(src, /window\.(alert|confirm|prompt)\(/);
});
