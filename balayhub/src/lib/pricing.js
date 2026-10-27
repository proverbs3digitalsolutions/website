'use strict';

const { query } = require('../db');
const { holidayNight, addDays, weekday } = require('./holidays');

// Price each night gets, strongest first (D-66):
//   1. a price set for that exact night on the calendar: kept as it is, no rule changes it
//   2. the holiday rate, on nights before/within a holiday long weekend
//   3. a season: its fixed nightly rate, or its percentage change on the weekend or base rate
//   4. the weekend rate, on Friday and Saturday nights
//   5. the base nightly rate
// Then the booking-window rules from pricing_rules (a listing rule replaces the workspace rule of
// the same kind; a rule set to inactive on a listing switches that kind off for it):
//   last_minute: check-in within `days` of today (Manila); far_out: check-in more than `days` away;
//   at most one of the two applies. gap_night: the stay exactly fills a free gap of at most `days`
//   nights between two confirmed bookings or blocks; it also waives the minimum stay.
// Rule percentages multiply every night that is not custom, rounded to the centavo, and together never
// cut a night by more than 90%. Each non-custom night is then raised to units.min_price if set. Stay discount: monthly (28+) over fortnight (14+)
// over weekly (7+).

const RULE_KINDS = ['last_minute', 'far_out', 'gap_night'];

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const nightsBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// Money is kept in whole centavos so every step is exact.
const toCents = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100));
const fromCents = (c) => (c / 100).toFixed(2);

// `cents` multiplied by (100 + p) / 100 for each percentage p, in whole-number arithmetic, rounded once.
function adjustCents(cents, ...pcts) {
  const num = pcts.reduce((n, p) => n * (100 + p), cents);
  return Math.round(num / 100 ** pcts.length);
}

// The rule that applies for each kind on this listing: its own rule if it has one, else the workspace rule.
function effectiveRules(rows, unitId) {
  const rules = {};
  for (const kind of RULE_KINDS) {
    const rule = rows.find((r) => r.kind === kind && r.unit_id === unitId) || rows.find((r) => r.kind === kind && r.unit_id === null);
    if (rule && rule.active) rules[kind] = rule;
  }
  return rules;
}

// Everything the engine needs for the nights from `from` up to (not including) `to`, or null if the listing is gone.
// Bookings are loaded inclusively at both ends so a stay can see the booking that ends on its check-in
// and the one that starts on its check-out.
async function loadContext(unitId, from, to, db, today) {
  const run = db ? (text, params) => db.query(text, params) : query;
  const { rows: [unit] } = await run(
    `SELECT u.unit_id, u.nightly_rate, u.weekend_rate, u.holiday_rate, u.weekly_discount, u.fortnight_discount, u.monthly_discount,
            u.min_nights, u.min_price, p.organization_id
       FROM units u JOIN properties p USING (property_id) WHERE u.unit_id = $1`, [unitId]);
  if (!unit) return null;
  const { rows: overrides } = await run(
    `SELECT rate_date::text AS date, price FROM nightly_rates WHERE unit_id = $1 AND rate_date >= $2 AND rate_date < $3`, [unitId, from, to]);
  const { rows: seasons } = await run(
    `SELECT season_id, unit_id, name, start_date::text AS start_date, end_date::text AS end_date, nightly_rate, adjust_pct, min_nights
       FROM seasons WHERE organization_id = $1 AND (unit_id IS NULL OR unit_id = $2) AND start_date < $4 AND end_date >= $3
      ORDER BY (unit_id IS NULL), start_date DESC, created_at DESC, season_id`, [unit.organization_id, unitId, from, to]);
  const { rows: rules } = await run(
    `SELECT kind, unit_id, days, adjust_pct, active FROM pricing_rules WHERE organization_id = $1 AND (unit_id IS NULL OR unit_id = $2)`,
    [unit.organization_id, unitId]);
  const { rows: bookings } = await run(
    `SELECT check_in::text AS check_in, check_out::text AS check_out FROM bookings
      WHERE unit_id = $1 AND status = 'confirmed' AND check_out >= $2 AND check_in <= $3`, [unitId, from, to]);
  return {
    unit: {
      base: toCents(unit.nightly_rate), weekend: toCents(unit.weekend_rate), holiday: toCents(unit.holiday_rate),
      floor: toCents(unit.min_price), weekly: unit.weekly_discount, fortnight: unit.fortnight_discount,
      monthly: unit.monthly_discount, min_nights: unit.min_nights,
    },
    overrides: new Map(overrides.map((o) => [o.date, toCents(o.price)])),
    seasons,
    rules: effectiveRules(rules, unit.unit_id),
    bookings,
    today: today || manilaToday(),
  };
}

