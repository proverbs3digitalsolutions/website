'use strict';

// Cleaning tasks: one per departing stay, created when the guest checks out
// or automatically for today's and tomorrow's departures. Also the rules for
// what a cleaner or staff member may see of a task.

const { pool, query } = require('../db');
const { propertyScope } = require('./access');
const { isCleaner } = require('./cleaner');

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

// Tasks a cleaner may see are their own, or not given to anyone yet (no team
// member and no outside name). For everyone else the condition is always true.
function cleanerTaskSql(user, params, alias = 't') {
  if (!isCleaner(user)) return 'true';
  params.push(user.user_id);
  return `(${alias}.assigned_to = $${params.length} OR (${alias}.assigned_to IS NULL AND ${alias}.assignee_name IS NULL))`;
}

// Cleaning tasks `user` may see: the properties they're assigned to, narrowed
// for cleaners as above. Expects the properties alias `p` and tasks alias `t`.
function taskScope(user, params, alias = 't') {
  return `${propertyScope(user, params)} AND ${cleanerTaskSql(user, params, alias)}`;
}

// A cleaner sees a guest's first name only.
const firstName = (name) => (name ? name.trim().split(/\s+/)[0] || null : null);

// Who a task is for: a team member by user id, or an outside cleaner by name.
// Null for an unassigned task. Matches the SQL key used in /cleaner-scores.
function cleanerKey(assignedTo, assigneeName) {
  if (assignedTo) return `user:${assignedTo}`;
  return assigneeName ? `name:${assigneeName.toLowerCase()}` : null;
}

// The task fields `user` may see. Owners and managers see all of it. Everyone
// else gets pay only on a clean paid to them: the same payee rule as My pay (D-52), i.e.
// assigned to them, or unassigned and finished by them (BACKEND-SCHEMA 6.1). Everyone
// gets is_paid, yes or no with no amount, so a job page can show that a clean is paid.
// A cleaner also gets the guest's first name only. The internal completed_by id is never sent: done_by_viewer
// says only whether the viewer finished the clean, for every role.
function presentTask(user, row) {
  const { completed_by: doneBy, ...task } = row;
  const is_paid = task.pay_status === 'paid';
  const done_by_viewer = doneBy === user.user_id;
  if (['owner', 'manager'].includes(user.role)) return { ...task, is_paid, done_by_viewer };
  const mine = task.assigned_to ? task.assigned_to === user.user_id
    : !task.assignee_name && done_by_viewer;
  const shown = {
    ...task,
    is_paid,
    done_by_viewer,
    pay_amount: mine ? task.pay_amount : null,
    pay_status: mine ? task.pay_status : null,
  };
  if (!isCleaner(user)) return shown;
  return { ...shown, departing_guest: firstName(task.departing_guest) };
}

module.exports = { ensureTaskForBooking, createDueTasks, syncOpenTasks, TODAY, taskScope, cleanerTaskSql, presentTask, firstName, cleanerKey };
