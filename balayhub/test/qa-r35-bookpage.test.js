'use strict';
require('./helpers');

// Round 35 BOOKPAGE (D-117): Connect PayMongo, Turn on and Turn off take each other's place, so they share one focus key;
// Turn on with no listing stays focusable (aria-disabled, not disabled) and a press does nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'settings.js'), 'utf8');
const start = src.indexOf("h('h2', null, 'Direct booking page')");
const card = src.slice(start);
const slot = card.slice(card.indexOf("h('div', { class: 'chips'"), card.indexOf("!b.enabled && b.paymongo_connected && noListing"));
const btn = (label) => slot.split('\n').find((l) => l.includes(`'${label}')`)) || '';

test('the three buttons that swap places share the bp-main focus key', () => {
  for (const label of ['Turn off', 'Turn on', 'Connect PayMongo']) assert.match(btn(label), /'data-focus-key': 'bp-main'/, label);
});

test('Turn on is aria-disabled, never disabled, and does nothing while no listing is on the page', () => {
  const on = btn('Turn on');
  assert.doesNotMatch(on, /\bdisabled:/);
  assert.match(on, /'aria-disabled': noListing \? 'true' : null/);
  assert.match(on, /onclick: \(\) => \(noListing \? undefined : turnOn\(false\)\)/);
  assert.match(on, /'aria-describedby': noListing \? 'bp-on-hint' : undefined/);
});

test('Copy link, Page settings and Change key are unchanged', () => {
  assert.doesNotMatch(btn('Copy link'), /data-focus-key/);
  assert.doesNotMatch(btn('Page settings'), /data-focus-key/);
  assert.doesNotMatch(btn('Change key'), /data-focus-key/);
});