// One night before booking-window rules: custom, holiday, season, weekend or base.
function priceNight(ctx, night) {
  const { unit, overrides, seasons } = ctx;
  if (overrides.has(night)) return { night, cents: overrides.get(night), kind: 'custom', label: 'Set on calendar', applied: [] };
  const holiday = unit.holiday !== null ? holidayNight(night) : null;
  if (holiday) return { night, cents: unit.holiday, kind: 'holiday', label: holiday, applied: [] };
  const weekend = unit.weekend !== null && [5, 6].includes(weekday(night));
  const season = seasons.find((s) => s.start_date <= night && s.end_date >= night && (s.nightly_rate !== null || s.adjust_pct !== null));
  if (season && season.nightly_rate !== null) return { night, cents: toCents(season.nightly_rate), kind: 'season', label: season.name, applied: [] };
  if (season) {
    // A percentage season changes what the night would otherwise cost: the weekend or the base rate.
    const otherwise = weekend ? unit.weekend : unit.base;
    return {
      night,
      cents: otherwise === null ? null : adjustCents(otherwise, season.adjust_pct),
      pre: otherwise,
      kind: 'season',
      label: season.name,
      applied: [{ kind: 'season', label: season.name, adjust_pct: season.adjust_pct }],
    };
  }
  if (weekend) return { night, cents: unit.weekend, kind: 'weekend', label: 'Weekend', applied: [] };
  return { night, cents: unit.base, kind: 'base', label: null, applied: [] };
}

// Does the stay exactly fill a free gap: a booking or block ends on check-in, another starts on check-out, nothing in between.
function fillsGap(bookings, checkIn, checkOut) {
  const before = bookings.some((b) => b.check_out === checkIn);
  const after = bookings.some((b) => b.check_in === checkOut);
  const overlap = bookings.some((b) => b.check_in < checkOut && b.check_out > checkIn);
  return before && after && !overlap;
}

// Booking-window rules that apply to a stay (they apply to every night of it).
function windowRules(ctx, checkIn, checkOut) {
  const { rules, bookings, today } = ctx;
  const out = [];
  const lead = nightsBetween(today, checkIn);
  const lastMinute = rules.last_minute;
  const farOut = rules.far_out;
  const gap = rules.gap_night;
  if (lastMinute && lead >= 0 && lead <= lastMinute.days) {
    out.push({ kind: 'last_minute', label: `Last minute: check-in within ${lastMinute.days} day${Number(lastMinute.days) === 1 ? '' : 's'}`, adjust_pct: lastMinute.adjust_pct });
  } else if (farOut && lead > farOut.days) {
    out.push({ kind: 'far_out', label: `Booked early: check-in more than ${farOut.days} days away`, adjust_pct: farOut.adjust_pct });
  }
  if (gap && nightsBetween(checkIn, checkOut) <= gap.days && fillsGap(bookings, checkIn, checkOut)) {
    out.push({ kind: 'gap_night', label: 'Fills a gap between bookings', adjust_pct: gap.adjust_pct });
  }
  return out;
}

