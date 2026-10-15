'use strict';

// QA round 16, lane G (#3, #28): checkout errors show next to the Pay button; the calendar heading reads right after both dates.
// Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');
let book; let dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r16g-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(path.join(__dirname, '../public/js/views/book.js'), path.join(dir, 'views/book.js'));
  globalThis.Element = class { };
  globalThis.document = { documentElement: { lang: '' } };
  book = await import(pathToFileURL(path.join(dir, 'views/book.js')));
});
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); delete globalThis.document; delete globalThis.Element; });

test('calHeading: three states', () => {
  assert.equal(book.calHeading(null, null), 'Choose your check-in date');
  assert.equal(book.calHeading('2026-11-01', null), 'Now choose your check-out date');
  assert.equal(book.calHeading('2026-11-01', '2026-11-03'), 'Dates chosen. Tap a date to change them.');
});

test('Taglish entry for the new heading exists', () => {
  assert.match(src, /'Dates chosen\. Tap a date to change them\.': 'Napili na ang dates\. I-tap ang ibang date para palitan\.'/);
});

test('checkout catch writes into payError, which sits before the submit button and is cleared on submit', () => {
  const catchAt = src.indexOf("const banner = !(err instanceof ApiError)");
  const tail = src.slice(catchAt, catchAt + 600);
  assert.match(tail, /payError\.replaceChildren\(/);
  assert.doesNotMatch(tail, /formError\.replaceChildren\(/);
  assert.ok(src.indexOf('    payError,') > 0 && src.indexOf('    payError,') < src.indexOf('    submit,\n'));
  assert.match(src, /e\.preventDefault\(\);[\s\S]{0,200}payError\.replaceChildren\(\)/);
});
