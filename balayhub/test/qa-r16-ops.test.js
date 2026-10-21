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
    if (name === 'housekeeping') {
      // R23 OPS-2: a busy flag + aria-disabled (not `disabled`, which drops focus) guards a second pick.
      assert.match(block, /uploading = true/);
      assert.match(block, /uploading = false/);
      assert.match(block, /setAttribute\('aria-disabled', 'true'\)/);
      assert.match(block, /removeAttribute\('aria-disabled'\)/);
      assert.match(block, /onclick: \(e\) => \{ if \(uploading\) e\.preventDefault\(\); \}/);
      assert.match(block, /'data-focus-key': 'hk-photo'/);
      assert.doesNotMatch(block, /upload\.disabled/);
    } else {
      assert.match(block, /upload\.disabled = true/);
      assert.match(block, /upload\.disabled = false/);
    }
    assert.match(block, /upload\.value = ''/);
    assert.doesNotMatch(src, /'Upload photo'\)?\)/);
    assert.doesNotMatch(src, /\}, (T\()?'Upload photo'/);
  });
}

test('housekeeping input is named Add photo with Taglish; maintenance keeps its name', () => {
  assert.match(hk, /id: 'hk-photo-file'/);
  assert.match(hk, /h\('label', \{ for: 'hk-photo-file' \}, T\('Add photo'\)\)/);
  assert.match(hk, /'Add photo': 'Magdagdag ng litrato'/);
  assert.match(mt, /id: 'maint-upload-file'/);
  assert.match(mt, /h\('label', \{ for: 'maint-upload-file' \}, 'Upload photo or document'\)/);
});
