'use strict';

// Housekeeping: cleaning tasks per departing stay, a checklist, photos, the
// status board and calendar, inspections, and assignment to a team member or a
// cleaner without a login. Owners, managers and staff see the properties they
// are assigned to. Staff see a cleaner's pay only on a clean paid to them. Cleaners
// also see only their own tasks and unassigned ones, with the guest's first name
// only and no pay except their own.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam, isValidDate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadUnit } = require('../lib/access');
const { isCleaner } = require('../lib/cleaner');
const { TODAY, taskScope, cleanerTaskSql, presentTask, firstName, cleanerKey } = require('../lib/housekeeping');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const owners = requireRole('owner');
const DAY_MS = 24 * 3600 * 1000;
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

// Cleaner pay is worked out by src/lib/cleanerpay.js when that module exists.
// Until then a finished clean simply has no pay yet.
function cleanerPay() {
  try {
    return require('../lib/cleanerpay');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && String(err.message).includes('cleanerpay')) return null;
    throw err;
  }
}

const TASK_SELECT = `
  SELECT t.task_id, t.unit_id, t.booking_id, t.due_date, t.next_check_in, t.status, t.assigned_to, t.assignee_name,
         t.checklist, t.notes, t.started_at, t.completed_at, t.completed_by, t.created_at, t.pay_amount, t.pay_status,
         u.unit_name, u.cleaning_status, p.property_id, p.property_name,
         au.full_name AS assigned_user_name, cu.full_name AS completed_by_name,
         COALESCE(g.full_name, b.guest_label) AS departing_guest, b.check_out AS departure_date, b.checked_out_at,
         (SELECT COUNT(*) FROM jsonb_array_elements(t.checklist) x WHERE (x->>'done')::boolean) AS done_count,
         jsonb_array_length(t.checklist) AS item_count
    FROM cleaning_tasks t
    JOIN units u ON u.unit_id = t.unit_id
    JOIN properties p ON p.property_id = u.property_id
    LEFT JOIN bookings b ON b.booking_id = t.booking_id
    LEFT JOIN guests g ON g.guest_id = b.guest_id
    LEFT JOIN users au ON au.user_id = t.assigned_to
    LEFT JOIN users cu ON cu.user_id = t.completed_by`;

