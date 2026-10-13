'use strict';

const { query } = require('../db');

// Nightly price for each night: per-date override, else the listing's base rate.
async function quote(unitId, checkIn, checkOut, db) {
  const { rows } = await (db || { query }).query(
    `SELECT d::date AS night, COALESCE(r.price, u.nightly_rate) AS price
       FROM units u
       CROSS JOIN generate_series($2::date, $3::date - 1, interval '1 day') AS d
       LEFT JOIN nightly_rates r ON r.unit_id = u.unit_id AND r.rate_date = d::date
      WHERE u.unit_id = $1 ORDER BY d`, [unitId, checkIn, checkOut]);
  const missing = rows.some((r) => r.price === null);
  const cents = rows.reduce((s, r) => s + Math.round(Number(r.price || 0) * 100), 0);
  return { nights: rows, accommodation_total: (cents / 100).toFixed(2), missing_rates: missing };
}

module.exports = { quote };
