'use strict';

// Guest messaging: templates, conversations, sending (now or scheduled).
// Replies come back through a "plus address" (e.g. admin+bh-<token>@domain)
// that the IMAP poller in lib/inbound.js matches to the conversation.

const crypto = require('crypto');
const config = require('../config');
const { pool, one, query, tx } = require('../db');
const { sendMail, mailEnabled } = require('./mailer');
const { describePolicy } = require('./policies');
const secretbox = require('./secretbox');
const guidebook = require('./guidebook');
const { BALANCE } = require('./balance');

// ---------------------------------------------------------------- default content
// The guidebook line in the check-in templates. New workspaces get it from the seed text;
// existing workspaces keep their own copy.
const GUIDEBOOK_LINE_EN = 'Your digital guidebook (directions, parking and house info): {{guidebook_link}}\n\n';
const GUIDEBOOK_LINE_TL = 'Ang digital guidebook mo (direksyon, parking at iba pang info): {{guidebook_link}}\n\n';

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

Before you arrive, please fill in the guest registration form (names of all guests and a photo of a valid ID; the building requires it):
{{checkin_link}}

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

${GUIDEBOOK_LINE_EN}House rules:
{{house_rules}}

If you haven't yet, please complete the guest registration form: {{checkin_link}}

Balance due: {{balance}}. Reply to this email if you need anything.

{{host_name}}`,
  },
  {
    system_key: 'thanks', name: 'Thank you after check-out', subject: 'Thank you for staying with us, {{guest_first_name}}!',
    body: `Hi {{guest_first_name}},

Thank you for staying at {{listing_name}}! We hope you had a great time.

If you enjoyed your stay, we'd love a review — and we'd be happy to host you again. Book directly with us next time for the best rate.

{{review_link}}

Salamat po!
{{host_name}}`,
  },
  {
    system_key: 'payment_reminder', name: 'Payment reminder', subject: 'Balance reminder for your stay on {{check_in}}',
    body: `Hi {{guest_first_name}},

A friendly reminder that your remaining balance of {{balance}} for {{listing_name}} ({{check_in}} – {{check_out}}) is due before check-in.

{{payment_link}}

You can also pay by GCash, Maya or bank transfer. If you do, please reply with your reference number.

Thank you!
{{host_name}}`,
  },
];

// Taglish versions of the built-in templates (same variables).
const TAGLISH_TEMPLATES = {
  confirmation: {
    name: 'Booking confirmation (Taglish)', subject: 'Confirmed na ang stay mo sa {{listing_name}} ({{confirmation_code}})',
    body: `Hi {{guest_first_name}}!

Salamat sa pag-book sa {{workspace_name}}! Confirmed na ang stay mo.

Listing: {{listing_name}}, {{property_name}}
Check-in: {{check_in}}, mula {{checkin_time}}
Check-out: {{check_out}}, hanggang {{checkout_time}}
Guests: {{num_guests}}
Total: {{total}} · Balanse: {{balance}}
Confirmation code: {{confirmation_code}}

Bago ka dumating, paki-fill up ang guest registration form (pangalan ng lahat ng guests at litrato ng valid ID; requirement ito ng building):
{{checkin_link}}

Magpapadala kami ng check-in instructions bago ang stay mo. Mag-reply lang dito kung may tanong ka.

See you soon!
{{host_name}}`,
  },
  checkin: {
    name: 'Check-in instructions (Taglish)', subject: 'Check-in details para sa {{check_in}} — {{listing_name}}',
    body: `Hi {{guest_first_name}}!

Excited na kaming i-welcome ka sa {{check_in}}! Narito ang kailangan mo:

Check-in: mula {{checkin_time}}
Address: {{property_address}}

{{checkin_instructions}}

Wi-Fi: {{wifi_name}} / Password: {{wifi_password}}

${GUIDEBOOK_LINE_TL}House rules:
{{house_rules}}

Kung hindi mo pa nagagawa, paki-fill up ang guest registration form: {{checkin_link}}

Balanse: {{balance}}. Mag-reply lang dito kung may kailangan ka.

{{host_name}}`,
  },
  thanks: {
    name: 'Thank you after check-out (Taglish)', subject: 'Salamat sa pag-stay, {{guest_first_name}}!',
    body: `Hi {{guest_first_name}}!

Maraming salamat sa pag-stay sa {{listing_name}}! Sana nag-enjoy ka.

Kung nagustuhan mo, malaking tulong sa amin ang review mo — at welcome na welcome ka ulit. Mag-book direkta sa amin next time para sa best rate.

{{review_link}}

