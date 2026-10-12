'use strict';

const express = require('express');
const config = require('../config');
const { one, query, tx } = require('../db');
const { HttpError, ah } = require('../lib/http');
const { validate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { sendMail } = require('../lib/mailer');
const {
  hashPassword, verifyPassword, burnPasswordCheck, newToken, hashToken,
  createSession, destroySession, requireAuth, rateLimit,
} = require('../lib/auth');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  key: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
});
// Per-IP cap regardless of email, against password spraying.
const ipLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `ip|${req.ip}` });
const emailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, key: (req) => `mail|${req.ip}` });

function publicUser(u) {
  return {
    user_id: u.user_id,
    full_name: u.full_name,
    email: u.email,
    role: u.role,
    organization_id: u.organization_id,
    organization_name: u.organization_name || null,
    business_type: u.business_type || null,
    email_verified: Boolean(u.email_verified_at),
  };
}

async function issueToken(userId, purpose, hours) {
  const token = newToken();
  await query(
    `INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [hashToken(token), userId, purpose, hours],
  );
  return token;
}

async function sendVerification(user) {
  const token = await issueToken(user.user_id, 'verify_email', 48);
  const link = `${config.appUrl}/#/verify?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: 'Verify your BalayHub email',
    text: `Hi ${user.full_name},\n\nConfirm your email to start using BalayHub:\n${link}\n\nThis link expires in 48 hours. If you didn't sign up, you can ignore this email.`,
  });
  return config.exposeDevLinks ? link : undefined;
}

async function loadInvitation(token) {
  return one(
    `SELECT i.*, o.name AS organization_name FROM invitations i
       JOIN organizations o ON o.organization_id = i.organization_id
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)],
  );
}

// ---------------------------------------------------------------- sign up
router.post('/auth/signup', ipLimiter, authLimiter, ah(async (req, res) => {
  const body = validate(req.body, {
    full_name: { type: 'string', required: true, max: 120, label: 'Full name' },
    email: { type: 'email', required: true, label: 'Email' },
    password: { type: 'password', required: true, label: 'Password' },
    confirm_password: { type: 'string', required: true, max: 200, label: 'Confirm password' },
    accept_privacy: { type: 'bool' },
    invite_token: { type: 'string', max: 200 },
  });
  if (req.body.password !== req.body.confirm_password) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { confirm_password: 'Passwords do not match.' } });
  }
  if (!body.accept_privacy) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { accept_privacy: 'Please read and accept the Privacy Notice to continue.' } });
  }

  let invite = null;
  if (body.invite_token) {
    invite = await loadInvitation(body.invite_token);
    if (!invite) throw new HttpError(400, 'This invitation link is invalid or has expired. Ask the workspace owner for a new one.', { code: 'INVITE_INVALID' });
    if (invite.email.toLowerCase() !== body.email) {
      throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { email: `This invitation was sent to ${invite.email}. Sign up with that address.` } });
    }
  }

  const passwordHash = await hashPassword(body.password);
  const user = await tx(async (db) => {
    const exists = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [body.email]);
    if (exists.rowCount) {
      throw new HttpError(409, 'An account with this email already exists. Log in or reset your password instead.', { code: 'EMAIL_TAKEN', fields: { email: 'This email is already registered.' } });
    }
    const { rows: [u] } = await db.query(
      `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [body.full_name, body.email, passwordHash, invite?.organization_id || null, invite?.role || null,
        invite ? new Date() : null], // the invite link proves control of the address
    );
    await db.query(
      `INSERT INTO consent_records (user_id, consent_type, policy_version) VALUES ($1, 'privacy_notice', $2)`,
      [u.user_id, config.privacyPolicyVersion],
    );
    if (invite) {
      await db.query('UPDATE invitations SET accepted_at = now() WHERE invitation_id = $1', [invite.invitation_id]);
      if (invite.property_ids.length) {
        await db.query(
          `INSERT INTO property_assignments (user_id, property_id)
           SELECT $1, p.property_id FROM properties p
            WHERE p.property_id = ANY($2) AND p.organization_id = $3
           ON CONFLICT DO NOTHING`,
          [u.user_id, invite.property_ids, invite.organization_id],
        );
      }
      await audit(db, u, 'member.joined', 'user', u.user_id, { role: invite.role });
    }
    return u;
  });

  await createSession(res, user.user_id);
  const devLink = !invite && config.requireEmailVerification ? await sendVerification(user) : undefined;
  const me = await one(
    `SELECT u.*, o.name AS organization_name, o.business_type FROM users u LEFT JOIN organizations o USING (organization_id) WHERE u.user_id = $1`,
    [user.user_id],
  );
  res.status(201).json({ user: publicUser(me), devVerificationLink: devLink });
}));

// ---------------------------------------------------------------- log in / out
router.post('/auth/login', ipLimiter, authLimiter, ah(async (req, res) => {
  const body = validate(req.body, {
    email: { type: 'email', required: true, label: 'Email' },
    password: { type: 'string', required: true, max: 200, label: 'Password' },
  });
  const user = await one(
    `SELECT u.*, o.name AS organization_name, o.business_type FROM users u LEFT JOIN organizations o USING (organization_id)
      WHERE lower(u.email) = $1`,
    [body.email],
  );
  const ok = user ? await verifyPassword(req.body.password, user.password_hash) : (await burnPasswordCheck(req.body.password), false);
  if (!ok || user.account_status !== 'active') {
    // Same message whether or not the account exists.
    throw new HttpError(401, 'Incorrect email or password. Try again or reset your password.', { code: 'BAD_CREDENTIALS' });
  }
  await createSession(res, user.user_id);
  await audit(null, user, 'auth.login', 'user', user.user_id);
  res.json({ user: publicUser(user) });
}));

