'use strict';

// Guest inbox: one conversation per reservation, emailed to the guest; guest
// replies come back over IMAP (lib/inbound.js). Templates and automatic
// messages live here too. Owners and managers only; changing templates and
// automatic messages is owner-only (workspace-wide settings).

const express = require('express');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { own } = require('../lib/pick');
const { validate, uuidParam, isValidDate, UUID_RE } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { changedKeys } = require('../lib/auditdiff');
const { requireRole, rateLimit } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { mailEnabled } = require('../lib/mailer');
const messaging = require('../lib/messaging');
const { inboxStatus } = require('../lib/inbound');
const config = require('../config');
const { planStatus } = require('../lib/plans');
const push = require('../lib/push');
const { notifyUser } = require('../lib/notify');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const owners = requireRole('owner');
router.use(['/inbox', '/message-templates', '/automations'], managers);

// Per-person caps (in memory, like the other limiters): notes that @mention people, and assignment changes.
const mentionLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, key: (req) => `inbox-mention|${req.user.user_id}` });
const assignLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, key: (req) => `inbox-assign|${req.user.user_id}` });
// Runs a limiter inside a handler, once the handler knows the request should count.
const applyLimit = (limiter, req, res) => new Promise((resolve, reject) => limiter(req, res, (err) => (err ? reject(err) : resolve())));

const TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
// A DATE comes back as YYYY-MM-DD; shown as "Oct 20, 2026" (UTC, so the day never shifts).
const dayText = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
// A filter id that isn't a UUID is ignored, like a bad channel or view, so an old or edited link still loads the list.
const uuidOrNull = (v) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);
// A listing, property or person filter counts only when this workspace has that row; any other id is ignored like a bad one.
// The caller's own property scope still applies to the rows themselves.
async function inWorkspace(user, sql, id) {
  if (!id) return null;
  return (await one(sql, [id, user.organization_id])) ? id : null;
}

// A mention in a note is stored as @[Full Name](user id).
const MENTION_RE = /@\[([^\]\n]{1,120})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

// Check the people mentioned in a note: each must be an active owner or manager who can see the
// reservation's property. Returns [{ user_id, full_name }], one per person.
async function checkMentions(user, conv, text) {
  const typed = new Map();
  for (const m of text.matchAll(MENTION_RE)) typed.set(m[2].toLowerCase(), m[1]);
  if (!typed.size) return [];
  const propertyId = await push.propertyOfBooking(conv.booking_id);
  const { rows } = await query(
    `SELECT u.user_id, u.full_name, (u.role = 'owner' OR EXISTS (SELECT 1 FROM property_assignments pa
              WHERE pa.user_id = u.user_id AND pa.property_id = $3)) AS can_see
       FROM users u WHERE u.organization_id = $1 AND u.role IN ('owner', 'manager') AND u.account_status = 'active'
        AND u.user_id = ANY($2::uuid[])`,
    [user.organization_id, [...typed.keys()], propertyId]);
  const people = new Map(rows.map((r) => [r.user_id, r]));
  // Staff (and cleaners) exist in the workspace but can't be mentioned: say so rather than "Unknown person".
  const { rows: others } = await query(
    `SELECT user_id FROM users WHERE organization_id = $1 AND account_status = 'active' AND user_id = ANY($2::uuid[])`,
    [user.organization_id, [...typed.keys()].filter((id) => !people.has(id))]);
  const known = new Set(others.map((r) => r.user_id));
  const problems = new Set();
  const mentions = [];
  for (const id of typed.keys()) {
    const p = people.get(id);
    if (!p) problems.add(known.has(id) ? 'Only owners and managers can be mentioned.' : 'Unknown person');
    else if (!p.can_see) problems.add(`${p.full_name} can't see this reservation`);
    else mentions.push({ user_id: p.user_id, full_name: p.full_name });
  }
  if (problems.size) throw validationError({ body: [...problems].join(' ') });
  return mentions;
}

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
  let sql = own(VIEWS, view) || VIEWS.open;
  if (sql.includes('$USER')) { params.push(user.user_id); sql = sql.replace('$USER', `$${params.length}`); }
  return sql;
}

