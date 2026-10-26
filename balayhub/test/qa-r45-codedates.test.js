'use strict';
require('./helpers');

// QA round 45, lane CODEDATES (D-127, contract C3). A discount code whose Valid until is before Valid from says so in the
// words the screen uses: "Valid until must be on or after Valid from." The check itself is unchanged (valid_until < valid_from),
// so the same day is still accepted. The device (views/guestcare.js) and the server (src/routes/guestcare.js) say the same sentence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, sql } = require('./helpers');

const SENTENCE = 'Valid until must be on or after Valid from.';
const viewSrc = fs.readFileSync(path.join(__dirname, '../public/js/views/guestcare.js'), 'utf8');
const routeSrc = fs.readFileSync(path.join(__dirname, '../src/routes/guestcare.js'), 'utf8');

// guestcare.js imports browser modules, so lift the pure helper out of the source (as qa-r23-guestcare-view does).
const m = viewSrc.match(/export function discountCodeProblems[\s\S]*?\n}\n/);
const discountCodeProblems = m ? new Function('parseAmount', `${m[0].replace('export ', '')}; return discountCodeProblems;`)((t) => Number(String(t).replace(/[,₱\s]/g, ''))) : null;

test('device: Valid until a day before Valid from gets the new sentence on valid_until, and nothing else', () => {
  assert.ok(m, 'export function discountCodeProblems exists');
  assert.deepEqual(discountCodeProblems({ code: 'BALIK10', amount_off: '50', valid_from: '2026-11-02', valid_until: '2026-11-01' }), { valid_until: SENTENCE });
});

test('device: the same day is accepted, so there is no valid_until problem', () => {
  assert.equal(discountCodeProblems({ code: 'BALIK10', amount_off: '50', valid_from: '2026-11-01', valid_until: '2026-11-01' }), null);
});

test('the view and the server carry the same sentence, and the old "end date" sentence is gone from both', () => {
  assert.ok(viewSrc.includes(`'${SENTENCE}'`), 'views/guestcare.js uses the new sentence');
  assert.ok(routeSrc.includes(`'${SENTENCE}'`), 'src/routes/guestcare.js uses the new sentence');
  assert.doesNotMatch(viewSrc, /The end date must be after the start date/);
  assert.doesNotMatch(routeSrc, /The end date must be after the start date/);
});

let srv; let owner;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa45-codedates@example.com', 'QA r45 CODEDATES');
});
test.after(async () => { await srv.close(); });

test('server: Valid until a day before Valid from is refused with the new sentence, and nothing is saved', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'QA45BACK', percent_off: 10, valid_from: '2030-06-10', valid_until: '2030-06-09' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'VALIDATION');
  assert.equal(r.data.fields.valid_until, SENTENCE);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM discount_codes WHERE code = 'QA45BACK'`))[0].n, 0);
});

test('server: the same day is accepted and the code is saved', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'QA45SAME', percent_off: 10, valid_from: '2030-06-10', valid_until: '2030-06-10' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.code_id);
});
