'use strict';

// Bulk changes across several listings (D-67): nightly prices (set, change by a percentage, clear),
// blocks and unblocks over a date range, and the tag and room-type lists the listing picker uses.
// Owners and managers only; a manager reaches only the properties they are assigned to. A preview
// (`dry_run: true`) and the apply run the same code, so the preview is what the apply writes. An
// apply runs in one transaction, locks the listings first and writes one audit entry.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { nightlyPrices } = require('../lib/pricing');
const ical = require('../lib/ical');

const router = express.Router();
const managers = requireRole('owner', 'manager');

const MAX_LISTINGS = 50;
const MAX_DAYS = 366;
const PREVIEW_ROWS = 500;
const MAX_PRICE = 1000000;
const PRICE_ACTIONS = ['set', 'percent', 'clear'];
const BLOCK_ACTIONS = ['block', 'unblock'];

const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;
const today = async () => (await one(`SELECT ${TODAY} AS d`)).d;
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

// Shared by every bulk route. `from` and `to` are the first and the last night, both included.
const targetSpec = {
  unit_ids: { type: 'uuids', label: 'Listings' },
  tag: { type: 'string', max: 30, label: 'Tag' },
  from: { type: 'date', required: true, label: 'First night' },
  to: { type: 'date', required: true, label: 'Last night' },
  dry_run: { type: 'bool', label: 'Preview only' },
};

// Exactly one way to pick listings: a list of them, or a tag.
function checkTargets(body) {
  const picked = body.unit_ids.length > 0;
  if (picked && body.tag) throw validationError({ unit_ids: 'Pick listings or a tag, not both.' });
  if (!picked && !body.tag) throw validationError({ unit_ids: 'Pick at least one listing or a tag.' });
  if (body.unit_ids.length > MAX_LISTINGS) throw validationError({ unit_ids: `Bulk changes cover up to ${MAX_LISTINGS} listings at a time.` });
  if (body.tag) body.tag = body.tag.toLowerCase();
}

// Nothing before today (Manila time) can change, and one change covers at most a year.
async function checkDates(body) {
  if (body.to < body.from) throw validationError({ to: 'Must be on or after the first night.' });
  if (nightsBetween(body.from, body.to) + 1 > MAX_DAYS) throw validationError({ to: 'Bulk changes cover up to one year at a time.' });
  if (body.from < await today()) throw validationError({ from: 'Start from today or later.' });
}

// The listings a change covers, within the caller's scope. A picked list must all be found; a tag must
// match at least one listing. An apply locks them first, in a fixed order, so the preview and the
// writes see the same rows.
async function listingsFor(user, body, db, { lock }) {
  const params = [];
  const where = [propertyScope(user, params), `u.status = 'active'`, `p.status = 'active'`];
  if (body.unit_ids.length) {
    params.push(body.unit_ids);
    where.push(`u.unit_id = ANY($${params.length}::uuid[])`);
  } else {
    params.push(body.tag);
    where.push(`$${params.length} = ANY(u.tags)`);
  }
  const { rows } = await db.query(
    `SELECT u.unit_id, u.unit_name
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE ${where.join(' AND ')} ORDER BY u.unit_id${lock ? ' FOR UPDATE OF u' : ''}`, params);
  if (body.unit_ids.length && rows.length !== body.unit_ids.length) throw notFound();
  if (!rows.length) throw validationError({ tag: 'No listings you can change have this tag.' });
  if (rows.length > MAX_LISTINGS) {
    throw validationError({ tag: `This tag covers ${rows.length} listings. Bulk changes cover up to ${MAX_LISTINGS} at a time.` });
  }
  return rows;
}

// ---------------------------------------------------------------- prices
// Today's price times (1 + percent / 100), rounded to the centavo. Done in whole centavos so no float drift.
function changeBy(price, percent) {
  const cents = Math.round(Number(price) * 100);
  const next = Math.round((cents * (100 + percent)) / 100);
  return `${Math.floor(next / 100)}.${String(next % 100).padStart(2, '0')}`;
}

// Each night a price change touches: the price it has now (what the calendar shows) and the new one.
// Preview and apply both call this, so they always agree. A night with no price at all can't be
// changed by a percentage; those are reported, not guessed.
async function priceChanges(db, units, body) {
  const changes = [];
  const skipped = [];
  for (const u of units) {
    const row = { unit_id: u.unit_id, unit_name: u.unit_name };
    if (body.action === 'clear') {
      const { rows } = await db.query(
        'SELECT rate_date AS date, price FROM nightly_rates WHERE unit_id = $1 AND rate_date BETWEEN $2 AND $3 ORDER BY rate_date',
        [u.unit_id, body.from, body.to]);
      for (const r of rows) changes.push({ ...row, date: r.date, from_price: r.price, to_price: null });
      continue;
    }
    const nights = await nightlyPrices(u.unit_id, body.from, ical.addDays(body.to, 1), db);
    let unpriced = 0;
    for (const n of nights) {
      if (body.action === 'set') changes.push({ ...row, date: n.night, from_price: n.price, to_price: body.price });
      else if (n.price === null) unpriced += 1;
      else changes.push({ ...row, date: n.night, from_price: n.price, to_price: changeBy(n.price, body.percent) });
    }
    if (unpriced) skipped.push({ ...row, reason: `No nightly rate on ${unpriced} night${unpriced === 1 ? '' : 's'}. Those nights were left alone.` });
  }
  return { changes, skipped };
}

