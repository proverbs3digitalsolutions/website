'use strict';

// Tagalog weekday header on the booking calendar (QA round 3, public#27): "L L M M H B S" repeats letters.
// book.js splits the translated header on spaces, one name per column, so each name must be a
// three-letter word and all seven must be different. Frontend-only: no database.
// i18n.js is loaded from a temp copy of public/js. ui.js wraps Element.prototype when it loads and
// setGuestLang touches document, so both get minimal stubs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let i18n; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-i18n-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.document; delete globalThis.Element; });

// The header exactly as book.js builds it: t('S M T W T F S').split(' ').
const headerIn = (lang) => {
  i18n.setGuestLang(lang);
  try { return i18n.t('S M T W T F S').split(' '); } finally { i18n.setGuestLang('en'); }
};

test('the Tagalog weekday header gives seven different three-letter names, Sunday first', () => {
  const names = headerIn('tl');
  assert.equal(names.length, 7, JSON.stringify(names));
  for (const n of names) assert.match(n, /^[A-Za-z]{3}$/, `"${n}" is not a three-letter name`);
  assert.equal(new Set(names).size, 7, `names repeat: ${names.join(' ')}`);
  assert.equal(names[0], 'Lin', 'Linggo (Sunday) should be the first column, matching the English grid');
});

test('the English weekday header is unchanged: seven single letters', () => {
  assert.deepEqual(headerIn('en'), ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
});

test('book.js still builds the header by splitting the translated string on spaces', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');
  assert.match(src, /t\('S M T W T F S'\)\.split\(' '\)\.map\(\(w\) => h\('span', \{ class: 'bk-cal__wd' \}, w\)\)/);
});
