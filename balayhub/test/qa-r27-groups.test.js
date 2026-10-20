// QA r27 GST-1: the group form says so when the save joined a saved guest (D-99 S1), like the new-reservation form.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const src = readFileSync(path.join(__dirname, '../public/js/views/groups.js'), 'utf8');
const resSrc = readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
const matchedGuestNote = new Function(`${resSrc.match(/export function matchedGuestNote[\s\S]*?\n}\n/)[0].replace('export ', '')}\nreturn matchedGuestNote;`)();

test('groups.js imports matchedGuestNote and composes the toast from it', () => {
  assert.match(src, /import \{[^}]*\bmatchedGuestNote\b[^}]*\} from '\.\/reservations\.js'/);
  assert.ok(src.includes("const note = guest.full_name ? matchedGuestNote(guest.full_name, res.guest_name) : null;"));
  assert.ok(src.includes("toast(note ? `Group booking created. ${note}` : 'Group booking created.');"));
});

// Same composition as the source line, run on the real helper.
const compose = (guest, answered) => {
  const note = guest.full_name ? matchedGuestNote(guest.full_name, answered) : null;
  return note ? `Group booking created. ${note}` : 'Group booking created.';
};

test('toast message', () => {
  assert.equal(compose({ full_name: 'Maria Cruz' }, 'Maria Santos'), 'Group booking created. Saved under the existing guest Maria Santos (same email and first name).');
  assert.equal(compose({ full_name: 'Maria Cruz' }, '  maria  cruz '), 'Group booking created.');
  assert.equal(compose({ guest_id: 5 }, 'Maria Santos'), 'Group booking created.');
});
