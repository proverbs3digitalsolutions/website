'use strict';
// Reservation detail (frontend): overpaid alert nets refunds, cancelled wording, extras line, edit sends only changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
// The view imports browser modules, so pull the two pure helpers out of the source.
const grab = (name) => src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
const { overpaidAfterRefunds, changedFields } = new Function(`${grab('overpaidAfterRefunds')}\n${grab('changedFields')}\nreturn { overpaidAfterRefunds, changedFields };`)();

test('overpaid only counts what is still owed back', () => {
  assert.equal(overpaidAfterRefunds('-500.00', '0'), 500);
  assert.equal(overpaidAfterRefunds('-500.00', '500.00'), 0);
  assert.equal(overpaidAfterRefunds('-500.00', '200.00'), 300);
  assert.equal(overpaidAfterRefunds('100.00', '0'), 0);
  assert.equal(overpaidAfterRefunds('-0.30', '0.10'), 0.2);
});

test('edit sends only changed fields', () => {
  const r = { check_in: '2026-11-01', num_guests: 2, accommodation_total: '5000.00', notes: null, channel: 'direct' };
  const d = { check_in: '2026-11-01', num_guests: '2', accommodation_total: '5000', notes: '', channel: 'airbnb' };
  assert.deepEqual(changedFields(r, d), { channel: 'airbnb' });
  assert.deepEqual(changedFields(r, { notes: 'late' }), { notes: 'late' });
  assert.deepEqual(changedFields(r, { accommodation_total: '5500' }), { accommodation_total: '5500' });
});

test('detail card wiring', () => {
  assert.match(src, /overpaidAfterRefunds\(r\.balance, heldInfo\.refunded\)/);
  assert.match(src, /Cancelled — not owed/);
  assert.match(src, /'Extras'/);
  assert.match(src, /policy suggests refunding/);
  assert.match(src, /non-refundable, nothing is due back/);
  assert.match(src, /changedFields\(r, d\)/);
});
