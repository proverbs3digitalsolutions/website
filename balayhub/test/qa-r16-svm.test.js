'use strict';

// QA round 16, lane SVM (money server). Bug #24: a unit owner name another active owner already uses asks first
// (409 NAME_IN_USE; saved with confirm_duplicate_name: true). Bug #25: a discount code with both a percent and an amount
// says to choose one; a code with neither keeps the old sentence.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql } = require('./helpers');

const BOTH = 'Choose one: a percent off or an amount off, not both.';
const NEITHER = 'Set either a percent off or an amount off.';
let srv; let host;

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'svm-owner@example.com', 'SVM Stays');
});
test.after(async () => { await srv.close(); });

test('an owner name another active owner uses asks first, ignoring case and spaces around it', async () => {
  assert.equal((await host.post('/api/unit-owners', { full_name: 'QA Dup' })).status, 201);
  const dup = await host.post('/api/unit-owners', { full_name: '  qa dup ' });
  assert.equal(dup.status, 409, JSON.stringify(dup.data));
  assert.equal(dup.data.code, 'NAME_IN_USE');
  assert.equal(dup.data.error, 'An owner named QA Dup already exists.');
  assert.equal(dup.data.fields.full_name, 'An owner named QA Dup already exists.');
  assert.equal(dup.data.owner_name, 'QA Dup');
  // The host said yes: the second owner is saved with the same name.
  const saved = await host.post('/api/unit-owners', { full_name: '  qa dup ', confirm_duplicate_name: true });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
});

test('an archived owner of that name does not count', async () => {
  const old = await host.post('/api/unit-owners', { full_name: 'QA Archived' });
  assert.equal(old.status, 201, JSON.stringify(old.data));
  assert.equal((await host.post(`/api/unit-owners/${old.data.owner_id}/archive`, {})).status, 200);
  const again = await host.post('/api/unit-owners', { full_name: 'QA Archived' });
  assert.equal(again.status, 201, JSON.stringify(again.data));
});

test('an edit asks only when the name changes to one another owner uses', async () => {
  const a = await host.post('/api/unit-owners', { full_name: 'QA Edit A' });
  const b = await host.post('/api/unit-owners', { full_name: 'QA Edit B' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(b.status, 201, JSON.stringify(b.data));
  const clash = await host.patch(`/api/unit-owners/${b.data.owner_id}`, { full_name: 'QA Edit A' });
  assert.equal(clash.status, 409, JSON.stringify(clash.data));
  assert.equal(clash.data.code, 'NAME_IN_USE');
  assert.equal(clash.data.owner_name, 'QA Edit A');
  const yes = await host.patch(`/api/unit-owners/${b.data.owner_id}`, { full_name: 'QA Edit A', confirm_duplicate_name: true });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.equal((await sql('SELECT full_name FROM unit_owners WHERE owner_id = $1', [b.data.owner_id]))[0].full_name, 'QA Edit A');
  // The stored name is already shared now. A save that does not send a name never asks, and neither does an owner keeping their own name.
  assert.equal((await host.patch(`/api/unit-owners/${b.data.owner_id}`, { notes: 'Keys with the caretaker' })).status, 200);
  assert.equal((await host.patch(`/api/unit-owners/${a.data.owner_id}`, { full_name: 'QA Edit A' })).status, 200);
});

test('a discount code with both a percent and an amount says to choose one', async () => {
  const both = await host.post('/api/discount-codes', { code: 'QA16SVM', percent_off: 10, amount_off: '100' });
  assert.equal(both.status, 400, JSON.stringify(both.data));
  assert.equal(both.data.fields.percent_off, BOTH);
});

test('a discount code with neither a percent nor an amount keeps the old sentence', async () => {
  const neither = await host.post('/api/discount-codes', { code: 'QA16SVM', percent_off: null, amount_off: null });
  assert.equal(neither.status, 400, JSON.stringify(neither.data));
  assert.equal(neither.data.fields.percent_off, NEITHER);
  // An amount of 0 counts as no amount.
  const zero = await host.post('/api/discount-codes', { code: 'QA16SVM', percent_off: null, amount_off: '0' });
  assert.equal(zero.data.fields.percent_off, NEITHER);
});

test('a percent code or an amount code on its own still saves', async () => {
  assert.equal((await host.post('/api/discount-codes', { code: 'QA16PCT', percent_off: 10 })).status, 201);
  assert.equal((await host.post('/api/discount-codes', { code: 'QA16AMT', amount_off: '100' })).status, 201);
  assert.equal((await host.post('/api/discount-codes', { code: 'QA16ZERO', percent_off: 10, amount_off: '0' })).status, 201);
});
