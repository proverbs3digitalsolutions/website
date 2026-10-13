'use strict';

// Owner portal sign-in (D-39). Unit owners never get a users row: they sign in with a
// one-time link emailed to them, and get the separate bh_owner cookie, which points at
// owner_sessions. Only token hashes are stored.

const config = require('../config');
const { one, query } = require('../db');
const { HttpError } = require('./http');
const { newToken, hashToken } = require('./auth');
const { planStatus } = require('./plans');

const OWNER_COOKIE = 'bh_owner';
const SESSION_DAYS = 30;
const IDLE_DAYS = 7;
const LINK_MINUTES = 30;
const TOUCH_MS = 5 * 60 * 1000; // last_seen_at is written at most once per 5 minutes

const signedOut = () => new HttpError(401, 'Please sign in to the owner portal.', { code: 'OWNER_SIGNED_OUT' });

function readOwnerCookie(req) {
  const m = /(?:^|;\s*)bh_owner=([^;]+)/.exec(String(req.headers.cookie || ''));
  return m ? m[1] : null;
}

// Same attributes as the team session cookie (setSessionCookie in auth.js).
function setOwnerCookie(res, value, maxAgeSec) {
  const attrs = [`${OWNER_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

// A one-time sign-in link for one owner (30 minutes). Returns the full link.
async function issueSignInLink(ownerId) {
  const token = newToken();
  await query(
    `INSERT INTO owner_login_tokens (token_hash, owner_id, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [hashToken(token), ownerId, LINK_MINUTES],
  );
  return `${config.appUrl}/#/owner/signin?token=${encodeURIComponent(token)}`;
}

async function createOwnerSession(req, res, ownerId, organizationId) {
  const token = newToken();
  await query(
    `INSERT INTO owner_sessions (token_hash, owner_id, organization_id, expires_at, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5)`,
    [hashToken(token), ownerId, organizationId, SESSION_DAYS, String(req.get('user-agent') || '').slice(0, 300) || null],
  );
  await query('UPDATE unit_owners SET portal_last_seen_at = now() WHERE owner_id = $1', [ownerId]);
  setOwnerCookie(res, token, SESSION_DAYS * 86400);
}

async function destroyOwnerSession(req, res) {
  const token = readOwnerCookie(req);
  if (token) await query('DELETE FROM owner_sessions WHERE token_hash = $1', [hashToken(token)]);
  setOwnerCookie(res, '', 0);
}

// Attaches req.portalOwner when the bh_owner session is live, its owner still has portal
// access, and the workspace isn't scheduled for deletion. Anything else is 401.
// plan_status is the workspace's plan (planStatus), so owner writes can check for view-only.
async function requireOwnerSession(req, res, next) {
  try {
    const token = readOwnerCookie(req);
    if (!token) return next(signedOut());
    const row = await one(
      `SELECT s.token_hash, s.last_seen_at, o.owner_id, o.organization_id, o.full_name, o.email, g.name AS workspace_name,
              g.plan, g.trial_ends_at, g.paid_until, g.is_demo, g.deletion_scheduled_at
         FROM owner_sessions s
         JOIN unit_owners o ON o.owner_id = s.owner_id
         JOIN organizations g ON g.organization_id = o.organization_id
        WHERE s.token_hash = $1 AND s.expires_at > now()
          AND s.last_seen_at > now() - make_interval(days => $2)
          AND o.portal_enabled AND o.archived_at IS NULL AND g.deletion_scheduled_at IS NULL`,
      [hashToken(token), IDLE_DAYS]);
    if (!row) return next(signedOut());
    req.portalOwner = {
      owner_id: row.owner_id, organization_id: row.organization_id,
      full_name: row.full_name, email: row.email, workspace_name: row.workspace_name,
      plan_status: planStatus(row),
    };
    if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_MS) {
      await query('UPDATE owner_sessions SET last_seen_at = now() WHERE token_hash = $1', [row.token_hash]);
      await query('UPDATE unit_owners SET portal_last_seen_at = now() WHERE owner_id = $1', [row.owner_id]);
    }
    next();
  } catch (err) { next(err); }
}

module.exports = {
  IDLE_DAYS, issueSignInLink, createOwnerSession, destroyOwnerSession, requireOwnerSession,
};
