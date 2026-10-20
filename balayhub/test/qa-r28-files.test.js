'use strict';

// Round 28 (OPS-1, D-110): an empty file is said as empty, not as a wrong type. The server answers an empty body with
// 400 EMPTY_FILE after the access checks and before the type check, and stores nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const config = require('../src/config');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const EMPTY = 'This file is empty. Choose the file again.';
const up = (c, id, body, mime) => c.raw('POST', `/api/files?record_type=expense&record_id=${id}`, body, { 'Content-Type': mime, 'X-File-Name': 'e.bin' });
const filesOn = async (id) => (await sql('SELECT count(*)::int AS n FROM files WHERE related_record_id = $1', [id]))[0].n;

// Every stored file under the storage folder, so a refused upload that wrote a file would show up.
function storedFiles(dir = config.storageDir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? storedFiles(path.join(dir, e.name)) : 1), 0);
}

let srv; let owner; let other; let cleaner; let property; let expenseId;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'files-owner-r28@example.com', 'Files Owner');
  other = await ownerAccount(srv.base, 'files-other-r28@example.com', 'Files Other');
  property = (await owner.post('/api/properties', { property_name: 'Mabini Court', property_type: 'apartment', address: '4 Mabini St', city: 'Bacoor', province: 'Cavite' })).data.property;
  expenseId = (await owner.post('/api/expenses', { property_id: property.property_id, expense_date: '2026-08-10', category: 'repairs', amount: '700', description: 'Plumber' })).data.expense.expense_id;
  const inv = await owner.post('/api/team/invitations', { email: 'files-cleaner-r28@example.com', role: 'cleaner', property_ids: [property.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  cleaner = client(srv.base);
  const s = await cleaner.post('/api/auth/signup', {
    full_name: 'Aling Rosa', email: 'files-cleaner-r28@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
});
test.after(async () => { await srv.close(); });

test('an empty PNG to an expense is refused as empty, and nothing is saved', async () => {
  const before = storedFiles();
  const r = await up(owner, expenseId, Buffer.alloc(0), 'image/png');
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'EMPTY_FILE');
  assert.equal(r.data.error, EMPTY);
  assert.equal(await filesOn(expenseId), 0);
  assert.equal(storedFiles(), before);
});

test('an empty text body is refused as empty too, not as an unsupported type', async () => {
  const r = await up(owner, expenseId, Buffer.alloc(0), 'text/plain');
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(r.data.code, 'EMPTY_FILE');
  assert.equal(await filesOn(expenseId), 0);
});

test('a non-empty file of the wrong type is still refused as an unsupported type', async () => {
  const r = await up(owner, expenseId, Buffer.from('hello, not a receipt'), 'text/plain');
  assert.equal(r.status, 415, JSON.stringify(r.data));
  assert.equal(r.data.code, 'UNSUPPORTED_FILE');
  assert.equal(await filesOn(expenseId), 0);
});

test('a valid PNG still uploads and links nothing new', async () => {
  const r = await up(owner, expenseId, PNG, 'image/png');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(await filesOn(expenseId), 1);
});

test('an empty upload to an expense another workspace owns gives the access answer, not the empty answer', async () => {
  const r = await up(other, expenseId, Buffer.alloc(0), 'image/png');
  assert.equal(r.status, 404, JSON.stringify(r.data));
  assert.equal(r.data.code, 'NOT_FOUND');
  assert.equal(await filesOn(expenseId), 1);
});

test('an empty upload by a cleaner to an expense is refused by role, not as empty', async () => {
  const r = await up(cleaner, expenseId, Buffer.alloc(0), 'image/png');
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.notEqual(r.data.code, 'EMPTY_FILE');
});
