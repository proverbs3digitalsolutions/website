'use strict';

// QA round 8, lane C36 (rent and owners money questions, frontend source scan only, no database).
// D-84: Cancel on a "more than is owed" or "more than the statement" question closes it quietly.
// Nothing is saved, no red error appears, and the form stays open (makeForm keeps it open when onSubmit returns false).
// node --test --test-concurrency=1 test/qa-r8-c36.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rentSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/rent.js'), 'utf8');
const ownSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/owners.js'), 'utf8');
const grpSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/groups.js'), 'utf8');

test('D-84 rent: Cancel on "Record more than is owed?" returns false before anything is posted, with no error', () => {
  const rp = rentSrc.slice(rentSrc.indexOf('export async function recordPaymentModal'), rentSrc.indexOf('// ---------------------------------------------------------------- add expense'));
  const cancel = rp.match(/^.*title: 'Record more than is owed\?'.*$/m);
  assert.ok(cancel, 'the over-balance question is still asked');
  assert.match(cancel[0], /\)\) return false;$/, 'Cancel returns false on that same line');
  assert.doesNotMatch(cancel[0], /throw/, 'Cancel throws nothing');
  assert.doesNotMatch(rp, /Payment not saved/, 'no "Payment not saved." message for a Cancel');
  const ask = rp.indexOf("title: 'Record more than is owed?'");
  const send = rp.indexOf("post('/payments', { ...data, confirm_over: true }");
  assert.ok(ask > 0 && ask < send, 'the question comes before the confirmed payment');
  assert.ok(rp.indexOf('return false;', ask) < send, 'a Cancel returns before the confirmed payment is posted');
});

test('D-84 rent: ApiError is no longer imported, because nothing in rent.js uses it', () => {
  assert.doesNotMatch(rentSrc, /ApiError/);
  assert.match(rentSrc, /import \{ get, post, patch, qs, uploadFile, fileContentError \} from '\.\.\/api\.js';/);
});

test('D-84 owners: Cancel on "Pay more than the statement?" returns false before anything is posted, with no error', () => {
  const rp = ownSrc.slice(ownSrc.indexOf('const recordPayout = () => formModal('), ownSrc.indexOf('const voidPayout = async'));
  const cancel = rp.match(/^.*title: 'Pay more than the statement\?'.*$/m);
  assert.ok(cancel, 'the over-statement question is still asked');
  assert.match(cancel[0], /\)\) return false;$/, 'Cancel returns false on that same line');
  assert.doesNotMatch(cancel[0], /throw/, 'Cancel throws nothing');
  assert.doesNotMatch(rp, /Payout not saved/, 'no "Payout not saved." message for a Cancel');
  const ask = rp.indexOf("title: 'Pay more than the statement?'");
  const send = rp.indexOf("post(`${base}/payouts`, { ...d, month, confirm_over: true }");
  assert.ok(ask > 0 && ask < send, 'the question comes before the confirmed payout');
  assert.ok(rp.indexOf('return false;', ask) < send, 'a Cancel returns before the confirmed payout is posted');
});

test('D-84 owners: ApiError is no longer imported, because nothing in owners.js uses it', () => {
  assert.doesNotMatch(ownSrc, /ApiError/);
  assert.match(ownSrc, /import \{ get, post, patch, qs \} from '\.\.\/api\.js';/);
});

test('groups: a room\'s guests box uses the reservation rule and marks its own row, so a blank, 0, negative or decimal count is "At least 1 guest." and nothing posts', () => {
  assert.match(grpSrc, /import \{ addDays, boxValue, guestsProblem, matchedGuestNote \} from '\.\/reservations\.js';/);
  assert.doesNotMatch(grpSrc, /Number\(guests\.value\) \|\| 1/, 'a blank count is no longer sent as 1');
  const row = grpSrc.slice(grpSrc.indexOf('function roomRow'), grpSrc.indexOf('// A 409 is ROOMS_TAKEN'));
  assert.match(row, /const guestsKey = `num_guests-\$\{uid\}`;/, 'the error key names this row');
  assert.match(row, /dataset: \{ field: guestsKey \}/, 'the guests box is a field the form can mark');
  assert.doesNotMatch(row, /mk\('guests'/, 'the guests box is not the plain label wrapper');
  assert.match(row, /'aria-describedby': `gr-guests-\$\{uid\}-err`/, 'the guests input is tied to its error text');
  const check = row.indexOf('const problem = guestsProblem(guests.value);');
  assert.ok(check > 0, 'rooms() checks the count');
  assert.ok(row.indexOf('add(guestsKey, problem, new ApiError(problem, { status: 400, fields: { [guestsKey]: problem } }))') > check, 'the refusal names this row');
  assert.ok(check < row.indexOf('const base = {'), 'the count is checked before the room is built');
  assert.match(row, /num_guests: Number\(guests\.value\)/);
});

test('groups: the new group and add-a-room paths keep the row field error and check every room before anything is posted', () => {
  const ng = grpSrc.slice(grpSrc.indexOf('export async function newGroupModal'), grpSrc.indexOf("modal = openModal({ title: 'New group booking'"));
  assert.match(ng, /throw mapRoomError\(err, owners\);/, 'a row error reaches the form with its field key');
  assert.ok(ng.indexOf('rows.flatMap((r) => r.rooms())') < ng.indexOf("post('/booking-groups'"), 'every row is checked before the group is posted');
  const ar = grpSrc.slice(grpSrc.indexOf('async function addRoomModal'), grpSrc.indexOf('// ---------------------------------------------------------------- list'));
  assert.match(ar, /throw e instanceof ApiError \? e : new ApiError\(e\.message, \{ status: 400 \}\);/, 'a row error reaches the form with its field key');
  assert.ok(ar.indexOf('row.rooms()') < ar.indexOf('/rooms`, { rooms: list })'), 'the room is checked before it is posted');
});
