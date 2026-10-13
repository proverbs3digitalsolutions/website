// QA round 1, lane L33: unit labels, manila dates and button sizes on the long-term views.
// Frontend-only source scan of the four views this lane owns.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VIEWS = ['rent.js', 'tenants.js', 'dashboard.js', 'properties.js'];
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', f), 'utf8');

test('#31 no long-term view builds "Unit " + the unit name by hand', () => {
  for (const f of VIEWS) {
    const src = read(f);
    assert.doesNotMatch(src, /Unit \$\{/, `${f} still hard-codes "Unit \${...}"`);
    assert.doesNotMatch(src, /['"]Unit ['"]\s*\+/, `${f} still concatenates "Unit "`);
  }
});

test('#31 every long-term view imports unitLabel from ui.js', () => {
  for (const f of VIEWS) {
    assert.match(read(f), /import \{[^}]*\bunitLabel\b[^}]*\} from '\.\.\/ui\.js';/, `${f} must import unitLabel from ui.js`);
  }
});

test('#31 the dashboard shows unit names through unitLabel, like the rent roll', () => {
  assert.match(read('dashboard.js'), /unitLabel\(c\.unit_name\)/);
});

test('#64 .btn--sm is only used on secondary or ghost row actions, never on main actions', () => {
  for (const f of VIEWS) {
    for (const line of read(f).split('\n')) {
      if (!line.includes('btn--sm')) continue;
      const shown = line.trim().slice(0, 120);
      assert.doesNotMatch(line, /btn--primary/, `${f} has a small primary (main) button: ${shown}`);
      assert.match(line, /btn--(secondary|ghost)/, `${f} has a small button that is neither secondary nor ghost: ${shown}`);
    }
  }
});

test('dates: no timestamp is cut to its first 10 characters for display (use manilaDay)', () => {
  for (const f of VIEWS) {
    const src = read(f);
    assert.doesNotMatch(src, /_at\b[^\n;]{0,30}\.slice\(0,\s*10\)/, `${f} pre-cuts a timestamp to a date`);
    assert.doesNotMatch(src, /\bString\([^)\n]*\)\.slice\(0,\s*10\)/, `${f} pre-cuts String(...) to a date`);
  }
});
