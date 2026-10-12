'use strict';

// Cleaning tasks: one per departing stay, created when the guest checks out
// or automatically for today's and tomorrow's departures.

const { pool, query } = require('../db');

const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;

// Insert the cleaning task for a reservation if it doesn't have one yet.
async function ensureTaskForBooking(bookingId, user = null, db = pool) {
  const { rows: [t] } = await db.query(
    `INSERT INTO cleaning_tasks (organization_id, unit_id, booking_id, due_date, next_check_in, checklist, created_by)
     SELECT b.organization_id, b.unit_id, b.booking_id, b.check_out,
            (SELECT MIN(n.check_in) FROM bookings n WHERE n.unit_id = b.unit_id AND n.kind = 'reservation'
                AND n.status = 'confirmed' AND n.check_in >= b.check_out),
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('text', item, 'done', false)), '[]'::jsonb)
               FROM jsonb_array_elements_text(o.cleaning_checklist) AS item),
            $2
       FROM bookings b JOIN organizations o ON o.organization_id = b.organization_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND b.status = 'confirmed'
     ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO NOTHING
     RETURNING task_id`, [bookingId, user?.user_id || null]);
  return t?.task_id || null;
}

// Keep open tasks in step with their stay (dates extended, moved to another unit).
async function syncOpenTasks(bookingId = null, db = pool) {
  await db.query(
    `UPDATE cleaning_tasks t SET due_date = b.check_out, unit_id = b.unit_id,
            next_check_in = (SELECT MIN(n.check_in) FROM bookings n WHERE n.unit_id = b.unit_id AND n.kind = 'reservation'
                                AND n.status = 'confirmed' AND n.check_in >= b.check_out)
       FROM bookings b
      WHERE b.booking_id = t.booking_id AND t.status IN ('todo', 'in_progress') AND b.status = 'confirmed'
        AND ($1::uuid IS NULL OR t.booking_id = $1)
        AND (t.due_date <> b.check_out OR t.unit_id <> b.unit_id
             OR t.next_check_in IS DISTINCT FROM (SELECT MIN(n.check_in) FROM bookings n WHERE n.unit_id = b.unit_id AND n.kind = 'reservation'
                                AND n.status = 'confirmed' AND n.check_in >= b.check_out))`, [bookingId]);
}

// Scheduler: tasks for stays checking out today or tomorrow.
async function createDueTasks() {
  const { rows } = await query(
    `SELECT b.booking_id FROM bookings b
       JOIN units u ON u.unit_id = b.unit_id
      WHERE b.kind = 'reservation' AND b.status = 'confirmed' AND u.status = 'active'
        AND b.check_out BETWEEN ${TODAY} AND ${TODAY} + 1
        AND NOT EXISTS (SELECT 1 FROM cleaning_tasks t WHERE t.booking_id = b.booking_id)`);
  for (const r of rows) await ensureTaskForBooking(r.booking_id);
  await syncOpenTasks();
  // A cancelled stay's open task is no longer needed.
  await query(
    `UPDATE cleaning_tasks t SET status = 'cancelled'
       FROM bookings b WHERE b.booking_id = t.booking_id AND b.status = 'cancelled' AND t.status IN ('todo', 'in_progress')`);
  return rows.length;
}

module.exports = { ensureTaskForBooking, createDueTasks, syncOpenTasks };
