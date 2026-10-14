'use strict';

// Help & support. Hosts and their team search the help center and open tickets;
// BalayHub's platform admins answer them. Every ticket keeps a timeline of each
// step (created, replies, status changes, assignment, rating) so both sides can
// see exactly where it stands.

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { query, one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { requireAuth } = require('../lib/auth');
const { own } = require('../lib/pick');
const { CATEGORIES, articlesFor, searchArticles } = require('../lib/helpcenter');

const router = express.Router();
const adminRouter = express.Router();

const STATUS_LABEL = { new: 'Received', in_progress: 'In progress', waiting_on_customer: 'Waiting for you', resolved: 'Resolved', closed: 'Closed' };
const CATEGORY_LABEL = { question: 'Question', problem: 'Something isn\'t working', payments: 'Payments & billing', account: 'Account & access', feature: 'Suggestion', other: 'Other' };
const REOPEN_DAYS = 14;
const ticketNo = (n) => `T-${n}`;
const ticketLink = (id) => `${config.appUrl}/#/help/tickets/${id}`;

// ---------------------------------------------------------------- help center
router.get('/help/articles', ah(async (req, res) => {
  const role = req.user.role;
  const q = String(req.query.q || '').slice(0, 200);
  const visible = articlesFor(role, req.user.business_type);
  res.json({
    categories: CATEGORIES.map(([key, name]) => ({ key, name })),
    articles: (q ? searchArticles(q, role, 8, req.user.business_type) : visible).map(({ slug, title, category, body }) => ({ slug, title, category, body })),
  });
}));

// ---------------------------------------------------------------- helpers
async function addEvent(db, ticketId, ev) {
  await (db || { query }).query(
    `INSERT INTO support_events (ticket_id, kind, from_status, to_status, actor_id, actor_kind, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ticketId, ev.kind, ev.from || null, ev.to || null, ev.actorId || null, ev.actorKind, ev.note || null]);
}

async function setStatus(db, t, to, actor, note) {
  if (t.status === to) return;
  await db.query(
    `UPDATE support_tickets SET status = $2, updated_at = now(),
            resolved_at = CASE WHEN $2 = 'resolved' THEN now() WHEN $2 IN ('new', 'in_progress', 'waiting_on_customer') THEN NULL ELSE resolved_at END,
            closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END
      WHERE ticket_id = $1`, [t.ticket_id, to]);
  await addEvent(db, t.ticket_id, { kind: 'status', from: t.status, to, actorId: actor.id, actorKind: actor.kind, note });
}

async function notifyAdmins(t, subject, text) {
  const { sendMail } = require('../lib/mailer');
  for (const to of config.platformAdmins) {
    await sendMail({ to, subject: `[${ticketNo(t.ticket_no)}] ${subject}`, text: `${text}\n\nOpen in BalayHub: ${config.appUrl}/#/admin/support/${t.ticket_id}` }).catch(() => {});
  }
}

async function notifyCustomer(t, subject, text) {
  const u = t.created_by ? await one('SELECT email, full_name FROM users WHERE user_id = $1', [t.created_by]) : null;
  if (!u) return;
  const { sendMail } = require('../lib/mailer');
  await sendMail({
    to: u.email, subject: `[${ticketNo(t.ticket_no)}] ${subject}`,
    text: `Hi ${u.full_name.split(' ')[0]},\n\n${text}\n\nSee the full ticket and reply here: ${ticketLink(t.ticket_id)}\n\n— BalayHub Support`,
  }).catch(() => {});
}

// Owners see all of their workspace's tickets; managers and staff see their own.
function ticketScope(user, params) {
  params.push(user.organization_id);
  let sql = `t.organization_id = $${params.length}`;
  if (user.role !== 'owner') { params.push(user.user_id); sql += ` AND t.created_by = $${params.length}`; }
  return sql;
}

async function loadTicket(user, id) {
  const params = [id];
  const t = await one(`SELECT t.* FROM support_tickets t WHERE t.ticket_id = $1 AND ${ticketScope(user, params)}`, params);
  if (!t) throw notFound();
  return t;
}

async function ticketDetail(t, { internal }) {
  const { rows: messages } = await query(
    `SELECT m.message_id, m.author_kind, m.internal, m.body, m.created_at, u.full_name AS author_name
       FROM support_messages m LEFT JOIN users u ON u.user_id = m.author_id
      WHERE m.ticket_id = $1 ${internal ? '' : 'AND NOT m.internal'} ORDER BY m.created_at`, [t.ticket_id]);
  const { rows: events } = await query(
    `SELECT e.kind, e.from_status, e.to_status, e.actor_kind, e.note, e.created_at, u.full_name AS actor_name
       FROM support_events e LEFT JOIN users u ON u.user_id = e.actor_id WHERE e.ticket_id = $1 ORDER BY e.created_at`, [t.ticket_id]);
  const { rows: files } = await query(
    `SELECT file_id, file_name, mime_type, uploaded_at FROM files WHERE related_record_type = 'support' AND related_record_id = $1 ORDER BY uploaded_at`, [t.ticket_id]);
  const creator = t.created_by ? await one('SELECT full_name, email, role FROM users WHERE user_id = $1', [t.created_by]) : null;
  // Support staff are shown as "BalayHub Support" to customers.
  const shown = (name, kind) => (kind === 'support' && !internal ? 'BalayHub Support' : name);
  return {
    ticket: { ...t, number: ticketNo(t.ticket_no), status_label: STATUS_LABEL[t.status], category_label: CATEGORY_LABEL[t.category], created_by_name: creator?.full_name || null,
      ...(internal ? { created_by_email: creator?.email, created_by_role: creator?.role } : {}),
      can_reopen: t.status === 'resolved' && Date.now() - new Date(t.resolved_at) < REOPEN_DAYS * 86400000 },
    messages: messages.map((m) => ({ ...m, author_name: shown(m.author_name, m.author_kind) })),
    events: events.map((e) => ({ ...e, actor_name: shown(e.actor_name, e.actor_kind), from_label: STATUS_LABEL[e.from_status], to_label: STATUS_LABEL[e.to_status] })),
    files,
  };
}

// ---------------------------------------------------------------- customer side
router.get('/support/tickets', ah(async (req, res) => {
  const params = [];
  const where = [ticketScope(req.user, params)];
  if (['open', 'resolved', 'all'].includes(req.query.view) && req.query.view !== 'all') {
    where.push(req.query.view === 'open' ? `t.status IN ('new', 'in_progress', 'waiting_on_customer')` : `t.status IN ('resolved', 'closed')`);
  }
  if (req.query.q) { params.push(`%${String(req.query.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`); where.push(`(t.subject ILIKE $${params.length} OR ('T-' || t.ticket_no) ILIKE $${params.length})`); }
  const { rows } = await query(
    `SELECT t.ticket_id, t.ticket_no, t.subject, t.category, t.priority, t.status, t.created_at, t.updated_at, u.full_name AS created_by_name,
            (SELECT COUNT(*)::int FROM support_messages m WHERE m.ticket_id = t.ticket_id AND NOT m.internal) AS messages
       FROM support_tickets t LEFT JOIN users u ON u.user_id = t.created_by
      WHERE ${where.join(' AND ')} ORDER BY (t.status = 'waiting_on_customer') DESC, t.updated_at DESC LIMIT 200`, params);
  res.json({ tickets: rows.map((t) => ({ ...t, number: ticketNo(t.ticket_no), status_label: STATUS_LABEL[t.status], category_label: CATEGORY_LABEL[t.category] })) });
}));

const ticketLimiter = new Map();
router.post('/support/tickets', ah(async (req, res) => {
  const body = validate(req.body, {
    subject: { type: 'string', required: true, max: 150, label: 'Subject' },
    category: { type: 'enum', values: Object.keys(CATEGORY_LABEL), required: true, label: 'Topic' },
    priority: { type: 'enum', values: ['normal', 'urgent'], label: 'Priority' },
    body: { type: 'text', required: true, max: 8000, label: 'Description' },
  });
  if (body.subject.length < 3) throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { subject: 'Add a short subject.' } });
  // A few tickets an hour per person is plenty; protects the support inbox.
  const k = req.user.user_id; const now = Date.now();
  const hits = (ticketLimiter.get(k) || []).filter((x) => now - x < 3600 * 1000);
  if (hits.length >= 10) throw new HttpError(429, 'You have opened many tickets in the last hour. Please add details to an existing ticket instead.', { code: 'RATE_LIMITED' });
  ticketLimiter.set(k, [...hits, now]);
  // What the app knows about where they were (helps support reproduce the problem).
  const c = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
  const context = {
    page: String(c.page || '').slice(0, 200), browser: String(c.browser || req.get('user-agent') || '').slice(0, 300),
    screen: String(c.screen || '').slice(0, 40), theme: String(c.theme || '').slice(0, 20), language: String(c.language || '').slice(0, 10),
    role: req.user.role, plan: req.user.plan, workspace: req.user.organization_name, app_version: config.termsVersion,
  };
  const t = await tx(async (db) => {
    const { rows: [tk] } = await db.query(
      `INSERT INTO support_tickets (organization_id, created_by, subject, category, priority, context) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.organization_id, req.user.user_id, body.subject, body.category, body.priority || 'normal', JSON.stringify(context)]);
    await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, body) VALUES ($1,$2,'customer',$3)`, [tk.ticket_id, req.user.user_id, body.body]);
    await addEvent(db, tk.ticket_id, { kind: 'created', to: 'new', actorId: req.user.user_id, actorKind: 'customer' });
    return tk;
  });
  await notifyAdmins(t, `New ${t.priority === 'urgent' ? 'URGENT ' : ''}ticket: ${t.subject}`,
    `From ${req.user.full_name} (${req.user.email}), ${req.user.organization_name}, role ${req.user.role}.\nTopic: ${CATEGORY_LABEL[t.category]}\nPage: ${context.page || '-'}\n\n${body.body}`);
  await notifyCustomer(t, `We received your request: ${t.subject}`,
    `Thanks for contacting BalayHub Support. Your ticket number is ${ticketNo(t.ticket_no)}. We usually reply within 1 business day${t.priority === 'urgent' ? ' (urgent tickets sooner)' : ''}.`);
  res.status(201).json({ ticket_id: t.ticket_id, number: ticketNo(t.ticket_no) });
}));

