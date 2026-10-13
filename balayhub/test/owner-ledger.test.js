'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { pool } = require('../src/db');
const { addDays } = require('../src/lib/holidays');

const today = manilaToday();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const payoutBody = (over = {}) => ({ amount: '1000', paid_on: today, method: 'gcash', ...over });
const withdrawalBody = (over = {}) => ({ amount: '100', entry_date: today, note: 'Repair', ...over });
const payouts = (id) => `/api/unit-owners/${id}/payouts`;
const reserve = (id) => `/api/unit-owners/${id}/reserve`;
const withdraw = (id) => `/api/unit-owners/${id}/reserve/withdrawals`;

let srv; let owner; let manager; let staff; let other;
let ownerId; let secondId; let outsiderId; let orgId;
let firstPayout; let depositId; let firstWithdrawal; let secondWithdrawal;

const balanceOf = async (id) => (await owner.get(reserve(id))).data.balance;
const payoutCount = async (id, amount) => (await sql(
  'SELECT COUNT(*)::int AS n FROM owner_payouts WHERE owner_id = $1 AND amount = $2', [id, amount]))[0].n;
const addDeposit = async (id, amount) => (await sql(
  `INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, note)
   VALUES ($1, $2, 'deposit', $3, $4, 'Repairs reserve top-up') RETURNING entry_id`,
  [orgId, id, amount, today]))[0].entry_id;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'ledger-owner@example.com', 'Ledger Stays');
  other = await ownerAccount(srv.base, 'ledger-other@example.com', 'Other Ledger');
  const prop = (await owner.post('/api/properties', {
    property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila',
  })).data.property;
  const invite = async (email, role) => {
    const inv = await owner.post('/api/team/invitations', { email, role, property_ids: [prop.property_id] });
    const c = client(srv.base);
    await c.post('/api/auth/signup', {
      full_name: `${role} ${email}`, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
      invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
    });
    return c;
  };
  manager = await invite('ledger-manager@example.com', 'manager');
  staff = await invite('ledger-staff@example.com', 'staff');
  ownerId = (await owner.post('/api/unit-owners', { full_name: 'Juan Dela Cruz', email: 'juan.owner@example.com' })).data.owner_id;
  secondId = (await owner.post('/api/unit-owners', { full_name: 'Pedro Reyes' })).data.owner_id;
  outsiderId = (await other.post('/api/unit-owners', { full_name: 'Other Owner' })).data.owner_id;
  [{ organization_id: orgId }] = await sql('SELECT organization_id FROM unit_owners WHERE owner_id = $1', [ownerId]);
});
test.after(async () => { await srv.close(); });

test('an owner with no reserve activity has a zero balance; target and monthly come from the owner', async () => {
  await sql('UPDATE unit_owners SET reserve_target = 10000, reserve_monthly = 500 WHERE owner_id = $1', [ownerId]);
  assert.deepEqual((await owner.get(reserve(secondId))).data, { balance: '0.00', target: '0.00', monthly: '0.00', entries: [] });
  const r = await owner.get(reserve(ownerId));
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.balance, r.data.target, r.data.monthly, r.data.entries], ['0.00', '10000.00', '500.00', []]);
});

