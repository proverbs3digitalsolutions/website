'use strict';

// Pricing helpers: seasons (date ranges with their own rate / minimum stay)
// and the Philippine holiday calendar used for holiday rates.

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadUnit } = require('../lib/access');
const holidays = require('../lib/holidays');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

router.get('/pricing', ah(async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows: listings } = await query(
    `SELECT u.unit_id, u.unit_name, p.property_name, u.nightly_rate, u.weekend_rate, u.holiday_rate, u.weekly_discount, u.monthly_discount, u.min_nights
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE ${scope} AND u.status = 'active' AND p.status = 'active' AND u.nightly_rate IS NOT NULL
      ORDER BY p.property_name, u.unit_name`, params);
  const { rows: seasons } = await query(
    `SELECT s.season_id, s.unit_id, u.unit_name, s.name, s.start_date::text AS start_date, s.end_date::text AS end_date, s.nightly_rate, s.min_nights
       FROM seasons s LEFT JOIN units u ON u.unit_id = s.unit_id
      WHERE s.organization_id = $1 AND s.end_date >= $2 AND (s.unit_id IS NULL OR s.unit_id = ANY($3))
      ORDER BY s.start_date`, [req.user.organization_id, manilaToday(), listings.map((l) => l.unit_id)]);
  res.json({ listings, seasons, holidays: holidays.upcoming(manilaToday(), 366) });
}));

router.post('/pricing/seasons', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    name: { type: 'string', required: true, max: 80, label: 'Name' },
    unit_id: { type: 'uuid', label: 'Listing' },
    start_date: { type: 'date', required: true, label: 'First night' },
    end_date: { type: 'date', required: true, label: 'Last night' },
    nightly_rate: { type: 'money', label: 'Nightly rate' },
    min_nights: { type: 'int', min: 1, max: 60, label: 'Minimum nights' },
  });
  if (body.end_date < body.start_date) throw validationError({ end_date: 'The last night must be on or after the first night.' });
  if ((Date.parse(body.end_date) - Date.parse(body.start_date)) / 86400000 > 366) throw validationError({ end_date: 'A season can be up to one year long.' });
  if (body.nightly_rate === null && body.min_nights === null) throw validationError({ nightly_rate: 'Set a nightly rate, a minimum stay, or both.' });
  if (body.unit_id) await loadUnit(req.user, body.unit_id);
  else if (req.user.role !== 'owner') throw validationError({ unit_id: 'Choose a listing. Only the owner can set seasons for every listing.' });
  const { rows: [{ n }] } = await query('SELECT COUNT(*)::int AS n FROM seasons WHERE organization_id = $1 AND end_date >= $2', [req.user.organization_id, manilaToday()]);
  if (n >= 200) throw new HttpError(409, 'You have too many upcoming seasons. Remove some first.', { code: 'LIMIT' });
  const s = await one(
    `INSERT INTO seasons (organization_id, unit_id, name, start_date, end_date, nightly_rate, min_nights, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING season_id`,
    [req.user.organization_id, body.unit_id, body.name, body.start_date, body.end_date, body.nightly_rate, body.min_nights, req.user.user_id]);
  await audit(null, req.user, 'season.created', 'season', s.season_id, body);
  res.status(201).json({ season_id: s.season_id });
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

module.exports = router;
