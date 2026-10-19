'use strict';

// Money paid to unit owners (payout records, voided never deleted) and each owner's repairs
// reserve (deposits from published statements, withdrawals recorded by hand). Workspace owners only.
// Money is compared in centavos; pg returns NUMERIC as strings.

const express = require('express');
const { pool, query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { ownerStatement } = require('../lib/statements');

const router = express.Router();
const ownersOnly = requireRole('owner');

const PAYOUT_METHODS = ['gcash', 'maya', 'bank_transfer', 'cash', 'other'];
// 2000 to 2100, the same years the statement routes accept.
const MONTH_RE = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const centavos = (s) => Math.round(Number(s) * 100);
const money = (c) => (c / 100).toFixed(2);
// ₱1,234.00 for messages (centavos in).
const peso = (c) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// "August 2026" for a YYYY-MM month, the way the owner pages write it.
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function monthParam(v) {
  if (typeof v !== 'string' || !MONTH_RE.test(v)) throw validationError({ month: 'Choose a month.' });
  return v;
}

async function loadOwner(user, id) {
  const o = await one('SELECT * FROM unit_owners WHERE owner_id = $1 AND organization_id = $2', [id, user.organization_id]);
  if (!o) throw notFound();
  return o;
}

const PAYOUT_SELECT = `SELECT p.payout_id, p.owner_id, p.month, p.amount, p.paid_on, p.method, p.reference_number, p.note,
        p.created_at, p.voided_at, p.void_reason, (p.voided_at IS NOT NULL) AS voided,
        ru.full_name AS recorded_by_name, vu.full_name AS voided_by_name
   FROM owner_payouts p
   LEFT JOIN users ru ON ru.user_id = p.recorded_by
   LEFT JOIN users vu ON vu.user_id = p.voided_by`;

async function loadPayout(db, id) {
  const { rows: [p] } = await db.query(`${PAYOUT_SELECT} WHERE p.payout_id = $1`, [id]);
  return p;
}

router.get('/unit-owners/:id/payouts', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const month = req.query.month ? monthParam(req.query.month) : null;
  const { rows } = await query(
    `${PAYOUT_SELECT} WHERE p.owner_id = $1 AND ($2::text IS NULL OR p.month = $2) ORDER BY p.paid_on DESC, p.created_at DESC`,
    [o.owner_id, month]);
  res.json({ payouts: rows });
}));

const PAYOUT_SPEC = {
  amount: { type: 'money', required: true, positive: true, label: 'Amount' },
  paid_on: { type: 'date', required: true, label: 'Date paid' },
  method: { type: 'enum', values: PAYOUT_METHODS, required: true, label: 'Method' },
  reference_number: { type: 'string', max: 100, label: 'Reference number' },
  note: { type: 'text', max: 500, label: 'Note' },
  month: { type: 'string', max: 7, label: 'Month' },
  confirm_over: { type: 'bool' },
};

