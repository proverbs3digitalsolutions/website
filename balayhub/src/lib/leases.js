'use strict';

const { query } = require('../db');
const { HttpError } = require('./http');

// The listings, of those given, with an active monthly lease over any of these nights (a lease with no end date runs on).
async function leasedListings(unitIds, checkIn, checkOut, db = { query }) {
  const { rows } = await db.query(
    `SELECT DISTINCT unit_id FROM leases
      WHERE unit_id = ANY($1) AND lease_status = 'active' AND start_date < $3::date AND (end_date IS NULL OR end_date >= $2::date)`,
    [unitIds, checkIn, checkOut]);
  return new Set(rows.map((r) => r.unit_id));
}

// The confirmed short stays on a unit that a lease from startDate to endDate (null = runs on) would run over, earliest first.
async function stayClashes(unitId, startDate, endDate, db = { query }) {
  const { rows } = await db.query(
    `SELECT confirmation_code, check_in::text AS check_in, check_out::text AS check_out FROM bookings
      WHERE unit_id = $1 AND status <> 'cancelled' AND check_in < COALESCE($3::date + 1, 'infinity') AND check_out > $2::date
      ORDER BY check_in, confirmation_code`,
    [unitId, startDate, endDate]);
  return rows;
}

const day = (iso, year) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year && { year: 'numeric' }), timeZone: 'UTC' });

// The 409 answer for a lease over stays: names up to 5 of them and the first day the lease could start.
function leaseOverStays(stays) {
  const named = stays.slice(0, 5).map((s) => `${s.confirmation_code} (${day(s.check_in)} to ${day(s.check_out, true)})`);
  if (stays.length > 5) named.push(`and ${stays.length - 5} more`);
  const free = stays.reduce((m, s) => (s.check_out > m ? s.check_out : m), '');
  return new HttpError(409, `This unit has short stays booked during this lease: ${named.join(', ')}. Move or cancel them first, or start the lease after ${day(free, true)}.`,
    { code: 'LEASE_OVER_STAYS', stays });
}

module.exports = { leasedListings, stayClashes, leaseOverStays };
