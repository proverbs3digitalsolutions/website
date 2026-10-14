'use strict';
// Reservation detail (frontend): overpaid alert nets refunds, cancelled wording, extras line, edit sends only changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
// The view imports browser modules, so pull the two pure helpers out of the source.
const grab = (name) => src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`))[0].replace('export ', '');
const { overpaid, changedFields } = new Function(`${grab('overpaid')}\n${grab('changedFields')}\nreturn { overpaid, changedFields };`)();

// Round 9 (D-85): the balance the server returns already counts refunds, so overpaid is the surplus and nothing is subtracted again.
test('overpaid is the surplus in the balance (refunds are already counted by the server)', () => {
  assert.equal(overpaid('-500.00'), 500);
  assert.equal(overpaid('0.00'), 0);
  assert.equal(overpaid('100.00'), 0);
  assert.equal(overpaid('-0.30'), 0.3);
});

test('edit sends only changed fields', () => {
  const r = { check_in: '2026-11-01', num_guests: 2, accommodation_total: '5000.00', notes: null, channel: 'direct' };
  const d = { check_in: '2026-11-01', num_guests: '2', accommodation_total: '5000', notes: '', channel: 'airbnb' };
  assert.deepEqual(changedFields(r, d), { channel: 'airbnb' });
  assert.deepEqual(changedFields(r, { notes: 'late' }), { notes: 'late' });
  assert.deepEqual(changedFields(r, { accommodation_total: '5500' }), { accommodation_total: '5500' });
});

test('detail card wiring', () => {
  assert.match(src, /overpaid\(r\.balance\)/);
  assert.match(src, /Cancelled — not owed/);
  assert.match(src, /'Extras'/);
  assert.match(src, /policy suggests refunding/);
  assert.match(src, /non-refundable, nothing is due back/);
  assert.match(src, /changedFields\(r, d\)/);
});
