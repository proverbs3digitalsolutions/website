'use strict';

// BalayHub assistant: a chat helper for hosts and their staff that answers
// "how do I…?" questions about BalayHub. Its knowledge is the help center
// (src/lib/helpcenter.js) plus who is asking (role, workspace type, plan,
// current page). It never sees guest or booking data. When it can't solve
// something it offers to open a support ticket with the conversation attached.

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const { HttpError, ah } = require('../lib/http');
const { CATEGORIES, ARTICLES, searchArticles } = require('../lib/helpcenter');
const { PLANS, PUBLIC_PLANS } = require('../lib/plans');

const router = express.Router();
const TICKET_MARK = '[[TICKET]]';
// Models that accept server-side refusal fallbacks ("default" routing).
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'];

let client;
const anthropic = () => {
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey, baseURL: config.anthropicBaseUrl || undefined, timeout: 60 * 1000, maxRetries: 1 });
  return client;
};

// ---------------------------------------------------------------- knowledge
const ROLE_TEXT = {
  owner: 'Owner: full access, including billing, team, owner statements and deleting data.',
  manager: 'Property manager: runs day-to-day operations for the properties assigned to them; no billing, team or data deletion.',
  staff: 'Staff: sees reservations, calendar, housekeeping and deposits for their assigned properties (and long-term rent, expenses and reports for those properties); guest contact details, the guest inbox, stay reports, pricing changes, team and billing are hidden from staff.',
};

