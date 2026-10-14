'use strict';

// Direct-booking discount codes. A code takes a percentage or a fixed amount
// off the accommodation (never the cleaning fee).

const { query } = require('../db');
const { fmtPeso } = require('./messaging');

const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const normalize = (code) => String(code || '').trim().toUpperCase().replace(/\s+/g, '');

// Uses: confirmed bookings plus checkouts that could still be paid (pending
// until PayMongo confirms the session is closed, even after the hold lapses).
const USES = `(SELECT COUNT(*)::int FROM direct_checkouts c WHERE c.discount_code_id = d.code_id
                 AND c.status IN ('confirmed', 'pending'))`;

// Check a code for a stay. Returns { code, discount } or { error }.
// Pass `db` with `lock: true` inside a transaction to hold the code while the
// booking is created, so the last use can't be taken twice.
// `name`/`email`: the booker's. Without `strict`, a returning-only code is
// shown as applied and checked at checkout, so the quote can't be used to test
// whether an email has stayed before.
async function applyCode(orgId, rawCode, { nights, accommodation, email, name }, { db, lock, strict = true } = {}) {
  const code = normalize(rawCode);
  if (!code) return { code: null, discount: 0 };
  const run = db || { query };
  // Lock first, then count in a new statement so the count sees other holds that just committed.
  if (lock) await run.query('SELECT 1 FROM discount_codes WHERE organization_id = $1 AND code = $2 FOR UPDATE', [orgId, code]);
  const { rows: [d] } = await run.query(
    `SELECT d.*, ${USES} AS uses FROM discount_codes d WHERE d.organization_id = $1 AND d.code = $2`, [orgId, code]);
  const invalid = { error: 'This code is not valid.' };
  if (!d || !d.active) return invalid;
  const today = manilaToday();
  if ((d.valid_from && today < String(d.valid_from)) || (d.valid_until && today > String(d.valid_until))) return { error: 'This code has expired or is not active yet.' };
  if (d.max_uses && d.uses >= d.max_uses) return { error: 'This code has been fully used.' };
  if (nights < d.min_nights) return { error: `This code is for stays of ${d.min_nights} nights or more.` };
  if (d.returning_only && strict) {
    const { rows: [past] } = email && name ? await run.query(
      `SELECT 1 FROM bookings b JOIN guests g ON g.guest_id = b.guest_id
        WHERE b.organization_id = $1 AND lower(g.email) = lower($2) AND lower(split_part(trim(g.full_name), ' ', 1)) = lower(split_part(trim($4), ' ', 1))
          AND b.status = 'confirmed' AND b.kind = 'reservation' AND b.check_out <= $3 LIMIT 1`,
      [orgId, email, today, name]) : { rows: [] };
    if (!past) return { error: 'This code is for returning guests. Use the same name and email as your previous stay.' };
  }
  // A personal code is for the guest it was issued to. Checked at checkout (strict) only; the quote preview has no email yet.
  if (d.issued_to_booking_id && strict) {
    const { rows: [mine] } = email ? await run.query(
      `SELECT 1 FROM bookings b JOIN guests g ON g.guest_id = b.guest_id WHERE b.booking_id = $1 AND lower(g.email) = lower($2)`,
      [d.issued_to_booking_id, email]) : { rows: [] };
    if (!mine) return invalid;
  }
  const acc = Math.round(Number(accommodation) * 100);
  const off = d.percent_off ? Math.round((acc * d.percent_off) / 100) : Math.min(acc, Math.round(Number(d.amount_off) * 100));
  return { code: d.code, code_id: d.code_id, returning_only: d.returning_only, label: d.percent_off ? `${d.percent_off}% off` : `${fmtPeso(d.amount_off)} off`, discount: off / 100 };
}

module.exports = { applyCode, normalize, USES };
