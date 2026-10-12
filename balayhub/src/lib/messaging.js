'use strict';

// Guest messaging: templates, conversations, sending (now or scheduled).
// Replies come back through a "plus address" (e.g. admin+bh-<token>@domain)
// that the IMAP poller in lib/inbound.js matches to the conversation.

const crypto = require('crypto');
const config = require('../config');
const { pool, one, query } = require('../db');
const { sendMail, mailEnabled } = require('./mailer');

// ---------------------------------------------------------------- default content
const DEFAULT_TEMPLATES = [
  {
    system_key: 'confirmation', name: 'Booking confirmation', subject: 'Your stay at {{listing_name}} is confirmed ({{confirmation_code}})',
    body: `Hi {{guest_first_name}},

Thank you for booking with {{workspace_name}}! Your stay is confirmed.

Listing: {{listing_name}}, {{property_name}}
Check-in: {{check_in}} from {{checkin_time}}
Check-out: {{check_out}} by {{checkout_time}}
Guests: {{num_guests}}
Total: {{total}} · Balance due: {{balance}}
Confirmation code: {{confirmation_code}}

We'll send check-in instructions before you arrive. Just reply to this email if you have any questions.

See you soon!
{{host_name}}`,
  },
  {
    system_key: 'checkin', name: 'Check-in instructions', subject: 'Check-in details for {{check_in}} — {{listing_name}}',
    body: `Hi {{guest_first_name}},

We're excited to welcome you on {{check_in}}! Here's everything you need:

Check-in time: from {{checkin_time}}
Address: {{property_address}}

{{checkin_instructions}}

Wi-Fi: {{wifi_name}} / Password: {{wifi_password}}

House rules:
{{house_rules}}

Balance due: {{balance}}. Reply to this email if you need anything.

{{host_name}}`,
  },
  {
    system_key: 'thanks', name: 'Thank you after check-out', subject: 'Thank you for staying with us, {{guest_first_name}}!',
    body: `Hi {{guest_first_name}},

Thank you for staying at {{listing_name}}! We hope you had a great time.

If you enjoyed your stay, we'd love a review — and we'd be happy to host you again. Book directly with us next time for the best rate.

Salamat po!
{{host_name}}`,
  },
  {
    system_key: 'payment_reminder', name: 'Payment reminder', subject: 'Balance reminder for your stay on {{check_in}}',
    body: `Hi {{guest_first_name}},

A friendly reminder that your remaining balance of {{balance}} for {{listing_name}} ({{check_in}} – {{check_out}}) is due before check-in.

You can pay by GCash, Maya or bank transfer. Please reply with your reference number once paid.

Thank you!
{{host_name}}`,
  },
];

const DEFAULT_AUTOMATIONS = [
  { key: 'confirmation', name: 'Send booking confirmation when a reservation is created', trigger_event: 'booking_created', offset_days: 0 },
  { key: 'checkin', name: 'Send check-in instructions 1 day before arrival', trigger_event: 'before_check_in', offset_days: 1, send_time: '10:00' },
  { key: 'thanks', name: 'Send a thank-you the day after check-out', trigger_event: 'after_check_out', offset_days: 1, send_time: '10:00' },
];

// Create default templates and (disabled) automations the first time a workspace uses the inbox.
async function ensureDefaults(organizationId) {
  for (const t of DEFAULT_TEMPLATES) {
    await query(
      `INSERT INTO message_templates (organization_id, name, subject, body, system_key)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id, system_key) WHERE system_key IS NOT NULL DO NOTHING`,
      [organizationId, t.name, t.subject, t.body, t.system_key]);
  }
  const existing = await one('SELECT COUNT(*) AS n FROM automations WHERE organization_id = $1', [organizationId]);
  if (existing.n === 0) {
    for (const a of DEFAULT_AUTOMATIONS) {
      const tpl = await one('SELECT template_id FROM message_templates WHERE organization_id = $1 AND system_key = $2', [organizationId, a.key]);
      if (tpl) {
        await query(
          `INSERT INTO automations (organization_id, template_id, name, trigger_event, offset_days, send_time, enabled)
           VALUES ($1,$2,$3,$4,$5,$6,false)`,
          [organizationId, tpl.template_id, a.name, a.trigger_event, a.offset_days, a.send_time || '10:00']);
      }
    }
  }
}

