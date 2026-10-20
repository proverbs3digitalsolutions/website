'use strict';

// QA r25 HELP (INB-3, D-106): a subject or topic filled from the follow-up link wins over an older saved draft.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/help.js'), 'utf8');
const view = src.slice(src.indexOf('export async function helpNewView'));

test('Contact support marks the subject as coming from the link only when the link has one', () => {
  assert.match(view, /name: 'subject'[^\n]*fromLink: Boolean\(query\.subject\)/);
});

test('Contact support marks the topic as coming from the link only when the link has one', () => {
  assert.match(view, /name: 'category'[^\n]*fromLink: Boolean\(query\.topic\)/);
});
