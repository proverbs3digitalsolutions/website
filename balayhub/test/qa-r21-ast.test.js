const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('assistant panel closes on hashchange without taking focus', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/assistant.js'), 'utf8');
  const m = src.match(/addEventListener\?\.\('hashchange', \(\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(m, 'hashchange listener exists');
  assert.match(m[1], /panel\.hidden = true/);
  assert.match(m[1], /aria-expanded', 'false'/);
  assert.doesNotMatch(m[1], /focus\(/);
});
