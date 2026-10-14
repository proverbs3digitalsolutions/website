'use strict';

// Taglish for the two refusals a guest can get when a payment proof would push the proofs they already
// sent past what they owe (QA round 5, lane C19 for C05's #7): "You already sent proofs for ₱X ..." and
// "Your proofs already cover what you owe. ...". tServer must give the same Taglish wording pay.js uses for
// its own pre-check, with the peso amounts unchanged. Frontend-only: no database.
// i18n.js is loaded from a temp copy of public/js, with the same minimal stubs as qa-r4-c21.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let i18n; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-i18n-c19-'));
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

const SENT_EN = (sent, left) => `You already sent proofs for ${sent} that the host hasn't checked yet, so you can send up to ${left} more.`;
const SENT_TL = (sent, left) => `Nakapadala ka na ng patunay na ${sent} na hindi pa na-check ng host, kaya hanggang ${left} pa lang ang puwede mong ipadala.`;
const COVER_EN = 'Your proofs already cover what you owe. The host will check them soon.';
const COVER_TL = 'Sapat na ang mga patunay mo para sa utang mo. I-check na ito ng host maya-maya.';

test('the proof limit message comes back in Taglish with both peso amounts', () => {
  assert.equal(
    inLang('tl', () => i18n.tServer(SENT_EN('₱1,500.00', '₱9,500.00'))),
    SENT_TL('₱1,500.00', '₱9,500.00'));
});

test('the Taglish proof limit keeps the amounts for any balance', () => {
  for (const [sent, left] of [['₱0.50', '₱0.50'], ['₱1,000.00', '₱10,000.00'], ['₱1,234,567.89', '₱2,000,000.00']]) {
    assert.equal(inLang('tl', () => i18n.tServer(SENT_EN(sent, left))), SENT_TL(sent, left), `${sent} / ${left}`);
  }
});

test('the "already cover" message comes back in Taglish', () => {
  assert.equal(inLang('tl', () => i18n.tServer(COVER_EN)), COVER_TL);
});

test('English guests still see both proof messages in English', () => {
  assert.equal(inLang('en', () => i18n.tServer(SENT_EN('₱1,500.00', '₱9,500.00'))), SENT_EN('₱1,500.00', '₱9,500.00'));
  assert.equal(inLang('en', () => i18n.tServer(COVER_EN)), COVER_EN);
});

test('the Taglish proof limit matches the wording pay.js uses for its own pre-check', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');
  const m = src.match(/"You already sent proofs for \{sent\} that the host hasn't checked yet, so you can send up to \{left\} more\.": '([^']*)'/);
  assert.ok(m, 'pay.js no longer registers the Taglish wording for the proof limit');
  const expected = m[1].replace('{sent}', '₱1,500.00').replace('{left}', '₱9,500.00');
  assert.equal(inLang('tl', () => i18n.tServer(SENT_EN('₱1,500.00', '₱9,500.00'))), expected);
});

test('the "already cover" Taglish matches the wording pay.js uses for its own pre-check', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');
  const m = src.match(/'Your proofs already cover what you owe\. The host will check them soon\.': '([^']*)'/);
  assert.ok(m, 'pay.js no longer registers the Taglish wording for the "already cover" message');
  assert.equal(inLang('tl', () => i18n.tServer(COVER_EN)), m[1]);
});

test('every proof message proofs.js builds is translated', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/proofs.js'), 'utf8');
  // The server builds the limit as a template literal with fmtPeso amounts, e.g. `... ${messaging.fmtPeso(pending)} ...`.
  const limit = src.match(/`(You already sent proofs for \$\{[^}]+\} that the host hasn't checked yet, so you can send up to \$\{[^}]+\} more\.)`/);
  assert.ok(limit, 'no proof-limit message found in proofs.js');
  const out = inLang('tl', () => i18n.tServer(limit[1].replace(/\$\{messaging\.fmtPeso\(pending\)\}/, '₱1,500.00').replace(/\$\{messaging\.fmtPeso\(left\)\}/, '₱9,500.00')));
  assert.equal(out, SENT_TL('₱1,500.00', '₱9,500.00'));
  const cover = src.match(/'(Your proofs already cover what you owe\. The host will check them soon\.)'/);
  assert.ok(cover, 'no "already cover" message found in proofs.js');
  assert.equal(inLang('tl', () => i18n.tServer(cover[1])), COVER_TL);
});

test('the over-balance refusal comes back in Taglish with the amount, and English stays English', () => {
  const EN = 'This is more than the ₱11,000.00 still owed.';
  assert.equal(inLang('tl', () => i18n.tServer(EN)), 'Mas malaki ito sa balanseng ₱11,000.00.');
  assert.equal(inLang('en', () => i18n.tServer(EN)), EN);
});

test('the over-balance Taglish matches the wording pay.js uses for its own pre-check', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');
  const m = src.match(/'This is more than the balance of \{amount\}\.': '([^']*)'/);
  assert.ok(m, 'pay.js no longer registers the Taglish wording for the over-balance refusal');
  assert.equal(inLang('tl', () => i18n.tServer('This is more than the ₱11,000.00 still owed.')), m[1].replace('{amount}', '₱11,000.00'));
});

test('the over-balance refusal proofs.js builds is translated', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/proofs.js'), 'utf8');
  // The server builds it as a template literal, e.g. `This is more than the ${messaging.fmtPeso(now.balance)} still owed.`
  const m = src.match(/`(This is more than the \$\{[^}]+\} still owed\.)`/);
  assert.ok(m, 'no over-balance refusal found in proofs.js');
  const out = inLang('tl', () => i18n.tServer(m[1].replace(/\$\{[^}]+\}/, '₱11,000.00')));
  assert.notEqual(out, m[1].replace(/\$\{[^}]+\}/, '₱11,000.00'), 'still in English for Taglish guests');
  assert.equal(out, 'Mas malaki ito sa balanseng ₱11,000.00.');
});
