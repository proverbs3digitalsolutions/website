'use strict';

// Cleaner pay (Phase 3, D-52). A finished clean is paid to one cleaner: the team
// member it was assigned to, else the outside cleaner it was assigned to by name,
// else whoever marked it done. Pay is worked out once, when the clean is marked
// done, and stays until it is paid.

// The cleaner a task is paid to. Same order the pay lists use for the cleaner key
// (user:<id> or name:<lower-case name>, the same keys as housekeeping's cleaner scores).
function payee(task) {
  if (task.assigned_to) return { user_id: task.assigned_to };
  if (task.assignee_name) return { name: task.assignee_name };
  return { user_id: task.completed_by || null };
}

// The cleaner_rates row for the task's payee, or null when there is none.
async function rateFor(db, orgId, task) {
  const p = payee(task);
  if (!p.user_id && !p.name) return null;
  const { rows } = p.user_id
    ? await db.query('SELECT rate_id, rate_type, amount FROM cleaner_rates WHERE organization_id = $1 AND user_id = $2', [orgId, p.user_id])
    : await db.query('SELECT rate_id, rate_type, amount FROM cleaner_rates WHERE organization_id = $1 AND lower(assignee_name) = lower($2)', [orgId, p.name]);
  return rows[0] || null;
}

// Set pay_amount on a finished, unpaid clean from its payee's rate. Per clean: the rate.
// Per hour: finished minus started, rounded up to the next 15 minutes, at most 12 hours.
// Per hour with no real start (Start never pressed) leaves the pay NULL, "not set", for the owner
// to fill in; it is never 0. A start equal to the finish is the same thing (set together, not worked).
// Call it after the clean is marked done, inside the same transaction. Returns the new
// amount, or null when nothing was set (not done, already paid, or no rate).
async function computePay(db, taskId) {
  const { rows: [task] } = await db.query(
    `SELECT organization_id, status, pay_status, started_at, completed_at, assigned_to, assignee_name, completed_by
       FROM cleaning_tasks WHERE task_id = $1`, [taskId]);
  if (!task || task.status !== 'done' || task.pay_status !== 'unpaid') return null;
  const rate = await rateFor(db, task.organization_id, task);
  if (!rate) return null;
  const { rows: [out] } = await db.query(
    `UPDATE cleaning_tasks SET pay_amount = CASE WHEN $2::text = 'per_clean' THEN $3::numeric
        WHEN started_at IS NULL OR started_at = completed_at THEN NULL
        ELSE ROUND($3::numeric * LEAST(GREATEST(CEIL(EXTRACT(EPOCH FROM (completed_at - started_at)) / 900)::int, 0) * 15, 720) / 60, 2)
      END
      WHERE task_id = $1 RETURNING pay_amount`,
    [taskId, rate.rate_type, rate.amount]);
  return out.pay_amount;
}

module.exports = { computePay, rateFor };
