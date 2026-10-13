'use strict';

const { query } = require('../db');
const { holidayNight, addDays, weekday } = require('./holidays');

// Which price each night gets, strongest first:
//   1. a price set for that exact night on the calendar
//   2. the holiday rate, on nights before/within a holiday long weekend
//   3. a season's nightly rate (listing-specific season beats a workspace-wide one)
//   4. the weekend rate, on Friday and Saturday nights
//   5. the base nightly rate
// Then a weekly (7+ nights) or monthly (28+ nights) discount on the stay.

async function loadRules(unitId, from, to, db) {
  const run = (db || { query }).query.bind(db || { query });
  const { rows: [unit] } = await run(
    `SELECT u.unit_id, u.nightly_rate, u.weekend_rate, u.holiday_rate, u.weekly_discount, u.monthly_discount, u.min_nights, p.organization_id
       FROM units u JOIN properties p USING (property_id) WHERE u.unit_id = $1`, [unitId]);
  if (!unit) return null;
  const { rows: overrides } = await run(
    `SELECT rate_date::text AS date, price FROM nightly_rates WHERE unit_id = $1 AND rate_date >= $2 AND rate_date < $3`, [unitId, from, to]);
  const { rows: seasons } = await run(
    `SELECT season_id, unit_id, name, start_date::text AS start_date, end_date::text AS end_date, nightly_rate, min_nights
       FROM seasons WHERE organization_id = $1 AND (unit_id IS NULL OR unit_id = $2) AND start_date < $4 AND end_date >= $3
      ORDER BY (unit_id IS NULL), start_date DESC`, [unit.organization_id, unitId, from, to]);
  return { unit, overrides: new Map(overrides.map((o) => [o.date, o.price])), seasons };
}

function priceNight(rules, night) {
  const { unit, overrides, seasons } = rules;
  const inSeason = seasons.filter((s) => s.start_date <= night && s.end_date >= night);
  if (overrides.has(night)) return { night, price: overrides.get(night), kind: 'custom', label: 'Set on calendar' };
  const holiday = unit.holiday_rate !== null ? holidayNight(night) : null;
  if (holiday) return { night, price: unit.holiday_rate, kind: 'holiday', label: holiday };
  const season = inSeason.find((s) => s.nightly_rate !== null);
  if (season) return { night, price: season.nightly_rate, kind: 'season', label: season.name };
  if (unit.weekend_rate !== null && [5, 6].includes(weekday(night))) return { night, price: unit.weekend_rate, kind: 'weekend', label: 'Weekend' };
  return { night, price: unit.nightly_rate, kind: 'base', label: null };
}

// Prices for each night from `from` up to (not including) `to`.
async function nightlyPrices(unitId, from, to, db) {
  const rules = await loadRules(unitId, from, to, db);
  if (!rules) return [];
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(priceNight(rules, d));
  return out;
}

// Price a stay. `accommodation_total` is after any length-of-stay discount.
async function quote(unitId, checkIn, checkOut, db) {
  const rules = await loadRules(unitId, checkIn, checkOut, db);
  if (!rules) return { nights: [], accommodation_total: '0.00', missing_rates: true };
  const nights = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) nights.push(priceNight(rules, d));
  const missing = nights.some((n) => n.price === null);
  const subtotal = nights.reduce((s, n) => s + Math.round(Number(n.price || 0) * 100), 0);
  const { unit } = rules;
  const pct = nights.length >= 28 && unit.monthly_discount > 0 ? unit.monthly_discount
    : nights.length >= 7 && unit.weekly_discount > 0 ? unit.weekly_discount : 0;
  const discount = Math.round((subtotal * pct) / 100);
  // The longest minimum stay that applies to any of these nights.
  const minNights = Math.max(unit.min_nights || 1, ...rules.seasons
    .filter((s) => s.min_nights && nights.some((n) => s.start_date <= n.night && s.end_date >= n.night)).map((s) => s.min_nights));
  const minSeason = rules.seasons.find((s) => s.min_nights === minNights && minNights > (unit.min_nights || 1));
  return {
    nights,
    subtotal: (subtotal / 100).toFixed(2),
    discount_pct: pct,
    discount_label: pct ? `${pct}% ${nights.length >= 28 && unit.monthly_discount > 0 ? 'monthly' : 'weekly'} discount` : null,
    discount_amount: (discount / 100).toFixed(2),
    accommodation_total: ((subtotal - discount) / 100).toFixed(2),
    missing_rates: missing,
    min_nights: minNights,
    min_nights_reason: minSeason ? minSeason.name : null,
  };
}

module.exports = { quote, nightlyPrices };
