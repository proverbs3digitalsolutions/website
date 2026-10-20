// R24 CSS: compact tab labels wrap on phones; a button in a table cell lines up with the row's first line.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public/css/app.css'), 'utf8');

test('OPS-2: compact tabs wrap inside the phone grid cell', () => {
  const m = css.match(/@media \(max-width: 559px\) \{\s*\n\s*\.tabs--compact \{ display: grid[\s\S]*?\n\}/);
  assert.ok(m, 'phone media block for .tabs--compact exists');
  assert.match(m[0], /\.tabs--compact button, \.tabs--compact a \{ white-space: normal; overflow-wrap: anywhere; \}/);
});

test('MNY-4: .table td.cell-action drops top padding and stays on one line', () => {
  assert.match(css, /\.table td\.cell-action \{ padding-top: 0; white-space: nowrap; \}/);
});
