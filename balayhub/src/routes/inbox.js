'use strict';

// Guest inbox: one conversation per reservation, emailed to the guest; guest
// replies come back over IMAP (lib/inbound.js). Templates and automatic
// messages live here too. Owners and managers only.

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { mailEnabled } = require('../lib/mailer');
const messaging = require('../lib/messaging');
const { inboxStatus } = require('../lib/inbound');
const config = require('../config');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const owners = requireRole('owner');
router.use(['/inbox', '/message-templates', '/automations'], managers);

const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });

// Create default templates once per workspace per process.
const seeded = new Set();
async function defaults(orgId) {
  if (seeded.has(orgId)) return;
  await messaging.ensureDefaults(orgId);
  seeded.add(orgId);
}

const CONV_FROM = `
    FROM conversations c
    JOIN bookings b ON b.booking_id = c.booking_id
    JOIN units u ON u.unit_id = b.unit_id
    JOIN properties p ON p.property_id = u.property_id
    LEFT JOIN guests g ON g.guest_id = b.guest_id
    LEFT JOIN users au ON au.user_id = c.assigned_to`;

const CONV_COLS = `
  c.conversation_id, c.booking_id, c.subject, c.status, c.assigned_to, au.full_name AS assigned_name,
  c.snoozed_until, c.unread, c.last_message_at,
  COALESCE(g.full_name, b.guest_label, 'Guest') AS guest_name, g.email AS guest_email,
  b.check_in, b.check_out, b.status AS booking_status, b.channel, b.confirmation_code, b.checked_in_at, b.checked_out_at,
  u.unit_id, u.unit_name, p.property_name`;

