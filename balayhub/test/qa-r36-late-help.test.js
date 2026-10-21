'use strict';
require('./helpers');

// Round 36 late fix (D-116): Mark as solved on a ticket must not use `disabled` on the focused button (it drops focus to BODY
// until the guard's later pass). It uses aria-busy plus a flag, so focus stays on the button until the redraw removes it.
// Source scan of the handler; frontend only, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/help.js'), 'utf8');
const start = src.indexOf("'Mark as solved'");
const from = src.lastIndexOf("h('button'", start);
const handler = src.slice(from, start);

test('Mark as solved keeps focus on the button while the request runs', () => {
  assert.ok(handler.includes('/resolve'), 'found the handler');
  assert.ok(!/\.disabled\s*=/.test(handler), 'handler must not set disabled on the focused button');
  assert.match(handler, /aria-busy/);
  assert.match(handler, /if \(solving\) return/);
});

// e.currentTarget is null after the first await, so the button must be read before it.
test('Mark as solved reads the button before the first await', () => {
  const i = handler.indexOf('const btn = e.currentTarget');
  assert.ok(i >= 0, 'button captured');
  assert.ok(i < handler.indexOf('await'), 'button read before the first await');
});

test('Send rating never reads e.currentTarget after an await', () => {
  const s = src.indexOf("'Send rating'");
  const h2 = src.slice(src.lastIndexOf("h('button'", s), s);
  assert.ok(!/await[\s\S]*e\.currentTarget/.test(h2), 'no e.currentTarget after await');
});