Salamat po!
{{host_name}}`,
  },
  payment_reminder: {
    name: 'Payment reminder (Taglish)', subject: 'Paalala sa balanse para sa stay mo sa {{check_in}}',
    body: `Hi {{guest_first_name}}!

Friendly reminder lang po na ang natitirang balanse mo na {{balance}} para sa {{listing_name}} ({{check_in}} – {{check_out}}) ay kailangang bayaran bago mag-check-in.

{{payment_link}}

Puwede ka ring magbayad sa GCash, Maya o bank transfer. Paki-reply lang ng reference number kung ganoon.

Salamat po!
{{host_name}}`,
  },
};

// Switch the built-in templates to English or Taglish, keeping any custom
// wording as a separate copy first. The built-in keys (and so the automations
// and confirmation logic) stay the same.
async function setTemplateLanguage(organizationId, language, userId) {
  await ensureDefaults(organizationId);
  const target = language === 'tl' ? TAGLISH_TEMPLATES : Object.fromEntries(DEFAULT_TEMPLATES.map((t) => [t.system_key, t]));
  const all = [...DEFAULT_TEMPLATES, ...Object.values(TAGLISH_TEMPLATES)];
  // Also the older thank-you text that migration 018 appended {{review_link}} to.
  const oldThanks = DEFAULT_TEMPLATES.find((t) => t.system_key === 'thanks').body.replace('\n\n{{review_link}}', '');
  // The check-in text from before the guidebook line was added. Existing workspaces keep it,
  // so it still counts as built-in and switching language doesn't make a "my version" copy.
  const oldCheckin = [
    DEFAULT_TEMPLATES.find((t) => t.system_key === 'checkin').body.replace(GUIDEBOOK_LINE_EN, ''),
    TAGLISH_TEMPLATES.checkin.body.replace(GUIDEBOOK_LINE_TL, ''),
  ];
  const stockBodies = new Set([...all.map((t) => t.body), `${oldThanks}\n\n{{review_link}}`, ...oldCheckin]);
  const stockSubjects = new Set(all.map((t) => t.subject));
  let copied = 0;
  await tx(async (db) => {
    for (const [key, t] of Object.entries(target)) {
      const { rows: [cur] } = await db.query('SELECT * FROM message_templates WHERE organization_id = $1 AND system_key = $2 FOR UPDATE', [organizationId, key]);
      if (!cur) continue;
      if (!stockBodies.has(cur.body) || !stockSubjects.has(cur.subject)) {
        await db.query(`INSERT INTO message_templates (organization_id, name, subject, body, created_by) VALUES ($1,$2,$3,$4,$5)`,
          [organizationId, `${cur.name} (my version)`.slice(0, 120), cur.subject, cur.body, userId]);
        copied += 1;
      }
      await db.query('UPDATE message_templates SET name = $2, subject = $3, body = $4, updated_at = now() WHERE template_id = $1',
        [cur.template_id, t.name, t.subject, t.body]);
    }
  });
  return { copied };
}

const DEFAULT_AUTOMATIONS = [
  { key: 'confirmation', name: 'Send booking confirmation when a reservation is created', trigger_event: 'booking_created', offset_days: 0 },
  { key: 'checkin', name: 'Send check-in instructions 1 day before arrival', trigger_event: 'before_check_in', offset_days: 1, send_time: '10:00' },
  { key: 'thanks', name: 'Send a thank-you the day after check-out', trigger_event: 'after_check_out', offset_days: 1, send_time: '10:00' },
  { key: 'payment_reminder', name: 'Remind guests with a balance 3 days before check-in', trigger_event: 'before_check_in', offset_days: 3, send_time: '10:00' },
];

// Create default templates and (disabled) automations the first time a workspace uses the inbox.
async function ensureDefaults(organizationId) {
  // One workspace at a time, so two pages loading at once can't create the defaults twice.
  await tx(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`defaults:${organizationId}`]);
    for (const t of DEFAULT_TEMPLATES) {
      await db.query(
        `INSERT INTO message_templates (organization_id, name, subject, body, system_key)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id, system_key) WHERE system_key IS NOT NULL DO NOTHING`,
        [organizationId, t.name, t.subject, t.body, t.system_key]);
    }
    const { rows: [existing] } = await db.query('SELECT COUNT(*)::int AS n FROM automations WHERE organization_id = $1', [organizationId]);
    if (existing.n === 0) {
      for (const a of DEFAULT_AUTOMATIONS) {
        const { rows: [tpl] } = await db.query('SELECT template_id FROM message_templates WHERE organization_id = $1 AND system_key = $2', [organizationId, a.key]);
        if (tpl) {
          await db.query(
            `INSERT INTO automations (organization_id, template_id, name, trigger_event, offset_days, send_time, enabled)
             VALUES ($1,$2,$3,$4,$5,$6,false)`,
            [organizationId, tpl.template_id, a.name, a.trigger_event, a.offset_days, a.send_time || '10:00']);
        }
      }
    }
  });
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
  // The guidebook link, for confirmed stays only, created on first use.
  await guidebook.ensureGuideToken(bookingId);
  // Every reservation gets a private check-in form link the first time it's needed.
  await query(`UPDATE bookings SET checkin_token = $2 WHERE booking_id = $1 AND checkin_token IS NULL AND kind = 'reservation'`,
    [bookingId, crypto.randomBytes(18).toString('base64url')]);
  // A private review link (the guest rates their stay; only the host sees it).
  await query(`UPDATE bookings SET review_token = $2 WHERE booking_id = $1 AND review_token IS NULL AND kind = 'reservation'`,
    [bookingId, crypto.randomBytes(18).toString('base64url')]);
  // A balance payment link, when the host takes payments online (PayMongo) or accepts manual payments.
  await query(`UPDATE bookings b SET pay_token = $2 FROM organizations o
                WHERE b.booking_id = $1 AND b.pay_token IS NULL AND b.kind = 'reservation'
                  AND o.organization_id = b.organization_id AND (o.paymongo_key_hint IS NOT NULL OR o.manual_payments_enabled)`,
    [bookingId, crypto.randomBytes(18).toString('base64url')]);
  return one(
    `SELECT b.*, u.unit_name, u.checkin_time, u.checkout_time, u.wifi_name, u.wifi_password, u.checkin_instructions, u.house_rules,
            u.cancellation_policy, u.cancellation_policy_text, ug.door_code_enc,
            p.property_name, p.address, p.city, p.province, p.organization_id AS org_id,
            g.full_name AS guest_name, g.email AS guest_email,
            o.name AS workspace_name, o.paymongo_key_hint, o.manual_payments_enabled, o.guest_language, o.plan, o.trial_ends_at, o.paid_until, o.is_demo, o.deletion_scheduled_at,
            (SELECT full_name FROM users WHERE organization_id = b.organization_id AND role = 'owner' ORDER BY created_at LIMIT 1) AS owner_name,
            EXISTS (SELECT 1 FROM guest_reviews r WHERE r.booking_id = b.booking_id) AS reviewed,
            ${BALANCE} AS balance
       FROM bookings b
       JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id
       LEFT JOIN guests g ON g.guest_id = b.guest_id
       LEFT JOIN unit_guides ug ON ug.unit_id = u.unit_id
      WHERE b.booking_id = $1`, [bookingId]);
}

// A full sentence (or nothing). Online checkout wins; otherwise the manual GCash/Maya/bank page.
function paymentLink(ctx) {
  if (!ctx.pay_token || !(Number(ctx.balance) > 0)) return '';
  const pay = require('../routes/balancepay');
  const url = `${config.appUrl}/#/pay/${ctx.pay_token}`;
  if (pay.acceptsOnline(ctx)) return `Pay securely online (GCash, Maya or card): ${url}`;
  if (ctx.manual_payments_enabled && !pay.manualRefusal(ctx)) return `Pay by GCash, Maya or bank transfer, then send your proof of payment: ${url}`;
  return '';
}

