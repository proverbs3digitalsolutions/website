'use strict';
// QA round 8, lane C26 (reservations and groups views, frontend only, no database).
// #47: Cancel on "Record more than the balance?" returns quietly: nothing is posted, no "Payment not saved." error.
// #42: each check-in date link in the list names its guest, listing and date.
// #48: a guest count that is empty, not a whole number or below 1 is refused at its field before anything is posted.
// #1:  a room-type quote asks the server for the listing BalayHub would pick now (property_id + room_type) and names it.
// K9:  the New reservation cleaning fee box says a blank one uses the rate card's cleaning fee.
// D-81: every repeated row button in these two files names its row (damage buttons, payment rows, group room rows).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
const grpSrc = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/groups.js'), 'utf8');
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};

test('#47 Cancel on "Record more than the balance?" returns false: nothing is posted, the form stays open, and no error is shown', () => {
  const rp = resSrc.slice(resSrc.indexOf('const recordPayment = () => formModal'), resSrc.indexOf('const editDetails'));
  assert.doesNotMatch(rp, /Payment not saved/, 'no "Payment not saved." message for a Cancel');
  assert.doesNotMatch(rp, /throw new ApiError/, 'a Cancel throws nothing');
  const ask = rp.indexOf('confirmDialog(');
  const stop = rp.indexOf('return false;');
  const send = rp.indexOf('await post(`/reservations/${r.booking_id}/payments`');
  assert.ok(ask > 0 && ask < stop && stop < send, 'a Cancel returns before the payment is posted');
  assert.match(rp, /if \(over > 0 && !await confirmDialog\(/);
});

test('#42 each check-in date link in the list names its guest, listing and date (staff get the name staff are allowed to see)', () => {
  assert.ok(resSrc.includes("h('a', { href: `#/reservations/${r.booking_id}`, 'aria-label': `${r.guest_name || r.guest_label || 'Guest'}, ${r.unit_name}, check-in ${fmtDate(r.check_in)}` }, fmtDate(r.check_in))"));
});

test('#48 a guest count must be a whole number from 1; anything else is "Enter a whole number of guests, 1 or more."', () => {
  const guestsProblem = new Function(`${grab(resSrc, 'guestsProblem')}\nreturn guestsProblem;`)();
  for (const bad of ['', ' ', '0', '-3', '1.5', 'abc', '1e2']) assert.equal(guestsProblem(bad), 'Enter a whole number of guests, 1 or more.', `"${bad}"`);
  for (const good of ['1', '2', '50', ' 3 ']) assert.equal(guestsProblem(good), null, `"${good}"`);
});

test('#48 New reservation and Edit check the guest count before anything is posted, and say so at the field', () => {
  const newRes = resSrc.slice(resSrc.indexOf('onSubmit: async (data) => {'), resSrc.indexOf("const res = await post('/reservations', data);"));
  assert.ok(newRes.includes('const problem = guestsProblem(data.num_guests);'));
  assert.ok(newRes.includes('if (problem) throw new ApiError(problem, { status: 400, fields: { num_guests: problem } });'));
  const edit = resSrc.slice(resSrc.indexOf('let changes = changedFields(r, d);'), resSrc.indexOf('toast(saved.changed'));
  assert.ok(edit.includes("if ('num_guests' in changes) {"), 'only a changed guest count is checked, so a stored blank is not refused on an unrelated save');
  assert.ok(edit.includes('const problem = guestsProblem(changes.num_guests);'));
  const check = edit.indexOf('guestsProblem(changes.num_guests)');
  const send = edit.indexOf('await patch(`/reservations/${r.booking_id}`, changes)');
  assert.ok(check > 0 && check < send, 'the guest count is checked before the PATCH');
});

test('#1 a room-type quote asks the server with property_id and room_type, and names the listing it returns', () => {
  const refresh = resSrc.slice(resSrc.indexOf('async function refreshQuote'), resSrc.indexOf("form.addEventListener('change', refreshQuote)"));
  assert.ok(refresh.includes('get(`/reservations/quote${qs({ ...u, check_in: ci, check_out: coNow })}`)'));
  assert.ok(resSrc.includes('const quoteTarget = () => {'), 'the quote target is built in one place');
  assert.doesNotMatch(resSrc, /quoteUnit/, 'the page no longer picks the first listing of a type');
  assert.doesNotMatch(resSrc, /listings\.find\(\(l\) => l\.property_id === pid/);
  assert.ok(refresh.includes('(${q.unit_name}, the free listing BalayHub would pick now)'), 'the guide line names the listing');
  assert.ok(refresh.includes("if (!u) { ++seq; applyQuote(null); quoteBox.textContent = typeMode() ? 'Choose a room type to see the price.'"), 'no room type chosen says so');
});

test('#1 a group room row quotes a room type the same way, names the listing, and keeps the no-room message', () => {
  const suggest = grpSrc.slice(grpSrc.indexOf('async function suggest()'), grpSrc.indexOf("mode.addEventListener('change'"));
  assert.ok(suggest.includes("let pick = mode.value === 'unit' && unit.value ? { unit_id: unit.value } : null;"), 'the quote target follows the room choice');
  assert.ok(suggest.includes('get(`/reservations/quote${qs({ ...pick, check_in: ci.value, check_out: co.value })}`)'));
  assert.doesNotMatch(suggest, /listings\.find/, 'the page no longer picks the first listing of a type');
  assert.ok(suggest.includes('(${q.unit_name}, the free listing BalayHub would pick now)'), 'the note names the listing');
  assert.ok(suggest.includes('catch (err) { if (mine === seq) { fill(null); note.textContent = err.message; } }'), 'a 409 shows the server message');
});

test("K9 the New reservation cleaning fee box says a blank one uses the rate card's cleaning fee", () => {
  assert.match(resSrc, /name: 'cleaning_fee', label: 'Cleaning fee', type: 'money', hint: "Leave blank to use your rate card's cleaning fee\."/);
});

test('D-81 every repeated damage button in the reservation detail names its report', () => {
  const dmg = resSrc.slice(resSrc.indexOf('async function damageCard'), resSrc.indexOf('async function lostFoundCard'));
  assert.ok(dmg.includes("'aria-label': `Charge the guest for ${x.description}`"));
  assert.ok(dmg.includes("'aria-label': `Deduct from deposit for ${x.description}`"));
  assert.ok(dmg.includes("'aria-label': `Waive ${x.description}`"));
});

test('D-81 every repeated payment row button names its payment (receipt, email, void)', () => {
  const pay = resSrc.slice(resSrc.indexOf('payments.map((p) =>'), resSrc.indexOf('charges, proofs, refunds'));
  assert.ok(pay.includes("'aria-label': `Receipt for ${peso(p.amount)} on ${fmtDate(p.payment_date)}`"));
  assert.ok(pay.includes("'aria-label': `${p.receipt_sent_at ? 'Email again' : 'Email'} for ${peso(p.amount)} on ${fmtDate(p.payment_date)}`"));
  assert.ok(pay.includes("'aria-label': `Void payment of ${peso(p.amount)} on ${fmtDate(p.payment_date)}`"));
});

test('D-81 every group room row has its own Remove name, renumbered when a row is removed', () => {
  const rr = grpSrc.slice(grpSrc.indexOf('function roomRow'), grpSrc.indexOf('// A 409 is ROOMS_TAKEN'));
  assert.ok(rr.includes("'aria-label': `Remove this room, room ${number}`"));
  assert.ok(rr.includes('setNumber(n) {'), 'the row can be renumbered');
  const nm = grpSrc.slice(grpSrc.indexOf('const addRow = () => {'), grpSrc.indexOf('addRow(); addRow();'));
  assert.ok(nm.includes('number: rows.length + 1'));
  assert.ok(nm.includes('rows.forEach((x, i) => x.setNumber(i + 1));'));
});
