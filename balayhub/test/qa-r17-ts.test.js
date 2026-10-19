'use strict';

// QA round 17, lane TS: top bar search covers five more groups and the scope line names what the role can search (O1, #36).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
const src = fs.readFileSync(path.join(JS, 'topsearch.js'), 'utf8');
let ts;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r17ts-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js', 'topsearch.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ts = await import(pathToFileURL(path.join(dir, 'topsearch.js')));
});

test('scopeLine: the four sentences', () => {
  assert.equal(ts.scopeLine({ role: 'owner', business_type: 'short_term' }),
    'Search covers reservations, guests, listings, properties, unit owners, quotes, repair requests, cleaning tasks, supplies, expenses, discount codes, add-ons, pages and help.');
  assert.equal(ts.scopeLine({ role: 'staff', business_type: 'short_term' }),
    'Search covers reservations, guests, listings, properties, repair requests, cleaning tasks, supplies, expenses, pages and help.');
  assert.equal(ts.scopeLine({ role: 'owner', business_type: 'long_term' }),
    'Search covers properties, tenants, repair requests, expenses, pages and help.');
  assert.equal(ts.scopeLine({ role: 'cleaner', business_type: 'short_term' }), 'Search covers pages and help.');
});

test('scopeLine: manager gets quotes, discount codes and add-ons but not unit owners', () => {
  const s = ts.scopeLine({ role: 'manager', business_type: 'short_term' });
  assert.match(s, /quotes/); assert.match(s, /discount codes/); assert.match(s, /add-ons/); assert.doesNotMatch(s, /unit owners/);
});

test('GROUP_ORDER lists the five new keys before help', () => {
  const m = src.match(/GROUP_ORDER = \[([^\]]*)\]/);
  assert.deepEqual([...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]),
    ['pages', 'reservations', 'guests', 'listings', 'properties', 'tenants', 'owners', 'quotes', 'maintenance', 'housekeeping', 'supplies', 'expenses', 'discount_codes', 'addons', 'help']);
});

test('the .tb-scope line is built from scopeLine(user())', () => {
  const line = src.split('\n').find((l) => l.includes('tb-scope'));
  assert.match(line, /scopeLine\(user\(\)\)/);
  assert.doesNotMatch(src, /Search covers guests, reservations/);
});