async function writePrices(db, user, body, units, changes) {
  if (body.action === 'clear') {
    await db.query('DELETE FROM nightly_rates WHERE unit_id = ANY($1::uuid[]) AND rate_date BETWEEN $2 AND $3',
      [units.map((u) => u.unit_id), body.from, body.to]);
  } else if (changes.length) {
    await db.query(
      `INSERT INTO nightly_rates (unit_id, rate_date, price)
       SELECT * FROM unnest($1::uuid[], $2::date[], $3::numeric[])
       ON CONFLICT (unit_id, rate_date) DO UPDATE SET price = EXCLUDED.price`,
      [changes.map((c) => c.unit_id), changes.map((c) => c.date), changes.map((c) => c.to_price)]);
  }
  await audit(db, user, 'bulk.prices', 'bulk', null, {
    action: body.action, from: body.from, to: body.to, listings: units.length, changed: changes.length,
    price: body.price, percent: body.percent });
}

router.post('/bulk/prices', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    ...targetSpec,
    action: { type: 'enum', values: PRICE_ACTIONS, required: true, label: 'Action' },
    price: { type: 'money', positive: true, label: 'Nightly price' },
    percent: { type: 'int', min: -90, max: 300, label: 'Change by' },
  });
  checkTargets(body);
  if (body.action === 'set' && !body.price) throw validationError({ price: 'Enter the nightly price to set.' });
  if (body.action === 'percent' && body.percent === null) throw validationError({ percent: 'Enter the percentage to change by.' });
  if (body.action === 'percent' && body.percent === 0) throw validationError({ percent: 'Choose a change other than 0%.' });
  await checkDates(body);
  const { listings, changes, skipped } = await tx(async (db) => {
    const units = await listingsFor(req.user, body, db, { lock: !body.dry_run });
    const plan = await priceChanges(db, units, body);
    // A set price and a percentage change both end here, so the cap is checked once, for preview and apply alike.
    if (plan.changes.some((c) => c.to_price !== null && Number(c.to_price) > MAX_PRICE)) {
      throw validationError({ [body.action === 'set' ? 'price' : 'percent']: `A nightly price can't be more than ₱${MAX_PRICE.toLocaleString('en-PH')}.` });
    }
    if (!body.dry_run) await writePrices(db, req.user, body, units, plan.changes);
    return { listings: units.length, ...plan };
  });
  res.json({
    dry_run: body.dry_run, listings, changes: changes.slice(0, PREVIEW_ROWS), truncated: changes.length > PREVIEW_ROWS,
    count: changes.length, skipped,
  });
}));

// ---------------------------------------------------------------- blocks
const clashReason = (c) => {
  if (c.kind === 'reservation') return `Booked on some of these nights (${c.confirmation_code}).`;
  if (c.ical_feed_id) return 'A channel calendar already blocks some of these nights.';
  if (c.owner_block_by) return 'An owner stay already blocks some of these nights.';
  return 'Already blocked on some of these nights.';
};

// A listing with any confirmed booking or block on these nights is skipped whole and reported.
async function planBlocks(db, units, body, checkOut) {
  const { rows } = await db.query(
    `SELECT b.unit_id, b.kind, b.ical_feed_id, b.owner_block_by, b.confirmation_code
       FROM bookings b
      WHERE b.unit_id = ANY($1::uuid[]) AND b.status = 'confirmed'
        AND daterange(b.check_in, b.check_out) && daterange($2::date, $3::date)
      ORDER BY b.check_in`, [units.map((u) => u.unit_id), body.from, checkOut]);
  const clash = new Map();
  for (const r of rows) if (!clash.has(r.unit_id)) clash.set(r.unit_id, r);
  const changed = [];
  const skipped = [];
  for (const u of units) {
    const c = clash.get(u.unit_id);
    if (c) skipped.push({ unit_id: u.unit_id, unit_name: u.unit_name, reason: clashReason(c) });
    else changed.push({ unit_id: u.unit_id, unit_name: u.unit_name, check_in: body.from, check_out: checkOut });
  }
  return { changed, skipped, ids: [] };
}

