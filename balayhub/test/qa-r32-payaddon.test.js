'use strict';
require('./helpers');

// QA round 32, GST-1: on the guest pay page "Choose at least one extra." must clear as soon as the guest
// picks or changes an extra (D-105, D-114). Source scan only: the add-on card is filled by a fetch, so it
// is not mounted with the stand-in DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pay = fs.readFileSync(path.join(__dirname, '../public/js/views/pay.js'), 'utf8');
const card = pay.slice(pay.indexOf('function addonsCard('), pay.indexOf('function billSection('));

test('the extras list clears the last message on any input', () => {
  assert.match(card, /h\('div', \{ class: 'gp-addons', oninput: \(\) => err\.replaceChildren\(\) \}, rows\)/);
});

test('pressing with nothing picked still shows the message and focuses the first add-on input', () => {
  assert.match(card, /Choose at least one extra\.'\)\)\); card\.querySelector\('\.gp-addons input'\)\?\.focus\(\); return;/);
});
