'use strict';

// File downloads with emoji or CJK characters in the name. The Content-Disposition header must stay
// latin1-safe: an ASCII filename fallback plus filename* carrying the real name (RFC 6266).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, sql, manilaToday } = require('./helpers');

const PDF = Buffer.from('%PDF-1.4\n% filename test\n');
const EMOJI_CJK_NAME = '領収書 📄 Aircon.pdf';

let srv; let owner; let expenseId;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base);
  const property = (await owner.post('/api/properties', { property_name: 'Sampaguita', property_type: 'apartment', address: '12 Mabini St', city: 'Bacoor', province: 'Cavite' })).data.property;
  expenseId = (await owner.post('/api/expenses', { property_id: property.property_id, expense_date: manilaToday(), category: 'utilities', amount: '500', description: 'Bill' })).data.expense.expense_id;
});

test.after(async () => { await srv.close(); });

function parseDisposition(value) {
  const m = /^(inline|attachment); filename="([\x20-\x7e]*)"; filename\*=UTF-8''(\S+)$/.exec(value);
  assert.ok(m, `unexpected Content-Disposition: ${value}`);
  return { type: m[1], fallback: m[2], name: decodeURIComponent(m[3]) };
}

async function upload(name) {
  // The browser sends the name percent-encoded, as public/js/api.js does.
  const res = await owner.raw('POST', `/api/files?record_type=expense&record_id=${expenseId}`, PDF,
    { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(name) });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.file;
}

test('a file uploaded with an emoji and CJK name downloads with filename*', async () => {
  const file = await upload(EMOJI_CJK_NAME);
  const dl = await owner.get(`/api/files/${file.file_id}`);
  assert.equal(dl.status, 200, JSON.stringify(dl.data));
  const d = parseDisposition(dl.headers.get('content-disposition'));
  assert.equal(d.type, 'inline');
  // The upload replaces anything except ASCII letters, digits, space, . - _ ( ), so the stored name is already the safe one.
  assert.equal(d.name, file.file_name);
});

test('a stored name with emoji and CJK characters downloads inline and as an attachment', async () => {
  // Upload only keeps ASCII, so put the real CJK name on the row directly (as the owner receipt test does).
  const file = await upload('receipt.pdf');
  await sql('UPDATE files SET file_name = $1 WHERE file_id = $2', [EMOJI_CJK_NAME, file.file_id]);

  const inline = await owner.get(`/api/files/${file.file_id}`);
  assert.equal(inline.status, 200, JSON.stringify(inline.data));
  const di = parseDisposition(inline.headers.get('content-disposition'));
  assert.equal(di.type, 'inline');
  assert.equal(di.name, EMOJI_CJK_NAME);

  const attached = await owner.get(`/api/files/${file.file_id}?download=1`);
  assert.equal(attached.status, 200);
  const da = parseDisposition(attached.headers.get('content-disposition'));
  assert.equal(da.type, 'attachment');
  assert.equal(da.name, EMOJI_CJK_NAME);
});