// The task as stored, for checks before a write. Scoped like every task read.
async function loadTaskRow(user, id) {
  const params = [id];
  const row = await one(`${TASK_SELECT} WHERE t.task_id = $1 AND ${taskScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

// The task as `user` may see it.
async function loadTask(user, id) {
  return presentTask(user, await loadTaskRow(user, id));
}

const VIEWS = {
  today: `t.status IN ('todo', 'in_progress') AND t.due_date <= ${TODAY}`,
  upcoming: `t.status IN ('todo', 'in_progress') AND t.due_date > ${TODAY}`,
  open: `t.status IN ('todo', 'in_progress')`,
  done: `t.status = 'done'`,
  all: 'true',
};

const STATUSES = ['todo', 'in_progress', 'done', 'cancelled'];
const SORTS = {
  due: 't.due_date, p.property_name, u.unit_name',
  due_desc: 't.due_date DESC, p.property_name, u.unit_name',
  listing: 'p.property_name, u.unit_name, t.due_date',
  next_guest: 't.next_check_in NULLS LAST, t.due_date',
  completed: 't.completed_at DESC NULLS LAST',
};

// Filters on top of the view: mine, q, status, property_id, unit_id, assignee
// (a user id, "unassigned" or "outside" for a cleaner without a login),
// from/to (due date), late (overdue only), turnover (same_day | next_booked |
// no_next) and sort. A cleaner's search does not match guest surnames.
router.get('/cleaning-tasks', ah(async (req, res) => {
  const qp = req.query;
  const view = VIEWS[qp.view] ? qp.view : 'open';
  const params = [];
  const where = [taskScope(req.user, params), VIEWS[view]];
  if (qp.mine === '1') { params.push(req.user.user_id); where.push(`t.assigned_to = $${params.length}`); }
  if (typeof qp.q === 'string' && qp.q.trim()) {
    params.push(`%${qp.q.trim().slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    const i = params.length;
    const guest = isCleaner(req.user) ? '' : ` OR COALESCE(g.full_name, b.guest_label) ILIKE $${i}`;
    where.push(`(u.unit_name ILIKE $${i} OR p.property_name ILIKE $${i} OR t.assignee_name ILIKE $${i} OR au.full_name ILIKE $${i} OR t.notes ILIKE $${i}${guest})`);
  }
  if (STATUSES.includes(qp.status)) { params.push(qp.status); where.push(`t.status = $${params.length}`); }
  if (qp.property_id) { params.push(uuidParam(qp.property_id)); where.push(`p.property_id = $${params.length}`); }
  if (qp.unit_id) { params.push(uuidParam(qp.unit_id)); where.push(`t.unit_id = $${params.length}`); }
  if (qp.assignee === 'unassigned') where.push('t.assigned_to IS NULL AND t.assignee_name IS NULL');
  else if (qp.assignee === 'outside') where.push('t.assigned_to IS NULL AND t.assignee_name IS NOT NULL');
  else if (qp.assignee) { params.push(uuidParam(qp.assignee)); where.push(`t.assigned_to = $${params.length}`); }
  if (isValidDate(qp.from)) { params.push(qp.from); where.push(`t.due_date >= $${params.length}`); }
  if (isValidDate(qp.to)) { params.push(qp.to); where.push(`t.due_date <= $${params.length}`); }
  if (qp.late === '1') where.push(`t.status IN ('todo', 'in_progress') AND t.due_date < ${TODAY}`);
  if (qp.turnover === 'same_day') where.push('t.next_check_in = t.due_date');
  if (qp.turnover === 'next_booked') where.push('t.next_check_in IS NOT NULL');
  if (qp.turnover === 'no_next') where.push('t.next_check_in IS NULL');
  const order = SORTS[qp.sort] || (view === 'done' ? SORTS.completed : SORTS.due);
  const { rows } = await query(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`, params);
  const cp = [];
  const counts = await one(
    `SELECT COUNT(*) FILTER (WHERE ${VIEWS.today}) AS today, COUNT(*) FILTER (WHERE ${VIEWS.upcoming}) AS upcoming
       FROM cleaning_tasks t JOIN units u ON u.unit_id = t.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE ${taskScope(req.user, cp)}`, cp);
  res.json({ view, tasks: rows.map((r) => presentTask(req.user, r)), counts });
}));

// One task with its checklist files, inspections, damage reports, lost and
// found items and the work orders raised from it. Owners and managers see all
// of it (section 6.1). Staff and cleaners see only the damage reports and lost
// items they filed, and never an amount, charge, resolution or status note
// (D-51). Staff get no inspections; cleaners get them on their own jobs only and no work orders.
router.get('/cleaning-tasks/:id', ah(async (req, res) => {
  const task = await loadTask(req.user, uuidParam(req.params.id));
  const full = ['owner', 'manager'].includes(req.user.role);
  const cleaner = isCleaner(req.user);
  const mine = full ? '' : ' AND d.reported_by = $2';
  const mineLost = full ? '' : ' AND l.found_by = $2';
  const [files, inspections, damage, lostFound, workOrders] = await Promise.all([
    query(
      `SELECT file_id, file_name, mime_type, size_bytes, uploaded_at FROM files
        WHERE related_record_type = 'cleaning' AND related_record_id = $1 ORDER BY uploaded_at`, [task.task_id]),
    (req.user.role === 'staff' || (cleaner && task.assigned_to !== req.user.user_id)) ? { rows: [] } : query(
      `SELECT i.inspection_id, i.score, i.passed, i.items, i.notes, i.created_at, iu.full_name AS inspected_by_name
         FROM cleaning_inspections i LEFT JOIN users iu ON iu.user_id = i.inspected_by
        WHERE i.task_id = $1 ORDER BY i.created_at DESC`, [task.task_id]),
    query(
      `SELECT d.report_id, d.description, d.created_at, reporter.full_name AS reported_by_name
              ${full ? ', d.estimated_cost, d.status, d.charge_id, d.resolution_note, d.resolved_at, resolver.full_name AS resolved_by_name' : ''}
         FROM damage_reports d
         LEFT JOIN users reporter ON reporter.user_id = d.reported_by
         LEFT JOIN users resolver ON resolver.user_id = d.resolved_by
        WHERE d.task_id = $1${mine} ORDER BY d.created_at DESC`, full ? [task.task_id] : [task.task_id, req.user.user_id]),
    query(
      `SELECT l.item_id, l.description, l.found_where, l.found_on, l.status, l.created_at, finder.full_name AS found_by_name
              ${full ? ', l.status_note' : ''}
         FROM lost_found_items l LEFT JOIN users finder ON finder.user_id = l.found_by
        WHERE l.task_id = $1${mineLost} ORDER BY l.created_at DESC`, full ? [task.task_id] : [task.task_id, req.user.user_id]),
    cleaner ? { rows: [] } : query(
      `SELECT request_id, title, status FROM maintenance_requests WHERE cleaning_task_id = $1 ORDER BY created_at DESC`, [task.task_id]),
  ]);
  // Photos attached to the damage reports and lost items above.
  const { rows: itemFiles } = await query(
    `SELECT file_id, related_record_type, related_record_id, file_name, mime_type FROM files
      WHERE related_record_type IN ('damage', 'lost_found') AND related_record_id = ANY($1::uuid[])
      ORDER BY uploaded_at`, [[...damage.rows.map((r) => r.report_id), ...lostFound.rows.map((r) => r.item_id)]]);
  const photosOf = (type, id) => itemFiles
    .filter((f) => f.related_record_type === type && f.related_record_id === id)
    .map(({ file_id, file_name, mime_type }) => ({ file_id, file_name, mime_type }));
  res.json({
    task: {
      ...task,
      inspections: inspections.rows,
      damage_reports: damage.rows.map((r) => ({ ...r, files: photosOf('damage', r.report_id) })),
      lost_found: lostFound.rows.map((r) => ({ ...r, files: photosOf('lost_found', r.item_id) })),
      work_orders: workOrders.rows,
    },
    files: files.rows,
  });
}));

// A team member can take a cleaning task only if they can open it: owners
// always; managers and staff only with a property_assignments row for the
// task's property. "No one" and a named cleaner without a login stay allowed.
async function checkAssignee(user, body, propertyId, propertyName) {
  if (!body.assigned_to) return;
  const member = await one(
    `SELECT u.user_id, u.role = 'owner' OR EXISTS (
              SELECT 1 FROM property_assignments pa WHERE pa.user_id = u.user_id AND pa.property_id = $3) AS eligible
       FROM users u WHERE u.user_id = $1 AND u.organization_id = $2 AND u.account_status = 'active'`,
    [body.assigned_to, user.organization_id, propertyId]);
  if (!member) throw validationError({ assigned_to: 'Choose a member of this workspace.' });
  if (!member.eligible) {
    throw validationError({ assigned_to: `This team member isn't assigned to ${propertyName}. Add them to the property in Settings → Team first, or pick someone else.` });
  }
}

// Add a cleaning task by hand (e.g. a mid-stay clean or deep clean).
router.post('/cleaning-tasks', managers, ah(async (req, res) => {
  const body = validate(req.body, {
    unit_id: { type: 'uuid', required: true, label: 'Listing' },
    due_date: { type: 'date', required: true, label: 'Date' },
    assigned_to: { type: 'uuid', label: 'Assigned to' },
    assignee_name: { type: 'string', max: 80, label: 'Cleaner name' },
    notes: { type: 'text', max: 1000, label: 'Notes' },
  });
  const unit = await loadUnit(req.user, body.unit_id);
  await checkAssignee(req.user, body, unit.property_id, unit.property_name);
  const t = await one(
    `INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, assigned_to, assignee_name, notes, checklist, created_by,
                                 next_check_in)
     SELECT $1,$2,$3,$4,$5,$6,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('text', item, 'done', false)), '[]'::jsonb) FROM jsonb_array_elements_text(o.cleaning_checklist) item),
            $7,
            (SELECT MIN(n.check_in) FROM bookings n WHERE n.unit_id = $2 AND n.kind = 'reservation' AND n.status = 'confirmed' AND n.check_in >= $3)
       FROM organizations o WHERE o.organization_id = $1 RETURNING task_id`,
    [req.user.organization_id, unit.unit_id, body.due_date, body.assigned_to, body.assigned_to ? null : body.assignee_name, body.notes, req.user.user_id]);
  await audit(null, req.user, 'cleaning.task_created', 'cleaning_task', t.task_id, { unit_id: unit.unit_id });
  res.status(201).json({ task: await loadTask(req.user, t.task_id) });
}));

// Owners and managers can change the assignee, the date and notes, and set the
// pay on a clean until it is paid.
router.patch('/cleaning-tasks/:id', managers, ah(async (req, res) => {
  const task = await loadTaskRow(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    assigned_to: { type: 'uuid', label: 'Assigned to' },
    assignee_name: { type: 'string', max: 80, label: 'Cleaner name' },
    due_date: { type: 'date', label: 'Date' },
    notes: { type: 'text', max: 1000, label: 'Notes' },
    pay_amount: { type: 'money', positive: true, label: 'Pay' },
  }, { partial: true });
  // A task goes to either a team member or a named cleaner, not both.
  if (body.assigned_to && body.assignee_name) throw validationError({ assignee_name: 'Pick a team member or type a name, not both.' });
  if (body.assigned_to) body.assignee_name = null;
  else if (body.assignee_name) body.assigned_to = null;
  if ('due_date' in body && !body.due_date) delete body.due_date;
  await checkAssignee(req.user, body, task.property_id, task.property_name);
  const keys = Object.keys(body);
  await tx(async (db) => {
    // Locked and read here, so a clean paid a moment ago can't be re-assigned or re-priced in between.
    const { rows: [cur] } = await db.query('SELECT pay_status, assigned_to, assignee_name FROM cleaning_tasks WHERE task_id = $1 FOR UPDATE', [task.task_id]);
    if (cur.pay_status === 'paid') {
      const moves = 'pay_amount' in body
        || ('assigned_to' in body && body.assigned_to !== cur.assigned_to)
        || ('assignee_name' in body && body.assignee_name !== cur.assignee_name);
      if (moves) throw new HttpError(409, "This clean is already paid, so its pay and cleaner can't change.", { code: 'PAID' });
    }
    if (keys.length) {
      await db.query(`UPDATE cleaning_tasks SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE task_id = $1`,
        [task.task_id, ...keys.map((k) => body[k])]);
      await audit(db, req.user, 'cleaning.task_updated', 'cleaning_task', task.task_id, { after: body });
    }
  });
  if (body.assigned_to && body.assigned_to !== task.assigned_to) {
    require('../lib/push').notify(req.user.organization_id, 'cleaning', {
      title: `Cleaning assigned to you: ${task.unit_name}`, body: `Due ${task.due_date}`, url: `/#/housekeeping/${task.task_id}`, userId: body.assigned_to,
    }).catch(() => {});
  }
  res.json({ task: await loadTask(req.user, task.task_id) });
}));

