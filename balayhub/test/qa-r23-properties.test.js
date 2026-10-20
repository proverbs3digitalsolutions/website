// QA r23 PROPERTIES: Add unit's monthly rent opts into field()'s `positive` option, so rent 0 is named on the first Save.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('unit form: monthly rent is marked positive', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/properties.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes("name: 'monthly_rent'"));
  assert.ok(line, 'monthly_rent field exists');
  assert.match(line, /positive: true/);
});
