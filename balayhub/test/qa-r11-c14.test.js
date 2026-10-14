'use strict';

// QA round 11, C14 "auth-verify": "I've verified — continue" says so when the email is still not verified (#27),
// and the Check your email and verification pages go through t() with Taglish wording, so a Tagalog choice carries
// through (#29). Static checks on the source, plus the Taglish dictionary run through a temp copy of i18n.js with
// minimal DOM stubs (a browser module, no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const pub = path.join(__dirname, '..', 'public', 'js');
const auth = fs.readFileSync(path.join(pub, 'views', 'auth.js'), 'utf8');
// The two verification screens: from verifyView to the workspace setup section.
const verifySection = auth.slice(auth.indexOf('// ---------------------------------------------------------------- email verification'),
  auth.indexOf('// ---------------------------------------------------------------- workspace setup'));
const pendingView = auth.slice(auth.indexOf('export async function verifyPendingView'), auth.indexOf('// ---------------------------------------------------------------- workspace setup'));

// Every English string the two verification screens show (the server's own error text is out of scope).
const SCREEN_TEXT = [
  'Verifying your email…',
  "Couldn't verify",
  'This verification link is missing or incomplete. Log in to request a new one.',
  'Request a new link',
  'Email verified.',
  'Email verified',
  'You can now log in.',
  'Log in',
  'Check your email',
  'We sent a verification link to {email}. Open it on this device to continue setting up BalayHub.',
  "Your account was created, but we couldn't send the verification email. The BalayHub administrator needs to check the server's email settings. Try “Resend” once that's fixed.",
  'Verify my email',
  'Resend verification email',
  'A new verification email is on its way.',
  "I've verified — continue",
  'Not verified yet. Open the link we sent to {email}, then press this again.',
  'Use a different account',
];

// Each string is passed to t() as a literal, in single or double quotes.
const wrapped = (src, s) => src.includes(`t('${s}'`) || src.includes(`t("${s}"`);

test('#29 every string on the two verification screens goes through t()', () => {
  for (const s of SCREEN_TEXT) assert.ok(wrapped(verifySection, s), `not wrapped in t(): ${s}`);
});

test('#29 the verification screens read the stored language on open, so a Tagalog choice from the landing page carries', () => {
  assert.match(auth, /import \{[^}]*\binitGuestLang\b[^}]*\} from '\.\.\/i18n\.js';/);
  assert.match(verifySection, /async function verifyView\(el, \{ query \}\) \{\s*initGuestLang\(\);/);
  assert.match(pendingView, /async function verifyPendingView\(el\) \{\s*initGuestLang\(\);/);
});

// The Taglish dictionary is the object passed to extendTranslations in auth.js, loaded the same way as qa-r10-c05.
let i18n; let dir; let dict;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c14-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(pub, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  globalThis.localStorage = { getItem: () => 'tl', setItem() { }, removeItem() { } };
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
  const body = /extendTranslations\(\{([\s\S]*?)\}\);/.exec(auth);
  dict = body ? new Function(`return {${body[1]}};`)() : {};
});
test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete globalThis.Element; delete globalThis.document; delete globalThis.localStorage;
});

test('#29 auth.js adds a Taglish entry for every verification string', () => {
  for (const s of SCREEN_TEXT) {
    assert.ok(Object.prototype.hasOwnProperty.call(dict, s), `no Taglish entry for: ${s}`);
    assert.ok(String(dict[s]).trim() && dict[s] !== s, `Taglish entry is empty or still English: ${s}`);
  }
});

test('#29 with Tagalog chosen, the verification screens show Taglish; the email fills in', () => {
  i18n.extendTranslations(dict);
  i18n.initGuestLang();
  assert.equal(i18n.guestLang(), 'tl');
  assert.equal(i18n.t('Check your email'), dict['Check your email']);
  assert.notEqual(i18n.t("I've verified — continue"), "I've verified — continue");
  const note = i18n.t('Not verified yet. Open the link we sent to {email}, then press this again.', { email: 'ana@example.ph' });
  assert.match(note, /ana@example\.ph/);
  assert.doesNotMatch(note, /\{email\}/);
});

test('#27 "I\'ve verified — continue" reads the account again, and shows a note while the email is still not verified', () => {
  // The button's handler and label, from the button's props to its label.
  const button = pendingView.slice(pendingView.indexOf("class: 'btn btn--ghost btn--block', onclick:"), pendingView.indexOf("I've verified — continue"));
  assert.ok(button.includes('await refreshUser()'), 'the handler re-reads the account first');
  const email = pendingView.indexOf('const email = state.user.email');
  assert.ok(email > 0, 'the email is taken when the page opens, not read again after the account is re-read');
  // Still unverified: the page stays and says why. Verified: the person moves on.
  assert.match(button, /if \(!state\.user \|\| state\.user\.email_verified \|\| !state\.requireEmailVerification\) \{\s*afterLogin\(\);\s*return;\s*\}/);
  assert.match(button, /status\.replaceChildren\(h\('div', \{ class: 'alert alert--warn'/);
  assert.match(pendingView, /const status = h\('div', \{ role: 'status' \}\)/);
  assert.match(pendingView, /t\('Not verified yet\. Open the link we sent to \{email\}, then press this again\.', \{ email \}\)/);
});
