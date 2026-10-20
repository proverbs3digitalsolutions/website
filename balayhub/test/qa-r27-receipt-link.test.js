'use strict';

// Round 27: an uploaded expense receipt is linked to the expense (expenses.receipt_file_id), so the owner
// statement shows has_receipt; migration 040 links old unlinked expenses.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, client, sql, ownerAccount } = require('./helpers');

const PDF = Buffer.from('%PDF-1.4\n% receipt link test\n');
const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '040_link_expense_receipts.sql'), 'utf8');
const up = (c, id, name = 'r.pdf') => c.raw('POST', `/api/files?record_type=expense&record_id=${id}`, PDF,
  { 'Content-Type': 'application/pdf', 'X-File-Name': name });
const linkOf = async (id) => (await sql('SELECT receipt_file_id FROM expenses WHERE expense_id = $1', [id]))[0].receipt_file_id;
const filesOn = async (id) => (await sql('SELECT count(*)::int AS n FROM files WHERE related_record_id = $1', [id]))[0].n;

let srv; let host; let other; let manager; let staff; let property; let unit; let ownerId;
const mkExpense = async (c, p, u, desc) => (await c.post('/api/expenses', { property_id: p.property_id, unit_id: u && u.unit_id, expense_date: '2026-08-10', category: 'repairs', amount: '700', description: desc })).data.expense.expense_id;
const statementExpenses = async () => (await host.get(`/api/unit-owners/${ownerId}/statement?month=2026-08`)).data.statement.expenses;
const invite = async (email, role) => {
  const inv = await host.post('/api/team/invitations', { email, role, property_ids: [property.property_id] });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
};

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host-rl@example.com', 'Receipt Link A');
  other = await ownerAccount(srv.base, 'other-rl@example.com', 'Receipt Link B');
  property = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${property.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  ownerId = (await host.post('/api/unit-owners', { full_name: 'Net Owner', email: 'net-rl@example.com', management_fee_pct: '20', unit_ids: [unit.unit_id] })).data.owner_id;
  manager = await invite('manager-rl@example.com', 'manager');
  staff = await invite('staff-rl@example.com', 'staff');
});
test.after(async () => { await srv.close(); });

test('uploading a receipt links it to the expense and the owner statement shows it', async () => {
  const id = await mkExpense(host, property, unit, 'Aircon');
  let e = (await statementExpenses()).find((x) => x.expense_id === id);
  assert.equal(e.has_receipt, false);
  const r = await up(host, id);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  e = (await statementExpenses()).find((x) => x.expense_id === id);
  assert.equal(e.has_receipt, true);
  assert.equal(e.receipt_file_id, r.data.file.file_id);
  // A second upload replaces the link with the newest file.
  const r2 = await up(host, id, 'r2.pdf');
  e = (await statementExpenses()).find((x) => x.expense_id === id);
  assert.equal(e.receipt_file_id, r2.data.file.file_id);
});

test("a file for another organization's expense is refused and links nothing", async () => {
  const id = await mkExpense(host, property, unit, 'Plumbing');
  const r = await up(other, id);
  assert.equal(r.status, 404);
  assert.equal(await linkOf(id), null);
});

test('staff upload on an expense that already has a receipt saves the file and leaves the link unchanged', async () => {
  const id = await mkExpense(host, property, unit, 'Gas');
  const kept = (await up(host, id)).data.file.file_id;
  const r = await up(staff, id, 'staff.pdf');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(await filesOn(id), 2);
  assert.equal(await linkOf(id), kept);
});

test('staff upload on an expense with no receipt links it', async () => {
  const id = await mkExpense(host, property, unit, 'Water');
  const r = await up(staff, id, 'staff.pdf');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(await linkOf(id), r.data.file.file_id);
});

test('a manager upload replaces the receipt, newest wins', async () => {
  const id = await mkExpense(host, property, unit, 'Paint');
  await up(host, id);
  const r = await up(manager, id, 'manager.pdf');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(await linkOf(id), r.data.file.file_id);
});

test('a voided expense never gets a receipt link, but the file still saves', async () => {
  const id = await mkExpense(host, property, unit, 'Voided');
  assert.equal((await host.post(`/api/expenses/${id}/void`, { reason: 'Entered twice' })).status, 200);
  const r = await up(host, id);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(await linkOf(id), null);
  const s = await up(staff, id, 'staff.pdf');
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal(await linkOf(id), null);
});

test('a failed receipt link rolls back the file row with it', async () => {
  const id = await mkExpense(host, property, unit, 'Rollback');
  await sql("CREATE FUNCTION qa_r27_fail_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'link refused'; END $$");
  await sql('CREATE TRIGGER qa_r27_fail_link BEFORE UPDATE OF receipt_file_id ON expenses FOR EACH ROW EXECUTE FUNCTION qa_r27_fail_link()');
  try {
    const r = await up(host, id);
    assert.equal(r.status, 500);
    assert.equal(await filesOn(id), 0);
  } finally {
    await sql('DROP TRIGGER qa_r27_fail_link ON expenses');
    await sql('DROP FUNCTION qa_r27_fail_link()');
  }
});

test('migration 040 backfills an old unlinked expense from its newest file', async () => {
  const id = await mkExpense(host, property, unit, 'Old');
  const first = (await up(host, id)).data.file.file_id;
  const newest = (await up(host, id, 'n.pdf')).data.file.file_id;
  await sql('UPDATE expenses SET receipt_file_id = NULL WHERE expense_id = $1', [id]);
  await sql(`UPDATE files SET uploaded_at = now() - interval '1 day' WHERE file_id = $1`, [first]);
  const bare = await mkExpense(host, property, unit, 'No file');
  await sql(MIGRATION);
  assert.equal(await linkOf(id), newest);
  assert.equal(await linkOf(bare), null);
});

test('migration 040 never links a voided expense', async () => {
  const id = await mkExpense(host, property, unit, 'Voided backfill');
  await up(host, id);
  assert.equal((await host.post(`/api/expenses/${id}/void`, { reason: 'Duplicate' })).status, 200);
  await sql('UPDATE expenses SET receipt_file_id = NULL WHERE expense_id = $1', [id]);
  await sql(MIGRATION);
  assert.equal(await linkOf(id), null);
});

test("migration 040 links each expense to its own organization's newest receipt", async () => {
  const id = await mkExpense(host, property, unit, 'Own org');
  const own = (await up(host, id)).data.file.file_id;
  await sql('UPDATE expenses SET receipt_file_id = NULL WHERE expense_id = $1', [id]);
  // A newer file for the same record id, stored under another organization, must not hide this one.
  await sql(`INSERT INTO files (organization_id, related_record_type, related_record_id, storage_key, file_name, mime_type, size_bytes, uploaded_by, uploaded_at)
             SELECT organization_id, 'expense', $1, 'other/stray.pdf', 'stray.pdf', 'application/pdf', 10, user_id, now() + interval '1 hour'
               FROM users WHERE email = $2`, [id, 'other-rl@example.com']);
  await sql(MIGRATION);
  assert.equal(await linkOf(id), own);
});