// Extra list filters (on top of the view): q, unread, channel, property_id,
// unit_id, stay, assigned (a user id or "unassigned"), msg_from/msg_to (date of
// the last message, Manila time), attention and sort.
const CHANNELS = ['direct', 'airbnb', 'booking', 'agoda', 'vrbo', 'expedia', 'tripcom', 'other'];
const STAYS = {
  upcoming: `b.status = 'confirmed' AND b.check_in > ${TODAY}`,
  in_house: `b.status = 'confirmed' AND b.check_in <= ${TODAY} AND b.check_out > ${TODAY}`,
  past: `b.status = 'confirmed' AND b.check_out <= ${TODAY}`,
  cancelled: `b.status = 'cancelled'`,
};
const INBOX_SORTS = {
  unread: 'c.unread DESC, c.last_message_at DESC',
  recent: 'c.last_message_at DESC',
  oldest: 'c.last_message_at',
  check_in: 'b.check_in, c.last_message_at DESC',
};

// ---------------------------------------------------------------- conversations
router.get('/inbox', ah(async (req, res) => {
  await defaults(req.user.organization_id);
  const view = own(VIEWS, req.query.view) ? req.query.view : 'open';
  const params = [];
  const where = [propertyScope(req.user, params), viewSql(view, params, req.user)];
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q) {
    params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`);
    const i = params.length;
    where.push(`(COALESCE(g.full_name, b.guest_label) ILIKE $${i} OR u.unit_name ILIKE $${i} OR b.confirmation_code ILIKE $${i} OR c.subject ILIKE $${i})`);
  }
  const qp = req.query;
  if (qp.unread === '1') where.push('c.unread');
  if (CHANNELS.includes(qp.channel)) { params.push(qp.channel); where.push(`b.channel = $${params.length}`); }
  const propertyId = await inWorkspace(req.user, 'SELECT 1 FROM properties WHERE property_id = $1 AND organization_id = $2', uuidOrNull(qp.property_id));
  if (propertyId) { params.push(propertyId); where.push(`p.property_id = $${params.length}`); }
  const unitId = await inWorkspace(req.user, `SELECT 1 FROM units u JOIN properties p ON p.property_id = u.property_id
                                               WHERE u.unit_id = $1 AND p.organization_id = $2`, uuidOrNull(qp.unit_id));
  if (unitId) { params.push(unitId); where.push(`u.unit_id = $${params.length}`); }
  if (own(STAYS, qp.stay)) where.push(own(STAYS, qp.stay));
  const assignee = await inWorkspace(req.user, `SELECT 1 FROM users WHERE user_id = $1 AND organization_id = $2 AND account_status = 'active'`, uuidOrNull(qp.assigned));
  if (qp.assigned === 'unassigned') where.push('c.assigned_to IS NULL');
  else if (assignee) { params.push(assignee); where.push(`c.assigned_to = $${params.length}`); }
  if (isValidDate(qp.msg_from)) { params.push(qp.msg_from); where.push(`(c.last_message_at AT TIME ZONE 'Asia/Manila')::date >= $${params.length}`); }
  if (isValidDate(qp.msg_to)) { params.push(qp.msg_to); where.push(`(c.last_message_at AT TIME ZONE 'Asia/Manila')::date <= $${params.length}`); }
  if (qp.attention === 'awaiting_reply') where.push(`last.direction = 'in'`);
  if (qp.attention === 'failed') where.push(`EXISTS (SELECT 1 FROM messages s WHERE s.conversation_id = c.conversation_id AND s.status = 'failed')`);
  if (qp.attention === 'scheduled') where.push(`EXISTS (SELECT 1 FROM messages s WHERE s.conversation_id = c.conversation_id AND s.status = 'scheduled')`);
  const order = own(INBOX_SORTS, qp.sort) || INBOX_SORTS.unread;
  const { rows } = await query(
    `SELECT ${CONV_COLS}, last.body AS last_body, last.direction AS last_direction, last.status AS last_status,
            (SELECT COUNT(*) FROM messages s WHERE s.conversation_id = c.conversation_id AND s.status = 'scheduled') AS scheduled_count,
            (SELECT COUNT(*) FROM messages s WHERE s.conversation_id = c.conversation_id AND s.status = 'failed') AS failed_count
     ${CONV_FROM}
     LEFT JOIN LATERAL (SELECT m.body, m.direction, m.status FROM messages m WHERE m.conversation_id = c.conversation_id
                          AND m.status <> 'cancelled' ORDER BY m.created_at DESC LIMIT 1) last ON true
     WHERE ${where.join(' AND ')}
     ORDER BY ${order} LIMIT 200`, params);
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

// Open conversations assigned to the signed-in person (Home: "Assigned to you (n)").
router.get('/inbox/assigned-count', ah(async (req, res) => {
  const params = [];
  const where = [propertyScope(req.user, params), viewSql('mine', params, req.user)];
  const row = await one(`SELECT COUNT(*)::int AS count ${CONV_FROM} WHERE ${where.join(' AND ')}`, params);
  res.json({ count: row.count });
}));

router.get('/inbox/status', ah(async (req, res) => {
  const replies = await inboxStatus();
  res.json({
    sending: mailEnabled(),
    replies,
    reply_address_ready: Boolean(messaging.replyAddress('test')),
    ai_drafts: Boolean(config.anthropicApiKey) && planStatus(req.user).ai,
    ai_needs_upgrade: Boolean(config.anthropicApiKey) && !planStatus(req.user).ai,
  });
}));

// People a conversation can be assigned to, or @mentioned in. With conversation_id, only the
// people who can see that conversation's property.
router.get('/inbox/assignees', ah(async (req, res) => {
  const conv = req.query.conversation_id ? await loadConversation(req.user, uuidParam(String(req.query.conversation_id))) : null;
  const propertyId = conv ? await push.propertyOfBooking(conv.booking_id) : null;
  const { rows } = await query(
    `SELECT u.user_id, u.full_name FROM users u
      WHERE u.organization_id = $1 AND u.role IN ('owner', 'manager') AND u.account_status = 'active'
        AND ($2::uuid IS NULL OR u.role = 'owner'
             OR EXISTS (SELECT 1 FROM property_assignments pa WHERE pa.user_id = u.user_id AND pa.property_id = $2))
      ORDER BY u.full_name`, [req.user.organization_id, propertyId]);
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
            (b.total_amount - CASE WHEN b.channel = 'direct' THEN 0 ELSE b.channel_fee END - COALESCE((SELECT SUM(amount) FROM booking_payments bp WHERE bp.booking_id = b.booking_id AND bp.voided_at IS NULL), 0))::numeric(12,2) AS balance,
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
    if (body.assigned_to !== conv.assigned_to) await applyLimit(assignLimiter, req, res);
    if (body.assigned_to) {
      const member = await one(
        `SELECT u.user_id, (u.role = 'owner' OR EXISTS (SELECT 1 FROM property_assignments pa
              WHERE pa.user_id = u.user_id AND pa.property_id = $3)) AS can_see
           FROM users u WHERE u.user_id = $1 AND u.organization_id = $2 AND u.role IN ('owner', 'manager') AND u.account_status = 'active'`,
        [body.assigned_to, req.user.organization_id, await push.propertyOfBooking(conv.booking_id)]);
      if (!member) throw validationError({ assigned_to: 'Choose an owner or manager in this workspace.' });
      if (!member.can_see) throw validationError({ assigned_to: "This person can't see this reservation's property." });
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
  if (body.assigned_to && body.assigned_to !== conv.assigned_to && body.assigned_to !== req.user.user_id) {
    await notifyUser(req.user.organization_id, body.assigned_to, 'assignment', {
      title: `${req.user.full_name} assigned you a conversation`,
      body: `${conv.guest_name} · ${conv.unit_name}, ${dayText(conv.check_in)}`,
      url: `/#/inbox/${conv.conversation_id}`,
      propertyId: await push.propertyOfBooking(conv.booking_id),
    });
  }
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
  if (body.note && body.body.search(MENTION_RE) !== -1) await applyLimit(mentionLimiter, req, res);
  const mentions = body.note ? await checkMentions(req.user, conv, body.body) : [];
  // Each mention is saved with the name on record, not the name typed, so the note and its alerts agree.
  const names = new Map(mentions.map((x) => [x.user_id, x.full_name]));
  const saved = body.note ? body.body.replace(MENTION_RE, (_m, _typed, id) => `@[${names.get(id.toLowerCase())}](${id.toLowerCase()})`) : body.body;
  const r = await messaging.queueMessage({
    bookingId: conv.booking_id, subject: body.subject, body: saved, user: req.user, scheduledAt, note: body.note,
  });
  await query('UPDATE conversations SET unread = false WHERE conversation_id = $1', [conv.conversation_id]);
  await audit(null, req.user, body.note ? 'inbox.note_added' : (scheduledAt ? 'inbox.message_scheduled' : 'inbox.message_sent'),
    'message', r.message.message_id, { conversation_id: conv.conversation_id });
  const others = mentions.filter((x) => x.user_id !== req.user.user_id);
  if (others.length) {
    const propertyId = await push.propertyOfBooking(conv.booking_id);
    const text = saved.replace(MENTION_RE, '@$1').slice(0, 140);
    await Promise.all(others.map((x) => notifyUser(req.user.organization_id, x.user_id, 'mention', {
      title: `${req.user.full_name} mentioned you`, body: text, url: `/#/inbox/${conv.conversation_id}`, propertyId,
    })));
  }
  const m = r.message;
  res.status(201).json({
    message: { message_id: m.message_id, status: m.status, error: m.error, scheduled_at: m.scheduled_at, sent_at: m.sent_at },
    mentions,
  });
}));