// The listing's cancellation policy in the guest's language (empty when none is set).
function cancellationPolicy(ctx) {
  const p = describePolicy(ctx.cancellation_policy, ctx.cancellation_policy_text);
  return p ? ((ctx.guest_language === 'tl' && p.tl) || p.en) : '';
}

// {{returning_guest_code}} is created on first use, so it is looked up only when a template uses it.
// lib/returning may not exist yet; then the variable is empty.
async function returningGuestCode(bookingId, ...texts) {
  if (!texts.some((t) => /\{\{\s*returning_guest_code\s*\}\}/.test(String(t || '')))) return '';
  let returning;
  try { returning = require('./returning'); } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return '';
    throw err;
  }
  return (await returning.codeFor(bookingId)) || '';
}

// Address, city, province; the city or province is left out when the address already names it as a whole word.
function addressLine(ctx) {
  const [address, ...rest] = [ctx.address, ctx.city, ctx.province];
  const has = (part) => new RegExp(`(^|[^\\p{L}])${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(address || '');
  return [address, ...rest.filter((p) => p && !has(p))].filter(Boolean).join(', ');
}

function variables(ctx, sender) {
  const guest = ctx.guest_name || ctx.guest_label || 'Guest';
  // The Wi-Fi password and door code show only from the day before check-in through check-out day.
  const secretsShown = guidebook.secretsOpen(ctx);
  const sharedLater = ctx.guest_language === 'tl' ? '(ibabahagi isang araw bago ang check-in)' : '(shared the day before check-in)';
  return {
    guest_name: guest,
    guest_first_name: guest.split(' ')[0],
    listing_name: ctx.unit_name,
    property_name: ctx.property_name,
    property_address: addressLine(ctx),
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
    wifi_password: !ctx.wifi_password ? '(ask your host)' : (secretsShown ? ctx.wifi_password : sharedLater),
    door_code: !ctx.door_code_enc ? '(ask your host)' : (secretsShown ? (guidebook.doorCodeOf(ctx.door_code_enc) || '(ask your host)') : sharedLater),
    guidebook_link: ctx.guide_token && ctx.status === 'confirmed' ? guidebook.guideLink(ctx.guide_token) : '',
    returning_guest_code: ctx.returning_guest_code || '',
    checkin_instructions: ctx.checkin_instructions || '',
    house_rules: ctx.house_rules || '',
    checkin_link: ctx.checkin_token ? `${config.appUrl}/#/checkin/${ctx.checkin_token}` : '',
    // A full sentence (or nothing) so templates read well either way.
    payment_link: paymentLink(ctx),
    cancellation_policy: cancellationPolicy(ctx),
    review_link: ctx.review_token && !ctx.reviewed && ctx.status === 'confirmed'
      ? `How was your stay? Tell us privately (1 minute): ${config.appUrl}/#/review/${ctx.review_token}` : '',
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
    `UPDATE messages SET status = 'sending', sending_started_at = now() WHERE message_id = $1 AND status IN ('scheduled', 'failed') RETURNING *`, [messageId]);
  if (!m) return null;
  const conv = await one('SELECT c.*, o.name AS workspace_name, o.is_demo FROM conversations c JOIN organizations o USING (organization_id) WHERE c.conversation_id = $1', [m.conversation_id]);
  if (conv.is_demo) {
    await query(`UPDATE messages SET status = 'failed', error = 'The demo workspace never sends email.' WHERE message_id = $1`, [messageId]);
    return { ok: false, error: 'The demo workspace never sends email.' };
  }
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
  ctx.returning_guest_code = await returningGuestCode(bookingId, t.subject, t.body);
  const vars = variables(ctx, sender);
  return { subject: render(t.subject, vars), body: render(t.body, vars), template: t };
}