router.post('/unit-owners/:id/payouts', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const body = validate(req.body, PAYOUT_SPEC);
  if (!body.month) throw validationError({ month: 'Choose the statement month this payout is for.' });
  monthParam(body.month);
  if (body.paid_on > manilaToday()) throw validationError({ paid_on: 'Date paid cannot be in the future.' });
  const key = req.get('Idempotency-Key');
  if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(400, 'Invalid Idempotency-Key header.', { code: 'BAD_REQUEST' });
  const org = req.user.organization_id;
  // A retried save (same key) gets the payout already recorded for this owner. The same key on another owner is refused.
  const replay = async (db) => {
    const { rows: [prev] } = await db.query(
      'SELECT payout_id, owner_id FROM owner_payouts WHERE organization_id = $1 AND idempotency_key = $2', [org, key]);
    if (!prev) return null;
    if (prev.owner_id !== o.owner_id) {
      throw new HttpError(409, 'This payment request was already used for another owner. Please reload the page and try again.', { code: 'IDEMPOTENCY_KEY_USED' });
    }
    return { duplicate: true, payout: await loadPayout(db, prev.payout_id) };
  };
  let result;
  try {
    result = await tx(async (db) => {
      // Lock the owner so a retried save waits here, then finds the first save's row.
      await db.query('SELECT owner_id FROM unit_owners WHERE owner_id = $1 FOR UPDATE', [o.owner_id]);
      if (key) {
        const again = await replay(db);
        if (again) return again;
      }
      const { rows: [saved] } = await db.query(
        "SELECT snapshot FROM owner_statements WHERE owner_id = $1 AND month = $2 AND status = 'published'", [o.owner_id, body.month]);
      // Due = the published copy's payout, or the live payout for a draft (skipped when the owner has no units to report on).
      const stmt = saved ? saved.snapshot : await ownerStatement(org, o.owner_id, body.month, db);
      if (stmt && (saved || stmt.units.length)) {
        const due = centavos(stmt.totals.payout);
        // The owner owes the workspace this month, so there is nothing to pay out. Refused even when the request confirms it.
        if (due < 0) {
          throw new HttpError(409, `Nothing is due to ${o.full_name} for ${monthName(body.month)}: they owe you ${peso(-due)}. A payout can't be recorded for this month.`,
            { code: 'NOTHING_DUE', due: money(due) });
        }
        // Paying more than the month's statement is allowed, but only when the request says it was meant.
        if (!body.confirm_over) {
          const { rows: [{ paid }] } = await db.query(
            'SELECT COALESCE(SUM(amount), 0) AS paid FROM owner_payouts WHERE owner_id = $1 AND month = $2 AND voided_at IS NULL', [o.owner_id, body.month]);
          const total = centavos(paid) + centavos(body.amount);
          if (total > due) {
            throw new HttpError(409, `This takes the ${monthName(body.month)} payouts to ${peso(total)}, more than the ${peso(due)} due. Confirm to record it anyway.`,
              { code: 'PAYOUT_OVER_DUE', due: money(due), paid: money(centavos(paid)) });
          }
        }
      }
      const { rows: [p] } = await db.query(
        `INSERT INTO owner_payouts (organization_id, owner_id, month, amount, paid_on, method, reference_number, note, recorded_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING payout_id`,
        [org, o.owner_id, body.month, body.amount, body.paid_on, body.method, body.reference_number, body.note, req.user.user_id, key || null]);
      await audit(db, req.user, 'owner_payout.recorded', 'owner_payout', p.payout_id,
        { owner_id: o.owner_id, amount: body.amount, method: body.method, month: body.month });
      return { duplicate: false, payout: await loadPayout(db, p.payout_id) };
    });
  } catch (err) {
    if (err.code !== '23505' || err.constraint !== 'owner_payouts_idem_uq') throw err;
    // Two saves with the same key raced for different owners and the other one committed first: replay it, or refuse it.
    result = await replay(pool);
  }
  // A retried save returns the payout already recorded instead of adding a second.
  if (result.duplicate) return res.json({ duplicate: true, payout: result.payout });
  res.status(201).json({ payout: result.payout });
}));

// Void a payout. The row stays for the record.
router.post('/owner-payouts/:id/void', ownersOnly, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 500, label: 'Reason' } });
  await tx(async (db) => {
    const { rows: [p] } = await db.query(
      'SELECT owner_id, amount, voided_at FROM owner_payouts WHERE payout_id = $1 AND organization_id = $2 FOR UPDATE',
      [id, req.user.organization_id]);
    if (!p) throw notFound();
    if (p.voided_at) throw new HttpError(409, 'This payout is already voided.', { code: 'ALREADY_VOIDED' });
    await db.query('UPDATE owner_payouts SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE payout_id = $1', [id, req.user.user_id, reason]);
    await audit(db, req.user, 'owner_payout.voided', 'owner_payout', id, { owner_id: p.owner_id, amount: p.amount, reason });
  });
  res.json({ ok: true });
}));

