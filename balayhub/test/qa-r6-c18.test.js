'use strict';

// QA round 6, C18 guest pages. O-g: the quote page's "Loading…" and "the host" fallback have Taglish wording.
// #11: a quote's date row says what the date means (Expires while open, Expired when expired, Valid until when
// cancelled or paid). O-h: the pay page's amount box starts as a whole amount (17600), with two decimals only
// when there are centavos. Frontend-only: no database. The views load from a temp copy with a stub app.js
// (filters.js imports it), so the pure helpers run in Node.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');

let dir; let i18n; let quotes; let pay;
test.before(async () => {
  globalThis.Element = class { }; // ui.js names the DOM Element class at load time; a stub is enough here
  globalThis.document = { documentElement: {} }; // initGuestLang sets the page language on load
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r6-c18-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null, requireEmailVerification: true };\n');
  for (const f of ['quote.js', 'quotes.js', 'pay.js']) fs.copyFileSync(path.join(__dirname, '../public/js/views', f), path.join(dir, 'views', f));
  // quote.js registers its Taglish wording when it loads, so it is imported before the lookups below.
  await import(pathToFileURL(path.join(dir, 'views', 'quote.js')));
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
  quotes = await import(pathToFileURL(path.join(dir, 'views', 'quotes.js')));
  pay = await import(pathToFileURL(path.join(dir, 'views', 'pay.js')));
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('O-g the quote page loading line and the host fallback have Taglish wording', () => {
  i18n.initGuestLang('tl');
  assert.equal(i18n.t('Loading…'), 'Naglo-load…');
  assert.equal(i18n.t('the host'), 'ang host');
  assert.equal(i18n.t('Please ask {host} for a new quote.', { host: i18n.t('the host') }), 'Humingi ng bagong quote kay ang host.');
});

test('#11 the date row says Expires while open, Expired when expired, Valid until when cancelled or paid', () => {
  assert.equal(quotes.expiryLabel('open'), 'Expires');
  assert.equal(quotes.expiryLabel('expired'), 'Expired');
  assert.equal(quotes.expiryLabel('cancelled'), 'Valid until');
  assert.equal(quotes.expiryLabel('paid'), 'Valid until');
});

test('#11 the quote detail row uses that label instead of the open-or-Expired guess', () => {
  const src = read('views/quotes.js');
  assert.match(src, /h\('dt', null, expiryLabel\(q\.status\)\)/);
  assert.doesNotMatch(src, /open \? 'Expires' : 'Expired'/);
});

test('O-h the amount box is a whole amount without centavos, and keeps two decimals for a fraction', () => {
  assert.equal(pay.prefillAmount(17600), '17600');
  assert.equal(pay.prefillAmount(17600.5), '17600.50');
  assert.equal(pay.prefillAmount(1234.5), '1234.50');
  // Balance less proofs can leave float residue (17599.999999999996); it is still the whole amount owed.
  assert.equal(pay.prefillAmount(17599.999999999996), '17600');
});

test('O-h the proof form prefills through that helper, not a fixed .toFixed(2)', () => {
  const src = read('views/pay.js');
  assert.match(src, /value: prefillAmount\(left\)/);
  assert.doesNotMatch(src, /left\.toFixed\(2\)/);
});