// ---------------------------------------------------------------- scheduler work
// Workspaces whose plan is inactive (demo, ended trial, overdue) send nothing.
async function inactiveOrgIds() {
  const { planStatus } = require('./plans');
  const { rows } = await query('SELECT organization_id, plan, trial_ends_at, paid_until, is_demo FROM organizations');
  return new Set(rows.filter((o) => planStatus(o).read_only).map((o) => o.organization_id));
}

async function sendDueMessages() {
  // A send interrupted by a restart is marked failed so the host can retry it.
  await query(`UPDATE messages SET status = 'failed', error = 'Sending was interrupted. Use Retry to send it again.'
                WHERE status = 'sending' AND sending_started_at < now() - interval '15 minutes'`);
  const { rows } = await query(`SELECT message_id, organization_id FROM messages WHERE status = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at LIMIT 50`);
  const inactive = rows.length ? await inactiveOrgIds() : new Set();
  for (const r of rows) {
    if (inactive.has(r.organization_id)) {
      await query(`UPDATE messages SET status = 'failed', error = 'Not sent: this workspace''s plan is inactive.' WHERE message_id = $1 AND status = 'scheduled'`, [r.message_id]);
    } else await deliver(r.message_id);
  }
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
    `SELECT a.*, t.subject, t.body, t.system_key FROM automations a JOIN message_templates t USING (template_id)
      WHERE a.enabled AND NOT t.archived`);
  const inactive = autos.length ? await inactiveOrgIds() : new Set();
  let sent = 0;
  for (const a of autos) {
    if (inactive.has(a.organization_id)) continue;
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
      // Payment reminders only go to guests who still owe something.
      if (a.system_key === 'payment_reminder' && Number(ctx.balance) <= 0) {
        await query('UPDATE automation_runs SET skipped = $3 WHERE automation_id = $1 AND booking_id = $2', [a.automation_id, b.booking_id, 'fully paid']);
        continue;
      }
      ctx.returning_guest_code = await returningGuestCode(b.booking_id, a.subject, a.body);
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
  DEFAULT_TEMPLATES, TAGLISH_TEMPLATES, setTemplateLanguage, VARIABLE_NAMES, ensureDefaults, bookingContext, variables, render, renderTemplateFor,
  getOrCreateConversation, queueMessage, deliver, sendDueMessages, runAutomations, automationSendAt, replyAddress, fmtPeso, fmtDate,
};
