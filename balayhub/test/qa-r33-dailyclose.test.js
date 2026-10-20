require('./helpers');
// Close the day / Update close: the page redraws after the dialog has closed, so focus returns to the button (D-115).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/dailyclose.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('closeDay onSubmit redraws after the dialog closes', () => {
  const line = src.split('\n').find((l) => l.includes("onSubmit: async (d) => { await post('/daily-close'"));
  assert.ok(line, 'onSubmit line found');
  assert.match(line, /setTimeout\(rerender\)/);
  assert.doesNotMatch(line, /(^|[^(])\brerender\(\)/);
});

test('dc-close focus key and button unchanged', () => {
  assert.match(src, /'data-focus-key': 'dc-close', onclick: closeDay/);
});
