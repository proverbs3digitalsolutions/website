'use strict';
require('./helpers');

// Round 33 (RESERVATIONS, BKG-2, D-115): Cancel reservation and Void payment send their request from inside the dialog,
// so a server refusal is said there and the typed reason stays.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/reservations.js'), 'utf8');
const fn = (name) => {
  const at = src.indexOf(`const ${name} = async`);
  assert.ok(at > -1, `${name} exists`);
  return src.slice(at, src.indexOf('\n  };', at) + 5);
};

for (const [name, url, toastText] of [
  ['cancel', '/reservations/${r.booking_id}/cancel', 'Reservation cancelled.'],
  ['voidPayment', '/booking-payments/${p.payment_id}/void', 'Payment voided.'],
]) {
  test(`${name}: the post runs in onConfirm and nothing posts after the dialog`, () => {
    const body = fn(name);
    assert.match(body, /reason: true/);
    const on = body.indexOf('onConfirm:');
    assert.ok(on > -1, 'onConfirm is there');
    const call = body.slice(on, body.indexOf('});', on));
    assert.ok(call.includes('post(`' + url + '`, { reason: why })'), 'same url, reason from the dialog');
    const after = body.slice(body.indexOf('if (!reason) return;'));
    assert.ok(after.includes('if (!reason) return;'), 'guard kept');
    assert.ok(!after.includes('post('), 'no post after the dialog closes');
    assert.ok(!/try\s*\{/.test(body) && !body.includes('catch'), 'no try/catch around the post');
    assert.ok(after.includes(`toast('${toastText}')`) && after.includes('rerender()'), 'toast and redraw kept');
  });
}