async function loadConversation(user, id) {
  const params = [id];
  const row = await one(`SELECT ${CONV_COLS} ${CONV_FROM} WHERE c.conversation_id = $1 AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

async function loadReservation(user, id) {
  const params = [id];
  const row = await one(
    `SELECT b.*, g.email AS guest_email FROM bookings b JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

const VIEWS = {
  open: `c.status = 'open' AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())`,
  unread: `c.status = 'open' AND c.unread AND (c.snoozed_until IS NULL OR c.snoozed_until <= now())`,
  mine: `c.status = 'open' AND c.assigned_to = $USER`,
  upcoming: `c.status = 'open' AND b.status = 'confirmed' AND b.check_in > ${TODAY}`,
  hosting: `c.status = 'open' AND b.status = 'confirmed' AND b.check_in <= ${TODAY} AND b.check_out > ${TODAY}`,
  snoozed: `c.status = 'open' AND c.snoozed_until > now()`,
  archived: `c.status = 'archived'`,
};

function viewSql(view, params, user) {
  let sql = VIEWS[view] || VIEWS.open;
  if (sql.includes('$USER')) { params.push(user.user_id); sql = sql.replace('$USER', `$${params.length}`); }
  return sql;
}

// ---------------------------------------------------------------- conversations
router.get('/inbox', ah(async (req, res) => {
  await defaults(req.user.organization_id);
  const view = VIEWS[req.query.view] ? req.query.view : 'open';
  const params = [];
  const where = [propertyScope(req.user, params), viewSql(view, params, req.user)];
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`);
    const i = params.length;
    where.push(`(COALESCE(g.full_name, b.guest_label) ILIKE $${i} OR u.unit_name ILIKE $${i} OR b.confirmation_code ILIKE $${i} OR c.subject ILIKE $${i})`);
  }
  const { rows } = await query(
    `SELECT ${CONV_COLS}, last.body AS last_body, last.direction AS last_direction, last.status AS last_status,
            (SELECT COUNT(*) FROM messages s WHERE s.conversation_id = c.conversation_id AND s.status = 'scheduled') AS scheduled_count,
            (SELECT COUNT(*) FROM messages s WHERE s.conversation_id = c.conversation_id AND s.status = 'failed') AS failed_count
     ${CONV_FROM}
     LEFT JOIN LATERAL (SELECT m.body, m.direction, m.status FROM messages m WHERE m.conversation_id = c.conversation_id
                          AND m.status <> 'cancelled' ORDER BY m.created_at DESC LIMIT 1) last ON true
     WHERE ${where.join(' AND ')}
     ORDER BY c.unread DESC, c.last_message_at DESC LIMIT 200`, params);
  for (const r of rows) r.last_body = r.last_body ? r.last_body.slice(0, 140) : '';
  res.json({ view, conversations: rows });
}));

router.get('/inbox/counts', ah(async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  params.push(req.user.user_id);
  const me = params.length;
  const row = await one(
    `SELECT COUNT(*) FILTER (WHERE ${VIEWS.unread}) AS unread,
            COUNT(*) FILTER (WHERE ${VIEWS.open}) AS open,
            COUNT(*) FILTER (WHERE ${VIEWS.mine.replace('$USER', `$${me}`)}) AS mine,
            COUNT(*) FILTER (WHERE ${VIEWS.upcoming}) AS upcoming,
            COUNT(*) FILTER (WHERE ${VIEWS.hosting}) AS hosting,
            COUNT(*) FILTER (WHERE ${VIEWS.snoozed}) AS snoozed
     ${CONV_FROM} WHERE ${scope}`, params);
  res.json({ counts: row });
}));

router.get('/inbox/status', ah(async (req, res) => {
  const replies = await inboxStatus();
  res.json({
    sending: mailEnabled(),
    replies,
    reply_address_ready: Boolean(messaging.replyAddress('test')),
    ai_drafts: Boolean(config.anthropicApiKey),
  });
}));

// People a conversation can be assigned to.
router.get('/inbox/assignees', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT user_id, full_name FROM users WHERE organization_id = $1 AND role IN ('owner', 'manager') AND account_status = 'active'
      ORDER BY full_name`, [req.user.organization_id]);
  res.json({ assignees: rows });
}));

// Start (or open) the conversation for a reservation.
router.post('/reservations/:id/conversation', managers, ah(async (req, res) => {
  const b = await loadReservation(req.user, uuidParam(req.params.id));
  const conv = await messaging.getOrCreateConversation(b.booking_id);
  res.json({ conversation_id: conv.conversation_id });
}));

router.get('/inbox/:id', ah(async (req, res) => {
  const conv = await loadConversation(req.user, uuidParam(req.params.id));
  const { rows: messages } = await query(
    `SELECT m.message_id, m.direction, m.kind, m.from_name, m.from_email, m.to_email, m.subject, m.body, m.status, m.error,
            m.scheduled_at, m.sent_at, m.created_at, u.full_name AS sent_by_name
       FROM messages m LEFT JOIN users u ON u.user_id = m.sent_by
      WHERE m.conversation_id = $1 ORDER BY COALESCE(m.sent_at, m.scheduled_at, m.created_at), m.created_at`, [conv.conversation_id]);
  const booking = await one(
    `SELECT b.num_guests, b.total_amount,
            (b.total_amount - COALESCE((SELECT SUM(amount) FROM booking_payments bp WHERE bp.booking_id = b.booking_id AND bp.voided_at IS NULL), 0))::numeric(12,2) AS balance,
            g.phone AS guest_phone
       FROM bookings b LEFT JOIN guests g ON g.guest_id = b.guest_id WHERE b.booking_id = $1`, [conv.booking_id]);
  if (conv.unread) await query('UPDATE conversations SET unread = false WHERE conversation_id = $1', [conv.conversation_id]);
  res.json({ conversation: { ...conv, ...booking, unread: false }, messages });
}));

router.patch('/inbox/:id', ah(async (req, res) => {
  const conv = await loadConversation(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    status: { type: 'enum', values: ['open', 'archived'], label: 'Status' },
    assigned_to: { type: 'uuid', label: 'Assignee' },
    snoozed_until: { type: 'string', max: 40, label: 'Snooze until' },
    unread: { type: 'bool', label: 'Unread' },
  }, { partial: true });
  const sets = [];
  const params = [conv.conversation_id];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (body.status) set('status', body.status);
  if ('assigned_to' in body) {
    if (body.assigned_to) {
      const member = await one(`SELECT user_id FROM users WHERE user_id = $1 AND organization_id = $2 AND role IN ('owner', 'manager') AND account_status = 'active'`,
        [body.assigned_to, req.user.organization_id]);
      if (!member) throw validationError({ assigned_to: 'Choose an owner or manager in this workspace.' });
    }
    set('assigned_to', body.assigned_to);
  }
  if ('snoozed_until' in body) {
    let until = null;
    if (body.snoozed_until) {
      until = new Date(body.snoozed_until);
      if (Number.isNaN(until.getTime()) || until <= new Date() || until > new Date(Date.now() + 366 * 86400000)) {
        throw validationError({ snoozed_until: 'Choose a time in the future.' });
      }
    }
    set('snoozed_until', until);
  }
  if ('unread' in body) set('unread', body.unread);
  if (sets.length) await query(`UPDATE conversations SET ${sets.join(', ')} WHERE conversation_id = $1`, params);
  res.json({ conversation: await loadConversation(req.user, conv.conversation_id) });
}));