test('record a payout: saved with its owner, method, month and who recorded it; listed back', async () => {
  const r = await owner.post(payouts(ownerId), payoutBody({ amount: '1500', method: 'gcash', reference_number: 'GC-123', note: 'September share', month: '2026-09' }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const p = r.data.payout;
  firstPayout = p.payout_id;
  assert.equal(p.owner_id, ownerId);
  assert.equal(p.amount, '1500.00');
  assert.equal(p.paid_on, today);
  assert.equal(p.method, 'gcash');
  assert.equal(p.reference_number, 'GC-123');
  assert.equal(p.month, '2026-09');
  assert.equal(p.voided, false);
  assert.equal(p.voided_at, null);
  assert.equal(p.recorded_by_name, 'Maria Santos');
  assert.match(p.created_at, ISO);

  const noMonth = await owner.post(payouts(ownerId), payoutBody({ amount: '90' }));
  assert.equal(noMonth.status, 201);
  assert.equal(noMonth.data.payout.month, null, 'the month is optional');

  const list = await owner.get(payouts(ownerId));
  assert.equal(list.status, 200);
  assert.equal(list.data.payouts.length, 2);
  assert.ok(list.data.payouts.some((x) => x.payout_id === firstPayout && x.amount === '1500.00'));
});

test('payouts reject bad input with field-level errors and no internal detail', async () => {
  const ok = payoutBody();
  for (const [over, field] of [
    [{ amount: '0' }, 'amount'],
    [{ amount: '-5' }, 'amount'],
    [{ amount: 'abc' }, 'amount'],
    [{ amount: undefined }, 'amount'],
    [{ paid_on: addDays(today, 1) }, 'paid_on'],
    [{ paid_on: '2026-02-30' }, 'paid_on'],
    [{ method: 'paypal' }, 'method'],
    [{ month: '2026-13' }, 'month'],
    [{ reference_number: 'x'.repeat(101) }, 'reference_number'],
    [{ note: 'x'.repeat(501) }, 'note'],
  ]) {
    const r = await owner.post(payouts(ownerId), { ...ok, ...over });
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.data.code, 'VALIDATION', JSON.stringify(over));
    assert.ok(r.data.fields[field], `${field} is named`);
    assert.doesNotMatch(JSON.stringify(r.data), /INSERT|SELECT|\.js:|stack/i);
  }
  assert.equal((await owner.post(payouts(ownerId), ok, { 'Idempotency-Key': 'short' })).status, 400, 'bad key');
});

test('a retried save with the same Idempotency-Key records one payout', async () => {
  const body = payoutBody({ amount: '800', method: 'maya' });
  const headers = { 'Idempotency-Key': 'pay-key-0001' };
  const first = await owner.post(payouts(ownerId), body, headers);
  assert.equal(first.status, 201);
  const again = await owner.post(payouts(ownerId), body, headers);
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.payout.payout_id, first.data.payout.payout_id);
  assert.equal(await payoutCount(ownerId, '800.00'), 1);
  const [row] = await sql('SELECT idempotency_key FROM owner_payouts WHERE payout_id = $1', [first.data.payout.payout_id]);
  assert.equal(row.idempotency_key, 'pay-key-0001', 'the key is stored on the payout row');
});

test('saves with the same key at the same moment record one payout', async () => {
  const body = payoutBody({ amount: '250', method: 'cash' });
  const headers = { 'Idempotency-Key': 'pay-key-race1' };
  const rs = await Promise.all(Array.from({ length: 6 }, () => owner.post(payouts(ownerId), body, headers)));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 201]);
  assert.equal(new Set(rs.map((r) => r.data.payout.payout_id)).size, 1, 'every save returns the same payout');
  assert.equal(await payoutCount(ownerId, '250.00'), 1);
});

test('a payout save waits for the owner row lock, so a retry always sees the first save', async () => {
  // Deterministic. The test holds FOR NO KEY UPDATE on the owner row: that conflicts with the save's
  // FOR UPDATE but not with the foreign-key lock an insert takes, so only the explicit lock can make the save wait.
  const body = payoutBody({ amount: '260', method: 'cash' });
  const headers = { 'Idempotency-Key': 'pay-key-lock1' };
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT owner_id FROM unit_owners WHERE owner_id = $1 FOR NO KEY UPDATE', [ownerId]);
    let answered = false;
    const pending = owner.post(payouts(ownerId), body, headers).then((r) => { answered = true; return r; });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(answered, false, 'the save waits until the owner row is free');
    await holder.query('COMMIT');
    assert.equal((await pending).status, 201);
  } finally {
    await holder.query('ROLLBACK').catch(() => {});
    holder.release();
  }
  assert.equal(await payoutCount(ownerId, '260.00'), 1);
});

test('a key used for one owner cannot be replayed for another owner', async () => {
  const body = payoutBody({ amount: '100', method: 'cash' });
  const headers = { 'Idempotency-Key': 'pay-key-owner2' };
  assert.equal((await owner.post(payouts(ownerId), body, headers)).status, 201);
  const r = await owner.post(payouts(secondId), body, headers);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'IDEMPOTENCY_KEY_USED');
  assert.equal(await payoutCount(secondId, '100.00'), 0);
});

test('a key still being saved for one owner refuses another owner once that save commits', async () => {
  // The first save is held open in its own transaction. The second owner's check cannot see that uncommitted row,
  // so its insert goes ahead and waits on the unique index. When the first save commits, the insert fails with 23505
  // and the route answers from the committed row.
  const body = payoutBody({ amount: '70', method: 'cash' });
  const headers = { 'Idempotency-Key': 'pay-key-open1' };
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query(
      `INSERT INTO owner_payouts (organization_id, owner_id, amount, paid_on, method, idempotency_key)
       VALUES ($1, $2, 70, $3, 'cash', 'pay-key-open1')`, [orgId, ownerId, today]);
    let answered = false;
    const pending = owner.post(payouts(secondId), body, headers).then((r) => { answered = true; return r; });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(answered, false, 'the second save waits for the first save to commit');
    await holder.query('COMMIT');
    const r = await pending;
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'IDEMPOTENCY_KEY_USED');
  } finally {
    await holder.query('ROLLBACK').catch(() => {});
    holder.release();
  }
  assert.equal(await payoutCount(ownerId, '70.00'), 1);
  assert.equal(await payoutCount(secondId, '70.00'), 0);
});

