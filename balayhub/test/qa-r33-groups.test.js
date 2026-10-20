'use strict';
require('./helpers');

// QA round 33, lane GROUPS (public/js/views/groups.js). Frontend only: source scan.
// Remove room and Cancel group send their request from inside the dialog (C1), so a refusal keeps the typed reason.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'groups.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function body(name) {
  const i = src.indexOf(`const ${name} = async`);
  assert.ok(i >= 0, `${name} found`);
  return src.slice(i, src.indexOf('\n  };', i));
}

for (const [name, url, toastText] of [
  ['removeRoom', '`/booking-groups/${g.group_id}/rooms/${r.booking_id}/remove`', 'Room removed.'],
  ['cancelGroup', '`/booking-groups/${g.group_id}/cancel`', 'Group cancelled.'],
]) {
  test(`${name}: the request runs inside the dialog and the typed reason survives a refusal`, () => {
    const b = body(name);
    assert.match(b, /reason: true/);
    assert.ok(b.includes(`onConfirm: (why) => post(${url}, { reason: why })`), 'onConfirm posts the same URL');
    const after = b.slice(b.indexOf('if (!reason) return;'));
    assert.ok(after.includes('if (!reason) return;'));
    assert.ok(!/post\(/.test(after), 'no post after the dialog');
    assert.ok(!/\brun\(/.test(b), 'does not use run()');
    assert.ok(after.includes(`toast('${toastText}'); rerender();`));
  });
}
