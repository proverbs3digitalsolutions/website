const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/calendar.js'), 'utf8');

test('actions that redraw the calendar grid return focus through one helper', () => {
  assert.match(src, /async function reload\(key\)/);
  assert.match(src, /toast\('Dates blocked\.'\); reload\(`cal-night-\$\{listing\.unit_id\}-\$\{date\}`\)/);
  assert.match(src, /toast\('Block removed\.'\); reload\(\)/);
  assert.match(src, /toast\('Reservation moved\.'\)[^\n]*\n\s*reload\(`cal-booking-\$\{b\.booking_id\}`\)/);
  assert.match(src, /querySelector\('h1'\)/);
});
