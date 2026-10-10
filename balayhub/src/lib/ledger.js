'use strict';

// Rent ledger. Charges (what is due) are generated from leases; payments (what
// was received) are stored separately. Every balance in the app is derived
// from these two tables — nothing on the dashboard is stored or hand-edited.
//
// Allocation rule: a lease's non-voided payments are applied to its charges
// oldest-first (by due date). A charge is
//   paid     – fully covered
//   overdue  – past its due date with a remaining balance (may be partly paid)
//   partial  – partly covered, not yet past due
//   unpaid   – nothing applied yet, not yet past due

const { query } = require('../db');

const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;

// Generate any missing monthly charges, up to and including the current month,
// for the workspace's leases. Safe to call repeatedly (idempotent per period).
async function syncCharges(organizationId, db) {
  await (db || { query }).query(
    `INSERT INTO rent_charges (lease_id, period, due_date, amount_due)
     SELECT l.lease_id, gs.period::date,
            -- the move-in month is always billed, due no later than the lease end
            LEAST(GREATEST(l.start_date, d.due), COALESCE(l.end_date, 'infinity'::date)),
            l.monthly_rent
       FROM leases l
       CROSS JOIN LATERAL generate_series(
              date_trunc('month', l.start_date),
              date_trunc('month', LEAST(COALESCE(l.end_date, ${TODAY}), ${TODAY})),
              interval '1 month') AS gs(period)
       CROSS JOIN LATERAL (SELECT (gs.period::date + (LEAST(l.due_day,
              EXTRACT(DAY FROM (gs.period + interval '1 month - 1 day'))::int) - 1)) AS due) AS d
      WHERE l.organization_id = $1
        -- after the move-in month, skip months whose rent falls due after move-out
        AND (gs.period = date_trunc('month', l.start_date) OR l.end_date IS NULL OR d.due <= l.end_date)
        AND l.lease_status <> 'cancelled'
        AND (l.lease_status = 'active' OR l.end_date IS NOT NULL)
        AND l.start_date <= ${TODAY}
     ON CONFLICT (lease_id, period) DO NOTHING`,
    [organizationId],
  );
}

// CTE computing the allocated amount per charge. Expects $1 = organization_id.
const CHARGE_STATUS_CTE = `
  lease_paid AS (
    SELECT lease_id, SUM(amount_paid) AS total
      FROM payments
     WHERE organization_id = $1 AND voided_at IS NULL
     GROUP BY lease_id
  ),
  charge_status AS (
    SELECT rc.charge_id, rc.lease_id, rc.period, rc.due_date, rc.amount_due,
           LEAST(rc.amount_due, GREATEST(0,
             COALESCE(lp.total, 0) - (SUM(rc.amount_due) OVER w - rc.amount_due)))::numeric(12,2) AS amount_applied
      FROM rent_charges rc
      JOIN leases l ON l.lease_id = rc.lease_id AND l.organization_id = $1
      LEFT JOIN lease_paid lp ON lp.lease_id = rc.lease_id
    WINDOW w AS (PARTITION BY rc.lease_id ORDER BY rc.due_date, rc.period ROWS UNBOUNDED PRECEDING)
  ),
  charges AS (
    SELECT cs.*, (cs.amount_due - cs.amount_applied)::numeric(12,2) AS balance,
           CASE WHEN cs.amount_applied >= cs.amount_due THEN 'paid'
                WHEN cs.due_date < ${TODAY} THEN 'overdue'
                WHEN cs.amount_applied > 0 THEN 'partial'
                ELSE 'unpaid' END AS status
      FROM charge_status cs
  )`;

// Per-lease totals: charged to date, paid, outstanding, overdue, credit.
const LEASE_BALANCE_CTE = `${CHARGE_STATUS_CTE},
  lease_balance AS (
    SELECT l.lease_id,
           COALESCE((SELECT SUM(amount_due) FROM charges c WHERE c.lease_id = l.lease_id), 0)::numeric(12,2) AS total_charged,
           COALESCE(lp.total, 0)::numeric(12,2) AS total_paid,
           COALESCE((SELECT SUM(balance) FROM charges c WHERE c.lease_id = l.lease_id), 0)::numeric(12,2) AS outstanding,
           COALESCE((SELECT SUM(balance) FROM charges c WHERE c.lease_id = l.lease_id AND c.status = 'overdue'), 0)::numeric(12,2) AS overdue,
           GREATEST(0, COALESCE(lp.total, 0) - COALESCE((SELECT SUM(amount_due) FROM charges c WHERE c.lease_id = l.lease_id), 0))::numeric(12,2) AS credit
      FROM leases l
      LEFT JOIN lease_paid lp ON lp.lease_id = l.lease_id
     WHERE l.organization_id = $1
  )`;

module.exports = { TODAY, syncCharges, CHARGE_STATUS_CTE, LEASE_BALANCE_CTE };
