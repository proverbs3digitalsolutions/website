'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// QA r49: a stray top-level '}' in app.css swallowed the next rule (the theme switch icon sizing).
const raw = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
// Blank out comments and strings, keeping newlines so line numbers survive.
const css = raw.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, m => m.replace(/[^\n]/g, ' '));

test('app.css braces balance and never go negative', () => {
  let depth = 0;
  const lines = css.split('\n');
  lines.forEach((l, i) => {
    for (const ch of l) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; assert.ok(depth >= 0, `stray "}" on line ${i + 1}`); }
    }
  });
  assert.equal(depth, 0);
});

test('.themeswitch icon rule sits at depth 0 right after a closed rule', () => {
  const lines = css.split('\n');
  const idx = lines.findIndex(l => l.startsWith('.themeswitch button > [aria-hidden] {'));
  assert.ok(idx > 0);
  let depth = 0;
  for (let i = 0; i < idx; i++) for (const ch of lines[i]) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
  assert.equal(depth, 0);
  let p = idx - 1;
  while (p >= 0 && !lines[p].trim()) p--;
  assert.ok(/\}\s*$/.test(lines[p]) && lines[p].trim() !== '}', 'previous line must be a complete rule, not a lone "}"');
});