// AI reply draft (only when ANTHROPIC_API_KEY is set). Never sent automatically.
router.post('/inbox/:id/ai-draft', ah(async (req, res) => {
  const conv = await loadConversation(req.user, uuidParam(req.params.id));
  const { instructions } = validate(req.body, { instructions: { type: 'text', max: 500, label: 'Instructions' } });
  if (!planStatus(req.user).ai) throw new HttpError(402, 'AI reply drafts are included in the Growth and Pro plans.', { code: 'PLAN_LIMIT' });
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

// Refuse {{names}} that messaging doesn't know (they would reach the guest as literal braces), and a name another
// active template already uses (case and end spaces ignored, like add-on names; archived templates don't count).
// Both problems are reported in one answer. ponytail: check then write, so two saves at the same instant could both pass.
async function checkTemplate(orgId, body, current = null) {
  const fields = {};
  for (const k of ['subject', 'body']) {
    if (typeof body[k] !== 'string') continue;
    const bad = [...new Set([...body[k].matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]))].filter((n) => !messaging.VARIABLE_NAMES.includes(n));
    if (bad.length) fields[k] = `Unknown ${bad.length === 1 ? 'variable' : 'variables'}: ${bad.map((n) => `{{${n}}}`).join(', ')}. Use only the names listed under the message.`;
  }
  // Saving the same name again (or only changing its case) is not a rename, so an older duplicate can still be edited.
  const renamed = typeof body.name === 'string' && (!current || body.name.toLowerCase() !== current.name.trim().toLowerCase());
  if (renamed) {
    const dup = await one(
      `SELECT btrim(name) AS name FROM message_templates
        WHERE organization_id = $1 AND NOT archived AND lower(btrim(name)) = lower(btrim($2)) AND template_id IS DISTINCT FROM $3 LIMIT 1`,
      [orgId, body.name, current?.template_id ?? null]);
    if (dup) fields.name = `You already have a template called "${dup.name}".`;
  }
  if (Object.keys(fields).length) throw validationError(fields);
}

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

// Switch the built-in guest messages to English or Taglish.
router.post('/message-templates/language', owners, ah(async (req, res) => {
  const { language } = validate(req.body, { language: { type: 'enum', values: ['en', 'tl'], required: true, label: 'Language' } });
  const r = await messaging.setTemplateLanguage(req.user.organization_id, language, req.user.user_id);
  await audit(null, req.user, 'template.language_switched', 'organization', req.user.organization_id, { language, copied: r.copied });
  res.json(r);
}));

router.post('/message-templates', owners, ah(async (req, res) => {
  const body = validate(req.body, templateSpec);
  await checkTemplate(req.user.organization_id, body);
  const t = await one(
    `INSERT INTO message_templates (organization_id, name, subject, body, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.organization_id, body.name, body.subject, body.body, req.user.user_id]);
  await audit(null, req.user, 'template.created', 'message_template', t.template_id);
  res.status(201).json({ template: t });
}));

router.patch('/message-templates/:id', owners, ah(async (req, res) => {
  const t = await loadTemplate(req.user, uuidParam(req.params.id));
  const body = validate(req.body, templateSpec, { partial: true });
  await checkTemplate(req.user.organization_id, body, t);
  // Only the fields whose stored text really changed are written and logged, by name; a save with no change writes nothing.
  const sent = Object.keys(body).filter((k) => body[k] !== null);
  const keys = changedKeys(t, Object.fromEntries(sent.map((k) => [k, body[k]])));
  if (keys.length) {
    await query(`UPDATE message_templates SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE template_id = $1`,
      [t.template_id, ...keys.map((k) => body[k])]);
    await audit(null, req.user, 'template.updated', 'message_template', t.template_id, { fields: keys, name: t.name });
  }
  res.json({ template: await loadTemplate(req.user, t.template_id) });
}));

router.post('/message-templates/:id/archive', owners, ah(async (req, res) => {
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
// These count a number of days, so the box can't be left blank for them.
const DAY_TRIGGERS = ['before_check_in', 'before_check_out', 'after_check_out'];
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
      WHERE a.organization_id = $1 ORDER BY a.created_at, a.automation_id`, [req.user.organization_id]);
  res.json({ automations: rows, can_edit: req.user.role === 'owner', sending: mailEnabled() });
}));

router.post('/automations', owners, ah(async (req, res) => {
  const body = validate(req.body, automationSpec);
  if (DAY_TRIGGERS.includes(body.trigger_event) && body.offset_days === null) throw validationError({ offset_days: 'Enter the number of days.' });
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
  // Checked against the trigger and number of days the automation will have once saved.
  const days = body.offset_days === undefined ? a.offset_days : body.offset_days;
  if (DAY_TRIGGERS.includes(body.trigger_event || a.trigger_event) && days === null) throw validationError({ offset_days: 'Enter the number of days.' });
  const keys = Object.keys(body).filter((k) => body[k] !== null);
  // Only the fields whose stored value really changed are written and logged, by name; a save with no change writes nothing.
  const fields = changedKeys(a, Object.fromEntries(keys.map((k) => [k, body[k]])));
  if (body.template_id) await loadTemplate(req.user, body.template_id);
  if (fields.length) {
    // Turning an automation on (again) starts counting from now, so it never
    // catches up on stays whose send time passed while it was off.
    const restart = body.enabled === true && !a.enabled ? ', created_at = now()' : '';
    await query(`UPDATE automations SET ${fields.map((k, i) => `${k} = $${i + 2}`).join(', ')}${restart} WHERE automation_id = $1`,
      [a.automation_id, ...fields.map((k) => body[k])]);
    await audit(null, req.user, 'automation.updated', 'automation', a.automation_id, { fields, name: a.name });
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