// Tick checklist items (anyone who can see the task, including cleaners).
router.post('/cleaning-tasks/:id/checklist', ah(async (req, res) => {
  const task = await loadTaskRow(req.user, uuidParam(req.params.id));
  if (!['todo', 'in_progress'].includes(task.status)) throw new HttpError(409, 'This task is already finished.', { code: 'FINISHED' });
  const { index, done } = validate(req.body, {
    index: { type: 'int', required: true, min: 0, max: 99, label: 'Item' },
    done: { type: 'bool', label: 'Done' },
  });
  if (index >= task.checklist.length) throw validationError({ index: 'No such checklist item.' });
  await query(
    `UPDATE cleaning_tasks SET checklist = jsonb_set(checklist, ARRAY[$2::text, 'done'], to_jsonb($3::boolean)),
            status = CASE WHEN status = 'todo' THEN 'in_progress' ELSE status END,
            started_at = COALESCE(started_at, now())
      WHERE task_id = $1`, [task.task_id, String(index), done]);
  res.json({ task: await loadTask(req.user, task.task_id) });
}));

// A cleaner starts a clean (todo to in progress) and finishes it (todo or in progress to done).
// Nothing else: reopening a finished clean is for owners and managers.
const CLEANER_MOVES = { todo: ['in_progress', 'done'], in_progress: ['in_progress', 'done'] };

