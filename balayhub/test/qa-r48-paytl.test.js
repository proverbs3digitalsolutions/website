'use strict';
require('./helpers');

// QA round 48 (GST48-1, C5): the balance pay link's own sentences had no Taglish line, so a guest who
// chose Taglish read English under a Taglish heading. i18n.js is loaded from a temp copy, as qa-r3-i18n does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let i18n; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-paytl-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.document; delete globalThis.Element; });

const PAIRS = [
  ['This payment link is not valid. Please ask your host for a new one.', 'Hindi valid ang payment link na ito. Humingi ng bagong link sa host mo.'],
  ['This payment link has expired because the stay has ended. Please ask your host for a new one.', 'Expired na ang payment link na ito dahil tapos na ang stay. Humingi ng bagong link sa host mo.'],
  ['Payment by transfer is not available for this booking. Please contact your host.', 'Hindi available ang bayad sa transfer para sa booking na ito. Kontakin ang iyong host.'],
  ['This booking was cancelled, so no payment can be sent for it.', 'Na-cancel ang booking na ito, kaya hindi na puwedeng magpadala ng bayad para dito.'],
  ['This booking was cancelled, so add-ons cannot be booked on it.', 'Na-cancel ang booking na ito, kaya hindi na puwedeng mag-book ng add-ons dito.'],
  ['Add-ons can only be booked up to check-in day.', 'Puwede lang mag-book ng add-ons hanggang sa araw ng check-in.'],
  ['Choose at least one add-on.', 'Pumili ng kahit isang add-on.'],
  ['The balance is too small to pay online. Please pay your host directly.', 'Masyadong maliit ang balanse para bayaran online. Direktang magbayad sa host mo.'],
  ['The amount due just changed. Please reload the page.', 'Nagbago ang babayaran. Paki-reload ang page.'],
  ['A payment for this booking is already in progress. Please wait a minute and reload.', 'May bayad nang ginagawa para sa booking na ito. Maghintay ng isang minuto at mag-reload.'],
];

test('tServer turns each balance pay sentence into Taglish, and English stays English', () => {
  for (const [en, tl] of PAIRS) {
    i18n.setGuestLang('tl');
    try { assert.equal(i18n.tServer(en), tl, en); } finally { i18n.setGuestLang('en'); }
    assert.equal(i18n.tServer(en), en);
  }
});

// Not shown to a guest, or covered elsewhere. The add-ons read-only sentence (line 158) has no Taglish line and is
// outside C5's ten: listed for the founder's Taglish check.
const EXEMPT = new Set(['This is a demo.', 'Invalid Idempotency-Key header.', 'Please check the highlighted fields.',
  "Add-ons can't be booked for this stay right now. Please contact your host."]);

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
