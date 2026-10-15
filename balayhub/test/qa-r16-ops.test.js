// R16 #36 (S4): picking a photo uploads it at once on the cleaning task and the repair request.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const hk = readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');
const mt = readFileSync(path.join(__dirname, '../public/js/views/maintenance.js'), 'utf8');

for (const [name, src, kind] of [['housekeeping', hk, 'cleaning'], ['maintenance', mt, 'maintenance']]) {
  test(`${name}: file input change runs the upload, no Upload photo button`, () => {
    const i = src.indexOf("const upload = h('input'");
    const block = src.slice(i, src.indexOf('\n  });', i));
    assert.match(block, /onchange: async/);
    assert.ok(block.includes(`uploadFile('${kind}'`));
    assert.match(block, /upload\.disabled = true/);
    assert.match(block, /upload\.disabled = false/);
    assert.match(block, /upload\.value = ''/);
    assert.doesNotMatch(src, /'Upload photo'\)?\)/);
    assert.doesNotMatch(src, /\}, (T\()?'Upload photo'/);
  });
}

test('housekeeping input is named Add photo with Taglish; maintenance keeps its name', () => {
  assert.match(hk, /'aria-label': T\('Add photo'\)/);
  assert.match(hk, /'Add photo': 'Magdagdag ng litrato'/);
  assert.match(mt, /'aria-label': 'Upload photo or document'/);
});
