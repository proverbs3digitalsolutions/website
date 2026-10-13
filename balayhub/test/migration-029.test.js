'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql } = require('./helpers');
const account = require('../src/lib/account');
const { createStaysWorkspace } = require('../src/lib/demo');

let srv; let orgId; let ownerId; let userId;
test.before(async () => {
  srv = await startServer();
  orgId = await createStaysWorkspace({ email: 'm029@example.com', passwordHash: 'x' });
  [{ user_id: userId }] = await sql(`SELECT user_id FROM users WHERE organization_id = $1 LIMIT 1`, [orgId]);
  [{ owner_id: ownerId }] = await sql(`INSERT INTO unit_owners (organization_id, full_name, email) VALUES ($1, 'Test Owner', 'o@example.com') RETURNING owner_id`, [orgId]);
});
test.after(async () => { await srv.close(); });

const cols = async (table) => (await sql(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).map((r) => r.column_name);
const bad = (q, p) => assert.rejects(sql(q, p), /check|violates|unique/i);

test('029: tables and columns exist; existing owners keep the old fee rule', async () => {
  const want = {
    unit_owners: ['fee_model', 'flat_monthly_fee', 'reserve_target', 'reserve_monthly', 'portal_enabled', 'portal_invited_at', 'portal_last_seen_at'],
    owner_sessions: ['token_hash', 'owner_id', 'organization_id', 'created_at', 'last_seen_at', 'expires_at', 'user_agent'],
    owner_login_tokens: ['token_hash', 'owner_id', 'expires_at', 'used_at', 'created_at'],
    owner_statements: ['statement_id', 'organization_id', 'owner_id', 'month', 'status', 'snapshot', 'published_at', 'published_by', 'sent_at', 'sent_to', 'created_at', 'updated_at'],
    owner_payouts: ['payout_id', 'organization_id', 'owner_id', 'month', 'amount', 'paid_on', 'method', 'reference_number', 'note', 'recorded_by', 'created_at', 'voided_at', 'voided_by', 'void_reason', 'idempotency_key'],
    owner_reserve_entries: ['entry_id', 'organization_id', 'owner_id', 'kind', 'amount', 'entry_date', 'note', 'statement_id', 'recorded_by', 'created_at', 'voided_at', 'voided_by', 'void_reason'],
    bookings: ['owner_block_by'],
  };
  for (const [t, cs] of Object.entries(want)) { const have = await cols(t); for (const c of cs) assert.ok(have.includes(c), `${t}.${c}`); }
  const [o] = await sql(`SELECT * FROM unit_owners WHERE owner_id = $1`, [ownerId]);
  assert.equal(o.fee_model, 'net_pct');
  assert.equal(o.flat_monthly_fee, '0.00');
  assert.equal(o.reserve_target, '0.00');
  assert.equal(o.reserve_monthly, '0.00');
  assert.equal(o.portal_enabled, false);
  assert.equal(o.portal_invited_at, null);
});

test('029: unit_owners checks reject bad values', async () => {
  await bad(`UPDATE unit_owners SET fee_model = 'bogus' WHERE owner_id = $1`, [ownerId]);
  for (const c of ['flat_monthly_fee', 'reserve_target', 'reserve_monthly']) await bad(`UPDATE unit_owners SET ${c} = -1 WHERE owner_id = $1`, [ownerId]);
  await sql(`UPDATE unit_owners SET fee_model = 'flat', flat_monthly_fee = 1500, reserve_target = 10000, reserve_monthly = 500 WHERE owner_id = $1`, [ownerId]);
});

test('029: statements are unique per owner and month; month and status are checked', async () => {
  const ins = (month, status = 'draft') => sql(`INSERT INTO owner_statements (organization_id, owner_id, month, status) VALUES ($1, $2, $3, $4) RETURNING statement_id`, [orgId, ownerId, month, status]);
  const [s] = await ins('2026-09');
  assert.ok(s.statement_id);
  await bad(`INSERT INTO owner_statements (organization_id, owner_id, month) VALUES ($1, $2, '2026-09')`, [orgId, ownerId]);
  for (const m of ['2026-13', '2026-00', '26-09', '2026-9', 'September']) await assert.rejects(ins(m), /check/i, m);
  await assert.rejects(ins('2026-10', 'sent'), /check/i);
  const [d] = await sql(`SELECT status, snapshot FROM owner_statements WHERE statement_id = $1`, [s.statement_id]);
  assert.equal(d.status, 'draft');
  assert.equal(d.snapshot, null);
});

test('029: payouts and reserve entries enforce amounts, enums and void pairing', async () => {
  const pay = (over = {}) => {
    const v = { amount: 100, method: 'gcash', month: '2026-09', ref: null, note: null, voidedAt: null, reason: null, ...over };
    return sql(`INSERT INTO owner_payouts (organization_id, owner_id, month, amount, paid_on, method, reference_number, note, voided_at, void_reason)
      VALUES ($1, $2, $3, $4, current_date, $5, $6, $7, $8, $9)`, [orgId, ownerId, v.month, v.amount, v.method, v.ref, v.note, v.voidedAt, v.reason]);
  };
  await pay();
  await pay({ month: null, method: 'cash' });
  await assert.rejects(pay({ amount: 0 }), /check/i);
  await assert.rejects(pay({ amount: -5 }), /check/i);
  await assert.rejects(pay({ method: 'card' }), /check/i);
  await assert.rejects(pay({ month: '2026-13' }), /check/i);
  await assert.rejects(pay({ ref: 'x'.repeat(101) }), /check/i);
  await assert.rejects(pay({ note: 'x'.repeat(501) }), /check/i);
  await assert.rejects(pay({ voidedAt: new Date() }), /check/i);
  await assert.rejects(pay({ reason: 'oops' }), /check/i);
  await pay({ voidedAt: new Date(), reason: 'Wrong owner' });

  const res = (over = {}) => {
    const v = { kind: 'deposit', amount: 50, note: null, ...over };
    return sql(`INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, note) VALUES ($1, $2, $3, $4, current_date, $5)`, [orgId, ownerId, v.kind, v.amount, v.note]);
  };
  await res();
  await res({ kind: 'withdrawal', note: 'Aircon repair' });
  await assert.rejects(res({ kind: 'refund' }), /check/i);
  await assert.rejects(res({ amount: 0 }), /check/i);
  await assert.rejects(res({ note: 'x'.repeat(301) }), /check/i);
  await bad(`INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, statement_id) VALUES ($1, $2, 'deposit', 5, current_date, gen_random_uuid())`, [orgId, ownerId]);
  await bad(`INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, voided_at) VALUES ($1, $2, 'deposit', 5, current_date, now())`, [orgId, ownerId]);
});

test('029: payout idempotency key is unique per workspace and optional (null keys are free)', async () => {
  const [{ indexdef }] = await sql(`SELECT indexdef FROM pg_indexes WHERE indexname = 'owner_payouts_idem_uq'`);
  assert.match(indexdef, /UNIQUE/);
  assert.match(indexdef, /\(organization_id, idempotency_key\)/);
  assert.match(indexdef, /idempotency_key IS NOT NULL/);
  const pay = (key) => sql(`INSERT INTO owner_payouts (organization_id, owner_id, amount, paid_on, method, idempotency_key)
    VALUES ($1, $2, 10, current_date, 'cash', $3)`, [orgId, ownerId, key]);
  await pay(null);
  await pay(null);
  await pay('idem-029-key');
  await assert.rejects(pay('idem-029-key'), (err) => err.code === '23505' && err.constraint === 'owner_payouts_idem_uq');
});

test('029: sessions and tokens cascade with the owner; deleting a block owner clears owner_block_by', async () => {
  const [o2] = await sql(`INSERT INTO unit_owners (organization_id, full_name) VALUES ($1, 'Second') RETURNING owner_id`, [orgId]);
  await sql(`INSERT INTO owner_sessions (token_hash, owner_id, organization_id, expires_at) VALUES ('h-sess', $1, $2, now() + interval '30 days')`, [o2.owner_id, orgId]);
  await sql(`INSERT INTO owner_login_tokens (token_hash, owner_id, expires_at) VALUES ('h-tok', $1, now() + interval '30 minutes')`, [o2.owner_id]);
  await bad(`INSERT INTO owner_login_tokens (token_hash, owner_id, expires_at) VALUES ('h-tok', $1, now())`, [o2.owner_id]);
  const [u] = await sql(`SELECT unit_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1 LIMIT 1`, [orgId]);
  const [b] = await sql(`INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, owner_block_by, block_reason, confirmation_code)
    VALUES ($1, $2, 'block', current_date + 400, current_date + 403, $3, 'Owner stay', 'BLK' || substr(gen_random_uuid()::text, 1, 6)) RETURNING booking_id`, [orgId, u.unit_id, o2.owner_id]);
  await sql(`DELETE FROM unit_owners WHERE owner_id = $1`, [o2.owner_id]);
  assert.equal((await sql(`SELECT owner_block_by FROM bookings WHERE booking_id = $1`, [b.booking_id]))[0].owner_block_by, null);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM owner_sessions WHERE owner_id = $1`, [o2.owner_id]))[0].n, 0);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM owner_login_tokens WHERE owner_id = $1`, [o2.owner_id]))[0].n, 0);
});

