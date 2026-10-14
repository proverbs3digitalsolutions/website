'use strict';

// Taglish for the server's guest-limit refusal (QA round 4, public#27 follow-up, lane C21): the public
// quote and checkout say "This place allows up to N guests.", and tServer must give the same Taglish
// wording book.js uses on its own submit path. Frontend-only: no database.
// i18n.js is loaded from a temp copy of public/js, with the same minimal stubs as qa-r3-i18n.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let i18n; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-i18n-c21-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.document; delete globalThis.Element; });

// Runs fn with the guest language set, then puts it back to English.
const inLang = (lang, fn) => {
  i18n.setGuestLang(lang);
  try { return fn(); } finally { i18n.setGuestLang('en'); }
};

test('the server guest-limit refusal comes back in Taglish with the same number', () => {
  assert.equal(
    inLang('tl', () => i18n.tServer('This place allows up to 4 guests.')),
    'Hanggang 4 guests lang ang puwede sa lugar na ito.');
});

test('the Taglish refusal keeps the number for any guest limit', () => {
  for (const n of [1, 2, 10, 50]) {
    assert.equal(
      inLang('tl', () => i18n.tServer(`This place allows up to ${n} guests.`)),
      `Hanggang ${n} guests lang ang puwede sa lugar na ito.`, `limit ${n}`);
  }
});

test('English guests still see the refusal in English', () => {
  assert.equal(inLang('en', () => i18n.tServer('This place allows up to 4 guests.')), 'This place allows up to 4 guests.');
});

test('the Taglish wording matches the one book.js uses on its own submit path', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');
  const m = src.match(/'This place allows up to \{n\} guests\.': '([^']*)'/);
  assert.ok(m, 'book.js no longer registers the Taglish wording for the guest limit');
  assert.equal(inLang('tl', () => i18n.tServer('This place allows up to 7 guests.')), m[1].replace('{n}', '7'));
});

test('every guest-limit message directbooking.js builds is translated', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/directbooking.js'), 'utf8');
  // The server builds these as template literals, e.g. `This place allows up to ${u.max_guests} guests.`
  const templates = [...src.matchAll(/`(This place allows up to \$\{[^}]+\} guests\.)`/g)].map((x) => x[1]);
  assert.ok(templates.length >= 1, 'no guest-limit message found in directbooking.js');
  for (const tpl of templates) {
    const msg = tpl.replace(/\$\{[^}]+\}/, '6');
    const out = inLang('tl', () => i18n.tServer(msg));
    assert.notEqual(out, msg, `"${msg}" is still in English for Taglish guests`);
    assert.equal(out, 'Hanggang 6 guests lang ang puwede sa lugar na ito.');
  }
});
