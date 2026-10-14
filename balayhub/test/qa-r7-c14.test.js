'use strict';

// QA round 7, lane C14 (guest Taglish): four server sentences showed in English under a Taglish page title
// (#10 bad check-in link, #11 bad review link, #12 guidebook not available, K14 quote not available).
// tServer must give the Taglish wording in "tl" and leave "en" alone, and the guidebook page must send its
// error text through tServer. Frontend-only: no database.
// i18n.js is loaded from a temp copy of public/js, with the same minimal stubs as qa-r4-c21.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let i18n; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-i18n-c14-'));
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

// The English sentence exactly as the server sends it, the file that sends it, and its Taglish.
const SENTENCES = [
  ['check-in link', 'This check-in link is not valid. Please ask your host for a new one.', 'src/routes/checkin.js',
    'Hindi valid ang check-in link na ito. Humingi ng bagong link sa host mo.'],
  ['review link', 'This review link is not valid.', 'src/routes/guestcare.js', 'Hindi valid ang review link na ito.'],
  ['guidebook', 'This guidebook is not available for this stay. Please ask your host for a new link.', 'src/routes/guidebook.js',
    'Hindi available ang guidebook para sa stay na ito. Humingi ng bagong link sa host mo.'],
  ['quote', 'This quote is not available.', 'src/routes/quotes.js', 'Hindi available ang quote na ito.'],
  ['booking page', 'This booking page is not available.', 'src/routes/directbooking.js', 'Hindi available ang booking page na ito.'],
  ['listing', 'This listing is not available.', 'src/routes/directbooking.js', 'Hindi available ang listing na ito.'],
];

for (const [name, en, file, tl] of SENTENCES) {
  test(`the ${name} sentence reads in Taglish in tl and stays English in en`, () => {
    assert.equal(inLang('tl', () => i18n.tServer(en)), tl);
    assert.equal(inLang('en', () => i18n.tServer(en)), en);
  });

  test(`the ${name} sentence is still the server's own wording (so the translation cannot drift from it)`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(src.includes(en), `${file} no longer sends: ${en}`);
  });
}

test('guest guidebook page: the error body goes through tServer, so the server sentence is translated', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/guide.js'), 'utf8');
  assert.match(src, /import \{[^}]*\btServer\b[^}]*\} from '\.\.\/i18n\.js'/, 'tServer is imported from i18n.js');
  assert.match(src, /: tServer\(err\.message\)\),/, 'the error paragraph prints tServer(err.message)');
  assert.doesNotMatch(src, /: err\.message/, 'no raw err.message left on the error path');
});