// Send now, schedule, or add an internal note.
router.post('/inbox/:id/messages', ah(async (req, res) => {
  const conv = await loadConversation(req.user, uuidParam(req.params.id));
  const body = validate(req.body, {
    body: { type: 'text', required: true, max: 10000, label: 'Message' },
    subject: { type: 'string', max: 200, label: 'Subject' },
    send_at: { type: 'string', max: 40, label: 'Send at' },
    note: { type: 'bool', label: 'Internal note' },
  });
  let scheduledAt = null;
  if (body.send_at && !body.note) {
    scheduledAt = new Date(body.send_at);
    if (Number.isNaN(scheduledAt.getTime())) throw validationError({ send_at: 'Choose a valid date and time.' });
    if (scheduledAt <= new Date(Date.now() + 30 * 1000)) scheduledAt = null; // "now" or the past: send immediately
    else if (scheduledAt > new Date(Date.now() + 366 * 86400000)) throw validationError({ send_at: 'Messages can be scheduled up to a year ahead.' });
  }
  if (!body.note) {
    if (!conv.guest_email) {
      throw new HttpError(409, "This guest has no email address. Add one on the guest's profile first, or save this as an internal note.", { code: 'NO_EMAIL' });
    }
    if (!mailEnabled()) {
      throw new HttpError(409, 'Email sending is not set up on the server yet, so messages cannot be sent. See EMAIL-SETUP.md.', { code: 'MAIL_OFF' });
    }
  }
  const r = await messaging.queueMessage({
    bookingId: conv.booking_id, subject: body.subject, body: body.body, user: req.user, scheduledAt, note: body.note,
  });
  await query('UPDATE conversations SET unread = false WHERE conversation_id = $1', [conv.conversation_id]);
  await audit(null, req.user, body.note ? 'inbox.note_added' : (scheduledAt ? 'inbox.message_scheduled' : 'inbox.message_sent'),
    'message', r.message.message_id, { conversation_id: conv.conversation_id });
  const m = r.message;
  res.status(201).json({ message: { message_id: m.message_id, status: m.status, error: m.error, scheduled_at: m.scheduled_at, sent_at: m.sent_at } });
}));

// AI reply draft (only when ANTHROPIC_API_KEY is set). Never sent automatically.
router.post('/inbox/:id/ai-draft', ah(async (req, res) => {
  const conv = await loadConversation(req.user, uuidParam(req.params.id));
  const { instructions } = validate(req.body, { instructions: { type: 'text', max: 500, label: 'Instructions' } });
  const { draftReply, AiError } = require('../lib/ai');
  try {
    const draft = await draftReply({ conversation: { ...conv, organization_id: req.user.organization_id }, user: req.user, instructions });
    await audit(null, req.user, 'inbox.ai_draft', 'conversation', conv.conversation_id);
    res.json({ draft });
  } catch (err) {
    if (err instanceof AiError) throw new HttpError(err.status, err.message, { code: 'AI_FAILED' });
    throw err;
  }
}));

