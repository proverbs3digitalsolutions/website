'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const config = require('../config');
const { one, query } = require('../db');
const { HttpError, forbidden } = require('./http');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'bh_session';
const SCRYPT = { N: 16384, r: 8, p: 1 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(key, expected);
}

// A fixed hash so unknown-email logins take as long as real ones.
let dummyHash = null;
async function burnPasswordCheck(password) {
  dummyHash = dummyHash || await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip malformed cookie */ }
  }
  return out;
}

function setSessionCookie(res, token, maxAgeSec) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

async function createSession(res, userId) {
  const token = newToken();
  const ttl = config.sessionTtlHours * 3600;
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, now() + make_interval(secs => $3), $4)`,
    [hashToken(token), userId, ttl, String(res.req?.get('user-agent') || '').slice(0, 300) || null],
  );
  setSessionCookie(res, token, ttl);
}

async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  setSessionCookie(res, '', 0);
}

// Attach req.user when a valid, non-idle session cookie is present.
async function loadSession(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.hadSessionCookie = Boolean(token);
    if (!token) return next();
    const row = await one(
      `SELECT s.token_hash, s.last_seen_at, u.user_id, u.full_name, u.email, u.phone, u.organization_id, u.role,
              u.account_status, u.email_verified_at, o.name AS organization_name, o.business_type, o.guest_language,
              o.plan, o.trial_ends_at, o.paid_until, o.is_demo, o.deletion_scheduled_at,
              o.card_check, o.card_brand, o.card_last4
         FROM sessions s
         JOIN users u ON u.user_id = s.user_id
         LEFT JOIN organizations o ON o.organization_id = u.organization_id
        WHERE s.token_hash = $1 AND s.expires_at > now()
          AND s.last_seen_at > now() - make_interval(hours => $2)`,
      [hashToken(token), config.sessionIdleHours],
    );
    if (row && row.account_status === 'active') {
      req.user = row;
      if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60 * 1000) {
        await query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [row.token_hash]);
      }
    }
    next();
  } catch (err) { next(err); }
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  const expired = req.hadSessionCookie;
  next(new HttpError(401, expired ? 'Your session has expired. Please log in again.' : 'Please log in to continue.',
    { code: expired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED' }));
}

// Signed in, verified, and a member of a workspace.
function requireWorkspace(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (config.requireEmailVerification && !req.user.email_verified_at) {
      return next(new HttpError(403, 'Please verify your email address first.', { code: 'EMAIL_UNVERIFIED' }));
    }
    if (!req.user.organization_id) {
      return next(new HttpError(403, 'Create your workspace to continue.', { code: 'NO_WORKSPACE' }));
    }
    next();
  });
}

// Read-only workspaces (the public demo, an ended trial, an overdue plan) can
// view and export everything but not change anything.
// Before the card check (D-98) only these writes work: account, support, the card check itself, invitations, deleting the workspace.
const CARD_CHECK_EXEMPT = /^\/(auth\/|account\/|support\/|admin\/|invitations\/|billing\/card-check(\/|$)|push\/unsubscribe$|workspace\/delete(\/cancel)?$)/;
const PLAN_EXEMPT = /^\/(auth\/|admin\/|invitations\/|billing\/|push\/|support\/|assistant\/|account\/|workspace\/delete\/cancel$)/;
function planGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.user?.organization_id) return next();
  // Guest-facing pages (opened by a private link) don't depend on who is signed in.
  if (req.path.startsWith('/public/')) return next();
  // Owner portal: signed in with its own cookie (bh_owner), so the workspace's plan doesn't apply.
  if (req.path.startsWith('/owner-portal/')) return next();
  const { planStatus, READ_ONLY_MSG } = require('./plans');
  const s = planStatus(req.user);
  if (!s.read_only) return next();
  if (s.reason === 'demo') {
    if (/^\/auth\/(logout|login|signup|demo)$|^\/push\/unsubscribe$/.test(req.path)) return next();
    return next(new HttpError(403, READ_ONLY_MSG.demo, { code: 'DEMO_READ_ONLY' }));
  }
  if (s.reason === 'card_check') {
    // Help & support still works, so a ticket screenshot (and only that record type) may be uploaded.
    if (req.path === '/files' && req.query.record_type === 'support') return next();
    return CARD_CHECK_EXEMPT.test(req.path) ? next() : next(new HttpError(402, READ_ONLY_MSG.card_check, { code: 'CARD_CHECK_REQUIRED' }));
  }
  if (PLAN_EXEMPT.test(req.path)) return next();
  // Screenshots on a support ticket, so a lapsed workspace can still get help.
  if (req.path === '/files' && req.query.record_type === 'support') return next();
  return next(new HttpError(402, READ_ONLY_MSG[s.reason], { code: 'PLAN_READ_ONLY' }));
}

// Scheduler: delete sessions that are expired or idle (the same rules loadSession
// uses to reject them), and one-time tokens that are expired or were used over
// 7 days ago. Owner portal sessions and sign-in links follow the same rules.
// Returns how many rows were deleted.
async function purgeExpiredAuth() {
  // Required here: ownerauth.js requires this module, so a top-level require would be circular.
  const { IDLE_DAYS } = require('./ownerauth');
  const s = await query(
    `DELETE FROM sessions WHERE expires_at <= now() OR last_seen_at <= now() - make_interval(hours => $1)`,
    [config.sessionIdleHours],
  );
  const t = await query(
    `DELETE FROM auth_tokens WHERE expires_at <= now() OR (used_at IS NOT NULL AND used_at < now() - interval '7 days')`,
  );
  const os = await query(
    `DELETE FROM owner_sessions WHERE expires_at <= now() OR last_seen_at <= now() - make_interval(days => $1)`,
    [IDLE_DAYS],
  );
  const ot = await query(
    `DELETE FROM owner_login_tokens WHERE expires_at <= now() OR (used_at IS NOT NULL AND used_at < now() - interval '7 days')`,
  );
  return s.rowCount + t.rowCount + os.rowCount + ot.rowCount;
}

const requireRole = (...roles) => (req, res, next) =>
  (roles.includes(req.user?.role) ? next() : next(forbidden()));

// Very small in-memory fixed-window limiter (per process).
// Every request is counted on arrival, so a burst of parallel requests can't slip past the cap.
// failedOnly: when the response finishes below 400 the count is given back, so successful
// requests from a shared IP never lock anyone out.
function rateLimit({ windowMs, max, key, failedOnly = false }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(k, h); }
    h.count += 1;
    if (h.count > max) {
      res.set('Retry-After', Math.ceil((h.reset - now) / 1000));
      return next(new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.', { code: 'RATE_LIMITED' }));
    }
    if (failedOnly) res.on('finish', () => { if (res.statusCode < 400) h.count = Math.max(0, h.count - 1); });
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, burnPasswordCheck, newToken, hashToken,
  createSession, destroySession, loadSession, requireAuth, requireWorkspace, requireRole, rateLimit, planGuard,
  purgeExpiredAuth,
};