test('029: export includes ledger rows but never sessions or tokens; purge removes everything', async () => {
  const [st] = await sql(`SELECT statement_id FROM owner_statements WHERE owner_id = $1 LIMIT 1`, [ownerId]);
  await sql(`INSERT INTO owner_statements (organization_id, owner_id, month, status, snapshot, published_at, published_by) VALUES ($1, $2, '2026-08', 'published', '{"a":1}', now(), $3)`, [orgId, ownerId, userId]);
  await sql(`INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, statement_id, recorded_by) VALUES ($1, $2, 'deposit', 10, current_date, $3, $4)`, [orgId, ownerId, st.statement_id, userId]);
  await sql(`INSERT INTO owner_sessions (token_hash, owner_id, organization_id, expires_at) VALUES ('h-sess2', $1, $2, now() + interval '1 day')`, [ownerId, orgId]);
  await sql(`INSERT INTO owner_login_tokens (token_hash, owner_id, expires_at) VALUES ('h-tok2', $1, now() + interval '1 day')`, [ownerId]);
  await sql(`INSERT INTO owner_payouts (organization_id, owner_id, amount, paid_on, method, idempotency_key) VALUES ($1, $2, 25, current_date, 'cash', 'exp-key-029')`, [orgId, ownerId]);
  const [u] = await sql(`SELECT unit_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1 LIMIT 1`, [orgId]);
  await sql(`INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, owner_block_by, block_reason, confirmation_code) VALUES ($1, $2, 'block', current_date + 500, current_date + 502, $3, 'Owner stay', 'BLK' || substr(gen_random_uuid()::text, 1, 6))`, [orgId, u.unit_id, ownerId]);

  const exp = await account.exportOrganization(orgId);
  assert.equal(exp.owner_statements.length, 2);
  assert.ok(exp.owner_payouts.length >= 3);
  assert.ok(exp.owner_reserve_entries.length >= 3);
  assert.equal(exp.owner_sessions, undefined);
  assert.equal(exp.owner_login_tokens, undefined);
  assert.ok(!JSON.stringify(exp).includes('h-sess2'));
  assert.ok(!JSON.stringify(exp).includes('exp-key-029'), 'the payout idempotency key is never exported');

  const tables = ['owner_sessions', 'owner_login_tokens', 'owner_reserve_entries', 'owner_payouts', 'owner_statements'];
  for (const t of tables) assert.ok(account.PURGED_TABLES.includes(t), t);
  await account.purgeOrganization(orgId);
  for (const t of ['owner_sessions', 'owner_reserve_entries', 'owner_payouts', 'owner_statements', 'unit_owners', 'bookings']) {
    assert.equal((await sql(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [orgId]))[0].n, 0, t);
  }
  assert.equal((await sql(`SELECT count(*)::int AS n FROM owner_login_tokens WHERE owner_id = $1`, [ownerId]))[0].n, 0);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM organizations WHERE organization_id = $1`, [orgId]))[0].n, 0);
});
