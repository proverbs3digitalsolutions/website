'use strict';
require('./helpers');

// QA round 30, HOUSEKEEPING (OPS-2, OPS-3). A renamed file is refused on the device before a report, item or
// inspection is saved, and Add photo names the content problem. Frontend-only (function-extract and source scans).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/views/housekeeping.js'), 'utf8');
const EMPTY = 'This file is empty. Choose the file again.';
const TYPE = 'Upload a JPG, PNG or WEBP photo up to 10 MB.';
const CONTENT = "This file isn't a real JPG, PNG or WEBP. Choose the file again.";

function load(contentStub) {
  const p = src.match(/export function photoProblem[\s\S]*?\n}\n/);
  const c = src.match(/export async function photoCheck[\s\S]*?\n}\n/);
  assert.ok(p && c, 'photoProblem and photoCheck are exported');
  return new Function('T', 'fileContentError', 'PHOTO_KINDS', `${p[0]}${c[0]}; return photoCheck;`.replaceAll('export ', ''))((s) => s, contentStub, 'JPG, PNG or WEBP');
}
const fn = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\nfunction ', src.indexOf(`function ${name}(`) + 1));

test('photoCheck: empty, type, content, fine', async () => {
  let calls = 0;
  const check = load(async (f) => { calls++; return f ? CONTENT : null; });
  assert.equal(await check({ type: 'image/png', size: 0 }), EMPTY);
  assert.equal(await check({ type: 'text/plain', size: 5 }), TYPE);
  assert.equal(calls, 0, 'stub not called for empty or wrong type');
  assert.equal(await check({ type: 'image/png', size: 5 }), CONTENT);
  assert.equal(await check(undefined), null);
  assert.equal(await load(async () => null)({ type: 'image/png', size: 5 }), null);
});

test('housekeeping.js imports fileContentError from api.js', () => {
  assert.match(src.split('\n').find((l) => l.includes("from '../api.js'")), /fileContentError/);
});

test('the three save-first forms await photoCheck in an async check', () => {
  for (const name of ['damageModal', 'lostFoundModal', 'inspectModal']) {
    assert.match(fn(name), /check: async \(\) => \{ const p = await photoCheck\(photo\.files\[0\]\); return p \? \{ photo: p \} : null; \}/, name);
  }
});

test('the Add photo catch maps the content refusal before the type and size', () => {
  const block = src.slice(src.indexOf('let uploading'), src.indexOf('const actionBtn'));
  const a = block.indexOf('BAD_FILE_CONTENT'), b = block.indexOf('UNSUPPORTED_FILE');
  assert.ok(a > -1 && b > a, 'BAD_FILE_CONTENT before UNSUPPORTED_FILE');
  assert.ok(block.includes("The file content doesn't match its type."));
  assert.ok(block.includes(`T("${CONTENT}")`));
});

test('the Taglish dictionary has the content sentence', () => {
  assert.ok(src.includes(`"${CONTENT}": 'Hindi totoong JPG, PNG o WEBP ang file na ito. Piliin ulit ang file.'`));
});
