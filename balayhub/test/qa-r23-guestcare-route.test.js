'use strict';

// QA round 23, lane GUESTCARE-ROUTE (server). POST /discount-codes answers with every field problem in one 400,
// the way the other owner forms do, instead of stopping at the first one. Wording and codes are unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql } = require('./helpers');

const BOTH = 'Choose one: a percent off or an amount off, not both.';
const NEITHER = 'Set either a percent off or an amount off.';
let srv; let owner;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa23-codes@example.com', 'QA23 Codes');
});
test.after(async () => { await srv.close(); });

test('a code with a space and a percent of 0 reports both problems in one answer, and saves nothing', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'QA 23 bad', percent_off: 0 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'VALIDATION');
  assert.equal(r.data.fields.code, "Codes can't contain spaces. Try QA-23-BAD.");
  assert.equal(r.data.fields.percent_off, 'Percent off must be at least 1.');
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM discount_codes WHERE code ILIKE '%23%'`))[0].n, 0);
});

test('a percent and an amount together, with the end date before the start, report both problems in one answer', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'QA23BOTH', percent_off: 10, amount_off: '100', valid_from: '2030-06-10', valid_until: '2030-06-01' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.percent_off, BOTH);
  assert.equal(r.data.fields.valid_until, 'Valid until must be on or after Valid from.');
  assert.equal(r.data.fields.code, undefined);
});

test('a code with a space and no percent or amount reports the space and the neither sentence together', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'QA 23 none', percent_off: null, amount_off: null });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.code, "Codes can't contain spaces. Try QA-23-NONE.");
  assert.equal(r.data.fields.percent_off, NEITHER);
});

test('a bad amount reports only the amount, not the choose-one sentence', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'QA23GATE', percent_off: 10, amount_off: 'abc' });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.amount_off, 'Amount off must be a valid amount (e.g. 8500 or 8500.50).');
  assert.equal(r.data.fields.percent_off, undefined);
});

test('a short code and a bad minimum-nights value report both in one answer', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'AB', percent_off: 10, min_nights: 0 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.code, 'Use 3–20 letters, numbers or dashes, e.g. BALIK10.');
  assert.equal(r.data.fields.min_nights, 'Minimum nights must be at least 1.');
});

test('a missing code says it is required and nothing else; a code over 20 characters gets its length message and no shape message', async () => {
  const missing = await owner.post('/api/discount-codes', { percent_off: 10 });
  assert.equal(missing.status, 400);
  assert.deepEqual(Object.keys(missing.data.fields), ['code']);
  assert.equal(missing.data.fields.code, 'Code is required.');
  const long = await owner.post('/api/discount-codes', { code: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', percent_off: 10 });
  assert.equal(long.status, 400);
  assert.deepEqual(Object.keys(long.data.fields), ['code']);
  assert.equal(long.data.fields.code, 'Code must be at most 20 characters.');
});

test('a valid code still saves, in the stored form (lower case typed, upper case kept, dashes kept)', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'qa-23-ok', percent_off: 10, valid_from: '2030-01-01', valid_until: '2030-12-31' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.code_id);
  assert.equal((await sql(`SELECT code FROM discount_codes WHERE code_id = $1`, [r.data.code_id]))[0].code, 'QA-23-OK');
});

test('a second code with the same name keeps its duplicate message', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'QA-23-OK', percent_off: 5 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.code, 'You already have a code with that name.');
});

test('the 50-code limit still answers 409 for a valid new code', async () => {
  const { n } = (await sql('SELECT COUNT(*)::int AS n FROM discount_codes WHERE active AND issued_to_booking_id IS NULL'))[0];
  for (let i = n; i < 50; i++) {
    assert.equal((await owner.post('/api/discount-codes', { code: `QA23LIM${i}`, percent_off: 1 })).status, 201, `code ${i}`);
  }
  const r = await owner.post('/api/discount-codes', { code: 'QA23OVER', percent_off: 1 });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'LIMIT');
  assert.equal(r.data.error, 'You can have up to 50 active codes. Turn some off first.');
});