// One stable system prompt per role, so the long knowledge part is cached.
const systemCache = new Map();
function knowledge(role) {
  if (systemCache.has(role)) return systemCache.get(role);
  const visible = ARTICLES.filter((a) => a.roles.includes(role));
  const hidden = ARTICLES.filter((a) => !a.roles.includes(role)).map((a) => a.title);
  const plans = PUBLIC_PLANS.map((k) => `${PLANS[k].name}: ₱${PLANS[k].price}/month, up to ${PLANS[k].listings} listings${PLANS[k].ai ? ', AI reply drafts' : ''}`).join('; ');
  const text = `You are the BalayHub assistant, the in-app helper inside BalayHub.

BalayHub is a rental and staycation management web app for Filipino hosts with about 1–10 units: condo staycations listed on Airbnb, Booking.com and Agoda, and monthly rentals (apartments, boarding houses, dorms, bedspaces). It has a multi-calendar with channel sync, reservations, a direct booking page, guest inbox with automatic messages, housekeeping, payments and receipts (GCash/Maya/card via PayMongo), security deposits, condo gate passes, guest check-in forms, reviews, reports and tax summaries, owner statements, tenants and leases, rent and expenses, maintenance, a phone app with notifications, dark mode, and English/Tagalog guest messages. Plans: ${plans}. New workspaces get a ${config.trialDays}-day free trial. Prices are in Philippine pesos.

The person you are talking to is a member of a BalayHub workspace with this role:
${ROLE_TEXT[role]}

How to help:
- Answer questions about using BalayHub: where a feature is, the steps to do something, what a setting means, and how to fix common problems. Give the exact menu path and button names from the guides below, as short numbered steps when there are several.
- Base every answer on the guides below. If they don't cover it, say you're not sure rather than guessing, and never invent menus, buttons, features, prices or policies.
- You cannot see or change the user's data (reservations, guests, payments, settings) and you cannot take actions for them. Tell them where to do it themselves.
- If a task needs a different role (for example a staff member asking about billing), say who in their team can do it.
- Reply in the language the user writes in: English, Tagalog or Taglish. Keep a warm, practical tone. Keep answers short — usually under 120 words — with no headings; plain text with simple numbered or dashed lists only (no tables, no bold).
- For general hosting questions (pricing tips, guest communication, house rules, BIR basics) you may give brief, practical advice, and say when they should check with an accountant, lawyer or their condo admin.
- If something looks like a bug, an account or billing problem, a payment that went wrong, data that looks missing, or anything you can't resolve, say that BalayHub Support can look into it and end your reply with the exact marker ${TICKET_MARK} on its own line. Also add the marker whenever the user asks for a human. Don't add it otherwise.
- Never ask for or repeat passwords, API keys, card numbers or full ID numbers. If the user pastes one, tell them to change it and not to share it.
- Stay on BalayHub and hosting topics; politely decline unrelated requests.

${hidden.length ? `Guides for other roles exist but this user can't use them (point them to the workspace owner): ${hidden.join('; ')}.\n\n` : ''}BalayHub guides:
${CATEGORIES.map(([key, name]) => {
    const list = visible.filter((a) => a.category === key);
    return list.length ? `\n## ${name}\n${list.map((a) => `### ${a.title}\n${a.body.join('\n')}`).join('\n\n')}` : '';
  }).join('\n')}`;
  systemCache.set(role, text);
  return text;
}

function userContext(user, page) {
  const type = { short_term: 'short-term stays (Airbnb/staycations)', long_term: 'long-term monthly rentals', both: 'both short-term stays and monthly rentals' }[user.business_type] || 'rentals';
  return `About this user (use it to tailor the answer; don't repeat it back):
- Name: ${user.full_name.split(' ')[0]}
- Workspace: ${user.organization_name}, used for ${type}
- Role: ${user.role}
- Plan: ${user.plan ? (PLANS[user.plan]?.name || user.plan) : 'unknown'}
- Page they are on: ${page || 'unknown'}`;
}

// ---------------------------------------------------------------- limits
const perUser = new Map();
const perOrg = new Map();
function allow(user) {
  const now = Date.now();
  const u = (perUser.get(user.user_id) || []).filter((t) => now - t < 3600 * 1000);
  const o = (perOrg.get(user.organization_id) || []).filter((t) => now - t < 86400 * 1000);
  if (u.length >= 40 || o.length >= 300) return false;
  perUser.set(user.user_id, [...u, now]);
  perOrg.set(user.organization_id, [...o, now]);
  return true;
}

function readMessages(raw) {
  const bad = () => new HttpError(400, 'Please send your question again.', { code: 'VALIDATION' });
  if (!Array.isArray(raw) || !raw.length || raw.length > 40) throw bad();
  const msgs = raw.map((m) => {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw bad();
    return { role: m.role, content: m.content.trim().slice(0, m.role === 'user' ? 2000 : 4000) };
  });
  if (msgs.at(-1).role !== 'user' || !msgs.at(-1).content) throw new HttpError(400, 'Type a question first.', { code: 'VALIDATION' });
  // Keep the recent part of the chat, starting on a user turn, alternating.
  let recent = msgs.slice(-12);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  const out = [];
  for (const m of recent) {
    if (!m.content) continue;
    if (out.length && out.at(-1).role === m.role) out.at(-1).content += `\n\n${m.content}`;
    else out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- endpoints
router.get('/assistant', (req, res) => {
  res.json({ enabled: Boolean(config.anthropicApiKey) && !req.user.is_demo });
});

router.post('/assistant/chat', ah(async (req, res) => {
  if (!config.anthropicApiKey) throw new HttpError(409, 'The BalayHub assistant is not set up on this server yet. You can still contact support.', { code: 'AI_OFF' });
  const messages = readMessages(req.body?.messages);
  if (!allow(req.user)) throw new HttpError(429, "You've asked a lot of questions in a short time. Please wait a bit, or contact support.", { code: 'RATE_LIMITED' });
  const page = String(req.body?.page || '').slice(0, 120);
  const model = config.assistantModel;

  let response;
  try {
    response = await anthropic().beta.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: knowledge(req.user.role), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: userContext(req.user, page) },
      ],
      messages,
      ...(FALLBACK_MODELS.includes(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('[assistant] the API key was rejected');
      throw new HttpError(502, 'The assistant is not available right now. Please contact support instead.', { code: 'AI_ERROR' });
    }
    if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && [500, 529].includes(err.status))) {
      throw new HttpError(503, 'The assistant is busy. Please try again in a minute.', { code: 'AI_BUSY' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`[assistant] API error ${err.status}: ${err.message}`);
      throw new HttpError(502, "The assistant couldn't answer right now. Please try again, or contact support.", { code: 'AI_ERROR' });
    }
    console.error('[assistant] request failed:', err.message);
    throw new HttpError(502, "Couldn't reach the assistant. Please try again, or contact support.", { code: 'AI_ERROR' });
  }

  if (response.stop_reason === 'refusal') {
    return res.json({ reply: "Sorry, I can't help with that one. If it's about your BalayHub account, BalayHub Support can take a look.", offer_ticket: true, articles: [] });
  }
  let reply = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const offerTicket = reply.includes(TICKET_MARK);
  reply = reply.split(TICKET_MARK).join('').trim();
  if (!reply) reply = "Sorry, I couldn't come up with an answer. Please try asking another way, or contact support.";
  if (response.stop_reason === 'max_tokens') reply += ' …';
  const articles = searchArticles(messages.at(-1).content, req.user.role, 3).map(({ slug, title, body }) => ({ slug, title, body }));
  res.json({ reply, offer_ticket: offerTicket, articles });
}));

module.exports = { router, knowledge, TICKET_MARK };
