'use strict';

// Account security and data rights: change password, export all data,
// delete the workspace (after a 14-day grace period).

const express = require('express');
const config = require('../config');
const { one, query } = require('../db');
const { HttpError, ah } = require('../lib/http');
const { validate } = require('../lib/validate');
const { audit } = require('../lib/audit');
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
  await query('UPDATE users SET password_hash = $2 WHERE user_id = $1', [req.user.user_id, await hashPassword(body.new_password)]);
  // Sign out every other device; keep this one.
  await query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.user_id, req.user.token_hash]);
  await query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL`, [req.user.user_id]);
  await audit(null, req.user, 'auth.password_changed', 'user', req.user.user_id);
  await sendMail({
    to: req.user.email,
    subject: 'Your BalayHub password was changed',
    text: `Hi ${req.user.full_name},\n\nThe password for your BalayHub account was just changed, and other devices were signed out.\n\nIf this wasn't you, reset your password now at ${config.appUrl}/#/forgot and contact your workspace owner.\n\n— BalayHub`,
  });
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
