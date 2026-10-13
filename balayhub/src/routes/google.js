'use strict';

// Sign in with Google (OAuth 2.0 authorization code flow with PKCE).
// New Google users get an account automatically (email already verified by
// Google); existing accounts with the same email are linked on first use.

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { one, tx } = require('../db');
const { ah } = require('../lib/http');
const { audit } = require('../lib/audit');
const { hashPassword, newToken, hashToken, createSession, rateLimit } = require('../lib/auth');

const router = express.Router();
const COOKIE = 'bh_oauth';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const enabled = () => Boolean(config.googleClientId && config.googleClientSecret);
const redirectUri = () => `${config.appUrl}/api/auth/google/callback`;
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, key: (req) => `google|${req.ip}` });

function setFlowCookie(res, value, maxAge) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/api/auth/google', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function readFlowCookie(req) {
  const raw = String(req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  try { return JSON.parse(Buffer.from(raw.slice(COOKIE.length + 1), 'base64url').toString('utf8')); } catch { return null; }
}

const fail = (res, code) => res.redirect(302, `/#/login?google_error=${encodeURIComponent(code)}`);

router.get('/auth/options', (req, res) => res.json({ google: enabled() }));

router.get('/auth/google/start', limiter, (req, res) => {
  if (!enabled()) return fail(res, 'not_configured');
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const invite = typeof req.query.invite === 'string' && req.query.invite.length < 200 ? req.query.invite : null;
  setFlowCookie(res, b64url(JSON.stringify({ state, verifier, invite })), 600);
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  res.redirect(302, `${AUTH_URL}?${params}`);
});

async function googleProfile(code, verifier) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, code_verifier: verifier, client_id: config.googleClientId, client_secret: config.googleClientSecret,
      redirect_uri: redirectUri(), grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
  const { access_token: accessToken } = await tokenRes.json();
  const infoRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
  if (!infoRes.ok) throw new Error(`userinfo failed (${infoRes.status})`);
  return infoRes.json();
}

router.get('/auth/google/callback', limiter, ah(async (req, res) => {
  const flow = readFlowCookie(req);
  setFlowCookie(res, '', 0);
  if (!enabled()) return fail(res, 'not_configured');
  if (req.query.error) return fail(res, 'cancelled');
  if (!flow || typeof req.query.state !== 'string' || typeof req.query.code !== 'string' || req.query.state !== flow.state) {
    return fail(res, 'expired');
  }
  let profile;
  try {
    profile = await googleProfile(req.query.code, flow.verifier);
  } catch (err) {
    console.error('[google] sign-in failed:', err.message);
    return fail(res, 'google_failed');
  }
  if (!profile.sub || !profile.email || profile.email_verified !== true) return fail(res, 'email_unverified');
  const email = String(profile.email).toLowerCase();
  const name = String(profile.name || email.split('@')[0]).trim().slice(0, 120) || 'BalayHub user';

  let user = await one('SELECT * FROM users WHERE google_sub = $1', [profile.sub])
    || await one('SELECT * FROM users WHERE lower(email) = $1', [email]);

  if (user) {
    if (user.account_status !== 'active') return fail(res, 'revoked');
    if (user.google_sub && user.google_sub !== profile.sub) return fail(res, 'mismatch');
    await one(`UPDATE users SET google_sub = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE user_id = $1 RETURNING user_id`,
      [user.user_id, profile.sub]);
    await audit(null, user, 'auth.login', 'user', user.user_id, { method: 'google' });
  } else {
    let invite = null;
    if (flow.invite) {
      invite = await one(
        `SELECT * FROM invitations WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [hashToken(flow.invite)]);
      if (invite && invite.email.toLowerCase() !== email) return fail(res, 'invite_email');
    }
    const passwordHash = await hashPassword(newToken()); // unusable until they choose one via "Forgot password"
    user = await tx(async (db) => {
      const { rows: [u] } = await db.query(
        `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at, google_sub)
         VALUES ($1,$2,$3,$4,$5,now(),$6) RETURNING *`,
        [name, email, passwordHash, invite?.organization_id || null, invite?.role || null, profile.sub]);
      // The sign-up page states that continuing with Google accepts the Privacy Notice.
      await db.query(`INSERT INTO consent_records (user_id, consent_type, policy_version) VALUES ($1, 'privacy_notice', $2), ($1, 'terms_of_service', $3)`,
        [u.user_id, config.privacyPolicyVersion, config.termsVersion]);
      if (invite) {
        await db.query('UPDATE invitations SET accepted_at = now() WHERE invitation_id = $1', [invite.invitation_id]);
        await db.query(
          `INSERT INTO property_assignments (user_id, property_id)
           SELECT $1, p.property_id FROM properties p WHERE p.property_id = ANY($2) AND p.organization_id = $3 ON CONFLICT DO NOTHING`,
          [u.user_id, invite.property_ids, invite.organization_id]);
        await audit(db, u, 'member.joined', 'user', u.user_id, { role: invite.role, method: 'google' });
      }
      return u;
    });
  }
  await createSession(res, user.user_id);
  res.redirect(302, '/#/');
}));

module.exports = router;
module.exports.enabled = enabled;
