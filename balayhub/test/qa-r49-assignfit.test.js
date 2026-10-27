'use strict';
require('./helpers');

// QA round 49 (INB49-2, C2): the inbox "Conversation assigned to" select was capped at 200px on every width,
// so a phone showed a cut name. Under 560px it now takes the whole row; wider screens keep the 200px cap.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8');
const SEL = '.inbox__head-actions select.input';

test('every { in app.css is closed', () => {
  // ponytail: not strict equality; a stray } at line ~1216 predates this lane (reported to the orchestrator).
  assert.ok((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length);
});

test('phone rule fills the row and comes after the 200px cap', () => {
  const cap = css.indexOf(`${SEL} { width: auto; max-width: 200px; }`);
  const m = /@media \(max-width: 559px\) \{ \.inbox__head-actions select\.input \{([^}]*)\} \}/.exec(css);
  assert.ok(cap > -1, 'the 200px rule is still there');
  assert.ok(m, 'phone rule exists');
  assert.match(m[1], /flex: 1 1 100%/);
  assert.match(m[1], /max-width: none/);
  assert.ok(m.index > cap, 'phone rule wins by order');
});
