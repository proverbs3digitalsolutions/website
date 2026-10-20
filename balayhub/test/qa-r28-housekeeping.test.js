'use strict';

// QA round 28, HOUSEKEEPING (OPS-1, OPS-2). An empty photo is refused before anything is saved or sent,
// and "Supplies used" with every quantity at 0 is keyed to the first quantity row. Frontend-only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');
const EMPTY = 'This file is empty. Choose the file again.';
const TYPE = 'Upload a JPG, PNG or WEBP photo up to 10 MB.';

function loadPhotoProblem() {
  const m = src.match(/export function photoProblem[\s\S]*?\n}\n/);
  assert.ok(m, 'photoProblem is exported');
  return new Function('T', `${m[0].replace('export ', '')}; return photoProblem;`)((s) => s);
}
const fn = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\nfunction ', src.indexOf(`function ${name}(`) + 1));

test('photoProblem: empty, wrong type, too big, fine, none', () => {
  const p = loadPhotoProblem();
  assert.equal(p({ type: 'image/png', size: 0 }), EMPTY);
  assert.equal(p({ type: 'application/pdf', size: 1000 }), TYPE);
  assert.equal(p({ type: 'image/png', size: 11 * 1024 * 1024 }), TYPE);
  assert.equal(p({ type: 'image/jpeg', size: 1024 * 1024 }), null);
  assert.equal(p(undefined), null);
});

test('the Taglish dictionary has the empty-file sentence', () => {
  assert.ok(src.includes(`'${EMPTY}': 'Walang laman ang file. Piliin ulit ang file.'`));
});

test('photoField is a keyed field with its own error line', () => {
  const m = src.match(/const photoField = [\s\S]*?;\n/)[0];
  assert.match(m, /'data-field': 'photo'/);
  assert.match(m, /class: 'error'/);
});

test('the three photo modals check the photo before anything is saved', () => {
  for (const name of ['damageModal', 'lostFoundModal', 'inspectModal']) {
    assert.match(fn(name), /check: async \(\) => \{ const p = await photoCheck\(photo\.files\[0\]\); return p \? \{ photo: p \} : null; \}/, name);
  }
});

test('the Photos card checks photoProblem before uploadFile and maps EMPTY_FILE', () => {
  const block = src.slice(src.indexOf('let uploading'), src.indexOf('const actionBtn'));
  assert.ok(block.indexOf('photoProblem(') > -1 && block.indexOf('photoProblem(') < block.indexOf('uploadFile('));
  assert.match(block, /err\.code === 'EMPTY_FILE'/);
});

test('all-zero supplies is refused through refuse() with the first quantity row', () => {
  assert.match(src, /if \(!items\.length\) refuse\(T\('Enter a quantity for at least one item\.'\), rows\.slice\(0, 1\)\);/);
  assert.doesNotMatch(src, /throw new ApiError\(T\('Enter a quantity for at least one item\.'\)/);
});
