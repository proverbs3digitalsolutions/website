'use strict';

// Housekeeping: cleaning tasks per departing stay, a checklist, photos, and
// assignment to a team member or a cleaner without a login. Staff (cleaners)
// see tasks for the properties they're assigned to.

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadUnit } = require('../lib/access');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const owners = requireRole('owner');

const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

const TASK_SELECT = `
  SELECT t.task_id, t.unit_id, t.booking_id, t.due_date, t.next_check_in, t.status, t.assigned_to, t.assignee_name,
         t.checklist, t.notes, t.started_at, t.completed_at, t.created_at,
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

async function loadTask(user, id) {
  const params = [id];
  const row = await one(`${TASK_SELECT} WHERE t.task_id = $1 AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

const VIEWS = {
  today: `t.status IN ('todo', 'in_progress') AND t.due_date <= ${TODAY}`,
  upcoming: `t.status IN ('todo', 'in_progress') AND t.due_date > ${TODAY}`,
  open: `t.status IN ('todo', 'in_progress')`,
  done: `t.status = 'done'`,
  all: 'true',
};

router.get('/cleaning-tasks', ah(async (req, res) => {
  const view = VIEWS[req.query.view] ? req.query.view : 'open';
  const params = [];
  const where = [propertyScope(req.user, params), VIEWS[view]];
  if (req.query.mine === '1') { params.push(req.user.user_id); where.push(`t.assigned_to = $${params.length}`); }
  const order = view === 'done' ? 't.completed_at DESC' : 't.due_date, p.property_name, u.unit_name';
  const { rows } = await query(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`, params);
  const cp = [];
  const counts = await one(
    `SELECT COUNT(*) FILTER (WHERE ${VIEWS.today}) AS today, COUNT(*) FILTER (WHERE ${VIEWS.upcoming}) AS upcoming
       FROM cleaning_tasks t JOIN units u ON u.unit_id = t.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE ${propertyScope(req.user, cp)}`, cp);
  res.json({ view, tasks: rows, counts });
}));

router.get('/cleaning-tasks/:id', ah(async (req, res) => {
  const task = await loadTask(req.user, uuidParam(req.params.id));
  const { rows: files } = await query(
    `SELECT file_id, file_name, mime_type, size_bytes, uploaded_at FROM files
      WHERE related_record_type = 'cleaning' AND related_record_id = $1 ORDER BY uploaded_at`, [task.task_id]);
  res.json({ task, files });
}));

async function checkAssignee(user, body) {
  if (!body.assigned_to) return;
  const params = [body.assigned_to, user.organization_id];
  const member = await one(
    `SELECT user_id FROM users WHERE user_id = $1 AND organization_id = $2 AND account_status = 'active'`, params);
  if (!member) throw validationError({ assigned_to: 'Choose a member of this workspace.' });
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
  await checkAssignee(req.user, body);
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

router.patch('/cleaning-tasks/:id', managers, ah(async (req, res) => {
  const task = await loadTask(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    assigned_to: { type: 'uuid', label: 'Assigned to' },
    assignee_name: { type: 'string', max: 80, label: 'Cleaner name' },
    due_date: { type: 'date', label: 'Date' },
    notes: { type: 'text', max: 1000, label: 'Notes' },
  }, { partial: true });
  await checkAssignee(req.user, body);
  // A task goes to either a team member or a named cleaner, not both.
  if (body.assigned_to) body.assignee_name = null;
  else if (body.assignee_name) body.assigned_to = null;
  if ('due_date' in body && !body.due_date) delete body.due_date;
  const keys = Object.keys(body);
  if (body.assigned_to && body.assigned_to !== task.assigned_to) {
    require('../lib/push').notify(req.user.organization_id, 'cleaning', {
      title: `Cleaning assigned to you: ${task.unit_name}`, body: `Due ${task.due_date}`, url: `/#/housekeeping/${task.task_id}`, userId: body.assigned_to,
    }).catch(() => {});
  }
  if (keys.length) {
    await query(`UPDATE cleaning_tasks SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE task_id = $1`,
      [task.task_id, ...keys.map((k) => body[k])]);
    await audit(null, req.user, 'cleaning.task_updated', 'cleaning_task', task.task_id, { after: body });
  }
  res.json({ task: await loadTask(req.user, task.task_id) });
}));

// Tick checklist items (anyone who can see the task, including cleaners).
router.post('/cleaning-tasks/:id/checklist', ah(async (req, res) => {
  const task = await loadTask(req.user, uuidParam(req.params.id));
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

// Start / finish / reopen / cancel. Finishing marks the listing clean.
router.post('/cleaning-tasks/:id/status', ah(async (req, res) => {
  const task = await loadTask(req.user, uuidParam(req.params.id));
  const { status } = validate(req.body, { status: { type: 'enum', values: ['todo', 'in_progress', 'done', 'cancelled'], required: true, label: 'Status' } });
  if (status === 'cancelled' && req.user.role === 'staff') throw new HttpError(403, 'Only owners and managers can cancel cleaning tasks.', { code: 'FORBIDDEN' });
  await tx(async (db) => {
    const set = {
      todo: 'status = \'todo\', started_at = NULL, completed_at = NULL, completed_by = NULL',
      in_progress: 'status = \'in_progress\', started_at = COALESCE(started_at, now()), completed_at = NULL, completed_by = NULL',
      done: 'status = \'done\', started_at = COALESCE(started_at, now()), completed_at = now(), completed_by = $2',
      cancelled: 'status = \'cancelled\'',
    }[status];
    await db.query(`UPDATE cleaning_tasks SET ${set} WHERE task_id = $1`, status === 'done' ? [task.task_id, req.user.user_id] : [task.task_id]);
    if (status === 'done') {
      await db.query(`UPDATE units SET cleaning_status = 'clean', cleaning_updated_at = now() WHERE unit_id = $1`, [task.unit_id]);
    }
    await audit(db, req.user, `cleaning.task_${status}`, 'cleaning_task', task.task_id);
  });
  if (status === 'done') {
    require('../lib/push').notify(req.user.organization_id, 'cleaning', {
      title: `Cleaning done: ${task.unit_name}`, body: `${req.user.full_name} finished the cleaning.`,
      url: `/#/housekeeping/${task.task_id}`, propertyId: task.property_id, roles: ['owner', 'manager'],
    }).catch(() => {});
  }
  res.json({ task: await loadTask(req.user, task.task_id) });
}));

// People a task can be assigned to (any active team member).
router.get('/cleaning-assignees', managers, ah(async (req, res) => {
  const { rows } = await query(
    `SELECT user_id, full_name, role FROM users WHERE organization_id = $1 AND account_status = 'active' ORDER BY role = 'staff' DESC, full_name`,
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
  if (!items || items.length > 40 || items.some((x) => x.length > 120)) {
    throw validationError({ items: 'Enter up to 40 checklist items, each up to 120 characters.' });
  }
  await query('UPDATE organizations SET cleaning_checklist = $2 WHERE organization_id = $1', [req.user.organization_id, JSON.stringify(items)]);
  await audit(null, req.user, 'cleaning.checklist_updated', 'organization', req.user.organization_id, { count: items.length });
  res.json({ items });
}));

module.exports = router;
