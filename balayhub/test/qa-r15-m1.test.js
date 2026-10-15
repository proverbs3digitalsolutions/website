'use strict';
// QA round 15, lane M1 (frontend only): payout method starts on "Choose…" (#25); a refused From date stays when To changes (#20).
// node --test --test-concurrency=1 test/qa-r15-m1.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const owners = read('public/js/views/owners.js');
const stayreports = read('public/js/views/stayreports.js');
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};

test('#25 Record payout: no preset method, and the check asks', () => {
  const line = owners.split('\n').find((l) => l.includes("name: 'method'"));
  assert.ok(line);
  assert.doesNotMatch(line, /value: 'gcash'/);
  assert.match(line, /placeholderOption: 'Choose…'/);
  assert.match(owners, /check: \(d\) => \(!d\.method \? \{ method: 'Choose how you paid the owner\.' \} : null\)/);
});

test('owners.js: the standalone receipt link is a link-tap link', () => {
  assert.match(owners, /h\('a', \{ class: 'link-tap', href: `\/api\/files\/\$\{e\.receipt_file_id\}`/);
});

test('#20 periodBoxes keeps a refused From while To changes', () => {
  const periodBoxes = new Function(`${grab(stayreports, 'periodBoxes')}\nreturn periodBoxes;`)();
  assert.deepEqual(periodBoxes({ from: '0001-01-01' }, { from: '', to: '2026-10-20' }), { from: '0001-01-01', to: '2026-10-20' });
  assert.deepEqual(periodBoxes({}, { from: '2026-10-01', to: '2026-10-20' }), { from: '2026-10-01', to: '2026-10-20' });
  assert.deepEqual(periodBoxes({ to: '9999-01-01' }, { from: '2026-10-01', to: '' }), { from: '2026-10-01', to: '9999-01-01' });
});

test('#20 the status names the refused date', () => {
  const t = new Function(`${grab(stayreports, 'refusedDatesText')}\nreturn refusedDatesText;`)();
  assert.equal(t({ from: 'x' }), "The From date isn't used until you fix it.");
  assert.equal(t({ to: 'x' }), "The To date isn't used until you fix it.");
  assert.equal(t({}), '');
  assert.match(stayreports, /value: shown\[key\]/);
});

test('#25 the empty Method shows the custom sentence, not the generic required one', () => {
  const line = owners.split('\n').find((l) => l.includes("name: 'method'"));
  assert.doesNotMatch(line, /required: true/);
});
