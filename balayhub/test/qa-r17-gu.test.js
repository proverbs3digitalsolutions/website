'use strict';

// QA round 17, #10 and #11: a draft registration says "Submit registration" (only a submitted one says
// "Save changes"), and a failed balance checkout shows its error above the Pay button, not as a toast.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const checkin = fs.readFileSync(path.join(__dirname, '../public/js/views/checkin.js'), 'utf8');
const pay = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');

test('both button-label lines test r?.submitted_at', () => {
  const lines = checkin.split('\n').filter((l) => l.includes("t('Save changes')"));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.match(l, /r\?\.submitted_at \? t\('Save changes'\) : t\('Submit registration'\)/);
});

test('payError sits before the Pay button, and the catch writes it instead of a toast', () => {
  assert.match(pay, /\[payError, btn, /);
  const click = pay.slice(pay.indexOf("btn.addEventListener('click'"), pay.indexOf('el.replaceChildren(page(', pay.indexOf("btn.addEventListener('click'")));
  assert.match(click, /payError\.replaceChildren\(\)/);
  assert.match(click, /payError\.replaceChildren\(h\('div', \{ class: 'alert alert--error', role: 'alert' \}, tServer\(err\.message\)\)\)/);
  assert.doesNotMatch(click, /toast\(tServer/);
});
