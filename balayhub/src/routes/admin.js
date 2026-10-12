'use strict';

// Platform admin (you, the BalayHub operator): all workspaces, their plan and
// trial, and setting a plan after a customer pays. Also the public plan list.

const express = require('express');
const config = require('../config');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireAuth } = require('../lib/auth');
const { PLANS, PUBLIC_PLANS, planStatus } = require('../lib/plans');

const router = express.Router();

// Prices for the landing page.
router.get('/public/plans', (req, res) => {
  const contact = config.salesContactEmail || config.inboundAddress || ((/<([^>]+)>/.exec(config.mailFrom) || [])[1] || '');
  res.json({
    trial_days: config.trialDays,
    contact_email: contact.endsWith('.local') ? '' : contact,
    plans: PUBLIC_PLANS.map((k) => ({ key: k, name: PLANS[k].name, price: PLANS[k].price, listings: PLANS[k].listings, ai: PLANS[k].ai })),
  });
});

function platformAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    const ok = req.user.email_verified_at && config.platformAdmins.includes(String(req.user.email).toLowerCase());
    // Hidden from everyone else.
    return ok ? next() : next(notFound());
  });
}
router.use('/admin', platformAdmin);

router.get('/admin/workspaces', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT o.organization_id, o.name, o.business_type, o.plan, o.trial_ends_at, o.paid_until, o.plan_note, o.is_demo, o.created_at,
            ow.full_name AS owner_name, ow.email AS owner_email,
            (SELECT COUNT(*) FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = o.organization_id
               AND u.status = 'active' AND p.status = 'active') AS unit_count,
            (SELECT COUNT(*) FROM users x WHERE x.organization_id = o.organization_id AND x.account_status = 'active') AS member_count,
            (SELECT MAX(s.last_seen_at) FROM sessions s JOIN users x USING (user_id) WHERE x.organization_id = o.organization_id) AS last_active_at
       FROM organizations o
       LEFT JOIN LATERAL (SELECT full_name, email FROM users WHERE organization_id = o.organization_id AND role = 'owner' ORDER BY created_at LIMIT 1) ow ON true
      ORDER BY o.created_at DESC LIMIT 1000`);
  res.json({ workspaces: rows.map((w) => ({ ...w, status: planStatus(w) })), plans: Object.entries(PLANS).map(([k, p]) => ({ key: k, ...p })) });
}));

router.patch('/admin/workspaces/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const org = await one('SELECT * FROM organizations WHERE organization_id = $1', [id]);
  if (!org) throw notFound();
  if (org.is_demo) throw new HttpError(409, 'The demo workspace cannot be changed.', { code: 'DEMO' });
  const body = validate(req.body, {
    plan: { type: 'enum', values: Object.keys(PLANS), label: 'Plan' },
    paid_until: { type: 'date', label: 'Paid until' },
    trial_ends_at: { type: 'date', label: 'Trial ends' },
    plan_note: { type: 'text', max: 1000, label: 'Note' },
  }, { partial: true });
  const sets = []; const params = [id];
  const set = (sql, v) => { params.push(v); sets.push(sql.replace('$$', `$${params.length}`)); };
  if (body.plan) set('plan = $$', body.plan);
  if ('paid_until' in body) set('paid_until = $$', body.paid_until);
  // A trial end date means the end of that day in Manila.
  if ('trial_ends_at' in body) set(`trial_ends_at = ($$::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'`, body.trial_ends_at);
  if ('plan_note' in body) set('plan_note = $$', body.plan_note);
  if (sets.length) {
    await query(`UPDATE organizations SET ${sets.join(', ')} WHERE organization_id = $1`, params);
    await audit(null, { organization_id: id, user_id: req.user.user_id }, 'platform.plan_changed', 'organization', id, { before: { plan: org.plan, paid_until: org.paid_until }, after: body });
  }
  res.json({ ok: true });
}));

module.exports = router;
