'use strict';

// Unit owners (people whose units this workspace manages) and their monthly statements.
// A statement is a live draft until it is published. Publishing freezes the full ownerStatement()
// result in owner_statements.snapshot (the published copy): the owner portal and the emailed
// statement show that copy, never the live numbers.

const express = require('express');
const config = require('../config');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { own } = require('../lib/pick');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { changedKeys } = require('../lib/auditdiff');
const { requireRole } = require('../lib/auth');
const { ownerStatement, statementText, monthHasEnded, reserveBalance } = require('../lib/statements');

const router = express.Router();
const ownersOnly = requireRole('owner');
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

const ownerSpec = {
  full_name: { type: 'string', required: true, max: 120, label: 'Owner name' },
  email: { type: 'email', label: 'Email' },
  phone: { type: 'phone', label: 'Mobile number' },
  management_fee_pct: { type: 'percent', label: 'Management fee (%)' },
  cleaning_to_manager: { type: 'bool', label: 'Cleaning fees' },
  notes: { type: 'text', max: 1000, label: 'Notes' },
  unit_ids: { type: 'uuids', label: 'Units' },
  fee_model: { type: 'enum', values: ['net_pct', 'gross_pct', 'flat'], label: 'Fee type' },
  flat_monthly_fee: { type: 'money', label: 'Flat monthly fee' },
  reserve_target: { type: 'money', label: 'Repairs reserve target' },
  reserve_monthly: { type: 'money', label: 'Repairs reserve monthly top-up' },
};

const normEmail = (e) => (e ? e.toLowerCase() : null);
// Sorted ids, so the same units in another order compare equal.
const sortedIds = (ids) => [...ids].sort().join(',');

// A percentage fee needs a number: a box sent blank is refused, not kept as the old fee or replaced by the 20% default.
// A flat-fee owner has no percentage, and an add that leaves the fee out (not sent at all) takes the default.
function checkFee(raw, body, model) {
  if (body.management_fee_pct !== null && body.management_fee_pct !== undefined && Number(body.management_fee_pct) > 100) {
    throw validationError({ management_fee_pct: 'Management fee must be at most 100%.' });
  }
  if (model !== 'flat' && Object.hasOwn(raw, 'management_fee_pct') && body.management_fee_pct === null) {
    throw validationError({ management_fee_pct: 'Management fee is required.' });
  }
}

// A unit that belongs to another owner moves its stays and expenses onto that owner's statements, so the move needs the host's
// yes (move_units: true). Without it the save is refused with every such unit named, and nothing is written.
async function refuseUnitsOfOthers(db, orgId, ownerId, unitIds, moveUnits) {
  if (!unitIds || moveUnits) return;
  const { rows } = await db.query(
    `SELECT u.unit_id, u.unit_name, u.owner_id, o.full_name AS owner_name
       FROM units u JOIN properties p USING (property_id) JOIN unit_owners o ON o.owner_id = u.owner_id
      WHERE p.organization_id = $1 AND u.unit_id = ANY($2) AND u.owner_id IS NOT NULL AND u.owner_id IS DISTINCT FROM $3
      ORDER BY u.unit_name`, [orgId, unitIds, ownerId]);
  if (!rows.length) return;
  throw new HttpError(409, rows.map((u) => `${u.unit_name} belongs to ${u.owner_name}.`).join(' '), { code: 'UNIT_HAS_OWNER', units: rows });
}

// A name another active owner in the workspace already uses is asked about (409 NAME_IN_USE) and saved only when the host
// agrees (confirm_duplicate_name: true). Letter case and spaces at the ends don't matter; archived owners and the owner's own row never count.
async function refuseNameInUse(db, orgId, ownerId, name, confirmed) {
  if (confirmed) return;
  const { rows: [other] } = await db.query(
    `SELECT full_name FROM unit_owners WHERE organization_id = $1 AND archived_at IS NULL AND lower(btrim(full_name)) = lower(btrim($2))
        AND owner_id IS DISTINCT FROM $3 ORDER BY created_at LIMIT 1`, [orgId, name, ownerId]);
  if (!other) return;
  const msg = `An owner named ${other.full_name} already exists.`;
  throw new HttpError(409, msg, { code: 'NAME_IN_USE', fields: { full_name: msg }, owner_name: other.full_name });
}

