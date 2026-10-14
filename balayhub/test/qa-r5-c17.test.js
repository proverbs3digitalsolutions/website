'use strict';

// QA round 5, C17 (public pages). Frontend only, so these are source checks on the two guest pages.
// #49: the booking page add-on box writes the clamped quantity back, so the box shows what is charged.
// #9: only an open quote shows the PayMongo line in its footer; cancelled and expired quotes keep the privacy link.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');

test('#49: the add-on quantity box is written back with the clamped number it will charge', () => {
  const src = read('book.js');
  const start = src.indexOf('const sync = () => {');
  assert.ok(start > 0, 'the add-on sync function is found');
  const body = src.slice(start, src.indexOf('\n    };', start));
  assert.match(body, /qtyInput\.value = String\(q\)/, 'sync writes q back into the box');
});

test('#9: the PayMongo line is behind an open-quote check; the privacy link stays on every page', () => {
  const src = read('quote.js');
  const line = src.split('\n').find((l) => l.includes("t('Payments are processed securely by PayMongo. ')"));
  assert.ok(line, 'the footer line is found');
  assert.match(line, /q\?\.status === 'open' && t\('Payments are processed securely by PayMongo\. '\)/);
  assert.match(line, /h\('a', \{ href: '#\/privacy' \}, t\('Privacy notice'\)\)/);
});
