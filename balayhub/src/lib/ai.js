'use strict';

// AI reply drafts for the guest inbox (Claude, via the Anthropic Messages API).
// Only used when ANTHROPIC_API_KEY is set. Drafts are never sent automatically:
// the host reads and edits them first.

const config = require('../config');
const { one, query } = require('../db');
const { fmtDate, fmtPeso } = require('./messaging');
const { BALANCE } = require('./balance');

const API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM = `You write email replies to guests on behalf of a short-term rental host in the Philippines (Airbnb-style condo and staycation units).

Rules:
- Reply to the guest's latest message. Be warm, polite and brief (usually 2-6 sentences), like a helpful Filipino host.
- Reply in the same language the guest used (English, Tagalog, or Taglish).
- Only state facts found in the listing and reservation details provided. Never invent prices, policies, addresses, codes or availability. If something is unknown, say you will check and get back to them.
- Do not promise refunds, discounts or changes to the booking unless the host's instructions say so.
- Do not include a subject line, placeholders or notes to the host. Output only the message body, ending with the host's name.`;

function contextText(ctx, messages, hostName) {
  const lines = [
    `Host / sender name: ${hostName}`,
    `Business name: ${ctx.workspace_name}`,
    '',
    'Reservation:',
    `- Guest: ${ctx.guest_name || ctx.guest_label || 'Guest'}`,
    `- Listing: ${ctx.unit_name}, ${ctx.property_name} (${[ctx.address, ctx.city, ctx.province].filter(Boolean).join(', ')})`,
    `- Check-in: ${fmtDate(ctx.check_in)}, from ${String(ctx.checkin_time || '').slice(0, 5)}`,
    `- Check-out: ${fmtDate(ctx.check_out)}, by ${String(ctx.checkout_time || '').slice(0, 5)}`,
    `- Number of guests: ${ctx.num_guests || 'not recorded'}`,
    `- Status: ${ctx.status}${ctx.checked_in_at ? ', checked in' : ''}${ctx.checked_out_at ? ', checked out' : ''}`,
    `- Total: ${fmtPeso(ctx.total_amount)}; balance due: ${fmtPeso(Math.max(0, Number(ctx.balance)))}`,
    `- Booked through: ${ctx.channel}`,
    '',
    'Listing details:',
    `- Wi-Fi: ${ctx.wifi_name ? `${ctx.wifi_name} / password ${ctx.wifi_password || '(not set)'}` : 'not provided'}`,
    `- Check-in instructions: ${ctx.checkin_instructions || 'not provided'}`,
    `- House rules: ${ctx.house_rules || 'not provided'}`,
    '',
    'Conversation so far (oldest first):',
  ];
  for (const m of messages) {
    const who = m.direction === 'in' ? 'GUEST' : (m.direction === 'note' ? 'HOST INTERNAL NOTE (not seen by guest)' : 'HOST');
    lines.push(`--- ${who}, ${new Date(m.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    lines.push(String(m.body).slice(0, 3000));
  }
  return lines.join('\n');
}

// Per-workspace limit so a stuck button can't run up the API bill.
const usage = new Map();
const LIMIT_PER_HOUR = 60;
function allow(orgId) {
  const now = Date.now();
  const u = usage.get(orgId);
  if (!u || u.reset < now) { usage.set(orgId, { n: 1, reset: now + 3600 * 1000 }); return true; }
  if (u.n >= LIMIT_PER_HOUR) return false;
  u.n += 1;
  return true;
}

class AiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

async function draftReply({ conversation, user, instructions }) {
  if (!config.anthropicApiKey) throw new AiError('AI drafts are not available right now. Try again later.', 409);
  if (!allow(conversation.organization_id)) throw new AiError('AI draft limit reached for this hour. Please try again later.', 429);
  const ctx = await one(
    `SELECT b.*, u.unit_name, u.checkin_time, u.checkout_time, u.wifi_name, u.wifi_password, u.checkin_instructions, u.house_rules,
            p.property_name, p.address, p.city, p.province, g.full_name AS guest_name, o.name AS workspace_name,
            ${BALANCE} AS balance
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id LEFT JOIN guests g ON g.guest_id = b.guest_id
      WHERE b.booking_id = $1`, [conversation.booking_id]);
  const { rows } = await query(
    `SELECT direction, body, COALESCE(sent_at, scheduled_at, created_at) AS at FROM messages
      WHERE conversation_id = $1 AND status NOT IN ('cancelled', 'failed')
      ORDER BY COALESCE(sent_at, scheduled_at, created_at) DESC LIMIT 20`, [conversation.conversation_id]);
  const messages = rows.reverse();
  let ask = 'Write the reply to the guest now.';
  if (!messages.some((m) => m.direction === 'in')) ask = 'The guest has not written yet. Write a friendly first message to the guest about their upcoming stay.';
  if (instructions) ask += `\n\nThe host's instructions for this reply (follow them): ${instructions}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicApiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: config.aiModel,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: `${contextText(ctx, messages, user.full_name)}\n\n${ask}` }],
      }),
    });
  } catch (err) {
    console.error('[ai] request failed:', err.message);
    throw new AiError("Couldn't reach the AI service. Please try again.");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[ai] ${res.status}: ${data?.error?.message || ''}`);
    if (res.status === 401 || res.status === 403) {
      console.error('[ai] the server AI key was rejected: check ANTHROPIC_API_KEY');
      throw new AiError('AI drafts are not available right now. Try again later.');
    }
    if (res.status === 429 || res.status === 529) throw new AiError('The AI service is busy. Please try again in a minute.');
    throw new AiError('The AI service could not write a draft right now. Please try again.');
  }
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new AiError('The AI returned an empty draft. Please try again.');
  return text;
}

module.exports = { draftReply, AiError };