// An email another active owner in the workspace already uses is asked about (409 EMAIL_IN_USE) and saved only when the host
// agrees (confirm_duplicate_email: true). Archived owners and the owner's own row never count.
async function refuseEmailInUse(db, orgId, ownerId, email, confirmed) {
  if (!email || confirmed) return;
  const { rows: [other] } = await db.query(
    `SELECT full_name FROM unit_owners WHERE organization_id = $1 AND archived_at IS NULL AND lower(btrim(email)) = lower(btrim($2))
        AND owner_id IS DISTINCT FROM $3 ORDER BY created_at LIMIT 1`, [orgId, email, ownerId]);
  if (!other) return;
  const msg = `This email already belongs to ${other.full_name}.`;
  throw new HttpError(409, msg, { code: 'EMAIL_IN_USE', fields: { email: msg }, owner_name: other.full_name });
}

// An email that is the login of an active member of this workspace (the owner included) is asked about too (409 EMAIL_IS_LOGIN)
// and saved only when the host agrees (confirm_login_email: true): the statement email would go to a teammate, not an owner.
async function refuseEmailIsLogin(db, orgId, email, confirmed) {
  if (!email || confirmed) return;
  const { rows: [member] } = await db.query(
    `SELECT full_name FROM users WHERE organization_id = $1 AND account_status = 'active' AND lower(btrim(email)) = lower(btrim($2))
      ORDER BY created_at LIMIT 1`, [orgId, email]);
  if (!member) return;
  const msg = `This email is a login for ${member.full_name}.`;
  throw new HttpError(409, msg, { code: 'EMAIL_IS_LOGIN', fields: { email: msg }, login_name: member.full_name });
}

// Point the given units at this owner (and only these).
async function assignUnits(db, orgId, ownerId, unitIds) {
  if (!unitIds) return;
  const { rows } = await db.query(
    `SELECT u.unit_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1 AND u.unit_id = ANY($2)`, [orgId, unitIds]);
  if (rows.length !== new Set(unitIds).size) throw validationError({ unit_ids: 'One or more selected units were not found.' });
  await db.query(`UPDATE units SET owner_id = NULL WHERE owner_id = $1 AND NOT (unit_id = ANY($2)) AND status = 'active'`, [ownerId, unitIds]);
  await db.query('UPDATE units SET owner_id = $1 WHERE unit_id = ANY($2)', [ownerId, unitIds]);
}

async function loadOwner(user, id) {
  const o = await one('SELECT * FROM unit_owners WHERE owner_id = $1 AND organization_id = $2', [id, user.organization_id]);
  if (!o) throw notFound();
  return o;
}

// Filters: search (name, email, mobile), has units / no units yet, owns a
// given listing, sort. `units` is always the full list (for the forms).
const OWNER_SORTS = { name: 'o.full_name', fee: 'o.management_fee_pct DESC, o.full_name', units: 'COUNT(u.unit_id) DESC, o.full_name', newest: 'o.created_at DESC' };
router.get('/unit-owners', ownersOnly, ah(async (req, res) => {
  const org = req.user.organization_id;
  const q = req.query;
  const params = [org];
  const where = ['o.organization_id = $1', 'o.archived_at IS NULL'];
  const having = [];
  if (q.q) {
    params.push(`%${String(q.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(o.full_name ILIKE $${params.length} OR o.email ILIKE $${params.length} OR o.phone ILIKE $${params.length})`);
  }
  if (q.has_units === 'yes') having.push('COUNT(u.unit_id) > 0');
  if (q.has_units === 'no') having.push('COUNT(u.unit_id) = 0');
  if (q.unit_id) {
    // A unit that is not in this workspace is ignored, so the list shows every owner (as reviews and the inbox do).
    const unitId = uuidParam(q.unit_id);
    if (await one('SELECT 1 FROM units u JOIN properties p USING (property_id) WHERE u.unit_id = $1 AND p.organization_id = $2', [unitId, org])) {
      params.push(unitId);
      where.push(`EXISTS (SELECT 1 FROM units x WHERE x.owner_id = o.owner_id AND x.unit_id = $${params.length})`);
    }
  }
  const { rows: owners } = await query(
    `SELECT o.*, COALESCE(array_agg(u.unit_id) FILTER (WHERE u.unit_id IS NOT NULL), '{}') AS unit_ids
       FROM unit_owners o LEFT JOIN units u ON u.owner_id = o.owner_id AND u.status = 'active'
      WHERE ${where.join(' AND ')} GROUP BY o.owner_id ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
      ORDER BY ${own(OWNER_SORTS, q.sort) || OWNER_SORTS.name}`, params);
  const { rows: units } = await query(
    `SELECT u.unit_id, u.unit_name, p.property_name, u.owner_id FROM units u JOIN properties p USING (property_id)
      WHERE p.organization_id = $1 AND u.status = 'active' AND p.status = 'active' ORDER BY p.property_name, u.unit_name`, [org]);
  const { n: total } = await one('SELECT COUNT(*)::int AS n FROM unit_owners WHERE organization_id = $1 AND archived_at IS NULL', [org]);
  res.json({ owners, units, total });
}));