// Start / finish / reopen / cancel. Finishing marks the listing clean and sets
// the clean's pay, and an unassigned clean goes to whoever finished it. A paid
// clean can't change status. Reopening an unpaid one clears its pay and makes
// the unit dirty again, as a failed inspection does. Cleaners can't cancel.
router.post('/cleaning-tasks/:id/status', ah(async (req, res) => {
  const task = await loadTaskRow(req.user, uuidParam(req.params.id));
  const { status } = validate(req.body, { status: { type: 'enum', values: STATUSES, required: true, label: 'Status' } });
  if (status === 'cancelled' && !['owner', 'manager'].includes(req.user.role)) {
    throw new HttpError(403, 'Only owners and managers can cancel cleaning tasks.', { code: 'FORBIDDEN' });
  }
  const changed = await tx(async (db) => {
    const { rows: [cur] } = await db.query('SELECT status, pay_status FROM cleaning_tasks WHERE task_id = $1 FOR UPDATE', [task.task_id]);
    if (cur.pay_status === 'paid') throw new HttpError(409, "This clean is already paid, so its status can't change.", { code: 'PAID' });
    // Finishing a clean that is already finished changes nothing: its finish time, finisher and pay stay as they are.
    if (status === 'done' && cur.status === 'done') return false;
    if (isCleaner(req.user) && !(CLEANER_MOVES[cur.status] || []).includes(status)) {
      if (cur.status === 'done') throw new HttpError(409, 'This clean is already finished. Ask an owner or manager to reopen it.', { code: 'FINISHED' });
      throw new HttpError(409, 'Cleaners can only start a clean or mark it finished.', { code: 'NOT_ALLOWED' });
    }
    const reopen = ['todo', 'in_progress'].includes(status) && cur.status === 'done';
    const set = {
      todo: 'status = \'todo\', started_at = NULL, completed_at = NULL, completed_by = NULL',
      in_progress: 'status = \'in_progress\', started_at = COALESCE(started_at, now()), completed_at = NULL, completed_by = NULL',
      done: `status = 'done', completed_at = now(), completed_by = $2,
             assigned_to = CASE WHEN assigned_to IS NULL AND assignee_name IS NULL THEN $2 ELSE assigned_to END`,
      cancelled: 'status = \'cancelled\'',
    }[status];
    await db.query(`UPDATE cleaning_tasks SET ${set}${reopen ? ', pay_amount = NULL' : ''} WHERE task_id = $1`,
      status === 'done' ? [task.task_id, req.user.user_id] : [task.task_id]);
    if (reopen) await db.query(`UPDATE units SET cleaning_status = 'dirty', cleaning_updated_at = now() WHERE unit_id = $1`, [task.unit_id]);
    if (status === 'done') {
      await db.query(`UPDATE units SET cleaning_status = 'clean', cleaning_updated_at = now() WHERE unit_id = $1`, [task.unit_id]);
      const pay = cleanerPay();
      if (pay) await pay.computePay(db, task.task_id);
    }
    await audit(db, req.user, `cleaning.task_${status}`, 'cleaning_task', task.task_id);
    return true;
  });
  if (changed && status === 'done') {
    require('../lib/push').notify(req.user.organization_id, 'cleaning', {
      title: `Cleaning done: ${task.unit_name}`, body: `${req.user.full_name} finished the cleaning.`,
      url: `/#/housekeeping/${task.task_id}`, propertyId: task.property_id, roles: ['owner', 'manager'],
    }).catch(() => {});
  }
  res.json({ task: await loadTask(req.user, task.task_id) });
}));

