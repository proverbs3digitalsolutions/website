'use strict';

// QA round 33, lane DISCOUNT (MNY-1). A code typed with a space gets a suggestion that keeps only letters, numbers and
// single dashes (D-115). The server (POST /discount-codes) and the device (New discount code) give the same words.

const { startServer, ownerAccount, sql } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const NO_FIT = "Codes can't contain spaces. Use 3–20 letters, numbers or dashes, e.g. BALIK10.";
let srv; let owner;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa33-discount@example.com', 'QA33 Discount');
});
test.after(async () => { await srv.close(); });

const codeCount = async () => (await sql('SELECT COUNT(*)::int AS n FROM discount_codes'))[0].n;

test('server: a symbol after a space is dropped from the suggestion, and the refused code saves no row', async () => {
  const before = await codeCount();
  const r = await owner.post('/api/discount-codes', { code: 'bad code!', percent_off: 10 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'VALIDATION');
  assert.equal(r.data.fields.code, "Codes can't contain spaces. Try BAD-CODE.");
  assert.equal(await codeCount(), before);
});

test('server: a percent sign and a space become a suggestion with only letters, numbers and dashes', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'spring sale 20%', percent_off: 10 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.code, "Codes can't contain spaces. Try SPRING-SALE-20.");
});

test('server: a plain space-separated code still suggests its dashed form', async () => {
  const r = await owner.post('/api/discount-codes', { code: 'qa 23 bad', percent_off: 10 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.code, "Codes can't contain spaces. Try QA-23-BAD.");
});

test('server: a suggestion too short to be a code gives the shape sentence instead', async () => {
  const before = await codeCount();
  const r = await owner.post('/api/discount-codes', { code: 'a !', percent_off: 10 });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.fields.code, NO_FIT);
  assert.equal(await codeCount(), before);
});

// The device's copy is the same rule, read from the source of the form's check (the same way qa-r23-guestcare-view does).
const src = fs.readFileSync(path.join(__dirname, '../public/js/views/guestcare.js'), 'utf8');
const m = src.match(/export function discountCodeProblems[\s\S]*?\n}\n/);
const discountCodeProblems = m ? new Function('parseAmount', `${m[0].replace('export ', '')}; return discountCodeProblems;`)((t) => Number(String(t).replace(/[,₱\s]/g, ''))) : null;
const deviceCodeProblem = (code) => discountCodeProblems({ code, percent_off: '10' }).code;

test('device: a symbol after a space is dropped from the suggestion, the same words as the server', () => {
  assert.ok(m, 'export function discountCodeProblems exists');
  assert.equal(deviceCodeProblem('bad code!'), "Codes can't contain spaces. Try BAD-CODE.");
  assert.equal(deviceCodeProblem('spring sale 20%'), "Codes can't contain spaces. Try SPRING-SALE-20.");
  assert.equal(deviceCodeProblem('qa 23 bad'), "Codes can't contain spaces. Try QA-23-BAD.");
});

test('device: a suggestion too short to be a code gives the shape sentence instead', () => {
  assert.equal(deviceCodeProblem('a !'), NO_FIT);
});
