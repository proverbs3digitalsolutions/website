'use strict';

// Pricing helpers: seasons (date ranges with their own rate, percentage change or minimum stay),
// booking-window rules (last minute, far out, gap night), the price preview, and the
// Philippine holiday calendar used for holiday rates.

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { changedKeys } = require('../lib/auditdiff');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadUnit } = require('../lib/access');
const { nightlyPrices } = require('../lib/pricing');
const holidays = require('../lib/holidays');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// Days allowed for each kind of rule: last minute counts back from check-in, far out and gap night are nights.
const RULE_DAYS = { last_minute: [0, 30], far_out: [31, 540], gap_night: [1, 7] };
const RULE_KINDS = Object.keys(RULE_DAYS);

function checkRule(kind, days, adjustPct) {
  const [lo, hi] = RULE_DAYS[kind];
  if (days < lo || days > hi) throw validationError({ days: `For this kind of rule, use ${lo} to ${hi} days.` });
  if (adjustPct === 0) throw validationError({ adjust_pct: 'Enter a percentage other than 0.' });
}

// A rule this user may change: a workspace-wide rule is the owner's; a listing rule needs access to that listing.
async function loadRule(user, ruleId) {
  const rule = await one('SELECT * FROM pricing_rules WHERE rule_id = $1 AND organization_id = $2', [ruleId, user.organization_id]);
  if (!rule) throw notFound();
  if (rule.unit_id) await loadUnit(user, rule.unit_id);
  else if (user.role !== 'owner') throw new HttpError(403, 'Only the owner can change a rule for every listing.', { code: 'FORBIDDEN' });
  return rule;
}

router.get('/pricing', ah(async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows: listings } = await query(
    `SELECT u.unit_id, u.unit_name, p.property_name, u.nightly_rate, u.weekend_rate, u.holiday_rate, u.weekly_discount, u.monthly_discount,
            u.fortnight_discount, u.min_price, u.min_nights
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND u.status = 'active' AND p.status = 'active' AND u.nightly_rate IS NOT NULL
      ORDER BY p.property_name, u.unit_name`, params);
  const { rows: seasons } = await query(
    `SELECT s.season_id, s.unit_id, u.unit_name, s.name, s.start_date::text AS start_date, s.end_date::text AS end_date,
            s.nightly_rate, s.adjust_pct, s.min_nights, s.created_at
       FROM seasons s LEFT JOIN units u ON u.unit_id = s.unit_id
      WHERE s.organization_id = $1 AND s.end_date >= $2 AND (s.unit_id IS NULL OR s.unit_id = ANY($3))
      ORDER BY s.start_date`, [req.user.organization_id, manilaToday(), listings.map((l) => l.unit_id)]);
  const { rows: rules } = await query(
    `SELECT r.rule_id, r.unit_id, u.unit_name, r.kind, r.days, r.adjust_pct, r.active
       FROM pricing_rules r LEFT JOIN units u ON u.unit_id = r.unit_id
      WHERE r.organization_id = $1 AND (r.unit_id IS NULL OR r.unit_id = ANY($2))
      ORDER BY r.kind, u.unit_name NULLS FIRST`, [req.user.organization_id, listings.map((l) => l.unit_id)]);
  res.json({ listings, seasons, rules, holidays: holidays.upcoming(manilaToday(), 366) });
}));

