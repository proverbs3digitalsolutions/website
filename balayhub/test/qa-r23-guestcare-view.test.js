'use strict';
// New discount code: the device checks the server's business rules (src/routes/guestcare.js POST /discount-codes) in the same pass as the type rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/guestcare.js'), 'utf8');
// guestcare.js imports browser modules, so lift the pure helper out of the source.
const m = src.match(/export function discountCodeProblems[\s\S]*?\n}\n/);
const discountCodeProblems = m ? new Function('parseAmount', `${m[0].replace('export ', '')}; return discountCodeProblems;`)((t) => Number(String(t).replace(/[,₱\s]/g, ''))) : null;

test('discountCodeProblems is exported and wired as the form check', () => {
  assert.ok(m, 'export function discountCodeProblems exists');
  assert.match(src, /check: \(d\) => discountCodeProblems\(d\)/);
});

test('a code with spaces is named; a filled percent 0 is left to the number-box rule (min 1) so both show on one pass', () => {
  const p = discountCodeProblems({ code: 'QA 23 bad', percent_off: '0' });
  assert.equal(p.code, "Codes can't contain spaces. Try QA-23-BAD.");
  assert.equal(p.percent_off, undefined);
  assert.equal(discountCodeProblems({ code: 'BALIK10', percent_off: '', amount_off: '0' }).percent_off, 'Set either a percent off or an amount off.');
});

test('shape, both-or-neither and date order use the server wording', () => {
  assert.equal(discountCodeProblems({ code: 'ab', percent_off: '10' }).code, 'Use 3–20 letters, numbers or dashes, e.g. BALIK10.');
  assert.equal(discountCodeProblems({ code: 'BALIK10', percent_off: '10', amount_off: '50' }).percent_off, 'Choose one: a percent off or an amount off, not both.');
  assert.equal(discountCodeProblems({ code: 'BALIK10', percent_off: '10', amount_off: '0' }), null);
  assert.equal(discountCodeProblems({ code: 'BALIK10', amount_off: '50', valid_from: '2026-11-02', valid_until: '2026-11-01' }).valid_until, 'Valid until must be on or after Valid from.');
});

test('an empty code is left to the required check; a good form has no problems', () => {
  assert.equal(discountCodeProblems({ code: '', percent_off: '10' }), null);
  assert.equal(discountCodeProblems({ code: 'balik10', percent_off: '10', valid_from: '2026-11-01', valid_until: '2026-11-01' }), null);
});