// One pass or fail for every checklist item, each index exactly once.
function inspectionItems(raw, checklist) {
  const fail = validationError({ items: 'Mark every checklist item as pass or fail.' });
  if (!Array.isArray(raw) || raw.length !== checklist.length) throw fail;
  const pass = new Array(checklist.length);
  for (const x of raw) {
    const index = x?.index;
    if (!Number.isInteger(index) || index < 0 || index >= checklist.length || pass[index] !== undefined || typeof x.pass !== 'boolean') throw fail;
    pass[index] = x.pass;
  }
  return checklist.map((item, i) => ({ text: item.text, pass: pass[i] }));
}

// Inspect a finished clean. Score = passed items ÷ items × 100, rounded.
// Pass = no failed items: the unit becomes inspected. A fail reopens the task
// with the failed items unticked, and the unit is dirty again.
router.post('/cleaning-tasks/:id/inspect', managers, ah(async (req, res) => {
  const task = await loadTaskRow(req.user, uuidParam(req.params.id));
  const { notes } = validate(req.body, { notes: { type: 'text', max: 1000, label: 'Notes' } });
  if (!task.checklist.length) throw validationError({ items: 'This clean has no checklist items to inspect.' });
  const items = inspectionItems(req.body?.items, task.checklist);
  const passedCount = items.filter((i) => i.pass).length;
  const score = Math.round((passedCount / items.length) * 100);
  const passed = passedCount === items.length;
  const inspection = await tx(async (db) => {
    const { rows: [cur] } = await db.query('SELECT status, pay_status, pay_amount FROM cleaning_tasks WHERE task_id = $1 FOR UPDATE', [task.task_id]);
    if (cur.status !== 'done') throw new HttpError(409, 'Only a finished clean can be inspected.', { code: 'NOT_DONE' });
    if (!passed && cur.pay_status === 'paid') {
      throw new HttpError(409, "This clean is already paid, so a failed inspection can't reopen it.", { code: 'PAID' });
    }
    const { rows: [ins] } = await db.query(
      `INSERT INTO cleaning_inspections (organization_id, task_id, inspected_by, items, score, passed, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING inspection_id`,
      [req.user.organization_id, task.task_id, req.user.user_id, JSON.stringify(items), score, passed, notes]);
    if (passed) {
      // Only a unit still waiting after its clean; a unit dirtied by a newer check-out stays dirty.
      await db.query(`UPDATE units SET cleaning_status = 'inspected', cleaning_updated_at = now() WHERE unit_id = $1 AND cleaning_status = 'clean'`, [task.unit_id]);
    } else {
      const checklist = task.checklist.map((c, i) => (items[i].pass ? c : { ...c, done: false }));
      await db.query(
        `UPDATE cleaning_tasks SET status = 'todo', started_at = NULL, completed_at = NULL, completed_by = NULL, pay_amount = NULL, checklist = $2
          WHERE task_id = $1`, [task.task_id, JSON.stringify(checklist)]);
      await db.query(`UPDATE units SET cleaning_status = 'dirty', cleaning_updated_at = now() WHERE unit_id = $1`, [task.unit_id]);
    }
    await audit(db, req.user, 'cleaning.inspected', 'cleaning_task', task.task_id, { score, passed });
    return { ...ins, payCleared: !passed && cur.pay_amount != null };
  });
  res.status(201).json({
    inspection: { inspection_id: inspection.inspection_id, passed, score },
    // A failed inspection reopens the clean and clears its pay (it is priced again when finished).
    pay_cleared: inspection.payCleared,
    task: await loadTask(req.user, task.task_id),
  });
}));