router.post('/unit-owners', ownersOnly, ah(async (req, res) => {
  const body = validate(req.body, ownerSpec);
  checkFee(req.body, body, body.fee_model || 'net_pct');
  const { n } = await one('SELECT COUNT(*)::int AS n FROM unit_owners WHERE organization_id = $1 AND archived_at IS NULL', [req.user.organization_id]);
  if (n >= 100) throw new HttpError(409, 'You can have up to 100 unit owners.', { code: 'LIMIT' });
  const id = await tx(async (db) => {
    await refuseNameInUse(db, req.user.organization_id, null, body.full_name, req.body.confirm_duplicate_name === true);
    await refuseEmailInUse(db, req.user.organization_id, null, body.email, req.body.confirm_duplicate_email === true);
    await refuseEmailIsLogin(db, req.user.organization_id, body.email, req.body.confirm_login_email === true);
    await refuseUnitsOfOthers(db, req.user.organization_id, null, body.unit_ids, req.body.move_units === true);
    const { rows: [o] } = await db.query(
      `INSERT INTO unit_owners (organization_id, full_name, email, phone, management_fee_pct, cleaning_to_manager, notes,
                                fee_model, flat_monthly_fee, reserve_target, reserve_monthly)
       VALUES ($1,$2,$3,$4,COALESCE($5::numeric, 20),COALESCE($6::boolean, true),$7,
               COALESCE($8::text, 'net_pct'),COALESCE($9::numeric, 0),COALESCE($10::numeric, 0),COALESCE($11::numeric, 0))
       RETURNING owner_id`,
      [req.user.organization_id, body.full_name, body.email, body.phone, body.management_fee_pct,
        req.body.cleaning_to_manager === undefined ? null : body.cleaning_to_manager, body.notes,
        body.fee_model, body.flat_monthly_fee, body.reserve_target, body.reserve_monthly]);
    await assignUnits(db, req.user.organization_id, o.owner_id, body.unit_ids);
    await audit(db, req.user, 'unit_owner.created', 'unit_owner', o.owner_id, { name: body.full_name });
    return o.owner_id;
  });
  res.status(201).json({ owner_id: id });
}));

