'use strict';

// QA round 12, C06 "auth-i18n" (K1, K9b). The verify screens and the owner-portal sign-in screen go through t() and
// tServer() with Taglish wording; a failed "I've verified — continue" check says so and keeps the page; a new
// verification email clears the "Not verified yet" note; i18n.useHostLang() takes the host app back to English in
// memory without touching the guest's saved choice. Source scans plus the i18n module loaded from a temp copy with
// minimal DOM stubs (a browser module, no database needed).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const pub = path.join(__dirname, '..', 'public', 'js');
const auth = fs.readFileSync(path.join(pub, 'views', 'auth.js'), 'utf8');
const owner = fs.readFileSync(path.join(pub, 'views', 'ownerportal.js'), 'utf8');
const verifyView = auth.slice(auth.indexOf('export async function verifyView'), auth.indexOf('export async function verifyPendingView'));
const pendingView = auth.slice(auth.indexOf('export async function verifyPendingView'), auth.indexOf('// ---------------------------------------------------------------- workspace setup'));
const devLinkDef = auth.slice(auth.indexOf('const devLink'), auth.indexOf('// ---------------------------------------------------------------- Screen 1'));
const KEY = 'bh-guest-lang';

// New wording on the verify screens and the dev link. Each one is passed to t() or tServer() as a literal.
const NEW_TEXT = [
  "Couldn't check. Check your connection and try again.",
  'Development mode — email is not configured, so here is the link: ',
  'This verification link is invalid or has expired. Log in to request a new one.',
  'Too many attempts. Please wait a few minutes and try again.',
  "We couldn't send the email. The BalayHub administrator needs to check the email settings on the server (docs/EMAIL-SETUP.md).",
  "You're offline or the server can't be reached.",
];

let i18n; let dir; let dict;
const store = new Map();
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c06-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(pub, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
  // The Taglish dictionary is the object passed to extendTranslations in auth.js.
  const body = /extendTranslations\(\{([\s\S]*?)\}\);/.exec(auth);
  dict = body ? new Function(`return {${body[1]}};`)() : {};
});
test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete globalThis.Element; delete globalThis.document; delete globalThis.localStorage;
});

test('K9b useHostLang() goes back to English in memory and keeps the saved guest choice', () => {
  assert.equal(typeof i18n.useHostLang, 'function', 'useHostLang is exported from i18n.js');
  i18n.setGuestLang('tl');
  assert.equal(i18n.guestLang(), 'tl');
  assert.equal(store.get(KEY), 'tl');
  i18n.useHostLang();
  assert.equal(i18n.guestLang(), 'en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(store.get(KEY), 'tl', 'the saved guest choice is not rewritten');
  assert.equal(i18n.t('Check your email'), 'Check your email');
});

test('K1 auth.js imports tServer for the verify screens', () => {
  assert.match(auth, /import \{[^}]*\btServer\b[^}]*\} from '\.\.\/i18n\.js';/);
});

test('K1 the dev-link prefix goes through t(), so the verify and forgot screens read Taglish', () => {
  assert.match(devLinkDef, /t\('Development mode — email is not configured, so here is the link: '\)/);
});

test('K1 server errors on the verify screens go through tServer()', () => {
  assert.match(verifyView, /fail\(tServer\(err\.message\)\);/);
  assert.match(pendingView, /msg\.replaceChildren\(h\('div', \{ class: 'alert alert--error' \}, tServer\(err\.message\)\)\);/);
});

test('K1 auth.js adds a Taglish entry for each new verify-screen string', () => {
  for (const s of NEW_TEXT) {
    assert.ok(Object.prototype.hasOwnProperty.call(dict, s), `no Taglish entry for: ${s}`);
    assert.ok(String(dict[s]).trim() && dict[s] !== s, `Taglish entry is empty or still English: ${s}`);
  }
});

test('K1 with Tagalog chosen, the new verify-screen strings read Taglish', () => {
  i18n.extendTranslations(dict);
  i18n.setGuestLang('tl');
  try {
    assert.notEqual(i18n.t("Couldn't check. Check your connection and try again."), "Couldn't check. Check your connection and try again.");
    assert.notEqual(i18n.tServer("You're offline or the server can't be reached."), "You're offline or the server can't be reached.");
    assert.notEqual(i18n.tServer('Too many attempts. Please wait a few minutes and try again.'), 'Too many attempts. Please wait a few minutes and try again.');
  } finally {
    i18n.setGuestLang('en');
  }
});

test('K1 a failed check on "I\'ve verified — continue" says so at the status line and keeps the page', () => {
  const button = pendingView.slice(pendingView.indexOf("class: 'btn btn--ghost btn--block', onclick:"), pendingView.indexOf("I've verified — continue"));
  assert.match(button, /try \{ await refreshUser\(\); \} catch \{/, 'the re-read is wrapped so a failed read is caught');
  assert.match(button, /catch \{\s*status\.replaceChildren\(h\('div', \{ class: 'alert alert--error'[^]*?t\("Couldn't check\. Check your connection and try again\."\)\)\);\s*return;\s*\}/);
});

test('K1 a new verification email clears the "Not verified yet" note', () => {
  const resend = pendingView.slice(pendingView.indexOf('const resend = h('), pendingView.indexOf("}, t('Resend verification email'));"));
  assert.match(resend, /status\.replaceChildren\(\);\s*msg\.replaceChildren\(h\('div', \{ class: 'alert alert--ok' \}, t\('A new verification email is on its way\.'\)\)/);
  assert.match(pendingView, /const status = h\('div', \{ role: 'status' \}\)/);
});

test('K1 owner-portal sign-in confirmation and expired-link button go through t()', () => {
  assert.match(owner, /import \{ t, useHostLang \} from '\.\.\/i18n\.js';/);
  assert.match(owner, /h\('h1', null, t\('Check your email'\)\)/);
  assert.match(owner, /href: '#\/owner' \}, t\('Request a new link'\)\)/);
  assert.doesNotMatch(owner, /h\('h1', null, 'Check your email'\)/);
});

// ---- Round 12 re-verify: host language on signed-in screens and the owner portal.
const appSrc = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
const renderSrc = appSrc.slice(appSrc.indexOf('export async function render()'));

test('R12 render() resets to the host language for signed-in routes except the verify screens', () => {
  assert.match(renderSrc, /route\.access === SIGNED_IN && route\.view !== authViews\.verifyView && route\.view !== authViews\.verifyPendingView\) i18n\.useHostLang/);
  assert.match(renderSrc, /verifyPendingView/, 'verify-pending is exempted');
  assert.match(renderSrc, /authViews\.verifyView/, 'verify is exempted');
  assert.equal((renderSrc.match(/useHostLang/g) || []).length >= 2, true, 'APP and SIGNED_IN paths both reset');
});

test('R12 owner-portal screens call useHostLang so language and lang attribute are English on every path', () => {
  assert.match(owner, /import \{ t, useHostLang \} from '\.\.\/i18n\.js';/);
  const signIn = owner.slice(owner.indexOf('export async function ownerSignInView'), owner.indexOf('export async function ownerLinkView'));
  const link = owner.slice(owner.indexOf('export async function ownerLinkView'), owner.indexOf('// ---------------------------------------------------------------- home'));
  const screen = owner.slice(owner.indexOf('function portalScreen'), owner.indexOf('async function signOut'));
  for (const [n, s] of [['signin', signIn], ['link', link], ['portalScreen', screen]]) assert.match(s, /useHostLang\(\)/, `${n} resets the language`);
});
