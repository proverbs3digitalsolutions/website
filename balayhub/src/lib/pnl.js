'use strict';

// Profit and loss per unit for one month (D-44). Gross, channel fees, refunds and expenses come from the
// same records the owner statements use. Money is summed in centavos and returned as 2-decimal strings.

const { query, one } = require('../db');
const { propertyScope } = require('./access');
const { monthBounds } = require('./statements');

const cents = (v) => Math.round(Number(v || 0) * 100);
const money = (c) => (c / 100).toFixed(2);
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const zero = () => ({ stays: 0, nights: 0, gross: 0, channel: 0, refunds: 0, expenses: 0 });

// Properties the caller may see: the whole workspace, or only assigned properties for a manager or staff member.
function propertyFilter(orgId, user, params) {
  if (user) return propertyScope(user, params, 'p');
  params.push(orgId);
  return `p.organization_id = $${params.length}`;
}

const line = (meta, a) => ({
  ...meta,
  stays: a.stays,
  nights: a.nights,
  gross: money(a.gross),
  channel_fees: money(a.channel),
  refunds: money(a.refunds),
  expenses: money(a.expenses),
  net: money(a.gross - a.channel - a.refunds - a.expenses),
});

// One row per unit in scope, then a "Not linked to a unit" row for workspace expenses with no unit.
// `unitIds` (owner portal) limits the report to those units and leaves that row out.
// `propertyId` limits it to one property. `user` applies the same property scope as the rest of the app.
async function unitPnl(orgId, month, { unitIds, user, propertyId } = {}) {
  const { start, end } = monthBounds(month);

  const unitParams = [];
  let unitSql = `SELECT u.unit_id, u.unit_name, p.property_name
                   FROM units u JOIN properties p ON p.property_id = u.property_id
                  WHERE ${propertyFilter(orgId, user, unitParams)}`;
  if (unitIds) { unitParams.push(unitIds); unitSql += ` AND u.unit_id = ANY($${unitParams.length})`; }
  if (propertyId) { unitParams.push(propertyId); unitSql += ` AND p.property_id = $${unitParams.length}`; }
  const { rows: units } = await query(`${unitSql} ORDER BY p.property_name, u.unit_name`, unitParams);
  const ids = units.map((u) => u.unit_id);
  const byUnit = new Map(ids.map((id) => [id, zero()]));

  // Confirmed stays that checked out in the month and have already ended (as in statements.js).
  const { rows: stays } = await query(
    `SELECT b.unit_id, COUNT(*) AS stays, SUM(b.check_out - b.check_in) AS nights,
            SUM(b.total_amount) AS gross, SUM(b.channel_fee) AS channel_fees
       FROM bookings b
      WHERE b.unit_id = ANY($1) AND b.kind = 'reservation' AND b.status = 'confirmed'
        AND b.check_out >= $2 AND b.check_out < $3 AND b.check_out <= $4
      GROUP BY b.unit_id`, [ids, start, end, manilaToday()]);
  for (const s of stays) {
    Object.assign(byUnit.get(s.unit_id), { stays: s.stays, nights: s.nights, gross: cents(s.gross), channel: cents(s.channel_fees) });
  }

  // Refunds dated in the month. Copy of the rule in statements.js (D-32): refunding an overpayment does not
  // reduce income, only the part beyond it does. Keep the two in step.
  const { rows: refunds } = await query(
    `SELECT b.booking_id, b.unit_id, b.total_amount, SUM(r.amount) AS in_period,
            COALESCE((SELECT SUM(p.amount) FROM booking_payments p WHERE p.booking_id = b.booking_id AND p.voided_at IS NULL), 0) AS paid,
            COALESCE((SELECT SUM(x.amount) FROM booking_refunds x WHERE x.booking_id = b.booking_id AND x.voided_at IS NULL AND x.refund_date < $2), 0) AS before_period
       FROM booking_refunds r JOIN bookings b ON b.booking_id = r.booking_id
      WHERE b.unit_id = ANY($1) AND b.kind = 'reservation' AND b.status = 'confirmed'
        AND r.voided_at IS NULL AND r.refund_date >= $2 AND r.refund_date < $3
      GROUP BY b.booking_id, b.unit_id, b.total_amount`, [ids, start, end]);
  for (const r of refunds) {
    const over = Math.max(0, cents(r.paid) - cents(r.total_amount));
    const before = cents(r.before_period);
    byUnit.get(r.unit_id).refunds += Math.max(0, before + cents(r.in_period) - over) - Math.max(0, before - over);
  }

  const { rows: unitExpenses } = await query(
    `SELECT e.unit_id, SUM(e.amount) AS amount FROM expenses e
      WHERE e.unit_id = ANY($1) AND e.voided_at IS NULL AND e.expense_date >= $2 AND e.expense_date < $3
      GROUP BY e.unit_id`, [ids, start, end]);
  for (const e of unitExpenses) byUnit.get(e.unit_id).expenses += cents(e.amount);

  const lines = units.map((u) => ({
    meta: { unit_id: u.unit_id, unit_name: u.unit_name, property_name: u.property_name },
    a: byUnit.get(u.unit_id),
  }));
  if (!unitIds) {
    const params = [start, end];
    let sql = `SELECT COUNT(*) AS count, SUM(e.amount) AS amount
                 FROM expenses e JOIN properties p ON p.property_id = e.property_id
                WHERE ${propertyFilter(orgId, user, params)} AND e.unit_id IS NULL AND e.voided_at IS NULL
                  AND e.expense_date >= $1 AND e.expense_date < $2`;
    if (propertyId) { params.push(propertyId); sql += ` AND e.property_id = $${params.length}`; }
    const unlinked = await one(sql, params);
    if (unlinked.count) {
      lines.push({
        meta: { unit_id: null, unit_name: 'Not linked to a unit', property_name: null },
        a: { ...zero(), expenses: cents(unlinked.amount) },
      });
    }
  }

  const total = zero();
  for (const { a } of lines) for (const k of Object.keys(total)) total[k] += a[k];
  return { month, rows: lines.map(({ meta, a }) => line(meta, a)), totals: line({}, total) };
}

module.exports = { unitPnl };
