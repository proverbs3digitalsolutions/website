// R24 PROPERTIES (ONB-3): Add unit on a stay workspace asks the same two questions as Add listing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/properties.js'), 'utf8');
const unitFields = src.slice(src.indexOf('function unitFields'), src.indexOf('function unitModal'));
const stayBlock = unitFields.slice(unitFields.indexOf("!u.unit_id && state.user.business_type !== 'long_term'"), unitFields.indexOf("name: 'availability'"));

test('a new stay unit carries cleaning fee and maximum guests', () => {
  assert.ok(stayBlock.includes('nightly_rate'), 'nightly rate stays in the stay-only block');
  assert.match(stayBlock, /name: 'cleaning_fee', label: 'Cleaning fee per stay', type: 'money'/);
  assert.match(stayBlock, /placeholder: 'e\.g\. 500'/);
  assert.match(stayBlock, /Leave blank if you don't charge a cleaning fee\./);
  assert.match(stayBlock, /name: 'max_guests', label: 'Maximum guests', type: 'number', min: 1, max: 50, value: 2/);
});

test('the new fields appear only for a new unit in a workspace that takes stays', () => {
  assert.match(unitFields, /!u\.unit_id && state\.user\.business_type !== 'long_term'/);
  assert.equal((unitFields.match(/name: 'max_guests'/g) || []).length, 1);
  assert.equal((unitFields.match(/name: 'cleaning_fee'/g) || []).length, 1);
  assert.ok(unitFields.indexOf("name: 'max_guests'") > unitFields.indexOf("!u.unit_id && state.user.business_type !== 'long_term'"));
});
