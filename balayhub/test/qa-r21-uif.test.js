'use strict';

// QA r21 UIF: showErrors focuses the first bad field in form order, not the first in the server's error list. Frontend-only: no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const JS = path.join(__dirname, '../public/js');
let ui;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r21uif-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(JS, f), path.join(dir, f));
  globalThis.Element = class { };
  globalThis.CSS = { escape: (x) => x };
  ui = await import(pathToFileURL(path.join(dir, 'ui.js')));
});

// Fields laid out in a row: index = position in the document.
function page(names) {
  const focused = [];
  const els = names.map((name, i) => {
    const input = {
      pos: i, focus() { focused.push(name); }, setAttribute() { },
      compareDocumentPosition(o) { return o.pos > this.pos ? 4 : o.pos < this.pos ? 2 : 0; },
    };
    const wrap = { classList: { add() { } }, querySelector: (sel) => (sel.includes('input') ? input : null) };
    return [name, wrap];
  });
  const map = Object.fromEntries(els);
  return { focused, form: { querySelector: (sel) => map[sel.match(/"(.+)"/)[1]] || null } };
}

test('server lists email before phone, form has phone first: phone is focused', () => {
  const { form, focused } = page(['name', 'phone', 'email']);
  ui.showErrors(form, { email: 'Bad email', phone: 'Bad phone' });
  assert.deepEqual(focused, ['phone']);
});

test('a single bad field is still focused', () => {
  const { form, focused } = page(['name', 'phone', 'email']);
  ui.showErrors(form, { email: 'Bad email' });
  assert.deepEqual(focused, ['email']);
});