test('void a payout: it stays listed, flagged voided; a second void is refused; month filter works', async () => {
  const p = (await owner.post(payouts(ownerId), payoutBody({ amount: '300', method: 'bank_transfer', month: '2026-08' }))).data.payout;
  assert.equal((await owner.post(`/api/owner-payouts/${p.payout_id}/void`, {})).status, 400, 'reason is required');
  const v = await owner.post(`/api/owner-payouts/${p.payout_id}/void`, { reason: 'Entered twice' });
  assert.equal(v.status, 200);
  assert.deepEqual(v.data, { ok: true });

  const aug = (await owner.get(`${payouts(ownerId)}?month=2026-08`)).data.payouts;
  assert.equal(aug.length, 1);
  assert.equal(aug[0].voided, true);
  assert.equal(aug[0].void_reason, 'Entered twice');
  assert.equal(aug[0].voided_by_name, 'Maria Santos');
  assert.match(aug[0].voided_at, ISO);

  const all = (await owner.get(payouts(ownerId))).data.payouts;
  assert.equal(all.find((x) => x.payout_id === firstPayout).voided, false, 'other payouts are not voided');
  assert.equal((await owner.get(`${payouts(ownerId)}?month=2026-13`)).status, 400);

  const twice = await owner.post(`/api/owner-payouts/${p.payout_id}/void`, { reason: 'again' });
  assert.equal(twice.status, 409);
  assert.equal(twice.data.code, 'ALREADY_VOIDED');
  assert.equal((await owner.post(`/api/owner-payouts/${crypto.randomUUID()}/void`, { reason: 'x' })).status, 404);
  assert.equal((await owner.post('/api/owner-payouts/not-a-uuid/void', { reason: 'x' })).status, 404);
});

test('reserve: deposits and withdrawals set the balance, and no withdrawal takes it below zero', async () => {
  depositId = await addDeposit(ownerId, '2000.00');
  let r = await owner.get(reserve(ownerId));
  assert.equal(r.data.balance, '2000.00');
  assert.equal(r.data.entries.length, 1);
  assert.equal(r.data.entries[0].kind, 'deposit');
  assert.equal(r.data.entries[0].voided, false);

  const w = await owner.post(withdraw(ownerId), withdrawalBody({ amount: '500', note: 'Aircon compressor' }));
  assert.equal(w.status, 201, JSON.stringify(w.data));
  const e = w.data.entry;
  assert.deepEqual([e.kind, e.amount, e.entry_date, e.note, e.voided, e.statement_id], ['withdrawal', '500.00', today, 'Aircon compressor', false, null]);
  assert.equal(e.recorded_by_name, 'Maria Santos');
  firstWithdrawal = e.entry_id;
  assert.equal(await balanceOf(ownerId), '1500.00');

  const over = await owner.post(withdraw(ownerId), withdrawalBody({ amount: '1500.01' }));
  assert.equal(over.status, 409);
  assert.equal(over.data.code, 'INSUFFICIENT_RESERVE');
  assert.match(over.data.error, /1,500\.00/);
  assert.equal(await balanceOf(ownerId), '1500.00', 'a refused withdrawal changes nothing');

  const exact = await owner.post(withdraw(ownerId), withdrawalBody({ amount: '1500' }));
  assert.equal(exact.status, 201, 'taking the balance to exactly zero is allowed');
  secondWithdrawal = exact.data.entry.entry_id;
  assert.equal(await balanceOf(ownerId), '0.00');

  const empty = await owner.post(withdraw(ownerId), withdrawalBody({ amount: '0.01' }));
  assert.equal(empty.status, 409);
  assert.equal(empty.data.error, 'The repairs reserve is empty.');
});

