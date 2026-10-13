'use strict';

const { query } = require('../db');

// The listings, of those given, with an active monthly lease over any of these nights (a lease with no end date runs on).
async function leasedListings(unitIds, checkIn, checkOut, db = { query }) {
  const { rows } = await db.query(
    `SELECT DISTINCT unit_id FROM leases
      WHERE unit_id = ANY($1) AND lease_status = 'active' AND start_date < $3::date AND (end_date IS NULL OR end_date >= $2::date)`,
    [unitIds, checkIn, checkOut]);
  return new Set(rows.map((r) => r.unit_id));
}

module.exports = { leasedListings };
