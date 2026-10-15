'use strict';
// QA round 14, lane GR1 (D-81 repeated names): per-room controls on the group detail page are told apart by dates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'groups.js'), 'utf8');

test('room table Remove button and room link name the row by listing and dates', () => {
  assert.doesNotMatch(src, /`Remove \$\{r\.unit_name\} from the group`/);
  assert.match(src, /'aria-label': `Remove \$\{rowName\}, from the group`/);
  assert.match(src, /const which = `\$\{r\.unit_name\}, \$\{fmtDate\(r\.check_in\)\} – \$\{fmtDate\(r\.check_out\)\}`/);
  assert.match(src, /href: `#\/reservations\/\$\{r\.booking_id\}`, 'aria-label': rowName/);
});
