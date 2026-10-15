'use strict';
// QA round 16, lane LT (long-term rent; frontend only, no database).
// #14: the expenses Vendor filter lists vendors from the entries the list can show: voided ones only while the voided filter includes them.
// node --test --test-concurrency=1 test/qa-r16-lt.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..', 'public', 'js');
const rentSrc = fs.readFileSync(path.join(root, 'views', 'rent.js'), 'utf8');

let dir; let rent;
test.before(async () => {
  globalThis.Element = class { };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-qa-r16-lt-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'filters.js']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), "export const state = { user: { role: 'owner', business_type: 'long_term' } };\nexport const navigate = () => {};\n");
  fs.copyFileSync(path.join(root, 'views', 'rent.js'), path.join(dir, 'views', 'rent.js'));
  rent = await import(pathToFileURL(path.join(dir, 'views', 'rent.js')).href);
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('#14 vendorSource hides voided expenses by default and for no filter', () => {
  assert.equal(rent.vendorSource({}), '/expenses');
  assert.equal(rent.vendorSource({ include_voided: '' }), '/expenses');
  assert.equal(rent.vendorSource(), '/expenses');
});

test('#14 vendorSource includes voided expenses when the voided filter includes them', () => {
  assert.equal(rent.vendorSource({ include_voided: '1' }), '/expenses?include_voided=1');
  assert.equal(rent.vendorSource({ include_voided: 'only' }), '/expenses?include_voided=1');
});

test('#14 renderBar builds vendors from vendorSource and reloads them when the source changes', () => {
  assert.match(rentSrc, /get\(vendorSource\(f\)\)/);
  assert.doesNotMatch(rentSrc, /get\('\/expenses\?include_voided=1'\)/);
  assert.match(rentSrc, /vendorSource\(f\) !== vendorsFrom/);
});