// ---------------------------------------------------------------- template rendering
const fmtPeso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const fmtTime = (t) => {
  if (!t) return '';
  const [hh, mm] = String(t).split(':').map(Number);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
};

async function bookingContext(bookingId) {
  return one(
    `SELECT b.*, u.unit_name, u.checkin_time, u.checkout_time, u.wifi_name, u.wifi_password, u.checkin_instructions, u.house_rules,
            p.property_name, p.address, p.city, p.province, p.organization_id AS org_id,
            g.full_name AS guest_name, g.email AS guest_email,
            o.name AS workspace_name,
            (SELECT full_name FROM users WHERE organization_id = b.organization_id AND role = 'owner' ORDER BY created_at LIMIT 1) AS owner_name,
            (b.total_amount - COALESCE((SELECT SUM(amount) FROM booking_payments bp WHERE bp.booking_id = b.booking_id AND bp.voided_at IS NULL), 0))::numeric(12,2) AS balance
       FROM bookings b
       JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id
       LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.booking_id = $1`, [bookingId]);
}

function variables(ctx, sender) {
  const guest = ctx.guest_name || ctx.guest_label || 'Guest';
  return {
    guest_name: guest,
    guest_first_name: guest.split(' ')[0],
    listing_name: ctx.unit_name,
    property_name: ctx.property_name,
    property_address: [ctx.address, ctx.city, ctx.province].filter(Boolean).join(', '),
    check_in: fmtDate(ctx.check_in),
    check_out: fmtDate(ctx.check_out),
    checkin_time: fmtTime(ctx.checkin_time),
    checkout_time: fmtTime(ctx.checkout_time),
    nights: String((Date.parse(ctx.check_out) - Date.parse(ctx.check_in)) / 86400000),
    num_guests: ctx.num_guests ? String(ctx.num_guests) : '',
    total: fmtPeso(ctx.total_amount),
    balance: fmtPeso(Math.max(0, Number(ctx.balance))),
    confirmation_code: ctx.confirmation_code,
    wifi_name: ctx.wifi_name || '(ask your host)',
    wifi_password: ctx.wifi_password || '(ask your host)',
    checkin_instructions: ctx.checkin_instructions || '',
    house_rules: ctx.house_rules || '',
    workspace_name: ctx.workspace_name,
    host_name: sender || ctx.owner_name || ctx.workspace_name,
  };
}

const VARIABLE_NAMES = Object.keys(variables({ check_in: '2026-01-01', check_out: '2026-01-02' }));