// Status board: each unit with its cleaning status, who is in it now, the next
// arrival, the open task and the latest inspection. A cleaner sees only their
// own open task and inspections, and a guest's first name.
router.get('/cleaning-board', ah(async (req, res) => {
  const params = [];
  const where = [propertyScope(req.user, params), "u.status = 'active'", "p.status = 'active'"];
  if (req.query.property_id) { params.push(uuidParam(req.query.property_id)); where.push(`p.property_id = $${params.length}`); }
  const visible = cleanerTaskSql(req.user, params, 't');
  const { rows } = await query(
    `SELECT u.unit_id, u.unit_name, p.property_id, p.property_name, u.cleaning_status, u.cleaning_updated_at,
            cs.booking_id AS stay_id, cs.check_in AS stay_check_in, cs.check_out AS stay_check_out, cs.guest_name,
            (SELECT MIN(n.check_in) FROM bookings n
              WHERE n.unit_id = u.unit_id AND n.kind = 'reservation' AND n.status = 'confirmed'
                AND n.check_in >= COALESCE(cs.check_out, ${TODAY}) AND n.booking_id IS DISTINCT FROM cs.booking_id) AS next_check_in,
            ot.task_id, ot.status AS task_status, COALESCE(au.full_name, ot.assignee_name) AS assignee,
            li.score, li.passed, li.created_at AS inspected_at
       FROM units u
       JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN LATERAL (
         SELECT b.booking_id, b.check_in, b.check_out, COALESCE(g.full_name, b.guest_label) AS guest_name
           FROM bookings b LEFT JOIN guests g ON g.guest_id = b.guest_id
          WHERE b.unit_id = u.unit_id AND b.kind = 'reservation' AND b.status = 'confirmed' AND b.checked_out_at IS NULL
            AND b.check_in <= ${TODAY} AND b.check_out >= ${TODAY}
          ORDER BY b.check_in LIMIT 1
       ) cs ON true
       LEFT JOIN LATERAL (
         SELECT t.task_id, t.status, t.assigned_to, t.assignee_name
           FROM cleaning_tasks t
          WHERE t.unit_id = u.unit_id AND t.status IN ('todo', 'in_progress') AND ${visible}
          ORDER BY t.due_date LIMIT 1
       ) ot ON true
       LEFT JOIN users au ON au.user_id = ot.assigned_to
       LEFT JOIN LATERAL (
         SELECT i.score, i.passed, i.created_at
           FROM cleaning_inspections i JOIN cleaning_tasks t ON t.task_id = i.task_id
          WHERE t.unit_id = u.unit_id AND ${visible}
          ORDER BY i.created_at DESC LIMIT 1
       ) li ON true
      WHERE ${where.join(' AND ')}
      ORDER BY p.property_name, u.unit_name`, params);
  res.json({
    units: rows.map((r) => ({
      unit_id: r.unit_id,
      unit_name: r.unit_name,
      property_id: r.property_id,
      property_name: r.property_name,
      cleaning_status: r.cleaning_status,
      cleaning_updated_at: r.cleaning_updated_at,
      current_stay: r.stay_id ? { check_in: r.stay_check_in, check_out: r.stay_check_out, guest_first_name: firstName(r.guest_name) } : null,
      next_check_in: r.next_check_in,
      open_task: r.task_id ? { task_id: r.task_id, status: r.task_status, assignee: r.assignee } : null,
      last_inspection: r.inspected_at ? { score: r.score, passed: r.passed, at: r.inspected_at } : null,
    })),
  });
}));