router.post('/auth/logout', ah(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), requireEmailVerification: config.requireEmailVerification });
});

// ---------------------------------------------------------------- email verification
router.post('/auth/verify-email', authLimiter, ah(async (req, res) => {
  const { token } = validate(req.body, { token: { type: 'string', required: true, max: 200 } });
  const row = await one(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [hashToken(token)],
  );
  if (!row) throw new HttpError(400, 'This verification link is invalid or has expired. Log in to request a new one.', { code: 'TOKEN_INVALID' });
  await query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE user_id = $1', [row.user_id]);
  res.json({ ok: true });
}));

router.post('/auth/resend-verification', requireAuth, emailLimiter, ah(async (req, res) => {
  if (req.user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
  const devLink = await sendVerification(req.user);
  res.json({ ok: true, devVerificationLink: devLink });
}));

// ---------------------------------------------------------------- password reset
router.post('/auth/forgot-password', emailLimiter, ah(async (req, res) => {
  const { email } = validate(req.body, { email: { type: 'email', required: true, label: 'Email' } });
  const user = await one(`SELECT * FROM users WHERE lower(email) = $1 AND account_status = 'active'`, [email]);
  let devLink;
  if (user) {
    const token = await issueToken(user.user_id, 'reset_password', 1);
    const link = `${config.appUrl}/#/reset-password?token=${encodeURIComponent(token)}`;
    await sendMail({
      to: user.email,
      subject: 'Reset your BalayHub password',
      text: `Hi ${user.full_name},\n\nUse this link to choose a new password:\n${link}\n\nThe link expires in 1 hour. If you didn't ask for this, you can ignore this email.`,
    });
    if (config.exposeDevLinks) devLink = link;
  }
  // Same response either way so the form doesn't reveal which emails exist.
  res.json({ ok: true, message: 'If an account exists for that email, we sent a reset link.', devResetLink: devLink });
}));

router.post('/auth/reset-password', authLimiter, ah(async (req, res) => {
  const body = validate(req.body, {
    token: { type: 'string', required: true, max: 200 },
    password: { type: 'password', required: true, label: 'New password' },
  });
  const passwordHash = await hashPassword(body.password);
  await tx(async (db) => {
    const { rows: [row] } = await db.query(
      `UPDATE auth_tokens SET used_at = now()
        WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [hashToken(body.token)],
    );
    if (!row) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.', { code: 'TOKEN_INVALID' });
    // Resetting via email also proves the address.
    await db.query('UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, now()) WHERE user_id = $2', [passwordHash, row.user_id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
    const { rows: [u] } = await db.query('SELECT * FROM users WHERE user_id = $1', [row.user_id]);
    await audit(db, u, 'auth.password_reset', 'user', u.user_id);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- workspace setup
router.post('/workspace', requireAuth, ah(async (req, res) => {
  if (config.requireEmailVerification && !req.user.email_verified_at) {
    throw new HttpError(403, 'Please verify your email address first.', { code: 'EMAIL_UNVERIFIED' });
  }
  if (req.user.organization_id) throw new HttpError(409, 'You already belong to a workspace.', { code: 'HAS_WORKSPACE' });
  const { name, business_type: businessType } = validate(req.body, {
    name: { type: 'string', required: true, max: 120, label: 'Business or workspace name' },
    business_type: { type: 'enum', values: ['short_term', 'long_term', 'both'], label: 'Type of rentals' },
  });
  const org = await tx(async (db) => {
    const { rows: [o] } = await db.query('INSERT INTO organizations (name, business_type) VALUES ($1, $2) RETURNING *', [name, businessType || 'short_term']);
    await db.query(`UPDATE users SET organization_id = $1, role = 'owner' WHERE user_id = $2`, [o.organization_id, req.user.user_id]);
    await audit(db, { ...req.user, organization_id: o.organization_id }, 'workspace.created', 'organization', o.organization_id);
    return o;
  });
  res.status(201).json({ organization: org });
}));

// Owners can rename the workspace or change which modules it uses.
router.patch('/workspace', requireAuth, ah(async (req, res) => {
  if (req.user.role !== 'owner') throw new HttpError(403, "You don't have permission to do that.", { code: 'FORBIDDEN' });
  const body = validate(req.body, {
    name: { type: 'string', max: 120, label: 'Business or workspace name' },
    business_type: { type: 'enum', values: ['short_term', 'long_term', 'both'], label: 'Type of rentals' },
  }, { partial: true });
  const keys = Object.keys(body).filter((k) => body[k]);
  if (keys.length) {
    await query(`UPDATE organizations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE organization_id = $1`,
      [req.user.organization_id, ...keys.map((k) => body[k])]);
    await audit(null, req.user, 'workspace.updated', 'organization', req.user.organization_id, body);
  }
  res.json({ ok: true });
}));

router.get('/invitations/:token', ah(async (req, res) => {
  const invite = await loadInvitation(req.params.token);
  if (!invite) throw new HttpError(404, 'This invitation link is invalid or has expired.', { code: 'INVITE_INVALID' });
  res.json({ email: invite.email, role: invite.role, organization_name: invite.organization_name });
}));

module.exports = router;
