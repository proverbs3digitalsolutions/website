'use strict';
// QA round 17, lane RS (reservations view, frontend only, no database).
// #5 a typed guest name that merges into an existing guest is said out loud; #7 Airbnb payments start on Cash.
// node --test --test-concurrency=1 test/qa-r17-rs.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');

function grab() {
  const m = src.match(/export function matchedGuestNote[\s\S]*?\n}\n/);
  assert.ok(m, 'matchedGuestNote is exported');
  return new Function(`${m[0].replace('export ', '')}\nreturn matchedGuestNote;`)();
}

test('#5 matchedGuestNote says when the saved guest differs from the typed name', () => {
  const note = grab();
  assert.equal(note('QA r17 DNR single', 'QA r17 DNR original'), 'Saved under the existing guest QA r17 DNR original (same email and first name).');
  assert.equal(note('  juan   cruz ', 'Juan Cruz'), null, 'spacing and case only');
  assert.equal(note('', 'Juan Cruz'), null);
  assert.equal(note('Juan', ''), null);
  assert.equal(note(undefined, null), null);
});

test('#5 the new-reservation save toasts the note after the saved toast, before the do-not-rebook toast', () => {
  const a = src.indexOf("const note = matchedGuestNote(data.guest_name, res.reservation.guest_name); if (note) toast(note);");
  const saved = src.indexOf("saved${res.confirmation?.sent");
  const dnr = src.indexOf('is marked "Do not rebook" in Guests.`, \'error\');');
  assert.ok(a > saved && a < dnr);
});

test('#7 Airbnb payment starts on Cash, direct on nothing, other channels on Channel payout', () => {
  assert.match(src, /value: r\.channel === 'direct' \? '' : r\.channel === 'airbnb' \? 'cash' : 'channel_payout'/);
});
