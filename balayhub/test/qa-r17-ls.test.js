'use strict';
// QA round 17, lane LS (frontend only, no database): picking photos uploads, compact bar keeps Occupancy and Sort, no failed-sync toast.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'listings.js'), 'utf8');

// listings.js imports app.js, so the pure helper is cut out of the source and run on its own.
const m = src.match(/export const compactSplit = .*;$/m);
const compactSplit = new Function(`${m[0].replace('export ', '')}; return compactSplit;`)();

test('compactSplit puts every filter in the panel (R20)', () => {
  const f = (name) => ({ name });
  const r = compactSplit([f('property_id'), f('occupancy'), f('status')], [f('unit_type'), f('sort')]);
  assert.deepEqual(r.quick, []);
  assert.deepEqual(r.more.map((x) => x.name), ['property_id', 'occupancy', 'status', 'unit_type', 'sort']);
});

test('the photo input uploads on pick; no Upload button or Choose photos toast', () => {
  assert.doesNotMatch(src, /Choose photos first\./);
  assert.match(src, /'aria-label': 'Listing photos', onchange: async/);
  assert.doesNotMatch(src, /\}, 'Upload'\)/);
});

test('the connect handler toasts only a good first sync', () => {
  assert.match(src, /if \(r\.sync\.ok\) toast\(`Connected\. \$\{text\}`\)/);
  assert.doesNotMatch(src, /Connected, but the first sync failed/);
});