router.post('/pricing/seasons', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    name: { type: 'string', required: true, max: 80, label: 'Name' },
    unit_id: { type: 'uuid', label: 'Listing' },
    start_date: { type: 'date', required: true, label: 'First night' },
    end_date: { type: 'date', required: true, label: 'Last night' },
    nightly_rate: { type: 'money', positive: true, label: 'Nightly rate' },
    adjust_pct: { type: 'int', min: -90, max: 300, label: 'Percentage change' },
    min_nights: { type: 'int', min: 1, max: 60, label: 'Minimum nights' },
  });
  if (body.end_date < body.start_date) throw validationError({ end_date: 'The last night must be on or after the first night.' });
  if ((Date.parse(body.end_date) - Date.parse(body.start_date)) / 86400000 > 366) throw validationError({ end_date: 'A season can be up to one year long.' });
  if (body.nightly_rate !== null && body.adjust_pct !== null) {
    throw validationError({ adjust_pct: 'Use either a fixed nightly rate or a percentage change, not both.' });
  }
  if (body.nightly_rate === null && body.adjust_pct === null && body.min_nights === null) {
    throw validationError({ nightly_rate: 'Set a nightly rate, a percentage change, a minimum stay, or a mix.' });
  }
  if (body.adjust_pct === 0) throw validationError({ adjust_pct: 'Enter a percentage other than 0.' });
  let unit = null;
  if (body.unit_id) unit = await loadUnit(req.user, body.unit_id);
  else if (req.user.role !== 'owner') throw validationError({ unit_id: 'Choose a listing. Only the owner can set seasons for every listing.' });
  const { rows: [{ n }] } = await query('SELECT COUNT(*)::int AS n FROM seasons WHERE organization_id = $1 AND end_date >= $2', [req.user.organization_id, manilaToday()]);
  if (n >= 200) throw new HttpError(409, 'You have too many upcoming seasons. Remove some first.', { code: 'LIMIT' });
  // Overlaps are allowed, and the saver is told which season prices each shared night (D-66, D-76). A listing
  // season beats an all-listings season on that listing. Within one scope the season that starts later wins,
  // and on equal starts the one created later, which is this one. A season that only sets a minimum stay never prices a night.
  const { rows: clash } = await query(
    `SELECT s.name, s.start_date::text AS start_date, s.end_date::text AS end_date, s.nightly_rate, s.adjust_pct, s.unit_id, u.unit_name
       FROM seasons s LEFT JOIN units u ON u.unit_id = s.unit_id
      WHERE s.organization_id = $1 AND s.start_date <= $4 AND s.end_date >= $3
        AND (s.unit_id IS NULL OR $2::uuid IS NULL OR s.unit_id = $2::uuid)
      ORDER BY s.start_date`,
    [req.user.organization_id, body.unit_id, body.start_date, body.end_date]);
  const prices = (x) => x.nightly_rate !== null || x.adjust_pct !== null;
  const overlaps = clash.map((o) => {
    const mixed = Boolean(o.unit_id) !== Boolean(body.unit_id);
    let wins = null;
    if (prices(body) && prices(o)) {
      if (mixed) wins = body.unit_id ? 'new' : 'existing';
      else wins = body.start_date >= o.start_date ? 'new' : 'existing';
    }
    return { name: o.name, start_date: o.start_date, end_date: o.end_date, on: mixed ? (body.unit_id ? unit.unit_name : o.unit_name) : null, wins };
  });
  const s = await one(
    `INSERT INTO seasons (organization_id, unit_id, name, start_date, end_date, nightly_rate, adjust_pct, min_nights, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING season_id`,
    [req.user.organization_id, body.unit_id, body.name, body.start_date, body.end_date, body.nightly_rate, body.adjust_pct,
      body.min_nights, req.user.user_id]);
  await audit(null, req.user, 'season.created', 'season', s.season_id, body);
  res.status(201).json({ season_id: s.season_id, overlaps });
}));

router.post('/pricing/seasons/:id/remove', managers, ah(async (req, res) => {
  const s = await one('SELECT * FROM seasons WHERE season_id = $1 AND organization_id = $2', [uuidParam(req.params.id), req.user.organization_id]);
  if (!s) throw notFound();
  if (s.unit_id) await loadUnit(req.user, s.unit_id);
  else if (req.user.role !== 'owner') throw new HttpError(403, 'Only the owner can remove a season for every listing.', { code: 'FORBIDDEN' });
  await query('DELETE FROM seasons WHERE season_id = $1', [s.season_id]);
  await audit(null, req.user, 'season.removed', 'season', s.season_id, { name: s.name });
  res.json({ ok: true });
}));

