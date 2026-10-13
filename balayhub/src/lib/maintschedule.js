'use strict';

// Recurring preventive maintenance (D-54). A schedule that has fallen due opens one
// maintenance request, then its next due date moves forward until it is after today
// (Manila time). Run hourly by the scheduler. `now` can be passed in for tests.

const { pool, tx } = require('../db');
const { audit } = require('./audit');

async function runSchedules(now = new Date()) {
  const { rows: [{ today }] } = await pool.query(`SELECT (($1::timestamptz) AT TIME ZONE 'Asia/Manila')::date AS today`, [now]);
  const { rows: due } = await pool.query(
    `SELECT s.schedule_id
       FROM maintenance_schedules s
       JOIN properties p ON p.property_id = s.property_id
       LEFT JOIN units u ON u.unit_id = s.unit_id
      WHERE s.active AND s.next_due <= $1::date AND p.status = 'active' AND (u.unit_id IS NULL OR u.status = 'active')
      ORDER BY s.next_due`, [today]);
  let created = 0;
  for (const { schedule_id: id } of due) created += await runOne(id, today);
  return created;
}

// Returns 1 if a request was opened, else 0. The due date moves on either way, so a schedule
// that is still waiting on an open request doesn't get checked again every hour.
async function runOne(scheduleId, today) {
  return tx(async (db) => {
    // Re-read under a row lock, so two runs can't both open the request.
    const { rows: [s] } = await db.query(
      `SELECT * FROM maintenance_schedules WHERE schedule_id = $1 AND active AND next_due <= $2::date FOR UPDATE`,
      [scheduleId, today]);
    if (!s) return 0;
    const { rows: [open] } = await db.query(
      `SELECT 1 FROM maintenance_requests WHERE schedule_id = $1 AND status IN ('open', 'in_progress') LIMIT 1`, [s.schedule_id]);
    let created = 0;
    if (!open) {
      const { rows: [m] } = await db.query(
        `INSERT INTO maintenance_requests (organization_id, property_id, unit_id, reported_by, title, description, priority, schedule_id, created_by)
         VALUES ($1,$2,$3,'Recurring schedule',$4,$5,$6,$7,$8) RETURNING request_id`,
        [s.organization_id, s.property_id, s.unit_id, s.title, s.description, s.priority, s.schedule_id, s.created_by]);
      await audit(db, null, 'maintenance.scheduled', 'maintenance', m.request_id, { schedule_id: s.schedule_id });
      created = 1;
    }
    // Jump to the first due date after today in one query: one request per run (no backlog
    // after a pause), with no loop per interval. Only due schedules get here (next_due <= today).
    // Days: whole steps from the stored date. Months: the first step past today. A month is at
    // least 28 days, so the series bound (days / 28 + 2) always reaches that step.
    // ponytail: each run counts from the stored date, so a 31st can drift to the 30th after a short month; anchor to the first due date if that matters.
    const { rows: [step] } = await db.query(
      `SELECT CASE WHEN $3 = 'days'
                THEN $1::date + ceil(($2::date - $1::date + 1)::numeric / $4::int)::int * $4::int
                ELSE (SELECT ($1::date + make_interval(months => k * $4::int))::date
                        FROM generate_series(1, ($2::date - $1::date) / 28 + 2) AS k
                       WHERE ($1::date + make_interval(months => k * $4::int))::date > $2::date
                       ORDER BY k LIMIT 1)
              END AS next`,
      [s.next_due, today, s.every_unit, s.every_n]);
    await db.query(
      `UPDATE maintenance_schedules SET next_due = $2, last_created_at = CASE WHEN $3 THEN now() ELSE last_created_at END
        WHERE schedule_id = $1`,
      [s.schedule_id, step.next, created === 1]);
    return created;
  });
}

module.exports = { runSchedules };
