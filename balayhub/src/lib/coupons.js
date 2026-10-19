'use strict';

// Platform plan coupons (D-94): discounts on BalayHub's own plans, paid through the one-time PayMongo checkout.
// The hosts' guest codes are discount_codes (src/lib/discounts.js), a different thing.
// Money is worked out in whole centavos (integers); the database keeps NUMERIC pesos.

const config = require('../config');
const { PLANS } = require('./plans');
const { HttpError } = require('./http');
const { audit } = require('./audit');

const MIN_CHARGE_C = 2000; // ₱20, the smallest charge we take (research R1)
const CODE_RE = /^[A-Z0-9-]{3,32}$/;
const INVALID_MSG = "This code isn't valid right now. Check it and try again.";
const USED_MSG = 'Your workspace has already used this code.';
const fail = (status, code, message, extra = {}) => new HttpError(status, message, { code, ...extra });

const normalizeCode = (raw) => String(raw ?? '').replace(/\s+/g, '').toUpperCase();

// "499.50" to 49950. Integer maths only: never parseFloat or multiply peso text.
function toCentavos(v) {
  const [whole, frac = ''] = String(v).split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
const toPesos = (c) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
const peso = (c) => (c % 100 === 0 ? `₱${c / 100}` : `₱${toPesos(c)}`);

const monthsTotal = (k) => (k.duration === 'once' ? 1 : k.duration === 'months' ? Number(k.duration_months) : null);

// Months a checkout covers: every month for forever, otherwise the months bought or the months left, whichever is less.
const coveredMonths = (k, left, months) => (k.duration === 'forever' ? months : Math.max(0, Math.min(months, left ?? months)));

// What one checkout costs with a coupon. `covered` of the `months` bought get it.
function priceWithCoupon({ listC, months, covered, coupon }) {
  const applies = Boolean(coupon) && covered > 0;
  let discountC = 0;
  if (applies) {
    const coveredC = Math.round((listC * covered) / months); // what the covered months cost at list
    if (coupon.kind === 'percent') discountC = Math.round((listC * covered * coupon.percent_off) / (months * 100));
    else if (coupon.kind === 'fixed') discountC = Math.min(covered * toCentavos(coupon.amount_off), coveredC);
    else discountC = coveredC; // free
  }
  let amountC = listC - discountC;
  const cardOnly = applies && Boolean(coupon.require_card);
  let minChargeApplied = false;
  if ((amountC > 0 && amountC < MIN_CHARGE_C) || (amountC === 0 && cardOnly)) {
    amountC = MIN_CHARGE_C;
    discountC = listC - amountC;
    minChargeApplied = true;
  }
  return { listC, discountC, amountC, free: amountC === 0, cardOnly, minChargeApplied };
}

function couponState(row, used, now = new Date()) {
  if (!row.active) return 'off';
  if (new Date(row.starts_at) > now) return 'scheduled';
  if (row.ends_at && new Date(row.ends_at) <= now) return 'ended';
  if (row.max_redemptions && used >= row.max_redemptions) return 'full';
  return 'active';
}

// Plain words for what the coupon takes off and for how long, e.g. "50% off your first 3 months.".
function describe(coupon) {
  const when = coupon.duration === 'once' ? 'your first month'
    : coupon.duration === 'months' ? `your first ${coupon.duration_months} months` : 'every month';
  if (coupon.kind === 'free') return `Free for ${when}.`;
  const off = coupon.kind === 'percent' ? `${coupon.percent_off}%` : peso(toCentavos(coupon.amount_off));
  return `${off} off ${when}.`;
}

const planList = (plans) => {
  const names = plans.map((p) => PLANS[p].name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
};
const usedUpMsg = (total) => `Your coupon's ${total} ${total === 1 ? 'month is' : 'months are'} used. This payment is the full price.`;

// Full list price in centavos. billing.js requires this module, so its price table is read when called, not at load.
function listCentavos(plan, months) {
  return Math.round(require('./billing').price(plan, months) * 100);
}

// Redemptions that hold a slot on the coupon's limit: active, used up, or pending for under two days.
async function usedCount(db, couponId) {
  const { rows: [r] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM platform_coupon_redemptions
      WHERE coupon_id = $1
        AND (status IN ('active', 'used_up') OR (status = 'pending' AND created_at > now() - interval '2 days'))`,
    [couponId]);
  return r.n;
}

const REDEMPTION_SQL = `SELECT c.*, r.redemption_id, r.status, r.months_total, r.months_used, r.activated_at
  FROM platform_coupon_redemptions r JOIN platform_coupons c ON c.coupon_id = r.coupon_id
  WHERE r.organization_id = $1 AND`;

// The workspace's redemption that still has months to give (pending or active), with its coupon's fields.
async function liveRedemption(db, orgId) {
  const { rows: [r] } = await db.query(`${REDEMPTION_SQL} r.status IN ('pending', 'active') ORDER BY r.created_at DESC LIMIT 1`, [orgId]);
  return r || null;
}

// The workspace's latest redemption that was not released (used up or still live).
async function lastRedemption(db, orgId) {
  const { rows: [r] } = await db.query(`${REDEMPTION_SQL} r.status <> 'released' ORDER BY r.created_at DESC LIMIT 1`, [orgId]);
  return r || null;
}

// Months that checkouts still pending (under two days old) have already claimed on a redemption.
async function claimedMonths(db, redemptionId) {
  const { rows: [r] } = await db.query(
    `SELECT COALESCE(SUM(coupon_months), 0)::int AS n FROM billing_payments
      WHERE coupon_redemption_id = $1 AND status = 'pending' AND created_at > now() - interval '2 days'`,
    [redemptionId]);
  return r.n;
}

// What a checkout for this workspace gets. `org` needs organization_id, plan and is_demo.
// Throws HttpError with the codes in the platform coupons contract. Every reason a code can't be used answers COUPON_INVALID,
// except the workspace's own (COUPON_USED, COUPON_OTHER, COUPON_PLAN, CARD_OFF).
async function resolve(db, { org, code, plan, months }) {
  if (org.is_demo) throw fail(409, 'COMPED', "The demo workspace can't use coupons.");
  if (org.plan === 'comped') throw fail(409, 'COMPED', "Your workspace is on a complimentary plan, so coupons don't apply.");
  const n = Number(months);
  const typed = normalizeCode(code);
  if (typed && !CODE_RE.test(typed)) {
    const code = typed.length > 32 ? 'Codes are up to 32 characters.' : 'Enter the code using letters, numbers and dashes.';
    throw fail(400, 'VALIDATION', 'Please check the highlighted fields.', { fields: { code } });
  }
  const live = await liveRedemption(db, org.organization_id);
  let coupon = null;
  let source = null;
  if (typed) {
    const { rows: [found] } = await db.query('SELECT * FROM platform_coupons WHERE code = $1', [typed]);
    // A workspace that already holds this coupon keeps its remaining months, even after the coupon ends or is switched off.
    if (found && live?.coupon_id === found.coupon_id) {
      coupon = live;
      source = 'redeemed';
    } else {
      if (!found || couponState(found, await usedCount(db, found.coupon_id)) !== 'active') throw fail(400, 'COUPON_INVALID', INVALID_MSG);
      const { rows: [earlier] } = await db.query(
        `SELECT 1 FROM platform_coupon_redemptions WHERE coupon_id = $1 AND organization_id = $2 AND status <> 'released' LIMIT 1`,
        [found.coupon_id, org.organization_id]);
      if (found.once_per_workspace && earlier) throw fail(409, 'COUPON_USED', USED_MSG);
      if (live) throw fail(409, 'COUPON_OTHER', `Your workspace is already using the coupon ${live.code}. It applies until its months are used.`);
      coupon = found;
      source = 'new';
    }
  } else if (live) {
    coupon = live;
    source = 'redeemed';
  }
  // A new coupon has all its months; a live one has what its paid and open checkouts have not claimed.
  let monthsLeft = coupon ? monthsTotal(coupon) : null;
  if (source === 'redeemed') {
    monthsLeft = live.months_total == null ? null
      : Math.max(0, live.months_total - live.months_used - (await claimedMonths(db, live.redemption_id)));
  }
  const eligible = !coupon?.plans || coupon.plans.includes(plan);
  if (typed && !eligible) throw fail(409, 'COUPON_PLAN', `This code is for ${planList(coupon.plans)}.`);
  const covered = coupon && eligible ? coveredMonths(coupon, monthsLeft, n) : 0;
  if (covered > 0 && coupon.require_card && !config.paymongoMethods.includes('card')) {
    throw fail(409, 'CARD_OFF', 'This code needs a card payment, and card payments are off right now.');
  }
  const priced = priceWithCoupon({ listC: listCentavos(plan, n), months: n, covered, coupon });
  let message = null;
  if (!coupon) {
    const last = await lastRedemption(db, org.organization_id);
    if (last?.status === 'used_up') message = usedUpMsg(last.months_total);
  } else if (covered === 0) {
    message = eligible ? usedUpMsg(live.months_total) : `Your coupon covers ${planList(coupon.plans)}, so this payment is the full price.`;
  } else {
    // A live forever coupon's offer already shows in the live box on Plan & billing, so it is not said twice.
    message = (source === 'redeemed' && coupon.duration === 'forever' ? '' : describe(coupon)) + (coupon.duration === 'months' ? ` This payment covers ${covered} of them.` : '');
    // A free coupon that needs a card still charges the minimum; say the amount (D-97 O10).
    if (coupon.kind === 'free' && priced.cardOnly && priced.minChargeApplied) message += ` You pay ₱${toPesos(priced.amountC)} once by card.`;
    message = message.trim() || null;
  }
  return { coupon, redemption: source === 'redeemed' ? live : null, source, monthsLeft, covered, ...priced, message };
}

// Take one slot on the coupon for a workspace, as a pending redemption. The coupon row is locked first, so two
// workspaces can't both take the last slot. A redemption the workspace already holds is reused as it is.
async function reserve(db, { org, userId, coupon, redemption }) {
  if (redemption) return redemption.redemption_id;
  const { rows: [locked] } = await db.query('SELECT max_redemptions FROM platform_coupons WHERE coupon_id = $1 FOR UPDATE', [coupon.coupon_id]);
  if (locked.max_redemptions && (await usedCount(db, coupon.coupon_id)) >= locked.max_redemptions) throw fail(400, 'COUPON_INVALID', INVALID_MSG);
  try {
    const { rows: [r] } = await db.query(
      `INSERT INTO platform_coupon_redemptions (coupon_id, organization_id, months_total, redeemed_by) VALUES ($1, $2, $3, $4) RETURNING redemption_id`,
      [coupon.coupon_id, org.organization_id, monthsTotal(coupon), userId]);
    return r.redemption_id;
  } catch (err) {
    if (err.code === '23505') throw fail(409, 'COUPON_USED', USED_MSG); // the workspace already holds this coupon
    throw err;
  }
}

// A paid checkout uses up its covered months. Called by markPaid inside its transaction.
// A released redemption stays released: a payment that lands late still gets its period from markPaid, but no coupon months.
async function applyPaid(db, b) {
  if (!b.coupon_redemption_id) return;
  const { rows: [r] } = await db.query(
    `UPDATE platform_coupon_redemptions r
        SET months_used = LEAST(COALESCE(r.months_total, 32767), r.months_used + $2),
            status = CASE WHEN r.months_total IS NOT NULL AND r.months_used + $2 >= r.months_total THEN 'used_up' ELSE 'active' END,
            activated_at = COALESCE(r.activated_at, now())
      WHERE r.redemption_id = $1 AND r.status <> 'released'
      RETURNING (SELECT c.code FROM platform_coupons c WHERE c.coupon_id = r.coupon_id) AS code`,
    [b.coupon_redemption_id, b.coupon_months]);
  if (!r) return;
  await audit(db, { organization_id: b.organization_id, user_id: b.created_by }, 'billing.coupon_applied', 'billing_payment', b.billing_id,
    { code: r.code, list_amount: b.list_amount, discount_amount: b.discount_amount, covered_months: b.coupon_months });
}

// Give a reservation back when no checkout for it is open or paid (the checkout failed or expired before any payment).
async function releaseIfUnused(db, redemptionId) {
  await db.query(
    `UPDATE platform_coupon_redemptions r SET status = 'released', released_at = now()
      WHERE r.redemption_id = $1 AND r.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM billing_payments b
                         WHERE b.coupon_redemption_id = r.redemption_id AND b.status IN ('paid', 'pending'))`,
    [redemptionId]);
}

module.exports = {
  normalizeCode, CODE_RE, MIN_CHARGE_C, toCentavos, toPesos, coveredMonths, priceWithCoupon, couponState, monthsTotal, describe,
  usedCount, liveRedemption, lastRedemption, resolve, reserve, applyPaid, releaseIfUnused,
};