test('withdrawals need an amount, a date and a note; the date cannot be in the future', async () => {
  const url = withdraw(ownerId);
  for (const [over, field] of [
    [{ note: undefined }, 'note'],
    [{ note: 'x'.repeat(301) }, 'note'],
    [{ entry_date: undefined }, 'entry_date'],
    [{ entry_date: addDays(today, 1) }, 'entry_date'],
    [{ amount: '0' }, 'amount'],
  ]) {
    const r = await owner.post(url, withdrawalBody(over));
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.ok(r.data.fields[field], `${field} is named`);
  }
  assert.equal(await balanceOf(ownerId), '0.00', 'nothing was recorded');
});

test('withdrawals at the same moment cannot take the balance below zero', async () => {
  await addDeposit(secondId, '1000.00');
  const body = withdrawalBody({ amount: '600', note: 'Plumbing' });
  const rs = await Promise.all(Array.from({ length: 4 }, () => owner.post(withdraw(secondId), body)));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409, 409]);
  assert.equal(await balanceOf(secondId), '400.00');
});

test('voiding a withdrawal puts the money back and keeps the row; voiding a deposit is refused', async () => {
  const v = await owner.post(`/api/reserve-entries/${firstWithdrawal}/void`, { reason: 'Entered by mistake' });
  assert.equal(v.status, 200);
  assert.deepEqual(v.data, { ok: true });
  assert.equal(await balanceOf(ownerId), '500.00');
  assert.equal((await owner.post(`/api/reserve-entries/${firstWithdrawal}/void`, { reason: 'again' })).status, 409);

  const dep = await owner.post(`/api/reserve-entries/${depositId}/void`, { reason: 'Not allowed' });
  assert.equal(dep.status, 409);
  assert.equal(dep.data.code, 'DEPOSIT_NOT_VOIDABLE');
  assert.equal(await balanceOf(ownerId), '500.00', 'the deposit is still counted');

  assert.equal((await owner.post(`/api/reserve-entries/${secondWithdrawal}/void`, {})).status, 400, 'reason is required');
  assert.equal((await owner.post(`/api/reserve-entries/${crypto.randomUUID()}/void`, { reason: 'x' })).status, 404);

  const list = (await owner.get(reserve(ownerId))).data.entries;
  const voided = list.find((x) => x.entry_id === firstWithdrawal);
  assert.equal(voided.voided, true);
  assert.equal(voided.void_reason, 'Entered by mistake');
  assert.equal(voided.voided_by_name, 'Maria Santos');
  assert.match(voided.voided_at, ISO);
  assert.equal(list.find((x) => x.entry_id === depositId).voided, false);

  // The restored room can be used again.
  const again = await owner.post(withdraw(ownerId), withdrawalBody({ amount: '500' }));
  assert.equal(again.status, 201);
  assert.equal(await balanceOf(ownerId), '0.00');
});

test('only the workspace owner can use payouts or the reserve', async () => {
  for (const [name, c] of [['manager', manager], ['staff', staff]]) {
    assert.equal((await c.get(payouts(ownerId))).status, 403, `${name} lists payouts`);
    assert.equal((await c.post(payouts(ownerId), payoutBody())).status, 403, `${name} records a payout`);
    assert.equal((await c.post(`/api/owner-payouts/${firstPayout}/void`, { reason: 'x' })).status, 403, `${name} voids a payout`);
    assert.equal((await c.get(reserve(ownerId))).status, 403, `${name} reads the reserve`);
    assert.equal((await c.post(withdraw(ownerId), withdrawalBody())).status, 403, `${name} records a withdrawal`);
    assert.equal((await c.post(`/api/reserve-entries/${depositId}/void`, { reason: 'x' })).status, 403, `${name} voids an entry`);
  }
  assert.equal((await client(srv.base).get(payouts(ownerId))).status, 401, 'signed out');
});

test('another workspace gets 404 for these owners, payouts and reserve entries, and nothing changes', async () => {
  const before = await balanceOf(ownerId);
  assert.equal((await other.get(payouts(ownerId))).status, 404);
  assert.equal((await other.post(payouts(ownerId), payoutBody({ amount: '555' }))).status, 404);
  assert.equal((await other.post(`/api/owner-payouts/${firstPayout}/void`, { reason: 'x' })).status, 404);
  assert.equal((await other.get(reserve(ownerId))).status, 404);
  assert.equal((await other.post(withdraw(ownerId), withdrawalBody({ amount: '1' }))).status, 404);
  assert.equal((await other.post(`/api/reserve-entries/${depositId}/void`, { reason: 'x' })).status, 404);
  assert.equal((await other.get(payouts(outsiderId))).status, 200, 'their own owner is fine');
  assert.equal(await payoutCount(ownerId, '555.00'), 0);
  assert.equal(await balanceOf(ownerId), before);
});
