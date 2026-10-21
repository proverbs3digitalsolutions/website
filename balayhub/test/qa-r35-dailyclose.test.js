require('./helpers');
// Reopen day: Close the day takes its place, so the button hands the focus guard the key dc-close before the redraw (D-117).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/dailyclose.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const reopen = src.slice(src.indexOf('const reopen = async'), src.indexOf('const closes = hist.closes'));

test('reopen success re-keys the button to dc-close and focuses it before rerender', () => {
  const ok = reopen.indexOf("toast('Day reopened.')");
  const key = reopen.indexOf("btn.setAttribute('data-focus-key', 'dc-close')");
  const focus = reopen.indexOf('btn.focus(', key);
  const redraw = reopen.indexOf('rerender()', ok);
  assert.ok(ok > 0 && key > ok, 'key set after the success toast');
  assert.ok(focus > key && redraw > focus, 'focused again, then redrawn');
});

test('reopen catch path unchanged', () => {
  assert.match(reopen, /catch \(err\) \{ toast\(err\.message, 'error'\); reopening = false; btn\.removeAttribute\('aria-busy'\); \}/);
});
