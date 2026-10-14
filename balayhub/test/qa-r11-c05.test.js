'use strict';

// QA round 11, lane C05 (guest pages): Taglish wording, guest-count and not-found messages,
// the review star message, and the check-in form's default rows. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
let i18n; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r11c05-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.document; delete globalThis.Element; });

test('K12: the deposit line is Tagalog', () => {
  i18n.setGuestLang('tl');
  try { assert.equal(i18n.t('{pct}% deposit', { pct: 50 }), '50% na deposit'); } finally { i18n.setGuestLang('en'); }
});

test('K11: both payment-failure sentences translate', () => {
  i18n.setGuestLang('tl');
  try {
    assert.match(i18n.tServer("Online payment isn't available right now. Please try again in a few minutes, or contact the host."), /^Hindi available ang online payment ngayon/);
    assert.match(i18n.tServer('Online payment is not available for this booking. Please contact your host.'), /^Hindi/);
  } finally { i18n.setGuestLang('en'); }
});

test('#7: the room charge is "Tuluyan", not "Tirahan"', () => {
  for (const f of ['quote.js', 'pay.js']) { const s = src(`views/${f}`); assert.ok(!s.includes("'Tirahan"), f); assert.ok(s.includes('Tuluyan'), f); }
});

test('#12: the refund line says it was added back to the balance', () => {
  const s = src('views/pay.js');
  assert.ok(s.includes("'Refunded to you, added back to the balance'"));
  assert.ok(s.includes('Ibinalik sa iyo, idinagdag ulit sa babayaran'));
  assert.ok(s.includes("t('Refunded to you, added back to the balance')"));
});

test('#9, #11: whole-number guest message and the not-available listing message', () => {
  const s = src('views/book.js');
  assert.ok(s.includes("'Enter a whole number of guests, 1 or more.'"));
  assert.ok(/'Enter a whole number of guests, 1 or more\.': '/.test(s), 'Taglish entry');
  assert.ok(s.includes("This listing is not available. It may have been removed, or it isn't open for online booking."));
  const i = s.indexOf('if (!l) {');
  assert.ok(!s.slice(i, i + 400).includes("isn't taking online bookings"), 'a missing listing no longer says bookings are off');
});

test('#10: the star message is inline, not a toast', () => {
  const s = src('views/review.js');
  assert.ok(!/toast\(t\('Please choose a star rating first\.'/.test(s));
  assert.ok(s.includes("role: 'alert'"));
  assert.ok(s.includes("showErrors(form, { rating: t('Please choose a star rating first.') })"));
});

test('#13: check-in starts with no extra guest row but keeps + Add guest', () => {
  const s = src('views/checkin.js');
  assert.ok(!s.includes('Array.from({ length: Math.max(0, (s.num_guests'));
  assert.ok(s.includes("t('+ Add guest')"));
});
