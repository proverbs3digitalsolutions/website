'use strict';
require('./helpers');

// QA round 31, LISTINGS (ONB-1). A renamed file in the Listing photos box is refused on the device, and every file
// refusal is said on the box's own line (uploadField), not in a toast. Frontend-only (source scans of photosModal).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/listings.js'), 'utf8');
const start = src.indexOf('async function photosModal(');
const modal = src.slice(start, src.indexOf('\n}\n', start));

test('imports the content check and the upload line helpers', () => {
  assert.match(src, /import \{[^}]*\bfileContentError\b[^}]*\} from '\.\.\/api\.js'/);
  assert.match(src, /\buploadField\b[\s\S]{0,400}\bfileRefused\b|\bfileRefused\b[\s\S]{0,400}\buploadField\b/);
});

test('empty check keeps its sentence and is coded; content check runs before shrink and the POST', () => {
  assert.match(modal, /if \(!f\.size\) throw new ApiError\('This file is empty\. Choose the file again\.', \{ status: 400, code: 'EMPTY_FILE' \}\)/);
  const empty = modal.indexOf('!f.size');
  const content = modal.indexOf('await fileContentError(f, PHOTO_KINDS)');
  assert.ok(content > empty, 'content check follows the empty check');
  assert.ok(content < modal.indexOf('shrink(f)'), 'content check before shrink');
  assert.ok(content < modal.indexOf("api('POST'"), 'content check before the POST');
  assert.match(modal, /throw new ApiError\(bad, \{ status: 415, code: 'BAD_FILE_CONTENT' \}\)/);
});

test('a file refusal is said on the box line, never toasted', () => {
  assert.match(modal, /let refusal = ''/);
  assert.match(modal, /catch \(err\) \{ if \(fileRefused\(err\)\) refusal = err\.message; else toast\(err\.message, 'error'\); \}/);
  assert.match(modal, /const up = uploadField\(input\)/);
  assert.match(modal, /h\('div', \{ class: 'field' \}, h\('label', \{ for: 'listing-photos-file' \}, 'Listing photos'\), up\.wrap\), h\('div', \{ class: 'chips' \}/);
  const redraw = modal.indexOf('box.replaceChildren(');
  assert.ok(modal.indexOf('up.show(refusal)') > modal.indexOf('focus?.(box)') && modal.indexOf('focus?.(box)') > redraw, 'shown after the redraw');
  assert.match(modal, /toast\('Photos uploaded\.'\)/);
});
