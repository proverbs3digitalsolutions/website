'use strict';

// Platform admin (you, the BalayHub operator): all workspaces, their plan and
// trial, and setting a plan after a customer pays. Also the public plan list.

const express = require('express');
const config = require('../config');
const { query, one } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam, isValidDate } = require('../lib/validate');
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
    online_payments: Boolean(config.paymongoSecretKey),
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

// Status of a workspace for the admin filter (from planStatus).
function adminStatus(w) {
  const st = w.status;
  if (w.is_demo) return 'demo';
  if (st.reason === 'deleting') return 'deleting';
  if (st.reason === 'trial_ended') return 'trial_ended';
  if (st.reason === 'payment_due') return 'overdue';
  if (st.reason === 'grace') return 'grace';
  if (st.plan === 'trial') return 'trial';
  if (st.plan === 'comped') return 'comped';
  return 'paying';
}
const ADMIN_STATUS = ['trial', 'paying', 'grace', 'trial_ended', 'overdue', 'comped', 'deleting', 'demo'];
const BUSINESS_TYPES = ['short_term', 'long_term', 'both'];
const ADMIN_SORTS = {
  newest: (a, b) => b.created_at - a.created_at,
  oldest: (a, b) => a.created_at - b.created_at,
  name: (a, b) => a.name.localeCompare(b.name),
  active: (a, b) => (b.last_active_at || 0) - (a.last_active_at || 0),
  units: (a, b) => Number(b.unit_count) - Number(a.unit_count),
  paid_until: (a, b) => String(a.paid_until || '9999').localeCompare(String(b.paid_until || '9999')),
  trial_ends: (a, b) => (a.trial_ends_at || Infinity) - (b.trial_ends_at || Infinity),
};

// Filters: search (workspace, owner name or email), status (computed from the
// plan dates, so filtered here), plan, business type, created date range
// (Manila), sort. `summary` always counts every workspace.
router.get('/admin/workspaces', ah(async (req, res) => {
  const q = req.query;
  const { rows } = await query(
    `SELECT o.organization_id, o.name, o.business_type, o.plan, o.trial_ends_at, o.paid_until, o.plan_note, o.is_demo, o.created_at, o.deletion_scheduled_at,
            ow.full_name AS owner_name, ow.email AS owner_email,
            (SELECT COUNT(*) FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = o.organization_id
               AND u.status = 'active' AND p.status = 'active') AS unit_count,
            (SELECT COUNT(*) FROM users x WHERE x.organization_id = o.organization_id AND x.account_status = 'active') AS member_count,
            (SELECT MAX(s.last_seen_at) FROM sessions s JOIN users x USING (user_id) WHERE x.organization_id = o.organization_id) AS last_active_at,
            (o.created_at AT TIME ZONE 'Asia/Manila')::date::text AS created_day
       FROM organizations o
       LEFT JOIN LATERAL (SELECT full_name, email FROM users WHERE organization_id = o.organization_id AND role = 'owner' ORDER BY created_at LIMIT 1) ow ON true
      ORDER BY o.created_at DESC LIMIT 1000`);
  const all = rows.map((w) => { const x = { ...w, status: planStatus(w) }; x.admin_status = adminStatus(x); return x; });
  const summary = Object.fromEntries(ADMIN_STATUS.map((k) => [k, all.filter((w) => w.admin_status === k).length]));
  const needle = q.q ? String(q.q).slice(0, 100).toLowerCase() : '';
  let list = all.filter((w) => !needle || `${w.name} ${w.owner_email || ''} ${w.owner_name || ''}`.toLowerCase().includes(needle));
  if (ADMIN_STATUS.includes(q.status)) list = list.filter((w) => w.admin_status === q.status);
  if (PLANS[q.plan]) list = list.filter((w) => w.plan === q.plan);
  if (BUSINESS_TYPES.includes(q.business_type)) list = list.filter((w) => w.business_type === q.business_type);
  if (isValidDate(q.created_from)) list = list.filter((w) => w.created_day >= q.created_from);
  if (isValidDate(q.created_to)) list = list.filter((w) => w.created_day <= q.created_to);
  if (ADMIN_SORTS[q.sort]) list = [...list].sort(ADMIN_SORTS[q.sort]);
  res.json({
    workspaces: list.map(({ deletion_scheduled_at: _d, created_day: _c, ...w }) => w),
    total: all.length, summary,
    mrr: all.filter((w) => w.admin_status === 'paying' || w.admin_status === 'grace').reduce((s, w) => s + (PLANS[w.plan]?.price || 0), 0),
    plans: Object.entries(PLANS).map(([k, p]) => ({ key: k, ...p })),
  });
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
