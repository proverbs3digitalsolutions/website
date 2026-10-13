'use strict';

// Returning-guest discount codes (D-62). Each guest with a checked-out stay gets one
// personal, single-use code, made the first time a message asks for it.

const { randomInt } = require('crypto');
const { one } = require('../db');

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
// No I, O, 0 or 1, so a code read out loud or printed is unambiguous.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => {
  let s = 'WELCOME-';
  for (let i = 0; i < 6; i += 1) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
};

// The guest's code for a booking, or '' unless the booking is a confirmed stay that has
// checked out and the workspace has the returning-guest discount on.
async function codeFor(bookingId) {
  const today = manilaToday();
  const b = await one(
    `SELECT b.organization_id, o.returning_guest_pct
       FROM bookings b JOIN organizations o ON o.organization_id = b.organization_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND b.status = 'confirmed' AND b.check_out <= $2`,
    [bookingId, today]);
  if (!b || b.returning_guest_pct === null) return '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await one('SELECT code FROM discount_codes WHERE issued_to_booking_id = $1', [bookingId]);
    if (existing) return existing.code;
    try {
      const d = await one(
        `INSERT INTO discount_codes (organization_id, code, description, percent_off, valid_until, max_uses, returning_only, issued_to_booking_id)
         VALUES ($1, $2, 'Returning guest', $3, ($5::date + interval '12 months')::date, 1, true, $4)
         RETURNING code`,
        [b.organization_id, newCode(), b.returning_guest_pct, bookingId, today]);
      return d.code;
    } catch (err) {
      // Another call issued the code first: the next pass finds it. Otherwise the code
      // clashed with one in this workspace, so the next pass draws a new one.
      if (err.code !== '23505') throw err;
    }
  }
  throw new Error(`Could not issue a returning-guest code for booking ${bookingId}.`);
}

module.exports = { codeFor };
