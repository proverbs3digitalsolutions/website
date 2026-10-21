'use strict';

require('./helpers');

// QA round 40 (OWNERLOCK): a payout that was checked before a removal and then waits on the owner's row lock is refused, not saved.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount, manilaToday } = require('./helpers');
const { pool } = require('../src/db');

const today = manilaToday();
const payoutBody = (over = {}) => ({ amount: '100', paid_on: today, method: 'cash', month: '2026-09', ...over });
const payouts = (id) => `/api/unit-owners/${id}/payouts`;
const removedText = (name) => `${name} was removed, so a payout can't be recorded. Payouts already recorded stay on their statements.`;
const RACE_NAME = 'QA r40 ownerlock Race Owner';
const KEYED_NAME = 'QA r40 ownerlock Keyed Owner';
const KEY = 'qa-r40-ownerlock-1';

let srv; let host; let raceId; let keyedId;

const payoutRows = async (id) => (await sql('SELECT payout_id FROM owner_payouts WHERE owner_id = $1', [id])).length;

// Waits until a payout is queued behind the owner's row lock, which proves its first owner read already ran.
async function waitForQueuedPayout() {
  for (let i = 0; i < 400; i += 1) {
    const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE '%FROM unit_owners WHERE owner_id = $1 FOR UPDATE%'`);
    if (n > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the payout never waited behind the removal');
}

// The removal is written but not committed yet. The payout starts, reads the owner as still active and queues on the lock.
// Only then does the removal commit.
async function racePayout(id, headers) {
  const remover = await pool.connect();
  try {
    await remover.query('BEGIN');
    await remover.query('UPDATE unit_owners SET archived_at = now(), portal_enabled = false WHERE owner_id = $1', [id]);
    const pending = host.post(payouts(id), payoutBody(), headers);
    await waitForQueuedPayout();
    await remover.query('COMMIT');
    return await pending;
  } finally {
    await remover.query('ROLLBACK').catch(() => {});
    remover.release();
  }
}

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'ownerlock-host@example.com', 'QA r40 ownerlock Workspace');
  raceId = (await host.post('/api/unit-owners', { full_name: RACE_NAME })).data.owner_id;
  keyedId = (await host.post('/api/unit-owners', { full_name: KEYED_NAME })).data.owner_id;
});
test.after(async () => { await srv.close(); });

test('a payout recorded with an Idempotency-Key before any removal is saved', async () => {
  const r = await host.post(payouts(keyedId), payoutBody(), { 'Idempotency-Key': KEY });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(await payoutRows(keyedId), 1);
});

test('a payout that races the removal is refused: 409 OWNER_REMOVED, the owner named, nothing written', async () => {
  const r = await racePayout(raceId);
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'OWNER_REMOVED');
  assert.equal(r.data.error, removedText(RACE_NAME));
  assert.equal(await payoutRows(raceId), 0, 'no payout row for the removed owner');
});

test('a racing payout with an Idempotency-Key already used for this owner is refused, not replayed', async () => {
  const r = await racePayout(keyedId, { 'Idempotency-Key': KEY });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.code, 'OWNER_REMOVED');
  assert.equal(r.data.error, removedText(KEYED_NAME));
  assert.equal(await payoutRows(keyedId), 1, 'only the payout recorded before the removal');
});
