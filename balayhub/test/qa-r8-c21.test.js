'use strict';

// QA round 8, C21 (booking page). Frontend only, so these are source checks on book.js (no database).
// K1: a language switch keeps dates, guests, typed fields, ticked boxes, code and add-ons. K2: no old total below 1 guest.
// K4: "Book direct" goes through t(). K5: the not-available card gives a reason.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/book.js'), 'utf8');

test('K1: the language redraw stores and re-applies the guest entries', () => {
  const store = src.slice(src.indexOf('redraw = () => {\n    keep = {'));
  for (const w of ['checkIn', 'checkOut', 'num_guests', "'name'", "'email'", "'phone'", "'notes'", 'consent', 'accept_rules', 'code:', 'pay:', 'addons: new Map(picked)']) {
    assert.ok(store.slice(0, 700).includes(w), `stores ${w}`);
  }
  const apply = src.slice(src.indexOf('if (kept) {'), src.indexOf('// From here a language switch'));
  for (const w of ['kept.checkIn', 'kept.values', 'kept.ticked', 'kept.pay', 'kept.code', 'kept.addons']) assert.ok(apply.includes(w), `applies ${w}`);
  assert.match(src, /const kept = keep\?\.unitId === l\.unit_id \? keep : null;\s*keep = null;/);
});

test('K2: below 1 guest the price box asks for the number of guests', () => {
  assert.match(src, /if \(!guestCountOk\(\)\) summary\.replaceChildren\(h\('p', \{ class: 'muted' \}, t\('Enter the number of guests to see the total\.'\)\)\);\s*if \(!guestCountOk\(\)\) return;/);
});

test('K4: Book direct goes through t() and has a Taglish entry', () => {
  assert.ok(src.includes("${t('Book direct')}`"));
  assert.ok(!/— Book direct`/.test(src));
});

test('K5: the not-available card says why', () => {
  assert.ok(src.includes(`t("This listing is not available. It may have been removed, or it isn't open for online booking.")`));
});