async function loadMessage(user, id) {
  const params = [id];
  const row = await one(
    `SELECT m.* FROM messages m JOIN conversations c ON c.conversation_id = m.conversation_id
       JOIN bookings b ON b.booking_id = c.booking_id JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE m.message_id = $1 AND ${propertyScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

router.post('/inbox/messages/:id/cancel', ah(async (req, res) => {
  const m = await loadMessage(req.user, uuidParam(req.params.id));
  const { rowCount } = await query(`UPDATE messages SET status = 'cancelled' WHERE message_id = $1 AND status = 'scheduled'`, [m.message_id]);
  if (!rowCount) throw new HttpError(409, 'This message is no longer scheduled (it was already sent or cancelled).', { code: 'NOT_SCHEDULED' });
  await audit(null, req.user, 'inbox.message_cancelled', 'message', m.message_id);
  res.json({ ok: true });
}));

router.post('/inbox/messages/:id/retry', ah(async (req, res) => {
  const m = await loadMessage(req.user, uuidParam(req.params.id));
  if (m.status !== 'failed') throw new HttpError(409, 'Only failed messages can be retried.', { code: 'NOT_FAILED' });
  if (!m.to_email) {
    // The guest may have been given an email since the first attempt.
    const g = await one(`SELECT g.email FROM conversations c JOIN bookings b USING (booking_id) LEFT JOIN guests g ON g.guest_id = b.guest_id
                          WHERE c.conversation_id = $1`, [m.conversation_id]);
    if (g?.email) await query('UPDATE messages SET to_email = $2 WHERE message_id = $1', [m.message_id, g.email]);
  }
  const r = await messaging.deliver(m.message_id);
  res.json({ ok: Boolean(r?.ok), error: r?.error || null });
}));

// ---------------------------------------------------------------- templates
const templateSpec = {
  name: { type: 'string', required: true, max: 80, label: 'Name' },
  subject: { type: 'string', required: true, max: 200, label: 'Subject' },
  body: { type: 'text', required: true, max: 5000, label: 'Message' },
};

async function loadTemplate(user, id) {
  const t = await one('SELECT * FROM message_templates WHERE template_id = $1 AND organization_id = $2', [id, user.organization_id]);
  if (!t) throw notFound();
  return t;
}

router.get('/message-templates', ah(async (req, res) => {
  await defaults(req.user.organization_id);
  const { rows } = await query(
    `SELECT template_id, name, subject, body, system_key, updated_at FROM message_templates
      WHERE organization_id = $1 AND NOT archived ORDER BY system_key IS NULL, name`, [req.user.organization_id]);
  res.json({ templates: rows, variables: messaging.VARIABLE_NAMES });
}));

router.post('/message-templates', ah(async (req, res) => {
  const body = validate(req.body, templateSpec);
  const t = await one(
    `INSERT INTO message_templates (organization_id, name, subject, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.organization_id, body.name, body.subject, body.body, req.user.user_id]);
  await audit(null, req.user, 'template.created', 'message_template', t.template_id);
  res.status(201).json({ template: t });
}));

router.patch('/message-templates/:id', ah(async (req, res) => {
  const t = await loadTemplate(req.user, uuidParam(req.params.id));
  const body = validate(req.body, templateSpec, { partial: true });
  const keys = Object.keys(body).filter((k) => body[k] !== null);
  if (keys.length) {
    await query(`UPDATE message_templates SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE template_id = $1`,
      [t.template_id, ...keys.map((k) => body[k])]);
    await audit(null, req.user, 'template.updated', 'message_template', t.template_id);
  }
  res.json({ template: await loadTemplate(req.user, t.template_id) });
}));

router.post('/message-templates/:id/archive', ah(async (req, res) => {
  const t = await loadTemplate(req.user, uuidParam(req.params.id));
  const used = await one('SELECT name FROM automations WHERE template_id = $1 AND enabled LIMIT 1', [t.template_id]);
  if (used) throw new HttpError(409, `This template is used by the automatic message "${used.name}". Turn that off first.`, { code: 'IN_USE' });
  await query('UPDATE message_templates SET archived = true, updated_at = now() WHERE template_id = $1', [t.template_id]);
  await audit(null, req.user, 'template.archived', 'message_template', t.template_id);
  res.json({ ok: true });
}));