router.patch('/unit-owners/:id', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const body = validate(req.body, ownerSpec, { partial: true });
  checkFee(req.body, body, body.fee_model || o.fee_model);
  const cols = ['full_name', 'email', 'phone', 'management_fee_pct', 'cleaning_to_manager', 'notes',
    'fee_model', 'flat_monthly_fee', 'reserve_target', 'reserve_monthly']
    .filter((k) => k in body && (body[k] !== null || ['email', 'phone', 'notes'].includes(k)));
  await tx(async (db) => {
    // Locked first, so the stored row compared below is the one this update replaces.
    const { rows: [before] } = await db.query('SELECT * FROM unit_owners WHERE owner_id = $1 FOR UPDATE', [o.owner_id]);
    if (cols.includes('full_name') && before.full_name !== body.full_name) {
      await refuseNameInUse(db, req.user.organization_id, o.owner_id, body.full_name, req.body.confirm_duplicate_name === true);
    }
    if (cols.includes('email') && normEmail(before.email) !== normEmail(body.email)) {
      await refuseEmailInUse(db, req.user.organization_id, o.owner_id, body.email, req.body.confirm_duplicate_email === true);
      await refuseEmailIsLogin(db, req.user.organization_id, body.email, req.body.confirm_login_email === true);
    }
    await refuseUnitsOfOthers(db, req.user.organization_id, o.owner_id, body.unit_ids, req.body.move_units === true);
    const { rows: owned } = await db.query(`SELECT unit_id FROM units WHERE owner_id = $1 AND status = 'active'`, [o.owner_id]);
    // Only the fields whose stored value really changes are named (names, never values). A save that changes nothing writes nothing.
    const sent = Object.fromEntries(cols.map((k) => [k, body[k]]));
    const unitsChanged = body.unit_ids !== undefined && sortedIds(body.unit_ids) !== sortedIds(owned.map((r) => r.unit_id));
    const fields = [...changedKeys(before, sent), ...(unitsChanged ? ['unit_ids'] : [])];
    if (!fields.length) return;
    const emailChanged = cols.includes('email') && normEmail(before.email) !== normEmail(body.email);
    if (cols.length) {
      await db.query(`UPDATE unit_owners SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE owner_id = $1`, [o.owner_id, ...cols.map((k) => body[k])]);
    }
    await assignUnits(db, req.user.organization_id, o.owner_id, body.unit_ids);
    // A new or cleared email ends portal access: sign out every session and any unused sign-in link.
    // Clearing the email also turns the portal off.
    if (emailChanged) {
      await db.query('DELETE FROM owner_sessions WHERE owner_id = $1', [o.owner_id]);
      await db.query('DELETE FROM owner_login_tokens WHERE owner_id = $1 AND used_at IS NULL', [o.owner_id]);
      if (body.email === null) await db.query('UPDATE unit_owners SET portal_enabled = false WHERE owner_id = $1', [o.owner_id]);
    }
    await audit(db, req.user, 'unit_owner.updated', 'unit_owner', o.owner_id,
      { fields, ...(emailChanged ? { portal_signed_out: true } : {}) });
  });
  res.json({ ok: true });
}));

router.post('/unit-owners/:id/archive', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  await tx(async (db) => {
    // Portal access ends with the owner: the same steps as portal-disable (ownerportal.js).
    await db.query('UPDATE unit_owners SET archived_at = now(), portal_enabled = false WHERE owner_id = $1', [o.owner_id]);
    await db.query('DELETE FROM owner_sessions WHERE owner_id = $1', [o.owner_id]);
    await db.query('DELETE FROM owner_login_tokens WHERE owner_id = $1 AND used_at IS NULL', [o.owner_id]);
    await db.query('UPDATE units SET owner_id = NULL WHERE owner_id = $1', [o.owner_id]);
    await audit(db, req.user, 'unit_owner.archived', 'unit_owner', o.owner_id, { name: o.full_name });
  });
  res.json({ ok: true });
}));

function monthParam(v) {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v) || Number(v.slice(0, 4)) < 2000 || Number(v.slice(0, 4)) > 2100) throw validationError({ month: 'Choose a month.' });
  return v;
}

// The saved row for one owner's statement in one month, or null before a draft exists.
async function loadRecord(ownerId, month, db = { query }) {
  const { rows: [r] } = await db.query(
    'SELECT statement_id, status, snapshot, published_at, sent_at, sent_to FROM owner_statements WHERE owner_id = $1 AND month = $2',
    [ownerId, month]);
  return r || null;
}
const recordOf = (r) => (r ? { status: r.status, published_at: r.published_at, sent_at: r.sent_at, sent_to: r.sent_to } : null);
const publishedOf = (r, month) => (r?.status === 'published' ? { ...r.snapshot, month_label: monthLabel(month) } : null);

