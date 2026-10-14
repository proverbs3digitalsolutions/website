'use strict';

// QA round 8, C22 (quote page). Frontend only, so these are source checks on quote.js (no database).
// #50: a language switch keeps what the guest typed (name, email, mobile and the two ticks) across the redraw.
// K3: a server field error sits at its field once; the banner names only the messages that have no field on the form.
// #8: the offer's expiry date uses fmtDateTimeL, so Taglish shows Taglish month names.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/quote.js'), 'utf8');

test('#50: the language redraw hands the typed details to the rebuilt page', () => {
  assert.match(src, /export async function quoteView\(el, \{ params, kept = \{\} \}\)/);
  assert.match(src, /const redraw = \(\) => quoteView\(el, \{ params, kept: typedDetails\(el\) \}\);/);
  // The snapshot reads the live form, so it works on any redraw (including one from a card with no form).
  assert.match(src, /const typedDetails = \(el\) => \{[\s\S]*?form\.form[\s\S]*?readForm\(f\)/);
  assert.match(src, /value: kept\.name \?\? \(q\.guest_name \|\| ''\)/);
  assert.match(src, /value: kept\.email \?\? \(q\.guest_email \|\| ''\)/);
  assert.match(src, /value: kept\.phone \?\? \(q\.guest_phone \|\| ''\)/);
  assert.match(src, /checked: Boolean\(kept\.accept_rules\)/);
  assert.match(src, /checked: Boolean\(kept\.consent\)/);
});

test('K3: a server field error sits at its field once; the banner names only the messages with no field', () => {
  // The old line showed every field message at its field and also in the banner.
  assert.doesNotMatch(src, /if \(err\.fields\) showErrors\(form, tFields\(err\.fields\)\);/);
  assert.match(src, /const unplaced = err\.fields \? showErrors\(form, tFields\(err\.fields\)\) : \[\];/);
  assert.match(src, /unplaced\.length \? unplaced\.join\(' '\)/);
  assert.match(src, /Object\.keys\(err\.fields \|\| \{\}\)\.length \? t\('Please check the highlighted fields\.'\)/);
});

test('K3: the banner line for field errors has a Taglish entry on this page', () => {
  assert.match(src, /'Please check the highlighted fields\.': 'Pakitingnan ang mga naka-highlight\.'/);
});

test('#8: the offer expiry uses the Taglish date-time formatter, not a fixed English month', () => {
  assert.match(src, /import \{[^}]*\bfmtDateTimeL\b[^}]*\} from '\.\.\/i18n\.js';/);
  assert.match(src, /date: fmtDateTimeL\(q\.expires_at\)/);
  assert.doesNotMatch(src, /toLocaleString\(undefined/);
});