// Fill a template in for one reservation (used by the composer).
router.get('/message-templates/:id/render', ah(async (req, res) => {
  const t = await loadTemplate(req.user, uuidParam(req.params.id));
  const b = await loadReservation(req.user, uuidParam(String(req.query.booking_id || '')));
  const out = await messaging.renderTemplateFor(t.template_id, b.booking_id, req.user.full_name);
  if (!out) throw notFound();
  res.json({ subject: out.subject, body: out.body });
}));

// ---------------------------------------------------------------- automatic messages
const TRIGGERS = ['booking_created', 'before_check_in', 'check_in_day', 'before_check_out', 'after_check_out'];
const automationSpec = {
  name: { type: 'string', required: true, max: 120, label: 'Name' },
  template_id: { type: 'uuid', required: true, label: 'Template' },
  trigger_event: { type: 'enum', values: TRIGGERS, required: true, label: 'When' },
  offset_days: { type: 'int', min: 0, max: 30, label: 'Days' },
  send_time: { type: 'time', label: 'Send time' },
  enabled: { type: 'bool', label: 'On' },
};

async function loadAutomation(user, id) {
  const a = await one('SELECT * FROM automations WHERE automation_id = $1 AND organization_id = $2', [id, user.organization_id]);
  if (!a) throw notFound();
  return a;
}

router.get('/automations', ah(async (req, res) => {
  await defaults(req.user.organization_id);
  const { rows } = await query(
    `SELECT a.automation_id, a.name, a.template_id, t.name AS template_name, a.trigger_event, a.offset_days,
            to_char(a.send_time, 'HH24:MI') AS send_time, a.enabled,
            (SELECT COUNT(*) FROM automation_runs r WHERE r.automation_id = a.automation_id AND r.message_id IS NOT NULL) AS sent_count
       FROM automations a JOIN message_templates t USING (template_id)
      WHERE a.organization_id = $1 ORDER BY a.created_at`, [req.user.organization_id]);
  res.json({ automations: rows, can_edit: req.user.role === 'owner', sending: mailEnabled() });
}));

router.post('/automations', owners, ah(async (req, res) => {
  const body = validate(req.body, automationSpec);
  await loadTemplate(req.user, body.template_id);
  const a = await one(
    `INSERT INTO automations (organization_id, template_id, name, trigger_event, offset_days, send_time, enabled)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::time, '10:00'),$7) RETURNING *`,
    [req.user.organization_id, body.template_id, body.name, body.trigger_event, body.offset_days || 0, body.send_time, body.enabled]);
  await audit(null, req.user, 'automation.created', 'automation', a.automation_id, { enabled: a.enabled });
  res.status(201).json({ automation: a });
}));

router.patch('/automations/:id', owners, ah(async (req, res) => {
  const a = await loadAutomation(req.user, uuidParam(req.params.id));
  const body = validate(req.body, automationSpec, { partial: true });
  const keys = Object.keys(body).filter((k) => body[k] !== null);
  if (body.template_id) await loadTemplate(req.user, body.template_id);
  if (keys.length) {
    // Turning an automation on (again) starts counting from now, so it never
    // catches up on stays whose send time passed while it was off.
    const restart = body.enabled === true && !a.enabled ? ', created_at = now()' : '';
    await query(`UPDATE automations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}${restart} WHERE automation_id = $1`,
      [a.automation_id, ...keys.map((k) => body[k])]);
    await audit(null, req.user, 'automation.updated', 'automation', a.automation_id, { after: body });
  }
  res.json({ automation: await loadAutomation(req.user, a.automation_id) });
}));

router.post('/automations/:id/remove', owners, ah(async (req, res) => {
  const a = await loadAutomation(req.user, uuidParam(req.params.id));
  await query('DELETE FROM automations WHERE automation_id = $1', [a.automation_id]);
  await audit(null, req.user, 'automation.removed', 'automation', a.automation_id, { name: a.name });
  res.json({ ok: true });
}));

module.exports = router;
