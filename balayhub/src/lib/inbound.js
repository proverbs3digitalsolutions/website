'use strict';

// Reads guest replies from the mailbox over IMAP. Only messages addressed to a
// BalayHub reply tag ("+bh-<token>") are imported; all other mail is ignored
// and left untouched (not marked read, not moved).

const config = require('../config');
const { pool, one, query } = require('../db');

function parseImapUrl(raw) {
  try {
    const u = new URL(raw);
    if (!['imaps:', 'imap:'].includes(u.protocol)) return null;
    return {
      host: u.hostname, port: Number(u.port) || (u.protocol === 'imaps:' ? 993 : 143), secure: u.protocol === 'imaps:',
      auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) },
    };
  } catch { return null; }
}

const TOKEN_RE = /\+bh-([a-z0-9]{6,32})@/i;

function findToken(parsed) {
  const addrs = [];
  for (const k of ['to', 'cc', 'bcc']) for (const v of (parsed[k]?.value || [])) addrs.push(v.address || '');
  for (const h of ['delivered-to', 'x-original-to']) {
    const v = parsed.headers?.get(h);
    if (v) addrs.push(typeof v === 'string' ? v : (v.text || JSON.stringify(v)));
  }
  for (const a of addrs) { const m = TOKEN_RE.exec(a); if (m) return m[1].toLowerCase(); }
  return null;
}

// Keep only the new part of a reply (drop the quoted thread below it).
function stripQuoted(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (/^On .+wrote:$/i.test(t) || (/^On .+/.test(t) && /wrote:$/.test((lines[i + 1] || '').trim()))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(t)) break;
    if (/^(From|Sent|Mula|Ipinadala):\s/.test(t) && out.some((l) => l.trim())) break;
    if (t.startsWith('>')) continue;
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() || String(text || '').trim();
}

// Store one parsed email if it belongs to a conversation. Returns true if stored.
async function storeInbound(parsed) {
  const token = findToken(parsed);
  if (!token) return false;
  const conv = await one('SELECT * FROM conversations WHERE reply_token = $1', [token]);
  if (!conv) return false;
  const from = parsed.from?.value?.[0] || {};
  const body = stripQuoted(parsed.text || '').slice(0, 20000) || '(empty message)';
  const { rowCount } = await query(
    `INSERT INTO messages (conversation_id, organization_id, direction, from_name, from_email, subject, body, status, sent_at, email_message_id)
     VALUES ($1,$2,'in',$3,$4,$5,$6,'received',$7,$8)
     ON CONFLICT (organization_id, email_message_id) WHERE direction = 'in' AND email_message_id IS NOT NULL DO NOTHING`,
    [conv.conversation_id, conv.organization_id, (from.name || '').slice(0, 120), (from.address || '').slice(0, 254),
      String(parsed.subject || '').slice(0, 200), body, parsed.date || new Date(), parsed.messageId || null]);
  if (rowCount) {
    await query(
      `UPDATE conversations SET unread = true, status = 'open', snoozed_until = NULL, last_message_at = now() WHERE conversation_id = $1`,
      [conv.conversation_id]);
  }
  return rowCount > 0;
}

let running = false;
async function pollInbox() {
  if (!config.imapUrl || running) return { skipped: true };
  const opts = parseImapUrl(config.imapUrl);
  if (!opts) { console.error('[inbox] IMAP_URL looks wrong. Expected imaps://EMAIL%40DOMAIN:APP_PASSWORD@imap.gmail.com:993'); return { skipped: true }; }
  running = true;
  const key = `${opts.auth.user}@${opts.host}/INBOX`;
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const client = new ImapFlow({ ...opts, logger: false });
  let imported = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const state = (await one('SELECT * FROM mail_sync_state WHERE mailbox = $1', [key])) || { last_uid: 0, uid_validity: null };
      const validity = Number(client.mailbox.uidValidity);
      let last = Number(state.last_uid) || 0;
      if (state.uid_validity && Number(state.uid_validity) !== validity) last = 0;
      // First run: only look at the last 2 days, never the whole mailbox.
      const uids = last === 0
        ? await client.search({ since: new Date(Date.now() - 2 * 86400000) }, { uid: true })
        : await client.search({ uid: `${last + 1}:*` }, { uid: true });
      let maxUid = last;
      for (const uid of (uids || []).filter((u) => u > last).sort((a, b) => a - b)) {
        maxUid = Math.max(maxUid, uid);
        const env = await client.fetchOne(uid, { envelope: true }, { uid: true });
        const rcpts = [...(env.envelope?.to || []), ...(env.envelope?.cc || [])].map((a) => a.address || '');
        if (!rcpts.some((a) => TOKEN_RE.test(a))) continue;
        const full = await client.fetchOne(uid, { source: true }, { uid: true });
        const parsed = await simpleParser(full.source);
        if (await storeInbound(parsed)) imported += 1;
      }
      await query(
        `INSERT INTO mail_sync_state (mailbox, uid_validity, last_uid, last_run_at, last_error) VALUES ($1,$2,$3,now(),NULL)
         ON CONFLICT (mailbox) DO UPDATE SET uid_validity = $2, last_uid = $3, last_run_at = now(), last_error = NULL`,
        [key, validity, maxUid]);
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.error('[inbox] reading replies failed:', err.message);
    await pool.query(
      `INSERT INTO mail_sync_state (mailbox, last_run_at, last_error) VALUES ($1, now(), $2)
       ON CONFLICT (mailbox) DO UPDATE SET last_run_at = now(), last_error = $2`, [key, String(err.message).slice(0, 300)]).catch(() => {});
    try { client.close(); } catch { /* ignore */ }
  } finally {
    running = false;
  }
  return { imported };
}

async function inboxStatus() {
  if (!config.imapUrl) return { configured: false };
  const row = await one('SELECT last_run_at, last_error FROM mail_sync_state ORDER BY last_run_at DESC NULLS LAST LIMIT 1');
  return { configured: true, last_run_at: row?.last_run_at || null, last_error: row?.last_error || null };
}

module.exports = { pollInbox, storeInbound, stripQuoted, findToken, parseImapUrl, inboxStatus };
