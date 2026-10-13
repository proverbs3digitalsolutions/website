// QA round 1, lane L34: dates made from timestamps show the Manila day (manilaDay from ui.js), never a UTC slice.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', file), 'utf8');
// A timestamp field cut to its first 10 characters, e.g. r.created_at.slice(0, 10) or String(p.since).slice(0, 10).
const UTC_CUT = /\b\w*(?:_at|since)\)?\.slice\(\s*0\s*,\s*10\s*\)/;
const IMPORTS_MANILA_DAY = /import \{[^}]*\bmanilaDay\b[^}]*\} from '\.\.\/ui\.js'/;

test('#41 guest reviews date is the Manila day, not a UTC slice', () => {
  const src = read('guestcare.js');
  assert.doesNotMatch(src, UTC_CUT);
  assert.match(src, IMPORTS_MANILA_DAY);
  assert.match(src, /fmtDate\(manilaDay\(r\.created_at\)\)/);
});

test('#41 calendar sync "stale since" date is the Manila day, not a UTC slice', () => {
  const src = read('home.js');
  assert.doesNotMatch(src, UTC_CUT);
  assert.match(src, IMPORTS_MANILA_DAY);
  assert.match(src, /fmtDate\(manilaDay\(p\.since\)\)/);
});

test('#41 maintenance uses the shared manilaDay from ui.js, with no local copy', () => {
  const src = read('maintenance.js');
  assert.doesNotMatch(src, /const manilaDay\s*=/);
  assert.match(src, IMPORTS_MANILA_DAY);
  assert.doesNotMatch(src, UTC_CUT);
});
