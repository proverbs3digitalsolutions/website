'use strict';

// QA round 28, UPLOAD (BKG-2, OPS-1, INB-2 reply path). An empty file is refused in
// uploadFile before any request, for every control that uploads (D-110).
// Frontend-only: api.js is imported from a temp copy with a stubbed fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SENTENCE = 'This file is empty. Choose the file again.';
let api;
let calls = 0;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-upload28-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, '../public/js/api.js'), path.join(dir, 'api.js'));
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) };
  };
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
});

test('an empty file is refused before any request', async () => {
  calls = 0;
  for (const f of [{ size: 0, type: 'image/png', name: 'e.png' }, undefined, null]) {
    await assert.rejects(api.uploadFile('deposit', 'd1', f), (e) => {
      assert.ok(e instanceof api.ApiError);
      assert.equal(e.message, SENTENCE);
      assert.equal(e.status, 400);
      assert.equal(e.code, 'EMPTY_FILE');
      return true;
    });
  }
  assert.equal(calls, 0);
});

test('a 70-byte PNG still sends one request', async () => {
  calls = 0;
  // A complete 70-byte PNG (QA r37 PINS): signature, an IHDR chunk at byte 12, an IDAT chunk, and an IEND chunk ending at byte 70.
  const png70 = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17),
    Buffer.from([0, 0, 0, 13]), Buffer.from('IDAT'), Buffer.alloc(17),
    Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.alloc(4),
  ]);
  assert.equal(png70.length, 70);
  await api.uploadFile('deposit', 'd1', new File([png70], 'a.png', { type: 'image/png' }));
  assert.equal(calls, 1);
});

test('an 11 MB file still gets the 413 message and no request', async () => {
  calls = 0;
  await assert.rejects(api.uploadFile('deposit', 'd1', { size: 11 * 1024 * 1024, type: 'image/png', name: 'b.png' }),
    (e) => e.status === 413 && e.message === 'Files must be 10 MB or smaller.');
  assert.equal(calls, 0);
});