// Unblocks cancel only manual blocks that lie wholly inside the range. Channel blocks, owner stays and
// blocks that also cover nights outside the range are left alone and reported. Reservations are never touched.
async function planUnblocks(db, units, body, checkOut) {
  const { rows } = await db.query(
    `SELECT b.booking_id, b.unit_id, b.check_in, b.check_out, b.ical_feed_id, b.owner_block_by
       FROM bookings b
      WHERE b.unit_id = ANY($1::uuid[]) AND b.kind = 'block' AND b.status = 'confirmed'
        AND daterange(b.check_in, b.check_out) && daterange($2::date, $3::date)
      ORDER BY b.check_in`, [units.map((u) => u.unit_id), body.from, checkOut]);
  const names = new Map(units.map((u) => [u.unit_id, u.unit_name]));
  const changed = [];
  const skipped = [];
  const ids = [];
  for (const b of rows) {
    const row = { unit_id: b.unit_id, unit_name: names.get(b.unit_id) };
    if (b.ical_feed_id) skipped.push({ ...row, reason: 'This block comes from a channel calendar. Remove it on the channel.' });
    else if (b.owner_block_by) skipped.push({ ...row, reason: "This is an owner's stay. The owner cancels it in their portal." });
    else if (b.check_in < body.from || b.check_out > checkOut) {
      skipped.push({ ...row, reason: 'This block also covers nights outside these dates, so it was left alone.' });
    } else {
      changed.push({ ...row, check_in: b.check_in, check_out: b.check_out });
      ids.push(b.booking_id);
    }
  }
  return { changed, skipped, ids };
}

async function writeBlocks(db, user, body, units, plan) {
  if (body.action === 'block') {
    for (const c of plan.changed) {
      await db.query(
        `INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, block_reason, confirmation_code, created_by)
         VALUES ($1,$2,'block',$3,$4,$5,$6,$7)`,
        [user.organization_id, c.unit_id, c.check_in, c.check_out, body.reason, ical.randomCode('BL'), user.user_id]);
    }
  } else if (plan.ids.length) {
    // Same as removing one block by hand (POST /blocks/:id/remove).
    await db.query('DELETE FROM bookings WHERE booking_id = ANY($1::uuid[])', [plan.ids]);
  }
  await audit(db, user, 'bulk.blocks', 'bulk', null, {
    action: body.action, from: body.from, to: body.to, listings: units.length, changed: plan.changed.length, skipped: plan.skipped.length });
}

router.post('/bulk/blocks', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    ...targetSpec,
    action: { type: 'enum', values: BLOCK_ACTIONS, required: true, label: 'Action' },
    reason: { type: 'string', max: 200, label: 'Reason' },
  });
  checkTargets(body);
  await checkDates(body);
  if (body.action === 'block' && !body.reason) throw validationError({ reason: 'Add a reason for the block.' });
  const checkOut = ical.addDays(body.to, 1);
  let plan;
  try {
    plan = await tx(async (db) => {
      const units = await listingsFor(req.user, body, db, { lock: !body.dry_run });
      const result = body.action === 'block'
        ? await planBlocks(db, units, body, checkOut)
        : await planUnblocks(db, units, body, checkOut);
      if (!body.dry_run) await writeBlocks(db, req.user, body, units, result);
      return { listings: units.length, ...result };
    });
  } catch (err) {
    // A booking took one of these nights between the preview and the apply; the database refused the overlap.
    if (err.constraint === 'bookings_no_overlap') {
      throw new HttpError(409, 'Some of these nights were booked while you were making changes. Preview again.', { code: 'DATES_TAKEN' });
    }
    throw err;
  }
  const key = body.action === 'block' ? 'created' : 'cancelled';
  res.json({ dry_run: body.dry_run, listings: plan.listings, [key]: plan.changed, skipped: plan.skipped, count: plan.changed.length });
}));

// ---------------------------------------------------------------- tags and room types
// Tags on the caller's active listings, with how many listings carry each.
router.get('/tags', ah(async (req, res) => {
  const params = [];
  const { rows } = await query(
    `SELECT t.tag, COUNT(*)::int AS count
       FROM units u
       JOIN properties p ON p.property_id = u.property_id
       CROSS JOIN LATERAL unnest(u.tags) AS t(tag)
      WHERE ${propertyScope(req.user, params)} AND u.status = 'active' AND p.status = 'active'
      GROUP BY t.tag ORDER BY t.tag`, params);
  res.json({ tags: rows });
}));

// Room types per property, with how many active listings have each.
router.get('/room-types', ah(async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `SELECT u.property_id, u.room_type, COUNT(*)::int AS count
       FROM units u
       JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND u.status = 'active' AND p.status = 'active' AND u.room_type IS NOT NULL
      GROUP BY u.property_id, u.room_type
      ORDER BY u.room_type, u.property_id`, params);
  res.json({ room_types: rows });
}));

module.exports = router;