// Tasks for a span of up to 31 days (inclusive), grouped by day, plus the
// people on them. Cancelled tasks are left out. A cleaner sees their own and
// unassigned tasks.
router.get('/cleaning-calendar', ah(async (req, res) => {
  const { from, to } = validate(req.query, {
    from: { type: 'date', required: true, label: 'From' },
    to: { type: 'date', required: true, label: 'To' },
  });
  const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (span < 0) throw validationError({ to: 'The end date must be on or after the start date.' });
  if (span > 30) throw validationError({ to: 'Show at most 31 days at a time.' });
  const params = [];
  const scope = taskScope(req.user, params);
  params.push(from);
  const f = params.length;
  params.push(to);
  const e = params.length;
  const { rows } = await query(
    `SELECT t.task_id, t.due_date, t.status, t.next_check_in, t.assigned_to, t.assignee_name,
            u.unit_name, p.property_id, au.full_name AS assigned_user_name
       FROM cleaning_tasks t
       JOIN units u ON u.unit_id = t.unit_id
       JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN users au ON au.user_id = t.assigned_to
      WHERE ${scope} AND t.due_date BETWEEN $${f} AND $${e} AND t.status <> 'cancelled'
      ORDER BY t.due_date, u.unit_name`, params);
  const days = new Map();
  for (let ms = Date.parse(from); ms <= Date.parse(to); ms += DAY_MS) {
    const date = new Date(ms).toISOString().slice(0, 10);
    days.set(date, { date, tasks: [] });
  }
  const people = new Map();
  for (const r of rows) {
    days.get(r.due_date).tasks.push({
      task_id: r.task_id,
      unit_name: r.unit_name,
      property_id: r.property_id,
      status: r.status,
      next_check_in: r.next_check_in,
      assigned_to: r.assigned_to,
      assigned_user_name: r.assigned_user_name,
      assignee_name: r.assignee_name,
    });
    const key = cleanerKey(r.assigned_to, r.assignee_name);
    if (key && !people.has(key)) people.set(key, { cleaner_key: key, cleaner_name: r.assigned_user_name || r.assignee_name });
  }
  res.json({ days: [...days.values()], assignees: [...people.values()] });
}));

