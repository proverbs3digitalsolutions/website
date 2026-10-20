'use strict';

// Account security and data rights: change password, export all data,
// delete the workspace (after a 14-day grace period).

const express = require('express');
const config = require('../config');
const { one, query, tx } = require('../db');
const { HttpError, ah } = require('../lib/http');
const { validate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { changedKeys } = require('../lib/auditdiff');
const { sendMail } = require('../lib/mailer');
const { hashPassword, verifyPassword, requireAuth, requireRole, rateLimit } = require('../lib/auth');
const account = require('../lib/account');

const router = express.Router(); // signed in, any workspace state
const workspaceRouter = express.Router(); // inside a workspace
const owners = requireRole('owner');

const pwLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `pw|${req.user?.user_id || req.ip}` });

router.post('/auth/change-password', requireAuth, pwLimiter, ah(async (req, res) => {
  const body = validate(req.body, {
    current_password: { type: 'string', required: true, max: 200, label: 'Current password' },
    new_password: { type: 'password', required: true, label: 'New password' },
    confirm_password: { type: 'string', required: true, max: 200, label: 'Confirm new password' },
  });
  if (body.new_password !== body.confirm_password) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { confirm_password: 'The passwords do not match.' } });
  }
  const u = await one('SELECT password_hash, google_sub FROM users WHERE user_id = $1', [req.user.user_id]);
  if (!(await verifyPassword(body.current_password, u.password_hash))) {
    const hint = u.google_sub ? ' If you signed up with Google and never set a password, log out and use "Forgot password" to set one.' : '';
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { current_password: `That's not your current password.${hint}` } });
  }
  const passwordHash = await hashPassword(body.new_password);
  // Change the password, sign out every other device, and retire open reset links, all in one transaction.
  // Same per-user lock as the reset route, so a reset and this change can't deadlock.
  await tx(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('reset:' || $1))`, [req.user.user_id]);
    await db.query('UPDATE users SET password_hash = $2 WHERE user_id = $1', [req.user.user_id, passwordHash]);
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.user_id, req.user.token_hash]);
    await db.query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL`, [req.user.user_id]);
  });
  await audit(null, req.user, 'auth.password_changed', 'user', req.user.user_id);
  await sendMail({
    to: req.user.email,
    subject: 'Your BalayHub password was changed',
    text: `Hi ${req.user.full_name},\n\nThe password for your BalayHub account was just changed, and other devices were signed out.\n\nIf this wasn't you, reset your password now at ${config.appUrl}/#/forgot and contact your workspace owner.\n\n— BalayHub`,
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- my account
// "Chrome on Android" from a user-agent string; good enough to recognise a device.
function deviceName(ua) {
  if (!ua) return 'Earlier sign-in';
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
const sessionId = (hash) => hash.slice(0, 16);

router.get('/account/profile', requireAuth, ah(async (req, res) => {
  const u = req.user;
  // Push is on only when this person has a saved push subscription; a notification choice alone (notify_prefs) is not one.
  const extra = await one(`SELECT created_at, google_sub IS NOT NULL AS google_linked,
      EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = $1) AS notifications_on FROM users WHERE user_id = $1`, [u.user_id]);
  const { rows: sessions } = await query(
    `SELECT token_hash, created_at, last_seen_at, user_agent FROM sessions
      WHERE user_id = $1 AND expires_at > now() AND last_seen_at > now() - make_interval(hours => $2) ORDER BY last_seen_at DESC LIMIT 20`,
    [u.user_id, config.sessionIdleHours]);
  let workspace = null; let properties = []; let owner = null; let activity = []; let support = null;
  if (u.organization_id) {
    const { planStatus } = require('../lib/plans');
    const org = await one('SELECT created_at FROM organizations WHERE organization_id = $1', [u.organization_id]);
    const plan = planStatus(u);
    // Only owners see what the plan costs and its listing limit; everyone sees the status (BACKEND-SCHEMA 6, D-83).
    if (u.role !== 'owner') { delete plan.price; delete plan.listing_limit; }
    workspace = { name: u.organization_name, business_type: u.business_type, role: u.role, created_at: org.created_at, plan,
      members: (await one(`SELECT COUNT(*)::int AS n FROM users WHERE organization_id = $1 AND account_status = 'active'`, [u.organization_id])).n };
    // Which properties this person works on (owners see everything).
    ({ rows: properties } = await query(
      u.role === 'owner'
        ? `SELECT p.property_id, p.property_name, p.city, (SELECT COUNT(*)::int FROM units x WHERE x.property_id = p.property_id AND x.status = 'active') AS units
             FROM properties p WHERE p.organization_id = $1 AND p.status = 'active' ORDER BY p.property_name`
        : `SELECT p.property_id, p.property_name, p.city, (SELECT COUNT(*)::int FROM units x WHERE x.property_id = p.property_id AND x.status = 'active') AS units
             FROM property_assignments a JOIN properties p USING (property_id) WHERE a.user_id = $2 AND p.organization_id = $1 AND p.status = 'active' ORDER BY p.property_name`,
      u.role === 'owner' ? [u.organization_id] : [u.organization_id, u.user_id]));
    if (u.role !== 'owner') owner = await one(`SELECT full_name, email FROM users WHERE organization_id = $1 AND role = 'owner' AND account_status = 'active' ORDER BY created_at LIMIT 1`, [u.organization_id]);
    ({ rows: activity } = await query(
      `SELECT action, record_type, created_at FROM audit_logs WHERE organization_id = $1 AND actor_user_id = $2
        AND action NOT IN ('auth.login', 'auth.logout', 'auth.login_google', 'file.downloaded') ORDER BY created_at DESC LIMIT 15`,
      [u.organization_id, u.user_id]));
    support = await one(
      `SELECT COUNT(*) FILTER (WHERE status IN ('new', 'in_progress', 'waiting_on_customer'))::int AS open,
              COUNT(*) FILTER (WHERE status = 'waiting_on_customer')::int AS waiting
         FROM support_tickets WHERE created_by = $1`, [u.user_id]);
  }
  res.json({
    user: { full_name: u.full_name, email: u.email, phone: u.phone, email_verified: Boolean(u.email_verified_at), created_at: extra.created_at, google_linked: extra.google_linked,
      notifications_on: extra.notifications_on },
    workspace, properties, owner, activity, support,
    sessions: sessions.map((x) => ({ id: sessionId(x.token_hash), device: deviceName(x.user_agent), created_at: x.created_at, last_seen_at: x.last_seen_at, current: x.token_hash === u.token_hash })),
  });
}));

router.patch('/account/profile', requireAuth, ah(async (req, res) => {
  const body = validate(req.body, {
    full_name: { type: 'string', required: true, max: 120, label: 'Full name' },
    phone: { type: 'phone', label: 'Mobile number' },
  });
  const phone = body.phone || null;
  await tx(async (db) => {
    const { rows: [now] } = await db.query('SELECT full_name, phone FROM users WHERE user_id = $1 FOR UPDATE', [req.user.user_id]);
    // Names the fields that really changed, never their values; a save that changes nothing writes nothing.
    const fields = changedKeys(now, { full_name: body.full_name, phone });
    if (!fields.length) return;
    await db.query('UPDATE users SET full_name = $2, phone = $3 WHERE user_id = $1', [req.user.user_id, body.full_name, phone]);
    await audit(db, req.user, 'user.profile_updated', 'user', req.user.user_id, { fields });
  });
  res.json({ ok: true });
}));

// Sign out one other device, or every device except this one.
router.post('/account/sessions/logout-others', requireAuth, ah(async (req, res) => {
  const { rowCount } = await query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.user_id, req.user.token_hash]);
  await audit(null, req.user, 'auth.signed_out_others', 'user', req.user.user_id, { sessions: rowCount });
  res.json({ ok: true, signed_out: rowCount });
}));

router.post('/account/sessions/:id/logout', requireAuth, ah(async (req, res) => {
  const id = String(req.params.id);
  if (!/^[a-f0-9]{16}$/.test(id)) throw new HttpError(404, 'Not found.', { code: 'NOT_FOUND' });
  const { rowCount } = await query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2 AND left(token_hash, 16) = $3`, [req.user.user_id, req.user.token_hash, id]);
  if (!rowCount) throw new HttpError(404, 'That device is already signed out.', { code: 'NOT_FOUND' });
  res.json({ ok: true });
}));

const exportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: (req) => `export|${req.user.organization_id}` });

workspaceRouter.get('/workspace/export', owners, exportLimiter, ah(async (req, res) => {
  const data = await account.exportOrganization(req.user.organization_id);
  await audit(null, req.user, 'workspace.exported', 'organization', req.user.organization_id);
  const name = `balayhub-export-${new Date().toISOString().slice(0, 10)}.json`;
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.type('application/json').send(JSON.stringify(data, null, 2));
}));

workspaceRouter.post('/workspace/delete', owners, ah(async (req, res) => {
  if (req.user.is_demo) throw new HttpError(403, 'The demo cannot be deleted.', { code: 'DEMO_READ_ONLY' });
  const { confirm_name: confirm } = validate(req.body, { confirm_name: { type: 'string', required: true, max: 200, label: 'Workspace name' } });
  if (confirm.trim().toLowerCase() !== String(req.user.organization_name).trim().toLowerCase()) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { confirm_name: 'Type the workspace name exactly as shown.' } });
  }
  const { deletion_scheduled_at: when } = await one(
    `UPDATE organizations SET deletion_scheduled_at = now() + make_interval(days => $2) WHERE organization_id = $1 RETURNING deletion_scheduled_at`,
    [req.user.organization_id, account.GRACE_DAYS]);
  await audit(null, req.user, 'workspace.deletion_requested', 'organization', req.user.organization_id, { delete_at: when });
  const date = new Date(when).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long' });
  await sendMail({
    to: req.user.email,
    subject: `Your BalayHub workspace "${req.user.organization_name}" will be deleted on ${date}`,
    text: `Hi ${req.user.full_name},\n\nYou asked to delete the workspace "${req.user.organization_name}". It is now view-only, and on ${date} all its data, files and team accounts will be permanently deleted.\n\nChanged your mind? Log in and click "Cancel deletion" in Settings before then: ${config.appUrl}/#/settings\n\n— BalayHub`,
  });
  res.json({ ok: true, deletion_scheduled_at: when });
}));

workspaceRouter.post('/workspace/delete/cancel', owners, ah(async (req, res) => {
  await query('UPDATE organizations SET deletion_scheduled_at = NULL WHERE organization_id = $1', [req.user.organization_id]);
  await audit(null, req.user, 'workspace.deletion_cancelled', 'organization', req.user.organization_id);
  res.json({ ok: true });
}));

module.exports = { router, workspaceRouter };
