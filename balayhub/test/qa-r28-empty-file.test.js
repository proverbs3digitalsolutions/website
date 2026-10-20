'use strict';
// QA round 28, PINS lane (cross-file check): the empty-file sentence is the same exact text everywhere it is said,
// the old receipt-only wording is gone from the app and server, and both the client (api.js) and the server (files.js)
// refuse an empty file with the EMPTY_FILE code. Reads the source files directly; no database, no browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SENTENCE = 'This file is empty. Choose the file again.';
const OLD = 'Choose the receipt file again';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('the exact empty-file sentence is in api.js, files.js, help.js, rent.js and housekeeping.js', () => {
  for (const rel of [
    'public/js/api.js',
    'src/routes/files.js',
    'public/js/views/help.js',
    'public/js/views/rent.js',
    'public/js/views/housekeeping.js',
  ]) {
    assert.ok(read(rel).includes(SENTENCE), `${rel} says: ${SENTENCE}`);
  }
});

test('the old receipt-only wording appears nowhere under public/js or src', () => {
  const files = [...walk(path.join(ROOT, 'public', 'js')), ...walk(path.join(ROOT, 'src'))];
  const hits = files.filter((f) => fs.readFileSync(f, 'utf8').includes(OLD)).map((f) => path.relative(ROOT, f));
  assert.deepEqual(hits, [], `old sentence still present in: ${hits.join(', ')}`);
});

test('api.js and files.js both refuse an empty file with the EMPTY_FILE code', () => {
  assert.match(read('public/js/api.js'), /code: 'EMPTY_FILE'/, 'client check in api.js uses EMPTY_FILE');
  assert.match(read('src/routes/files.js'), /code: 'EMPTY_FILE'/, 'server check in files.js uses EMPTY_FILE');
});