// Booking-window percentages, then the lowest-price floor. Custom nights are never changed. The percentages
// together never take a night below 10% of its price before any percentage (`pre`, else the night's own price).
function finishNight(ctx, night, windows) {
  if (night.kind === 'custom' || night.cents === null) return night;
  let cents = adjustCents(night.cents, ...windows.map((w) => w.adjust_pct));
  const applied = [...night.applied, ...windows];
  const cap = Math.ceil((night.pre ?? night.cents) / 10);
  if (cents < cap) {
    cents = cap;
    applied.push({ kind: 'max_discount', label: 'Capped at 90% off', adjust_pct: null });
  }
  const floor = ctx.unit.floor;
  if (floor !== null && cents < floor) {
    return { ...night, cents: floor, applied: [...applied, { kind: 'min_price', label: 'Raised to the lowest price', adjust_pct: null }] };
  }
  return { ...night, cents, applied };
}

// Each night of a stay, priced, plus whether the stay fills a gap.
function priceStay(ctx, checkIn, checkOut) {
  const windows = windowRules(ctx, checkIn, checkOut);
  const nights = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) nights.push(finishNight(ctx, priceNight(ctx, d), windows));
  return { nights, gap: windows.some((w) => w.kind === 'gap_night') };
}

const publicNight = (n) => ({
  night: n.night,
  price: n.cents === null ? null : fromCents(n.cents),
  kind: n.kind,
  label: n.label,
  applied: n.applied,
});

// Each night from `from` up to (not including) `to`, priced as a one-night stay that checks in that night.
// Used by the calendar, the direct booking page and the price preview.
function dayPrices(ctx, from, to) {
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    const [night] = priceStay(ctx, d, addDays(d, 1)).nights;
    const booked = ctx.bookings.some((b) => b.check_in <= d && b.check_out > d);
    out.push({ ...publicNight(night), booked });
  }
  return out;
}

// The one length-of-stay discount that applies: monthly (28+) over fortnight (14+) over weekly (7+).
function stayDiscount(unit, nights) {
  if (nights >= 28 && unit.monthly > 0) return { pct: unit.monthly, name: 'monthly' };
  if (nights >= 14 && unit.fortnight > 0) return { pct: unit.fortnight, name: 'fortnight' };
  if (nights >= 7 && unit.weekly > 0) return { pct: unit.weekly, name: 'weekly' };
  return null;
}

// Prices for each night from `from` up to (not including) `to`, each as a one-night stay.
async function nightlyPrices(unitId, from, to, db, { today } = {}) {
  const ctx = await loadContext(unitId, from, to, db, today);
  return ctx ? dayPrices(ctx, from, to) : [];
}

// Price a stay. `accommodation_total` is after any length-of-stay discount.
async function quote(unitId, checkIn, checkOut, db, { today } = {}) {
  const ctx = await loadContext(unitId, checkIn, checkOut, db, today);
  if (!ctx) return { nights: [], accommodation_total: '0.00', missing_rates: true, gap_night: false };
  const { nights: priced, gap } = priceStay(ctx, checkIn, checkOut);
  const nights = priced.map(publicNight);
  const missing = priced.some((n) => n.cents === null);
  const subtotal = priced.reduce((s, n) => s + (n.cents || 0), 0);
  const { unit } = ctx;
  const discount = stayDiscount(unit, priced.length);
  const pct = discount ? discount.pct : 0;
  const discountCents = Math.round((subtotal * pct) / 100);
  // The longest minimum stay that applies to any of these nights.
  const minNights = Math.max(unit.min_nights || 1, ...ctx.seasons
    .filter((s) => s.min_nights && nights.some((n) => s.start_date <= n.night && s.end_date >= n.night)).map((s) => s.min_nights));
  const minSeason = ctx.seasons.find((s) => s.min_nights === minNights && minNights > (unit.min_nights || 1));
  return {
    nights,
    subtotal: fromCents(subtotal),
    discount_pct: pct,
    discount_label: discount ? `${pct}% ${discount.name} discount` : null,
    discount_amount: fromCents(discountCents),
    accommodation_total: fromCents(subtotal - discountCents),
    missing_rates: missing,
    min_nights: gap ? 1 : minNights,
    min_nights_reason: !gap && minSeason ? minSeason.name : null,
    min_nights_waived: gap && minNights > 1 ? minNights : null,
    gap_night: gap,
  };
}

module.exports = { quote, nightlyPrices };