router.get('/unit-owners/:id/statement', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const month = monthParam(req.query.month);
  const s = await ownerStatement(req.user.organization_id, o.owner_id, month);
  const saved = await loadRecord(o.owner_id, month);
  res.json({ statement: { ...s, month_label: monthLabel(month) }, record: recordOf(saved), published: publishedOf(saved, month), portal_enabled: Boolean(o.portal_enabled) });
}));

router.post('/unit-owners/:id/statement/publish', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const month = monthParam(req.body?.month);
  if (!monthHasEnded(month)) throw new HttpError(409, 'A statement can be published once its month has ended.', { code: 'MONTH_NOT_ENDED' });
  const saved = await tx(async (db) => {
    // Locking the owner row serialises publish, unpublish and reserve withdrawals for this owner.
    await db.query('SELECT owner_id FROM unit_owners WHERE owner_id = $1 FOR UPDATE', [o.owner_id]);
    const existing = await loadRecord(o.owner_id, month, db);
    if (existing?.status === 'published') throw new HttpError(409, 'This statement is already published. Unpublish it to make corrections.', { code: 'ALREADY_PUBLISHED' });
    const s = await ownerStatement(req.user.organization_id, o.owner_id, month, db);
    const { rows: [row] } = await db.query(
      `INSERT INTO owner_statements (organization_id, owner_id, month, status, snapshot, published_at, published_by, updated_at)
       VALUES ($1,$2,$3,'published',$4,now(),$5,now())
       ON CONFLICT (owner_id, month) DO UPDATE SET status = 'published', snapshot = EXCLUDED.snapshot,
         published_at = now(), published_by = EXCLUDED.published_by, updated_at = now()
       RETURNING statement_id, status, snapshot, published_at, sent_at, sent_to`,
      [req.user.organization_id, o.owner_id, month, JSON.stringify(s), req.user.user_id]);
    if (Number(s.reserve.topup) > 0) {
      await db.query(
        `INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, note, statement_id, recorded_by)
         VALUES ($1,$2,'deposit',$3,(now() AT TIME ZONE 'Asia/Manila')::date,$4,$5,$6)`,
        [req.user.organization_id, o.owner_id, s.reserve.topup, `Repairs reserve top-up for ${monthLabel(month)}`, row.statement_id, req.user.user_id]);
    }
    await audit(db, req.user, 'unit_owner.statement_published', 'unit_owner', o.owner_id,
      { month, payout: s.totals.payout, reserve_topup: s.reserve.topup });
    return row;
  });
  res.json({ record: recordOf(saved), published: publishedOf(saved, month) });
}));

router.post('/unit-owners/:id/statement/unpublish', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  const month = monthParam(req.body?.month);
  const saved = await tx(async (db) => {
    await db.query('SELECT owner_id FROM unit_owners WHERE owner_id = $1 FOR UPDATE', [o.owner_id]);
    const existing = await loadRecord(o.owner_id, month, db);
    if (existing?.status !== 'published') throw new HttpError(409, 'Only a published statement can be unpublished.', { code: 'NOT_PUBLISHED' });
    // Its repairs reserve deposit goes with it, so the reserve must still hold zero or more without that deposit.
    if ((await reserveBalance(db, o.owner_id, month)) < 0) {
      throw new HttpError(409, 'The repairs reserve has already paid out money this statement added. Void that withdrawal first.', { code: 'RESERVE_IN_USE' });
    }
    await db.query(
      `UPDATE owner_reserve_entries SET voided_at = now(), voided_by = $2, void_reason = 'Statement unpublished to correct it'
        WHERE statement_id = $1 AND kind = 'deposit' AND voided_at IS NULL`, [existing.statement_id, req.user.user_id]);
    const { rows: [row] } = await db.query(
      `UPDATE owner_statements SET status = 'draft', snapshot = NULL, published_at = NULL, published_by = NULL,
              sent_at = NULL, sent_to = NULL, updated_at = now()
        WHERE statement_id = $1 RETURNING statement_id, status, snapshot, published_at, sent_at, sent_to`, [existing.statement_id]);
    await audit(db, req.user, 'unit_owner.statement_unpublished', 'unit_owner', o.owner_id,
      { month, sent_to: existing.sent_to, sent_at: existing.sent_at });
    return row;
  });
  res.json({ record: recordOf(saved), published: null });
}));

