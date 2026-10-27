'use strict';
require('./helpers');

// QA round 49 (C6, carry 14): the balance pay add-on refusal had no Taglish line, so a guest who chose Taglish read English. i18n.js is loaded from a temp copy, as qa-r3-i18n does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let i18n; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-addontl-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.document; delete globalThis.Element; });

const EN = "Add-ons can't be booked for this stay right now. Please contact your host.";
const TL = 'Hindi muna puwedeng mag-book ng add-ons para sa stay na ito. Kontakin ang iyong host.';

test('tServer gives the Taglish add-ons refusal, and English stays English', () => {
  i18n.setGuestLang('tl');
  try { assert.equal(i18n.tServer(EN), TL); } finally { i18n.setGuestLang('en'); }
  assert.equal(i18n.tServer(EN), EN);
});

// Not shown to a guest.
const EXEMPT = new Set(['This is a demo.', 'Invalid Idempotency-Key header.', 'Please check the highlighted fields.']);

test('every guest-visible sentence in balancepay.js has a Taglish line', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/balancepay.js'), 'utf8');
  const consts = {};
  for (const m of src.matchAll(/^const (\w+) = (["'])(.*)\2;$/gm)) consts[m[1]] = m[3];
  const sentences = new Set();
  for (const m of src.matchAll(/(?:HttpError\(\s*4\d\d,|notFound\()\s*(["'])((?:\\.|(?!\1).)*)\1/g)) sentences.add(m[2].replace(/\\'/g, "'"));
  for (const m of src.matchAll(/fields:\s*\{[^}]*?:\s*(["'])((?:\\.|(?!\1).)*)\1/g)) sentences.add(m[2]);
  assert.ok(sentences.size >= 10, `found ${sentences.size}`);
  i18n.setGuestLang('tl');
  try {
    const missing = [...sentences].filter((s) => !EXEMPT.has(s) && i18n.tServer(s) === s);
    assert.deepEqual(missing, []);
  } finally { i18n.setGuestLang('en'); }
  void consts;
});
