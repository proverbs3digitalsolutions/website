'use strict';

// QA round 30 (RATE-TL, D-112): the 429 sentence now carries the wait ("Too many tries. Please try again in N
// minute(s)." / "...in about an hour." / "...in about N hours."). Guest and sign-in pages show it through tServer(),
// so each shape reads Taglish with the number carried through. Browser module loaded from a temp copy; no database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const pub = path.join(__dirname, '..', 'public', 'js');
let i18n; let dir;
const store = new Map();
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r30tl-'));
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
  const auth = fs.readFileSync(path.join(pub, 'views', 'auth.js'), 'utf8');
  const body = /extendTranslations\(\{([\s\S]*?)\}\);/.exec(auth);
  i18n.extendTranslations(body ? new Function(`return {${body[1]}};`)() : {});
});
test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete globalThis.Element; delete globalThis.document; delete globalThis.localStorage;
});

const CASES = [
  ['Too many tries. Please try again in 1 minute.', 'Masyadong maraming subok. Subukan ulit pagkalipas ng 1 minuto.'],
  ['Too many tries. Please try again in 14 minutes.', 'Masyadong maraming subok. Subukan ulit pagkalipas ng 14 minuto.'],
  ['Too many tries. Please try again in about an hour.', 'Masyadong maraming subok. Subukan ulit pagkalipas ng mga isang oras.'],
  ['Too many tries. Please try again in about 3 hours.', 'Masyadong maraming subok. Subukan ulit pagkalipas ng mga 3 oras.'],
];

test('each new 429 shape reads Taglish with the number carried through', () => {
  i18n.setGuestLang('tl');
  try {
    for (const [en, tl] of CASES) assert.equal(i18n.tServer(en), tl);
  } finally { i18n.setGuestLang('en'); }
});

test('English is left alone', () => {
  i18n.setGuestLang('en');
  for (const [en] of CASES) assert.equal(i18n.tServer(en), en);
});
