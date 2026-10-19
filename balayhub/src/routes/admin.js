'use strict';

// Platform admin (you, the BalayHub operator): all workspaces, their plan and
// trial, and setting a plan after a customer pays. Also the public plan list,
// and the plan coupons a workspace owner can type at checkout.

const express = require('express');
const config = require('../config');
const { query, one, pool, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { own } = require('../lib/pick');
const { validate, uuidParam, isValidDate } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireAuth } = require('../lib/auth');
const { PLANS, PUBLIC_PLANS, planStatus } = require('../lib/plans');
const { normalizeCode, CODE_RE, couponState, toCentavos, toPesos } = require('../lib/coupons');
const { fmtPeso } = require('../lib/messaging');

const router = express.Router();

// Prices for the landing page.
router.get('/public/plans', (req, res) => {
  const contact = config.salesContactEmail || config.inboundAddress || ((/<([^>]+)>/.exec(config.mailFrom) || [])[1] || '');
  res.json({
    trial_days: config.trialDays,
    contact_email: contact.endsWith('.local') ? '' : contact,
    online_payments: Boolean(config.paymongoSecretKey),
    card_check: require('../lib/cardcheck').enabled(),
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
  if (st.reason === 'card_check') return 'card_pending';
  if (st.reason === 'deleting') return 'deleting';
  if (st.reason === 'trial_ended') return 'trial_ended';
  if (st.reason === 'payment_due') return 'overdue';
  if (st.reason === 'grace') return 'grace';
  if (st.plan === 'trial') return 'trial';
  if (st.plan === 'comped') return 'comped';
  return 'paying';
}
const ADMIN_STATUS = ['trial', 'paying', 'grace', 'trial_ended', 'overdue', 'comped', 'deleting', 'demo', 'card_pending'];
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
            o.card_check, o.card_brand, o.card_last4,
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
  if (own(PLANS, q.plan)) list = list.filter((w) => w.plan === q.plan);
  if (BUSINESS_TYPES.includes(q.business_type)) list = list.filter((w) => w.business_type === q.business_type);
  if (isValidDate(q.created_from)) list = list.filter((w) => w.created_day >= q.created_from);
  if (isValidDate(q.created_to)) list = list.filter((w) => w.created_day <= q.created_to);
  if (own(ADMIN_SORTS, q.sort)) list = [...list].sort(own(ADMIN_SORTS, q.sort));
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

// Skip the card check for a workspace the founder invited by hand: starts the trial now.
router.post('/admin/workspaces/:id/card-check', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  validate(req.body, { action: { type: 'enum', values: ['waive'], label: 'Action', required: true } });
  const org = await one('SELECT is_demo FROM organizations WHERE organization_id = $1', [id]);
  if (!org) throw notFound();
  if (org.is_demo) throw new HttpError(409, 'The demo workspace cannot be changed.', { code: 'DEMO' });
  const r = await require('../lib/cardcheck').waive(id, req.user);
  res.json({ ok: true, trial_ends_at: r.trial_ends_at });
}));

// ---- Plan coupons (D-94). The rules for using a coupon are in src/lib/coupons.js; these routes list, create,
// edit and switch off the coupons, and show who redeemed each one.

const COUPON_KINDS = ['percent', 'fixed', 'free'];
const COUPON_DURATIONS = ['once', 'months', 'forever'];
const COUPON_STATES = ['active', 'scheduled', 'ended', 'off', 'full'];
// Once a coupon is used, these can't change: the people already on it were promised this discount.
const COUPON_LOCKED = ['code', 'kind', 'percent_off', 'amount_off', 'duration', 'duration_months', 'plans', 'starts_on', 'starts_time'];
const COUPON_SORTS = {
  newest: (a, b) => b.created_at - a.created_at,
  oldest: (a, b) => a.created_at - b.created_at,
  code: (a, b) => a.code.localeCompare(b.code),
  ending: (a, b) => (a.ends_at || Infinity) - (b.ends_at || Infinity),
  most_used: (a, b) => b.used - a.used,
};

// The coupon's columns, plus its live counts: redemptions holding a slot on the limit, and what paid checkouts took off.
const COUPON_SQL = `SELECT c.*,
    (SELECT COUNT(*)::int FROM platform_coupon_redemptions r WHERE r.coupon_id = c.coupon_id
       AND (r.status IN ('active', 'used_up') OR (r.status = 'pending' AND r.created_at > now() - interval '2 days'))) AS used,
    (SELECT COALESCE(SUM(b.discount_amount), 0)::numeric(12,2) FROM billing_payments b
       JOIN platform_coupon_redemptions r ON r.redemption_id = b.coupon_redemption_id
      WHERE r.coupon_id = c.coupon_id AND b.status = 'paid') AS discount_total
  FROM platform_coupons c`;

// A coupon as the API returns it (the creator's id stays in the database).
const couponOut = (row) => {
  const { created_by: _by, used, discount_total, ...coupon } = row;
  return { ...coupon, state: couponState(row, used), used, discount_total };
};
async function loadCoupon(db, id) {
  const { rows: [row] } = await db.query(`${COUPON_SQL} WHERE c.coupon_id = $1`, [id]);
  return row ? couponOut(row) : null;
}

// Manila is UTC+8 all year, so its wall-clock time needs no zone library.
const manilaWall = (t) => new Date(new Date(t).getTime() + 8 * 3600 * 1000).toISOString();
const manilaDay = (t) => manilaWall(t).slice(0, 10);
const manilaClock = (t) => manilaWall(t).slice(11, 16);

// A stored coupon as form values, so an edit is checked as a whole coupon, the way a create is.
const couponForm = (c) => ({
  name: c.name, code: c.code, kind: c.kind, percent_off: c.percent_off, amount_off: c.amount_off,
  duration: c.duration, duration_months: c.duration_months, plans: c.plans, max_redemptions: c.max_redemptions,
  once_per_workspace: c.once_per_workspace, require_card: c.require_card,
  starts_on: manilaDay(c.starts_at), starts_time: manilaClock(c.starts_at),
  ends_on: c.ends_at ? manilaDay(c.ends_at) : null, ends_time: c.ends_at ? manilaClock(c.ends_at) : '23:59',
  note: c.note, active: c.active,
});

// Fields that don't fit the kind or duration are cleared, so they are never stored.
function couponInput(raw) {
  const input = { ...raw };
  if (input.kind !== 'percent') input.percent_off = null;
  if (input.kind !== 'fixed') input.amount_off = null;
  if (input.duration !== 'months') input.duration_months = null;
  return input;
}

function couponSpec(input) {
  return {
    name: { type: 'string', max: 100, required: true, label: 'Name' },
    code: { type: 'string', max: 64, required: true, label: 'Code' },
    kind: { type: 'enum', values: COUPON_KINDS, required: true, label: 'Kind' },
    percent_off: { type: 'int', min: 1, max: 99, required: input.kind === 'percent', label: 'Percent off' },
    amount_off: { type: 'money', positive: true, required: input.kind === 'fixed', label: 'Amount off' },
    duration: { type: 'enum', values: COUPON_DURATIONS, required: true, label: 'Duration' },
    duration_months: { type: 'int', min: 2, max: 36, required: input.duration === 'months', label: 'Number of months' },
    max_redemptions: { type: 'int', min: 1, max: 100000, label: 'Limit' },
    once_per_workspace: { type: 'bool' },
    require_card: { type: 'bool' },
    starts_on: { type: 'date', required: true, label: 'Start date' },
    starts_time: { type: 'time', label: 'Start time' },
    ends_on: { type: 'date', label: 'End date' },
    ends_time: { type: 'time', label: 'End time' },
    active: { type: 'bool' },
    note: { type: 'text', max: 1000, label: 'Note' },
  };
}

// The rules validate() has no type for: the code's shape, the plan list, the end after the start, and the limit
// against the times already used. Cleaned values (the code in capitals, the plan list, default times) go back onto `out`.
const couponChecks = (input, used) => (out) => {
  const errs = {};
  if (typeof out.code === 'string') {
    out.code = normalizeCode(out.code);
    if (!CODE_RE.test(out.code)) errs.code = 'Use 3 to 32 letters, numbers or dashes.';
  }
  const listed = input.plans ?? [];
  const picked = Array.isArray(listed) ? listed.map((p) => String(p).trim().toLowerCase()) : listed;
  if (!Array.isArray(picked) || !picked.every((p) => PUBLIC_PLANS.includes(p))) errs.plans = 'Plans must be Starter, Growth or Pro.';
  else out.plans = picked.length ? PUBLIC_PLANS.filter((p) => picked.includes(p)) : null; // stored in one fixed order, so a resave writes the same list
  out.starts_time = out.starts_time || '00:00';
  out.ends_time = (out.ends_on && out.ends_time) || '23:59';
  if (out.starts_on && out.ends_on && `${out.ends_on} ${out.ends_time}` <= `${out.starts_on} ${out.starts_time}`) {
    errs.ends_on = 'The end must be after the start.';
  }
  if (out.max_redemptions && out.max_redemptions < used) {
    errs.max_redemptions = `The limit can't be below the ${used} ${used === 1 ? 'time' : 'times'} it has been used.`;
  }
  return errs;
};

function couponFields(raw, used) {
  const input = couponInput(raw);
  return validate(input, couponSpec(input), { check: couponChecks(input, used) });
}

// Same stored value? The form sends the locked values back as they are, so a resend must not count as a change:
// codes compare after normalizeCode, money in centavos, plan lists as sets of plan names (any order, any case).
const planSet = (list) => list.map((p) => String(p).toLowerCase()).sort().join();
const sameValue = (k, a, b) => {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (k === 'code') return normalizeCode(a) === normalizeCode(b);
  if (k === 'amount_off') return toCentavos(a) === toCentavos(b);
  if (Array.isArray(a) && Array.isArray(b)) return planSet(a) === planSet(b);
  return a === b;
};

// A fixed amount above the highest plan price would make that plan free, so the server asks first (D-99, O9). It asks for
// a new coupon, or an edit that changes the amount or the kind. The confirm flag is read here and never stored.
const MAX_PLAN_C = Math.max(...PUBLIC_PLANS.map((p) => PLANS[p].price)) * 100;
function askHighAmount(f, before, body) {
  if (f.kind !== 'fixed' || toCentavos(f.amount_off) <= MAX_PLAN_C || body.confirm_high_amount === true) return;
  const moved = !before || !sameValue('amount_off', before.amount_off, f.amount_off) || !sameValue('kind', before.kind, f.kind);
  if (!moved) return;
  const msg = `This is more than the highest plan price (${fmtPeso(toPesos(MAX_PLAN_C))}), so the plan would be free.`;
  throw new HttpError(409, msg, { code: 'AMOUNT_ABOVE_PLAN', fields: { amount_off: msg }, max_plan_price: toPesos(MAX_PLAN_C) });
}

// Columns in the order the INSERT and UPDATE below use them. The times are Manila wall-clock, so the database makes them UTC.
const couponParams = (f) => [f.code, f.name, f.kind, f.percent_off, f.amount_off, f.duration, f.duration_months, f.plans,
  f.max_redemptions, f.once_per_workspace, f.require_card, f.starts_on, f.starts_time, f.ends_on, f.ends_time, f.active, f.note];
const COUPON_INSERT = `INSERT INTO platform_coupons (code, name, kind, percent_off, amount_off, duration, duration_months, plans, max_redemptions,
    once_per_workspace, require_card, starts_at, ends_at, active, note, created_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ($12::date + $13::time) AT TIME ZONE 'Asia/Manila',
    ($14::date + $15::time) AT TIME ZONE 'Asia/Manila', $16, $17, $18)
  RETURNING coupon_id`;
// $19 and $20 say whether the start and end Manila minute changed. When they did not, the stored instant (seconds and all) is kept.
const COUPON_UPDATE = `UPDATE platform_coupons SET code = $1, name = $2, kind = $3, percent_off = $4, amount_off = $5, duration = $6,
    duration_months = $7, plans = $8, max_redemptions = $9, once_per_workspace = $10, require_card = $11,
    starts_at = CASE WHEN $19 THEN ($12::date + $13::time) AT TIME ZONE 'Asia/Manila' ELSE starts_at END,
    ends_at = CASE WHEN $20 THEN ($14::date + $15::time) AT TIME ZONE 'Asia/Manila' ELSE ends_at END,
    active = $16, note = $17, updated_at = now()
  WHERE coupon_id = $18`;

// The unique index on code: a code another coupon uses is a 409, not a server error.
const codeTaken = (err) => (err.code === '23505' && err.constraint === 'platform_coupons_code_uq'
  ? new HttpError(409, 'Another coupon already uses this code.', { code: 'CODE_TAKEN' }) : err);

// Filters: text (code or name), state, kind and plan (a coupon with no plan list covers every paid plan), then sort.
// `summary` counts every coupon and totals what they took off, whatever the filters.
router.get('/admin/coupons', ah(async (req, res) => {
  const q = req.query;
  const all = (await query(`${COUPON_SQL} ORDER BY c.created_at DESC`)).rows.map(couponOut);
  const summary = {
    ...Object.fromEntries(COUPON_STATES.map((k) => [k, all.filter((c) => c.state === k).length])),
    discount_total: toPesos(all.reduce((s, c) => s + toCentavos(c.discount_total), 0)),
  };
  const needle = q.q ? String(q.q).slice(0, 100).toLowerCase() : '';
  let list = all.filter((c) => !needle || `${c.code} ${c.name}`.toLowerCase().includes(needle));
  if (COUPON_STATES.includes(q.state)) list = list.filter((c) => c.state === q.state);
  if (COUPON_KINDS.includes(q.kind)) list = list.filter((c) => c.kind === q.kind);
  if (PUBLIC_PLANS.includes(q.plan)) list = list.filter((c) => !c.plans || c.plans.includes(q.plan));
  list.sort(own(COUPON_SORTS, q.sort) || COUPON_SORTS.newest);
  res.json({ coupons: list, total: all.length, summary });
}));

router.post('/admin/coupons', ah(async (req, res) => {
  const f = couponFields({ once_per_workspace: true, ...req.body, active: true }, 0);
  askHighAmount(f, null, req.body);
  let row;
  try {
    row = (await query(COUPON_INSERT, [...couponParams(f), req.user.user_id])).rows[0];
  } catch (err) {
    throw codeTaken(err);
  }
  await audit(null, { organization_id: null, user_id: req.user.user_id }, 'platform.coupon_created', 'platform_coupon', row.coupon_id,
    { code: f.code, kind: f.kind, duration: f.duration });
  res.status(201).json({ coupon: await loadCoupon(pool, row.coupon_id) });
}));

// An edit is checked as the whole coupon. The coupon row is locked first, so a checkout taking a slot at this moment
// waits for the edit (reserve() in src/lib/coupons.js locks the same row).
router.patch('/admin/coupons/:id', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const coupon = await tx(async (db) => {
    const { rows: locked } = await db.query('SELECT 1 FROM platform_coupons WHERE coupon_id = $1 FOR UPDATE', [id]);
    if (!locked.length) throw notFound();
    const { rows: [before] } = await db.query(`${COUPON_SQL} WHERE c.coupon_id = $1`, [id]);
    const form = couponForm(before);
    const after = couponFields({ ...form, ...req.body }, before.used);
    const changed = Object.keys(form).filter((k) => !sameValue(k, form[k], after[k]));
    if (changed.length) {
      // Any redemption that was not released counts, even one that has since expired or been used up.
      const redeemed = (await db.query(
        `SELECT EXISTS (SELECT 1 FROM platform_coupon_redemptions WHERE coupon_id = $1 AND status <> 'released') AS redeemed`, [id])).rows[0].redeemed;
      if (redeemed && changed.some((k) => COUPON_LOCKED.includes(k))) {
        throw new HttpError(409, "This coupon has been used, so its discount can't change. Make a new coupon instead.", { code: 'COUPON_LOCKED' });
      }
      askHighAmount(after, form, req.body);
      const startsChanged = changed.some((k) => k === 'starts_on' || k === 'starts_time');
      const endsChanged = changed.some((k) => k === 'ends_on' || k === 'ends_time');
      try {
        await db.query(COUPON_UPDATE, [...couponParams(after), id, startsChanged, endsChanged]);
      } catch (err) {
        throw codeTaken(err);
      }
      const switched = changed.length === 1 && changed[0] === 'active';
      const action = switched ? (after.active ? 'platform.coupon_switched_on' : 'platform.coupon_switched_off') : 'platform.coupon_updated';
      await audit(db, { organization_id: null, user_id: req.user.user_id }, action, 'platform_coupon', id,
        switched ? { code: after.code } : { code: after.code, changed });
    }
    return loadCoupon(db, id);
  });
  res.json({ coupon });
}));