router.get('/support/tickets/:id', ah(async (req, res) => {
  const t = await loadTicket(req.user, uuidParam(req.params.id));
  res.json(await ticketDetail(t, { internal: false }));
}));

router.post('/support/tickets/:id/reply', ah(async (req, res) => {
  const t = await loadTicket(req.user, uuidParam(req.params.id));
  const { body } = validate(req.body, { body: { type: 'text', required: true, max: 8000, label: 'Message' } });
  if (t.status === 'closed') throw new HttpError(409, 'This ticket is closed. Please open a new one and mention ticket ' + ticketNo(t.ticket_no) + '.', { code: 'CLOSED' });
  const reopening = t.status === 'resolved';
  if (reopening && Date.now() - new Date(t.resolved_at) > REOPEN_DAYS * 86400000) {
    throw new HttpError(409, `This ticket was resolved more than ${REOPEN_DAYS} days ago. Please open a new one.`, { code: 'CLOSED' });
  }
  await tx(async (db) => {
    await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, body) VALUES ($1,$2,'customer',$3)`, [t.ticket_id, req.user.user_id, body]);
    await db.query('UPDATE support_tickets SET updated_at = now() WHERE ticket_id = $1', [t.ticket_id]);
    if (reopening) await setStatus(db, t, 'in_progress', { id: req.user.user_id, kind: 'customer' }, 'Reopened by a reply');
    else if (t.status === 'waiting_on_customer') await setStatus(db, t, 'in_progress', { id: req.user.user_id, kind: 'customer' }, 'Customer replied');
  });
  await notifyAdmins(t, `${reopening ? 'Reopened' : 'Reply'}: ${t.subject}`, `${req.user.full_name} wrote:\n\n${body}`);
  res.status(201).json({ ok: true });
}));

router.post('/support/tickets/:id/resolve', ah(async (req, res) => {
  const t = await loadTicket(req.user, uuidParam(req.params.id));
  if (['resolved', 'closed'].includes(t.status)) return res.json({ ok: true });
  await tx((db) => setStatus(db, t, 'resolved', { id: req.user.user_id, kind: 'customer' }, 'Marked as solved by the customer'));
  await notifyAdmins(t, `Marked solved by the customer: ${t.subject}`, `${req.user.full_name} marked the ticket as solved.`);
  res.json({ ok: true });
}));

router.post('/support/tickets/:id/rate', ah(async (req, res) => {
  const t = await loadTicket(req.user, uuidParam(req.params.id));
  if (!['resolved', 'closed'].includes(t.status)) throw new HttpError(409, 'You can rate the help once the ticket is resolved.', { code: 'NOT_RESOLVED' });
  const body = validate(req.body, { rating: { type: 'int', required: true, min: 1, max: 5, label: 'Rating' }, comment: { type: 'text', max: 1000, label: 'Comment' } });
  // The first rating stands. The update only lands on a ticket with no rating yet, so two sends at once can't both save.
  const saved = await one('UPDATE support_tickets SET rating = $2, rating_comment = $3 WHERE ticket_id = $1 AND rating IS NULL RETURNING ticket_id', [t.ticket_id, body.rating, body.comment]);
  if (!saved) throw new HttpError(409, 'This ticket is already rated.', { code: 'ALREADY_RATED' });
  await addEvent(null, t.ticket_id, { kind: 'rated', actorId: req.user.user_id, actorKind: 'customer', note: `${body.rating}/5${body.comment ? ` · ${body.comment}` : ''}` });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- BalayHub support (platform admins)
function platformAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    const ok = req.user.email_verified_at && config.platformAdmins.includes(String(req.user.email).toLowerCase());
    return ok ? next() : next(notFound());
  });
}
adminRouter.use('/admin/support', platformAdmin);

adminRouter.get('/admin/support/tickets', ah(async (req, res) => {
  const params = []; const where = ['true'];
  if (req.query.status && own(STATUS_LABEL, req.query.status)) { params.push(req.query.status); where.push(`t.status = $${params.length}`); }
  else if (req.query.status === 'open') where.push(`t.status IN ('new', 'in_progress', 'waiting_on_customer')`);
  if (req.query.category && own(CATEGORY_LABEL, req.query.category)) { params.push(req.query.category); where.push(`t.category = $${params.length}`); }
  if (req.query.priority === 'urgent') where.push(`t.priority = 'urgent'`);
  if (req.query.mine === '1') { params.push(req.user.user_id); where.push(`t.assigned_to = $${params.length}`); }
  if (req.query.q) { params.push(`%${String(req.query.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`); const n = params.length; where.push(`(t.subject ILIKE $${n} OR ('T-' || t.ticket_no) ILIKE $${n} OR o.name ILIKE $${n} OR u.email ILIKE $${n})`); }
  const { rows } = await query(
    `SELECT t.ticket_id, t.ticket_no, t.subject, t.category, t.priority, t.status, t.created_at, t.updated_at, t.first_response_at,
            o.name AS workspace, u.full_name AS created_by_name, u.email AS created_by_email, a.full_name AS assigned_name
       FROM support_tickets t JOIN organizations o ON o.organization_id = t.organization_id
       LEFT JOIN users u ON u.user_id = t.created_by LEFT JOIN users a ON a.user_id = t.assigned_to
      WHERE ${where.join(' AND ')} ORDER BY (t.priority = 'urgent' AND t.status IN ('new', 'in_progress')) DESC, (t.status = 'new') DESC, t.updated_at DESC LIMIT 300`, params);
  const { rows: counts } = await query(`SELECT status, COUNT(*)::int AS n FROM support_tickets GROUP BY status`);
  res.json({
    tickets: rows.map((t) => ({ ...t, number: ticketNo(t.ticket_no), status_label: STATUS_LABEL[t.status], category_label: CATEGORY_LABEL[t.category] })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  });
}));

async function loadAny(id) {
  const t = await one('SELECT * FROM support_tickets WHERE ticket_id = $1', [id]);
  if (!t) throw notFound();
  return t;
}

adminRouter.get('/admin/support/tickets/:id', ah(async (req, res) => {
  const t = await loadAny(uuidParam(req.params.id));
  const org = await one('SELECT name, plan, business_type, trial_ends_at, paid_until FROM organizations WHERE organization_id = $1', [t.organization_id]);
  res.json({ ...(await ticketDetail(t, { internal: true })), workspace: org });
}));

adminRouter.post('/admin/support/tickets/:id/reply', ah(async (req, res) => {
  const t = await loadAny(uuidParam(req.params.id));
  const body = validate(req.body, {
    body: { type: 'text', required: true, max: 8000, label: 'Message' },
    internal: { type: 'bool', label: 'Internal note' },
    status: { type: 'enum', values: Object.keys(STATUS_LABEL), label: 'Status' },
  });
  const actor = { id: req.user.user_id, kind: 'support' };
  // A public reply usually means "your turn" unless support picks another status.
  const next = body.status || (body.internal ? null : (t.status === 'new' || t.status === 'in_progress' ? 'waiting_on_customer' : null));
  await tx(async (db) => {
    await db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, internal, body) VALUES ($1,$2,'support',$3,$4)`,
      [t.ticket_id, req.user.user_id, Boolean(body.internal), body.body]);
    await db.query(`UPDATE support_tickets SET updated_at = now(), assigned_to = COALESCE(assigned_to, $2),
                     first_response_at = CASE WHEN $3 THEN first_response_at ELSE COALESCE(first_response_at, now()) END WHERE ticket_id = $1`,
    [t.ticket_id, req.user.user_id, Boolean(body.internal)]);
    if (next) await setStatus(db, t, next, actor);
  });
  if (!body.internal) {
    await notifyCustomer(t, `Reply from BalayHub Support: ${t.subject}`,
      `BalayHub Support replied to your ticket:\n\n${body.body}\n\nStatus: ${STATUS_LABEL[next || t.status]}.`);
  }
  res.status(201).json({ ok: true });
}));