function render(text, vars) {
  return String(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------- conversations
const newReplyToken = () => crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').toLowerCase();

async function getOrCreateConversation(bookingId, db = pool) {
  const existing = (await db.query('SELECT * FROM conversations WHERE booking_id = $1', [bookingId])).rows[0];
  if (existing) return existing;
  const ctx = await bookingContext(bookingId);
  const subject = `${ctx.unit_name} · ${fmtDate(ctx.check_in)} – ${fmtDate(ctx.check_out)}`;
  const { rows: [c] } = await db.query(
    `INSERT INTO conversations (organization_id, booking_id, guest_id, subject, reply_token, last_message_at)
     VALUES ($1,$2,$3,$4,$5, now()) ON CONFLICT (booking_id) DO NOTHING RETURNING *`,
    [ctx.organization_id, bookingId, ctx.guest_id, subject, newReplyToken()]);
  return c || (await db.query('SELECT * FROM conversations WHERE booking_id = $1', [bookingId])).rows[0];
}

// The address guests reply to: the sending mailbox plus a "+bh-<token>" tag.
function replyAddress(token) {
  const base = config.inboundAddress;
  if (!base || !base.includes('@')) return null;
  const [local, domain] = base.split('@');
  return `${local}+bh-${token}@${domain}`;
}

function fromAddress() {
  const m = /<([^>]+)>/.exec(config.mailFrom);
  return (m ? m[1] : config.mailFrom).trim();
}

// Send one queued/outgoing message row. Never throws; records the outcome.
async function deliver(messageId) {
  const { rows: [m] } = await pool.query(
    `UPDATE messages SET status = 'sending' WHERE message_id = $1 AND status IN ('scheduled', 'failed') RETURNING *`, [messageId]);
  if (!m) return null;
  const conv = await one('SELECT c.*, o.name AS workspace_name FROM conversations c JOIN organizations o USING (organization_id) WHERE c.conversation_id = $1', [m.conversation_id]);
  if (!m.to_email) {
    await query(`UPDATE messages SET status = 'failed', error = 'The guest has no email address.' WHERE message_id = $1`, [messageId]);
    return { ok: false, error: 'The guest has no email address.' };
  }
  if (!mailEnabled()) {
    await query(`UPDATE messages SET status = 'failed', error = 'Email sending is not set up on the server.' WHERE message_id = $1`, [messageId]);
    return { ok: false, error: 'Email sending is not set up on the server.' };
  }
  const prev = await one(
    `SELECT email_message_id FROM messages WHERE conversation_id = $1 AND email_message_id IS NOT NULL AND message_id <> $2
      ORDER BY created_at DESC LIMIT 1`, [m.conversation_id, messageId]);
  const emailId = `<bh-${messageId}@${fromAddress().split('@')[1] || 'balayhub.local'}>`;
  const result = await sendMail({
    to: m.to_email,
    from: `${conv.workspace_name} <${fromAddress()}>`,
    replyTo: replyAddress(conv.reply_token) || undefined,
    subject: m.subject || conv.subject,
    text: m.body,
    messageId: emailId,
    headers: prev ? { 'In-Reply-To': prev.email_message_id, References: prev.email_message_id } : undefined,
  });
  if (result.delivered) {
    await query(`UPDATE messages SET status = 'sent', sent_at = now(), error = NULL, email_message_id = $2 WHERE message_id = $1`, [messageId, emailId]);
    await query('UPDATE conversations SET last_message_at = now() WHERE conversation_id = $1', [m.conversation_id]);
    return { ok: true };
  }
  const error = result.reason || 'The email could not be sent. Check the email settings on the server.';
  await query(`UPDATE messages SET status = 'failed', error = $2 WHERE message_id = $1`, [messageId, error]);
  return { ok: false, error };
}

/**
 * Add an outgoing message (or internal note) to a reservation's conversation.
 * Sends immediately unless scheduledAt is in the future.
 */
async function queueMessage({ bookingId, subject, body, user, kind = 'message', scheduledAt = null, note = false, automationId = null }) {
  const conv = await getOrCreateConversation(bookingId);
  const ctx = await bookingContext(bookingId);
  const { rows: [m] } = await pool.query(
    `INSERT INTO messages (conversation_id, organization_id, direction, kind, from_name, to_email, subject, body, status, scheduled_at, sent_by, automation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [conv.conversation_id, conv.organization_id, note ? 'note' : 'out', kind, user?.full_name || ctx.workspace_name,
      note ? null : ctx.guest_email, subject || conv.subject, body, note ? 'note' : 'scheduled',
      note ? null : (scheduledAt || new Date()), user?.user_id || null, automationId]);
  await query(`UPDATE conversations SET last_message_at = now(), status = 'open' WHERE conversation_id = $1`, [conv.conversation_id]);
  if (note) return { message: m, conversation: conv };
  if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
    const r = await deliver(m.message_id);
    return { message: await one('SELECT * FROM messages WHERE message_id = $1', [m.message_id]), conversation: conv, delivery: r };
  }
  return { message: m, conversation: conv };
}

async function renderTemplateFor(templateId, bookingId, sender) {
  const t = await one('SELECT * FROM message_templates WHERE template_id = $1', [templateId]);
  const ctx = await bookingContext(bookingId);
  if (!t || !ctx || t.organization_id !== ctx.organization_id) return null;
  const vars = variables(ctx, sender);
  return { subject: render(t.subject, vars), body: render(t.body, vars), template: t };
}

// ---------------------------------------------------------------- scheduler work
async function sendDueMessages() {
  // A send interrupted by a restart is marked failed so the host can retry it.
  await query(`UPDATE messages SET status = 'failed', error = 'Sending was interrupted. Use Retry to send it again.'
                WHERE status = 'sending' AND COALESCE(scheduled_at, created_at) < now() - interval '15 minutes'`);
  const { rows } = await query(`SELECT message_id FROM messages WHERE status = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 50`);
  for (const r of rows) await deliver(r.message_id);
  return rows.length;
}

// When an automation should send for a stay (Asia/Manila local time).
function automationSendAt(a, b) {
  const at = (date, days) => {
    const d = new Date(`${String(date).slice(0, 10)}T${String(a.send_time).slice(0, 5)}:00+08:00`);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  };
  switch (a.trigger_event) {
    case 'booking_created': return new Date(b.created_at);
    case 'before_check_in': return at(b.check_in, -a.offset_days);
    case 'check_in_day': return at(b.check_in, 0);
    case 'before_check_out': return at(b.check_out, -a.offset_days);
    case 'after_check_out': return at(b.check_out, a.offset_days);
    default: return null;
  }
}

// Send automatic messages that are due. Only stays whose send time fell in the
// last 24 hours qualify, so turning an automation on never mass-mails old guests.
async function runAutomations() {
  const { rows: autos } = await query(
    `SELECT a.*, t.subject, t.body FROM automations a JOIN message_templates t USING (template_id)
      WHERE a.enabled AND NOT t.archived`);
  let sent = 0;
  for (const a of autos) {
    const { rows: bookings } = await query(
      `SELECT b.booking_id, b.check_in, b.check_out, b.created_at FROM bookings b
        WHERE b.organization_id = $1 AND b.kind = 'reservation' AND b.status = 'confirmed'
          AND b.check_out >= (now() AT TIME ZONE 'Asia/Manila')::date - 40
          AND NOT EXISTS (SELECT 1 FROM automation_runs r WHERE r.automation_id = $2 AND r.booking_id = b.booking_id)`,
      [a.organization_id, a.automation_id]);
    for (const b of bookings) {
      const when = automationSendAt(a, b);
      if (!when || when > new Date() || when < new Date(Date.now() - 24 * 3600 * 1000) || when < new Date(a.created_at)) continue;
      const claim = await query(
        `INSERT INTO automation_runs (automation_id, booking_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING booking_id`, [a.automation_id, b.booking_id]);
      if (!claim.rowCount) continue;
      const ctx = await bookingContext(b.booking_id);
      if (!ctx.guest_email) {
        await query('UPDATE automation_runs SET skipped = $3 WHERE automation_id = $1 AND booking_id = $2', [a.automation_id, b.booking_id, 'no guest email']);
        continue;
      }
      const vars = variables(ctx);
      const res = await queueMessage({
        bookingId: b.booking_id, subject: render(a.subject, vars), body: render(a.body, vars), kind: 'automated', automationId: a.automation_id,
      });
      await query('UPDATE automation_runs SET message_id = $3 WHERE automation_id = $1 AND booking_id = $2', [a.automation_id, b.booking_id, res.message.message_id]);
      sent += 1;
    }
  }
  return sent;
}

module.exports = {
  DEFAULT_TEMPLATES, VARIABLE_NAMES, ensureDefaults, bookingContext, variables, render, renderTemplateFor,
  getOrCreateConversation, queueMessage, deliver, sendDueMessages, runAutomations, automationSendAt, replyAddress, fmtPeso, fmtDate,
};
