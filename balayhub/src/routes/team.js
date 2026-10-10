'use strict';

const express = require('express');
const config = require('../config');
const { query, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { sendMail } = require('../lib/mailer');
const { requireRole, newToken, hashToken } = require('../lib/auth');

const router = express.Router();
const ownerOnly = requireRole('owner');

async function validPropertyIds(orgId, ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    'SELECT property_id FROM properties WHERE organization_id = $1 AND property_id = ANY($2)', [orgId, ids]);
  if (rows.length !== ids.length) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { property_ids: 'One or more selected properties were not found.' } });
  }
  return ids;
}

router.get('/team', ownerOnly, ah(async (req, res) => {
  const org = req.user.organization_id;
  const { rows: members } = await query(
    `SELECT u.user_id, u.full_name, u.email, u.role, u.created_at,
            COALESCE(array_agg(pa.property_id) FILTER (WHERE pa.property_id IS NOT NULL), '{}') AS property_ids
       FROM users u LEFT JOIN property_assignments pa ON pa.user_id = u.user_id
      WHERE u.organization_id = $1 AND u.account_status = 'active'
      GROUP BY u.user_id ORDER BY (u.role = 'owner') DESC, u.full_name`, [org]);
  const { rows: invitations } = await query(
    `SELECT invitation_id, email, role, property_ids, expires_at, created_at FROM invitations
      WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC`, [org]);
  res.json({ members, invitations });
}));

router.post('/team/invitations', ownerOnly, ah(async (req, res) => {
  const body = validate(req.body, {
    email: { type: 'email', required: true, label: 'Email' },
    role: { type: 'enum', values: ['manager', 'staff'], required: true, label: 'Role' },
    property_ids: { type: 'uuids', label: 'Properties' },
  });
  const org = req.user.organization_id;
  const propertyIds = await validPropertyIds(org, body.property_ids);
  const existing = await query('SELECT organization_id FROM users WHERE lower(email) = $1', [body.email]);
  if (existing.rowCount) {
    throw new HttpError(409, 'This email already has a BalayHub account. Team members must use a separate email for each workspace in this version.', { code: 'EMAIL_TAKEN', fields: { email: 'Already registered.' } });
  }
  const token = newToken();
  const invite = await tx(async (db) => {
    await db.query(`UPDATE invitations SET revoked_at = now()
                     WHERE organization_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND revoked_at IS NULL`, [org, body.email]);
    const { rows: [i] } = await db.query(
      `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, property_ids, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days')
       RETURNING invitation_id, email, role, property_ids, expires_at`,
      [org, body.email, body.role, hashToken(token), req.user.user_id, propertyIds]);
    await audit(db, req.user, 'member.invited', 'invitation', i.invitation_id, { email: body.email, role: body.role });
    return i;
  });
  const link = `${config.appUrl}/#/signup?invite=${encodeURIComponent(token)}`;
  const mail = await sendMail({
    to: body.email,
    subject: `You're invited to ${req.user.organization_name} on BalayHub`,
    text: `${req.user.full_name} invited you to help manage rental properties on BalayHub as a ${body.role}.\n\nAccept the invitation:\n${link}\n\nThis link expires in 7 days.`,
  });
  // The owner can copy the link and send it directly if email isn't configured.
  res.status(201).json({ invitation: invite, inviteLink: link, emailed: mail.delivered });
}));

router.post('/team/invitations/:id/revoke', ownerOnly, ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const { rowCount } = await query(
    `UPDATE invitations SET revoked_at = now() WHERE invitation_id = $1 AND organization_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [id, req.user.organization_id]);
  if (!rowCount) throw notFound();
  await audit(null, req.user, 'member.invite_revoked', 'invitation', id);
  res.json({ ok: true });
}));

async function loadMember(req) {
  const id = uuidParam(req.params.id);
  const { rows: [m] } = await query(
    `SELECT user_id, role FROM users WHERE user_id = $1 AND organization_id = $2 AND account_status = 'active'`,
    [id, req.user.organization_id]);
  if (!m) throw notFound();
  if (m.role === 'owner') throw new HttpError(400, "The workspace owner's access can't be changed here.", { code: 'OWNER_LOCKED' });
  return m;
}

router.patch('/team/members/:id', ownerOnly, ah(async (req, res) => {
  const member = await loadMember(req);
  const body = validate(req.body, {
    role: { type: 'enum', values: ['manager', 'staff'], label: 'Role' },
    property_ids: { type: 'uuids', label: 'Properties' },
  }, { partial: true });
  const org = req.user.organization_id;
  await tx(async (db) => {
    if (body.role) await db.query('UPDATE users SET role = $1 WHERE user_id = $2', [body.role, member.user_id]);
    if (body.property_ids) {
      const ids = await validPropertyIds(org, body.property_ids);
      await db.query('DELETE FROM property_assignments WHERE user_id = $1', [member.user_id]);
      if (ids.length) {
        await db.query('INSERT INTO property_assignments (user_id, property_id) SELECT $1, unnest($2::uuid[])', [member.user_id, ids]);
      }
    }
    await audit(db, req.user, 'member.updated', 'user', member.user_id, body);
  });
  res.json({ ok: true });
}));

// Revoke access immediately: detach from the workspace and end all sessions.
router.post('/team/members/:id/remove', ownerOnly, ah(async (req, res) => {
  const member = await loadMember(req);
  await tx(async (db) => {
    await db.query('DELETE FROM property_assignments WHERE user_id = $1', [member.user_id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [member.user_id]);
    await db.query(`UPDATE users SET account_status = 'revoked' WHERE user_id = $1`, [member.user_id]);
    await audit(db, req.user, 'member.removed', 'user', member.user_id);
  });
  res.json({ ok: true });
}));

// Owners see the full audit trail; managers see their own actions.
router.get('/audit', requireRole('owner', 'manager'), ah(async (req, res) => {
  const params = [req.user.organization_id];
  let where = 'a.organization_id = $1';
  if (req.user.role !== 'owner') { params.push(req.user.user_id); where += ` AND a.actor_user_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT a.audit_id, a.action, a.record_type, a.record_id, a.details, a.created_at, u.full_name AS actor_name
       FROM audit_logs a LEFT JOIN users u ON u.user_id = a.actor_user_id
      WHERE ${where} ORDER BY a.created_at DESC LIMIT 200`, params);
  res.json({ entries: rows });
}));

module.exports = router;
