// BKG-1: a date clash found while editing marks both date boxes, like New reservation (dateClashOnce keys on code DATES_TAKEN).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');

test('BKG-1 the client-side clash in Edit reservation carries DATES_TAKEN so both boxes are marked', () => {
  assert.match(src, /throw new ApiError\(clash\.message, \{ status: 409, code: 'DATES_TAKEN', fields: \{ check_out: clash\.message \} \}\)/);
  assert.match(src, /\}\)\(\)\.catch\(\(err\) => \{ throw dateClashOnce\(err\); \}\)/);
});