router.post('/pricing/rules', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    kind: { type: 'enum', required: true, values: RULE_KINDS, label: 'Rule' },
    days: { type: 'int', required: true, min: 0, max: 540, label: 'Days' },
    adjust_pct: { type: 'int', required: true, min: -90, max: 300, label: 'Percentage change' },
    unit_id: { type: 'uuid', label: 'Listing' },
  });
  checkRule(body.kind, body.days, body.adjust_pct);
  let unit = null;
  if (body.unit_id) unit = await loadUnit(req.user, body.unit_id);
  else if (req.user.role !== 'owner') throw validationError({ unit_id: 'Choose a listing. Only the owner can set rules for every listing.' });
  let rule;
  try {
    rule = await one(
      `INSERT INTO pricing_rules (organization_id, unit_id, kind, days, adjust_pct, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING rule_id`,
      [req.user.organization_id, body.unit_id, body.kind, body.days, body.adjust_pct, req.user.user_id]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'A rule of this kind already exists for this listing. Change that one instead.', { code: 'DUPLICATE' });
    throw err;
  }
  await audit(null, req.user, 'pricing_rule.created', 'pricing_rule', rule.rule_id,
    { kind: body.kind, days: body.days, adjust_pct: body.adjust_pct, listing: unit ? unit.unit_name : 'All listings' });
  res.status(201).json({ rule_id: rule.rule_id });
}));

router.patch('/pricing/rules/:id', managers, ah(async (req, res) => {
  const current = await loadRule(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    days: { type: 'int', min: 0, max: 540, label: 'Days' },
    adjust_pct: { type: 'int', min: -90, max: 300, label: 'Percentage change' },
    active: { type: 'bool' },
  }, { partial: true });
  for (const key of ['days', 'adjust_pct']) if (body[key] === null) throw validationError({ [key]: 'Enter a number.' });
  const days = body.days ?? current.days;
  const adjustPct = body.adjust_pct ?? current.adjust_pct;
  const active = body.active ?? current.active;
  checkRule(current.kind, days, adjustPct);
  const fields = changedKeys(current, { days, adjust_pct: adjustPct, active });
  // Nothing changed: no write and no activity row, and the rule as it stands is answered.
  if (!fields.length) {
    return res.json({ rule: { rule_id: current.rule_id, unit_id: current.unit_id, kind: current.kind, days, adjust_pct: adjustPct, active } });
  }
  const updated = await one(
    `UPDATE pricing_rules SET days = $2, adjust_pct = $3, active = COALESCE($4::boolean, active), updated_at = now()
      WHERE rule_id = $1 RETURNING rule_id, unit_id, kind, days, adjust_pct, active`,
    [current.rule_id, days, adjustPct, body.active ?? null]);
  await audit(null, req.user, 'pricing_rule.updated', 'pricing_rule', current.rule_id, { kind: current.kind, fields });
  res.json({ rule: updated });
}));

router.post('/pricing/rules/:id/remove', managers, ah(async (req, res) => {
  const rule = await loadRule(req.user, uuidParam(req.params.id));
  await query('DELETE FROM pricing_rules WHERE rule_id = $1', [rule.rule_id]);
  await audit(null, req.user, 'pricing_rule.removed', 'pricing_rule', rule.rule_id, { kind: rule.kind, days: rule.days, adjust_pct: rule.adjust_pct });
  res.json({ ok: true });
}));

// The price of each night as a one-night stay that checks in that night, with the rules that changed it.
router.get('/pricing/preview', requireRole('owner', 'manager', 'staff'), ah(async (req, res) => {
  const q = validate(req.query, {
    unit_id: { type: 'uuid', required: true, label: 'Listing' },
    from: { type: 'date', label: 'First night' },
    days: { type: 'int', min: 1, max: 120, label: 'Days' },
  });
  const unit = await loadUnit(req.user, q.unit_id);
  if (unit.status !== 'active' || unit.property_status !== 'active') throw notFound();
  const from = q.from || manilaToday();
  const days = q.days ?? 60;
  const nights = await nightlyPrices(unit.unit_id, from, holidays.addDays(from, days));
  res.json({ nights: nights.map(({ night, ...n }) => ({ date: night, ...n })) });
}));

module.exports = router;