router.post('/unit-owners/:id/statement/send', ownersOnly, ah(async (req, res) => {
  const o = await loadOwner(req.user, uuidParam(req.params.id));
  if (!o.email) throw new HttpError(409, 'Add the owner\'s email first.', { code: 'NO_EMAIL' });
  const month = monthParam(req.body?.month);
  const saved = await loadRecord(o.owner_id, month);
  if (saved?.status !== 'published') throw new HttpError(409, 'Publish this statement before sending it.', { code: 'NOT_PUBLISHED' });
  const s = saved.snapshot;
  const label = monthLabel(month);
  const portal = o.portal_enabled ? `\n\nYou can also see this statement in your owner portal: ${config.appUrl}/#/owner` : '';
  const { sendMail } = require('../lib/mailer');
  const r = await sendMail({
    to: o.email, replyTo: req.user.email,
    subject: `Owner statement for ${label} · ${s.workspace}`,
    text: `Hi ${o.full_name.split(' ')[0]},\n\nHere is your statement for ${label}.\n\n${statementText(s, label)}${portal}\n\nReply to this email if you have questions.\n\n— ${req.user.full_name}, ${s.workspace}`,
  });
  if (r.notConfigured || r.error) throw new HttpError(502, r.reason || 'Email is not set up on this server yet.', { code: 'NOT_SENT' });
  await query('UPDATE owner_statements SET sent_at = now(), sent_to = $2, updated_at = now() WHERE statement_id = $1', [saved.statement_id, o.email]);
  await audit(null, req.user, 'unit_owner.statement_sent', 'unit_owner', o.owner_id, { month, payout: s.totals.payout });
  res.json({ sent: true, to: o.email });
}));

// Review list: every active owner's statement for one month. Owners with no saved row yet show as draft,
// unless they have no units (nothing to review).
router.get('/owner-statements', ownersOnly, ah(async (req, res) => {
  const org = req.user.organization_id;
  const month = monthParam(req.query.month);
  const { rows: owners } = await query(
    'SELECT owner_id, full_name FROM unit_owners WHERE organization_id = $1 AND archived_at IS NULL ORDER BY full_name', [org]);
  const { rows: records } = await query(
    'SELECT owner_id, status, snapshot, published_at, sent_at FROM owner_statements WHERE organization_id = $1 AND month = $2', [org, month]);
  const { rows: paid } = await query(
    `SELECT owner_id, SUM(amount) AS paid FROM owner_payouts WHERE organization_id = $1 AND month = $2 AND voided_at IS NULL GROUP BY owner_id`, [org, month]);
  const { rows: unitCounts } = await query(
    `SELECT u.owner_id, COUNT(*)::int AS n FROM units u JOIN properties p USING (property_id)
      WHERE p.organization_id = $1 AND u.status = 'active' AND u.owner_id IS NOT NULL GROUP BY u.owner_id`, [org]);
  const recordBy = new Map(records.map((r) => [r.owner_id, r]));
  const paidBy = new Map(paid.map((r) => [r.owner_id, r.paid]));
  const unitsBy = new Map(unitCounts.map((r) => [r.owner_id, r.n]));
  const rows = [];
  for (const o of owners) {
    const rec = recordBy.get(o.owner_id);
    if (!rec && !unitsBy.get(o.owner_id)) continue;
    const published = rec?.status === 'published';
    const s = published ? rec.snapshot : await ownerStatement(org, o.owner_id, month);
    rows.push({
      owner_id: o.owner_id, full_name: o.full_name, unit_count: unitsBy.get(o.owner_id) || 0,
      status: rec?.status || 'draft', payout: s.totals.payout, paid: paidBy.get(o.owner_id) || '0.00',
      published_at: rec?.published_at || null, sent_at: rec?.sent_at || null,
    });
  }
  res.json({ month, month_label: monthLabel(month), owners: rows });
}));

module.exports = router;