// Who redeemed a coupon, newest first: the workspace, its owner, the months it has used, and what its paid checkouts took off.
router.get('/admin/coupons/:id/redemptions', ah(async (req, res) => {
  const id = uuidParam(req.params.id);
  const coupon = await loadCoupon(pool, id);
  if (!coupon) throw notFound();
  const { rows } = await query(
    `SELECT r.redemption_id, r.organization_id, o.name AS workspace_name,
            (SELECT u.email FROM users u WHERE u.organization_id = r.organization_id AND u.role = 'owner' ORDER BY u.created_at LIMIT 1) AS owner_email,
            r.status, r.months_total, r.months_used, r.created_at, r.activated_at,
            (SELECT COALESCE(SUM(b.discount_amount), 0)::numeric(12,2) FROM billing_payments b
              WHERE b.coupon_redemption_id = r.redemption_id AND b.status = 'paid') AS discount_total,
            (SELECT COUNT(*)::int FROM billing_payments b WHERE b.coupon_redemption_id = r.redemption_id AND b.status = 'paid') AS payments
       FROM platform_coupon_redemptions r
       JOIN organizations o ON o.organization_id = r.organization_id
      WHERE r.coupon_id = $1
      ORDER BY r.created_at DESC LIMIT 500`, [id]);
  res.json({ coupon, redemptions: rows });
}));

module.exports = router;
