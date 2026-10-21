'use strict';
require('./helpers');

// QA round 37, FILECHECK (INB-3, contract C2). The device runs the server's whole-file image check, so a file
// the server would refuse (415) is refused in the same press, before any record is saved (D-112, D-119).
// Parity: fileContentError is null exactly when ALLOWED[type].magic(bytes) is true. api.js is imported from a temp copy.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ALLOWED } = require('../src/lib/storage');

const SENTENCE = "This file isn't a real PDF, JPG, PNG or WEBP. Choose the file again.";
const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const txt = (s) => [...Buffer.from(s, 'latin1')];
const fill = (n, v = 0) => new Array(n).fill(v);
const png = () => [...SIG, 0, 0, 0, 0x0d, ...txt('IHDR'), ...fill(13), ...fill(4), 0, 0, 0, 0x0a, ...txt('IDAT'), ...fill(10), ...fill(4), 0, 0, 0, 0, ...txt('IEND'), ...fill(4)];
const jpeg = () => [0xff, 0xd8, 0xff, 0xe0, ...fill(60), 0xff, 0xd9];
const webp = (len) => {
  const body = [...txt('WEBP'), ...txt('VP8L'), ...fill(52)];
  const n = len === undefined ? body.length : len;
  return [...txt('RIFF'), n & 255, (n >> 8) & 255, 0, 0, ...body];
};
const mk = (bytes, type, name = 'f') => new File([Uint8Array.from(bytes)], name, { type });

let api;
let calls = 0;
test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-filecheck37-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, '../public/js/api.js'), path.join(dir, 'api.js'));
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ ok: true }) };
  };
  api = await import(pathToFileURL(path.join(dir, 'api.js')));
});

const png67 = png();
const cases = [
  ['complete PNG', png67, 'image/png'],
  ['complete JPEG', jpeg(), 'image/jpeg'],
  ['complete WEBP', webp(), 'image/webp'],
  ['repro: PNG signature + 64 bytes of text', [...SIG, ...txt('x'.repeat(64))], 'image/png'],
  ['PNG with last 12 bytes cut', png67.slice(0, -12), 'image/png'],
  ['JPEG without FF D9', [0xff, 0xd8, 0xff, 0xe0, ...fill(62)], 'image/jpeg'],
  ['JPEG with bytes after FF D9', [...jpeg(), ...fill(20, 7)], 'image/jpeg'],
  ['WEBP with a wrong length', webp(99), 'image/webp'],
  ['PNG of 63 bytes', [...png67.slice(0, 55), ...png67.slice(56)].slice(0, 63), 'image/png'],
  ['PNG with byte 4 wrong', [...png67.slice(0, 4), 0x00, ...png67.slice(5)], 'image/png'],
  ['PDF', txt('%PDF-1.4 hello'), 'application/pdf'],
  ['text typed image/png', txt('hello world, not an image at all'), 'image/png'],
];
for (const [name, bytes, type] of cases) {
  test(`parity with the server: ${name}`, async () => {
    const server = ALLOWED[type].magic(Buffer.from(bytes));
    assert.equal((await api.fileContentError(mk(bytes, type))) === null, server);
  });
}

test('the repro file, a complete PNG and a truncated PNG give the expected answers', async () => {
  assert.equal(await api.fileContentError(mk([...SIG, ...txt('x'.repeat(64))], 'image/png')), SENTENCE);
  assert.equal(await api.fileContentError(mk(png67, 'image/png')), null);
  assert.equal(await api.fileContentError(mk(png67.slice(0, -12), 'image/png')), SENTENCE);
});

test('no file, an empty file and another type give null', async () => {
  assert.equal(await api.fileContentError(undefined), null);
  assert.equal(await api.fileContentError(mk([], 'image/png')), null);
  assert.equal(await api.fileContentError(mk(txt('hi'), 'text/plain')), null);
});

test('an image over 10 MB is checked by its first bytes only, never read whole', async () => {
  const f = mk([...SIG], 'image/png');
  Object.defineProperty(f, 'size', { value: 11 * 1024 * 1024 });
  let whole = 0;
  const realSlice = f.slice.bind(f);
  f.arrayBuffer = async () => { whole += 1; return new ArrayBuffer(0); };
  f.slice = (a, b) => realSlice(a, b);
  assert.equal(await api.fileContentError(f), null);
  assert.equal(whole, 0);
});

test('uploadFile refuses the repro file with no request', async () => {
  calls = 0;
  await assert.rejects(api.uploadFile('help', 't1', mk([...SIG, ...txt('x'.repeat(64))], 'image/png', 'shot.png')), (e) => {
    assert.equal(e.message, SENTENCE);
    assert.equal(e.code, 'BAD_FILE_CONTENT');
    return true;
  });
  assert.equal(calls, 0);
});