// Team members and outside cleaners (managers and owners). For a month in
// Manila time: cleans finished (tasks_done), and inspections made (inspected,
// avg_score, fails). A re-inspected clean counts once per inspection.
router.get('/cleaner-scores', managers, ah(async (req, res) => {
  let month = req.query.month;
  if (month === undefined || month === '') {
    month = (await one(`SELECT to_char(now() AT TIME ZONE 'Asia/Manila', 'YYYY-MM') AS m`)).m;
  } else if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw validationError({ month: 'Use a month like 2026-10.' });
  }
  const params = [month];
  const scope = propertyScope(req.user, params);
  const KEY = `CASE WHEN t.assigned_to IS NOT NULL THEN 'user:' || t.assigned_to::text ELSE 'name:' || lower(t.assignee_name) END`;
  const finished = await query(
    `SELECT ${KEY} AS cleaner_key, MIN(COALESCE(au.full_name, t.assignee_name)) AS cleaner_name, COUNT(*) AS tasks_done
       FROM cleaning_tasks t
       JOIN units u ON u.unit_id = t.unit_id
       JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN users au ON au.user_id = t.assigned_to
      WHERE t.status = 'done' AND (t.assigned_to IS NOT NULL OR t.assignee_name IS NOT NULL)
        AND to_char(t.completed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM') = $1 AND ${scope}
      GROUP BY 1`, params);
  const graded = await query(
    `SELECT ${KEY} AS cleaner_key, MIN(COALESCE(au.full_name, t.assignee_name)) AS cleaner_name,
            COUNT(*) AS inspected, ROUND(AVG(i.score), 1)::float8 AS avg_score, COUNT(*) FILTER (WHERE NOT i.passed) AS fails
       FROM cleaning_inspections i
       JOIN cleaning_tasks t ON t.task_id = i.task_id
       JOIN units u ON u.unit_id = t.unit_id
       JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN users au ON au.user_id = t.assigned_to
      WHERE (t.assigned_to IS NOT NULL OR t.assignee_name IS NOT NULL)
        AND to_char(i.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM') = $1 AND ${scope}
      GROUP BY 1`, params);
  const people = new Map();
  const person = (r) => {
    if (!people.has(r.cleaner_key)) {
      people.set(r.cleaner_key, { cleaner_key: r.cleaner_key, cleaner_name: r.cleaner_name, tasks_done: 0, inspected: 0, avg_score: null, fails: 0 });
    }
    return people.get(r.cleaner_key);
  };
  for (const r of finished.rows) person(r).tasks_done = r.tasks_done;
  for (const r of graded.rows) Object.assign(person(r), { inspected: r.inspected, avg_score: r.avg_score, fails: r.fails });
  res.json({ cleaners: [...people.values()].sort((a, b) => a.cleaner_name.localeCompare(b.cleaner_name)) });
}));

// People a task can be assigned to (any active team member). property_ids
// lists the properties a manager or staff member is assigned to (null for
// owners, who can take any task), so the picker can show only eligible people.
router.get('/cleaning-assignees', managers, ah(async (req, res) => {
  const { rows } = await query(
    `SELECT u.user_id, u.full_name, u.role,
            CASE WHEN u.role = 'owner' THEN NULL
                 ELSE COALESCE((SELECT array_agg(pa.property_id) FROM property_assignments pa WHERE pa.user_id = u.user_id), '{}') END AS property_ids
       FROM users u WHERE u.organization_id = $1 AND u.account_status = 'active' ORDER BY u.role = 'staff' DESC, u.full_name`,
    [req.user.organization_id]);
  res.json({ assignees: rows });
}));

// The workspace's default checklist used for new tasks.
router.get('/cleaning-checklist', ah(async (req, res) => {
  const o = await one('SELECT cleaning_checklist FROM organizations WHERE organization_id = $1', [req.user.organization_id]);
  res.json({ items: o.cleaning_checklist });
}));

router.put('/cleaning-checklist', owners, ah(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : null;
  if (items && !items.length) throw validationError({ items: 'Add at least one checklist item.' });
  if (!items || items.length > 40 || items.some((x) => x.length > 120)) {
    throw validationError({ items: 'Enter up to 40 checklist items, each up to 120 characters.' });
  }
  // A line repeated in any case would be two rows that tick separately.
  const seen = new Map();
  for (const x of items) {
    const key = x.toLowerCase();
    if (seen.has(key)) throw validationError({ items: `This checklist has “${seen.get(key)}” twice.` });
    seen.set(key, x);
  }
  await query('UPDATE organizations SET cleaning_checklist = $2 WHERE organization_id = $1', [req.user.organization_id, JSON.stringify(items)]);
  await audit(null, req.user, 'cleaning.checklist_updated', 'organization', req.user.organization_id, { count: items.length });
  res.json({ items });
}));

module.exports = router;
