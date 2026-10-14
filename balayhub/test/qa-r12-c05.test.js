'use strict';

// QA round 12, lane C05 (guest pages): star error clears on pick, check-in thank-you heading,
// guide "Door code" once, booking-page price-rule line and guest-limit Taglish. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = (f) => fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8');
let book; let i18n; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r12c05-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/views/book.js'), path.join(dir, 'views/book.js'));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  i18n = await import(pathToFileURL(path.join(dir, 'i18n.js')));
  book = await import(pathToFileURL(path.join(dir, 'views/book.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.document; delete globalThis.Element; });

test('K17: picking a star clears the star error', () => {
  const s = src('views/review.js');
  const body = s.slice(s.indexOf('function set(n)'), s.indexOf('function paint()'));
  assert.match(body, /field--invalid/);
  assert.match(body, /aria-invalid/);
  assert.match(body, /textContent = ''/);
  assert.match(s, /role: 'group'/);
});

test('K18: the thank-you screen has the thank-you as its one h1', () => {
  const s = src('views/checkin.js');
  assert.match(s, /heading\.textContent = t\("Thank you! You're registered\."\)/);
  assert.ok(!s.includes("h2', null, t(\"Thank you"));
  assert.match(s, /\.gc__guest'\)\]\.filter/);
  assert.match(s, /blankGuests\.forEach\(\(row\) => row\.classList\.add\('field--invalid'\)\)/);
});

test('#12: the door code card says "Door code" once; Taglish "Code ng pinto"', () => {
  const s = src('views/guide.js');
  assert.equal((s.match(/t\('Door code'\)/g) || []).length, 1);
  assert.match(s, /'Door code': 'Code ng pinto'/);
  assert.match(s, /label: t\('Code'\)/);
});

test('#11: priceRulesLine', () => {
  assert.equal(book.priceRulesLine(['Booked-early price']), 'Includes: Booked-early price.');
  assert.equal(book.priceRulesLine([]), null);
  assert.equal(book.priceRulesLine(undefined), null);
  i18n.setGuestLang('tl');
  try { assert.match(book.priceRulesLine(['Booked-early price']), /^Kasama: /); } finally { i18n.setGuestLang('en'); }
});

test('K2: the guest-limit message has a Taglish sentence', () => {
  i18n.setGuestLang('tl');
  try { assert.equal(i18n.t('Guests must be at most {n}.', { n: 50 }), 'Hanggang 50 na guests lang ang puwede.'); } finally { i18n.setGuestLang('en'); }
  assert.match(src('views/book.js'), /Guests must be at most \(\\d\+\)/);
});
