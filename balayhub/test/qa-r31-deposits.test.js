// QA r31 DEP-R: the deposit card's "Add damage photo" says a refused file on its own line (uploadField), not a toast.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/deposits.js'), 'utf8');
const start = src.indexOf("const upload = h('input'");
const block = src.slice(start, src.indexOf('if (!dep) {', start));

test('deposits.js imports uploadField and fileRefused', () => {
  assert.match(src, /import \{[^}]*\buploadField\b[^}]*\} from '\.\.\/ui\.js'/);
  assert.match(src, /import \{[^}]*\bfileRefused\b[^}]*\} from '\.\.\/ui\.js'/);
});

test('the photo input is wrapped by uploadField and the wrapper is rendered', () => {
  assert.match(src, /const up = uploadField\(upload\);/);
  assert.match(src, /'Damage \/ condition photos'\), up\.wrap\)/);
  assert.doesNotMatch(src, /'Damage \/ condition photos'\), upload\)/);
});

test('onchange clears the line first', () => {
  assert.match(block, /onchange: async \(\) => \{\s*up\.clear\(\);\s*if \(!upload\.files\[0\]\) return;/);
});

test('the catch enables the input before up.show, and fileRefused picks line or toast', () => {
  const c = block.slice(block.indexOf('catch (err)'));
  assert.ok(c.indexOf('upload.disabled = false') > -1 && c.indexOf('upload.disabled = false') < c.indexOf('up.show('));
  assert.match(c, /if \(fileRefused\(err\)\) up\.show\(err\.message\); else toast\(err\.message, 'error'\)/);
  assert.match(block, /toast\('Photo added\.'\)/);
});