adminRouter.post('/admin/support/tickets/:id/status', ah(async (req, res) => {
  const t = await loadAny(uuidParam(req.params.id));
  const body = validate(req.body, {
    status: { type: 'enum', values: Object.keys(STATUS_LABEL), required: true, label: 'Status' },
    note: { type: 'string', max: 300, label: 'Note' },
  });
  await tx((db) => setStatus(db, t, body.status, { id: req.user.user_id, kind: 'support' }, body.note));
  if (body.status !== t.status) {
    await notifyCustomer(t, `Your ticket is now ${STATUS_LABEL[body.status].toLowerCase()}: ${t.subject}`,
      `Your ticket moved from "${STATUS_LABEL[t.status]}" to "${STATUS_LABEL[body.status]}".${body.note ? `\n\n${body.note}` : ''}${body.status === 'resolved' ? `\n\nIf it isn't fixed, just reply within ${REOPEN_DAYS} days and we'll reopen it. You can also rate the help on the ticket page.` : ''}`);
  }
  res.json({ ok: true });
}));

adminRouter.post('/admin/support/tickets/:id/assign', ah(async (req, res) => {
  const t = await loadAny(uuidParam(req.params.id));
  await query('UPDATE support_tickets SET assigned_to = $2, updated_at = now() WHERE ticket_id = $1', [t.ticket_id, req.user.user_id]);
  await addEvent(null, t.ticket_id, { kind: 'assigned', actorId: req.user.user_id, actorKind: 'support' });
  if (t.status === 'new') await tx((db) => setStatus(db, t, 'in_progress', { id: req.user.user_id, kind: 'support' }, 'Picked up'));
  res.json({ ok: true });
}));

