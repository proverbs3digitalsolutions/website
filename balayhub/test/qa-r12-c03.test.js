'use strict';
// QA round 12, lane C03 (reservations and groups views, frontend only, no database).
// #38 no default payment method, #3 You keep, #4 Overpaid, #2 clash before price, #5 edit source, #7 optional label,
// K13 save from the list opens the booking, K22 cards load together, #6 cancelled room total, K5 room type message, list default.
// node --test --test-concurrency=1 test/qa-r12-c03.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const res = read('public/js/views/reservations.js');
const grp = read('public/js/views/groups.js');
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};
const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const balanceLine = new Function('peso', `${grab(res, 'balanceLine')}\nreturn balanceLine;`)(peso);
const keepLine = new Function(`${grab(res, 'keepLine')}\nreturn keepLine;`)();
const roomTypeProblem = new Function(`${grab(grp, 'roomTypeProblem')}\nreturn roomTypeProblem;`)();

test('#4 balanceLine says Overpaid below zero, Balance otherwise', () => {
  assert.deepEqual(balanceLine('-800.00'), ['Overpaid', '₱800.00']);
  assert.deepEqual(balanceLine('1200.00'), ['Balance', '₱1,200.00']);
  assert.deepEqual(balanceLine('0.00'), ['Balance', '₱0.00']);
});

test('#3 keepLine is null for a channel booking with no fee, the amount otherwise', () => {
  assert.equal(keepLine({ channel: 'airbnb', total_amount: '5000.00', channel_fee: '0.00' }), null);
  assert.equal(keepLine({ channel: 'airbnb', total_amount: '5000.00', channel_fee: '750.00' }), 4250);
  assert.equal(keepLine({ channel: 'direct', total_amount: '4100.00', channel_fee: '0.00' }), 4100);
  assert.equal(keepLine({ channel: 'direct', total_amount: '4100.00', channel_fee: '600.00', channel_fee_ignored: true }), 4100);
  assert.match(res, /You keep: enter the channel fee to see this\./);
});

test('#38 a direct booking starts with no payment method and must choose one', () => {
  assert.doesNotMatch(res, /'gcash' : 'channel_payout'/);
  assert.match(res, /value: r\.channel === 'direct' \? '' : 'channel_payout'/);
  assert.match(res, /check: \(d\) => \(r\.channel === 'direct' && !d\.payment_method \? \{ payment_method: 'Choose how the guest paid\.' \}/);
});

test('K13 list callers of newReservationModal pass no onSaved; the calendar keeps its own', () => {
  assert.doesNotMatch(res, /newReservationModal\(\{ onSaved/);
  assert.match(res, /if \(onSaved\) onSaved\(res\.reservation\); else navigate/);
});

test('K22 the detail view loads its cards in one Promise.all', () => {
  assert.match(res, /await Promise\.all\(\[\s*canManage && confirmed \? checkinCard/);
  assert.doesNotMatch(res, /await card\(/);
});

test('#2 the edit dialog sends exclude_booking_id and checks clash before the price question', () => {
  assert.match(res, /exclude_booking_id: r\.booking_id/);
  const clash = res.indexOf('if (clash) throw new ApiError(clash.message');
  assert.ok(clash > 0 && clash < res.indexOf("title: 'Use the new price?'"));
  assert.match(res, /fields: \{ check_out: clash\.message \}/);
});

test('#5 #7 Edit has the source box (optional), shown only for direct, null for Not set', () => {
  const edit = res.slice(res.indexOf("title: 'Edit reservation'"));
  assert.match(edit, /name: 'source', label: 'Where did they book\? \(optional\)'/);
  assert.match(edit, /changes\.source = null/);
  assert.match(res, /For your own records, for example Facebook or a referral\./);
});

test('list requests and the export link use apiFilters, never changed()', () => {
  assert.match(res, /get\(`\/reservations\$\{qs\(apiFilters\(filters\)\)\}`\)/);
  assert.match(res, /\/api\/reservations\/export\$\{qs\(apiFilters\(filters\)\)\}/);
  assert.doesNotMatch(res, /get\(`[^`]*qs\(changed\(/);
});

test('#6 a cancelled group room shows a dash for its total', () => {
  assert.match(grp, /off \? \['—', h\('span', \{ class: 'sr-only' \}, ' Cancelled'\)\] : peso\(r\.total_amount\)/);
});

test('K5 the room type message names the room and sits on that row', () => {
  assert.equal(roomTypeProblem(3), 'Choose a room type for room 3.');
  assert.equal(roomTypeProblem(0), 'Choose a room type for this room.');
  assert.match(grp, /fields: \{ \[typeKey\]: roomTypeProblem\(num\) \}/);
  assert.match(grp, /dataset: \{ field: typeKey \}/);
});
