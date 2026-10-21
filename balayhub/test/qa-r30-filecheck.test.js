'use strict';
require('./helpers');

// QA round 30, FILECHECK (OPS-2, OPS-3, LT-1, INB-1). A file whose first bytes are not its type
// is refused in uploadFile before any request (D-112). Frontend-only: api.js is imported from a
// temp copy with a stubbed fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SENTENCE = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
const mk = (bytes, name, type) => new File([typeof bytes === 'string' ? bytes : Uint8Array.from(bytes)], name, { type });
// Complete images, not only their first bytes: the device checks the whole file as the server does (D-119, QA r37 PINS).
const ascii = (s) => [...Buffer.from(s, 'latin1')];
const PNG_OK = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii('IHDR'), ...Array(17).fill(0), 0, 0, 0, 10, ...ascii('IDAT'), ...Array(14).fill(0), 0, 0, 0, 0, ...ascii('IEND'), 0, 0, 0, 0];
const JPEG_OK = [0xff, 0xd8, 0xff, 0xe0, ...Array(60).fill(0), 0xff, 0xd9];
const WEBP_OK = [...ascii('RIFF'), 60, 0, 0, 0, ...ascii('WEBP'), ...ascii('VP8L'), ...Array(52).fill(0)];
let api;
let calls = 0;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filecheck30-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, '../public/js/api.js'), path.join(dir, 'api.js'));
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) };
  };
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
});

test('fileContentError accepts real signatures', async () => {
  const webp = WEBP_OK;
  assert.equal(await api.fileContentError(mk(PNG_OK, 'a.png', 'image/png')), null);
  assert.equal(await api.fileContentError(mk(JPEG_OK, 'a.jpg', 'image/jpeg')), null);
  assert.equal(await api.fileContentError(mk('%PDF-1.4', 'a.pdf', 'application/pdf')), null);
  assert.equal(await api.fileContentError(mk(webp, 'a.webp', 'image/webp')), null);
});

test('fileContentError refuses a renamed file', async () => {
  assert.equal(await api.fileContentError(mk('hello', 'text.png', 'image/png')), SENTENCE);
  assert.equal(await api.fileContentError(mk('hello world!!', 'x.webp', 'image/webp')), SENTENCE);
});

test('fileContentError leaves other cases to other checks', async () => {
  assert.equal(await api.fileContentError(undefined), null);
  assert.equal(await api.fileContentError(mk([], 'e.png', 'image/png')), null);
  assert.equal(await api.fileContentError(mk('hi', 'a.txt', 'text/plain')), null);
});

test('uploadFile refuses a fake PNG with no request', async () => {
  calls = 0;
  await assert.rejects(api.uploadFile('cleaning', 't1', mk('hello', 'text.png', 'image/png')), (e) => {
    assert.ok(e instanceof api.ApiError);
    assert.equal(e.message, SENTENCE);
    assert.equal(e.status, 415);
    assert.equal(e.code, 'BAD_FILE_CONTENT');
    return true;
  });
  assert.equal(calls, 0);
});

test('uploadFile sends a real PNG', async () => {
  calls = 0;
  await api.uploadFile('cleaning', 't1', mk(PNG_OK, 'a.png', 'image/png'));
  assert.equal(calls, 1);
});

test('empty and oversize files keep their own sentences', async () => {
  calls = 0;
  await assert.rejects(api.uploadFile('cleaning', 't1', mk([], 'e.png', 'image/png')),
    (e) => e.code === 'EMPTY_FILE' && e.message === 'This file is empty. Choose the file again.');
  await assert.rejects(api.uploadFile('cleaning', 't1', { size: 11 * 1024 * 1024, type: 'image/png', name: 'b.png' }),
    (e) => e.status === 413 && e.message === 'Files must be 10 MB or smaller.');
  assert.equal(calls, 0);
});
