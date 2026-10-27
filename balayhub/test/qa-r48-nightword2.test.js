'use strict';
require('./helpers');
// QA round 48, NIGHTWORD2 (ONB48-1): "1 night booked", not "1 nights booked", on Home and the owner portal strip label.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');

// Pull the template literal that contains `marker` out of the source, and evaluate it with the given scope.
function render(src, marker, scope) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, 'template not found: ' + marker);
  const start = src.lastIndexOf('`', i);
  const end = src.indexOf('`', i);
  const tpl = src.slice(start, end + 1);
  return new Function(...Object.keys(scope), 'return ' + tpl)(...Object.values(scope));
}

test('Home: occupancy line pluralises the night word', () => {
  const src = read('home.js');
  const at = (n) => render(src, 'booked · ', { r: { current: { booked_nights: n, occupancy: 3 } } });
  assert.equal(at(1), '1 night booked · 3% occupancy');
  assert.equal(at(2), '2 nights booked · 3% occupancy');
  assert.equal(at(0), '0 nights booked · 3% occupancy');
});

test('Owner portal: strip label pluralises the night word', () => {
  const src = read('ownerportal.js');
  const at = (booked) => render(src, 'blocked in ', { u: { unit_name: 'Unit' }, booked, blocked: 0, month: 0, fmtMonth: () => 'Oct' });
  assert.equal(at(1), 'Unit: 1 night booked, 0 blocked in Oct');
  assert.equal(at(2), 'Unit: 2 nights booked, 0 blocked in Oct');
});