// Attachments on any ticket (support staff are outside the customer's workspace).
adminRouter.get('/admin/support/files/:id', ah(async (req, res) => {
  const f = await one(`SELECT * FROM files WHERE file_id = $1 AND related_record_type = 'support'`, [uuidParam(req.params.id)]);
  if (!f) throw notFound();
  const full = path.resolve(config.storageDir, f.storage_key);
  if (!full.startsWith(path.resolve(config.storageDir) + path.sep)) throw notFound();
  res.set('Content-Type', f.mime_type);
  res.set('Cache-Control', 'private, no-store');
  res.set('Content-Disposition', `inline; filename="${f.file_name.replace(/"/g, '')}"`);
  fs.createReadStream(full).on('error', () => res.status(404).end()).pipe(res);
}));

// ---------------------------------------------------------------- scheduler
// Resolved tickets close themselves after a week without activity.
async function autoClose() {
  const { rows } = await query(
    `SELECT * FROM support_tickets WHERE status = 'resolved' AND resolved_at < now() - interval '7 days' AND updated_at < now() - interval '7 days' LIMIT 100`);
  for (const t of rows) await tx((db) => setStatus(db, t, 'closed', { kind: 'system' }, 'Closed automatically 7 days after it was resolved'));
  return rows.length;
}

module.exports = { router, adminRouter, autoClose, STATUS_LABEL, CATEGORY_LABEL, loadTicket };