const ENTRY_SELECT = `SELECT e.entry_id, e.owner_id, e.kind, e.amount, e.entry_date, e.note, e.statement_id, e.created_at,
        e.voided_at, e.void_reason, (e.voided_at IS NOT NULL) AS voided,
        ru.full_name AS recorded_by_name, vu.full_name AS voided_by_name
   FROM owner_reserve_entries e
   LEFT JOIN users ru ON ru.user_id = e.recorded_by
   LEFT JOIN users vu ON vu.user_id = e.voided_by`;

// Deposits minus withdrawals, voided entries left out. In centavos.
const reserveCents = (entries) => entries.reduce((sum, e) => (e.voided ? sum : sum + (e.kind === 'deposit' ? 1 : -1) * centavos(e.amount)), 0);

router.get('/unit-owners/:id/reserve', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const { rows: entries } = await query(`${ENTRY_SELECT} WHERE e.owner_id = $1 ORDER BY e.entry_date DESC, e.created_at DESC`, [o.owner_id]);
  res.json({ balance: money(reserveCents(entries)), target: o.reserve_target, monthly: o.reserve_monthly, entries });
}));

router.post('/unit-owners/:id/reserve/withdrawals', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    amount: { type: 'money', required: true, positive: true, label: 'Amount' },
    entry_date: { type: 'date', required: true, label: 'Date' },
    note: { type: 'string', required: true, max: 300, label: 'Note' },
  });
  if (body.entry_date > manilaToday()) throw validationError({ entry_date: 'Date cannot be in the future.' });
  const entry = await tx(async (db) => {
    // Lock the owner so two withdrawals can't both pass the balance check.
    await db.query('SELECT owner_id FROM unit_owners WHERE owner_id = $1 FOR UPDATE', [o.owner_id]);
    const { rows: entries } = await db.query(`${ENTRY_SELECT} WHERE e.owner_id = $1`, [o.owner_id]);
    const left = reserveCents(entries);
    if (centavos(body.amount) > left) {
      throw new HttpError(409, left > 0 ? `Only ${peso(left)} is in the repairs reserve.` : 'The repairs reserve is empty.', { code: 'INSUFFICIENT_RESERVE' });
    }
    const { rows: [r] } = await db.query(
      `INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, note, recorded_by)
       VALUES ($1,$2,'withdrawal',$3,$4,$5,$6) RETURNING entry_id`,
      [req.user.organization_id, o.owner_id, body.amount, body.entry_date, body.note, req.user.user_id]);
    await audit(db, req.user, 'owner_reserve.withdrawal_recorded', 'owner_reserve_entry', r.entry_id, { owner_id: o.owner_id, amount: body.amount });
    const { rows: [saved] } = await db.query(`${ENTRY_SELECT} WHERE e.entry_id = $1`, [r.entry_id]);
    return saved;
  });
  res.status(201).json({ entry });
}));

// Void a withdrawal (always allowed: it puts money back). Deposits are reversed by unpublishing their statement.
router.post('/reserve-entries/:id/void', ownersOnly, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { reason } = validate(req.body, { reason: { type: 'string', required: true, max: 500, label: 'Reason' } });
  await tx(async (db) => {
    const { rows: [e] } = await db.query(
      'SELECT owner_id, kind, amount, voided_at FROM owner_reserve_entries WHERE entry_id = $1 AND organization_id = $2 FOR UPDATE',
      [id, req.user.organization_id]);
    if (!e) throw notFound();
    if (e.kind === 'deposit') {
      throw new HttpError(409, 'A deposit is reversed by unpublishing its statement, not by voiding it here.', { code: 'DEPOSIT_NOT_VOIDABLE' });
    }
    if (e.voided_at) throw new HttpError(409, 'This entry is already voided.', { code: 'ALREADY_VOIDED' });
    await db.query('UPDATE owner_reserve_entries SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE entry_id = $1', [id, req.user.user_id, reason]);
    await audit(db, req.user, 'owner_reserve.withdrawal_voided', 'owner_reserve_entry', id, { owner_id: e.owner_id, amount: e.amount, reason });
  });
  res.json({ ok: true });
}));

module.exports = router;
