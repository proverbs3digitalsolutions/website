'use strict';

// Paid add-ons (D-59): the catalogue, what a guest's picks cost, and the booking
// charges that record them. `db` is a database pool or a transaction client; pass
// a transaction client when the write must happen together with other writes.

const { HttpError } = require('./http');
const { audit } = require('./audit');
const { UUID_RE } = require('./validate');

const PRICING = ['per_stay', 'per_night', 'per_guest', 'per_guest_night'];
const MAX_QUANTITY = 20;
// booking_charges.amount is numeric(12,2): 9,999,999,999.99, in centavos.
const MAX_AMOUNT_CENTAVOS = 999999999999;

// Where an add-on can be offered. Quotes take any active add-on.
const CONTEXTS = {
  booking: { sql: 'on_booking_page', offered: (a) => a.on_booking_page },
  before_arrival: { sql: 'before_arrival', offered: (a) => a.before_arrival },
  quote: { sql: 'TRUE', offered: () => true },
};

const addonsError = (message) =>
  new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { addons: message } });

// Money as whole centavos, so multiplying by nights or guests stays exact.
const toCentavos = (money) => Math.round(Number(money) * 100);
const fromCentavos = (c) => {
  const s = String(c).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};

// The picks as sent: a list of { addon_id, quantity }, each add-on at most once.
function parsePicks(selections) {
  if (!Array.isArray(selections) || selections.length > 50) throw addonsError('Choose add-ons from the list.');
  const seen = new Set();
  return selections.map((s) => {
    const id = typeof s?.addon_id === 'string' && UUID_RE.test(s.addon_id) ? s.addon_id.toLowerCase() : null;
    if (!id || !Number.isInteger(s.quantity) || s.quantity < 1 || s.quantity > MAX_QUANTITY) {
      throw addonsError('Choose add-ons from the list.');
    }
    if (seen.has(id)) throw addonsError('Each add-on can only be chosen once.');
    seen.add(id);
    return { addon_id: id, quantity: s.quantity };
  });
}

// How many of each add-on a booking already has on its bill (voided charges don't count), as a Map of addon_id
// to quantity. Counted by name (case-insensitive, trimmed) across the workspace's add-ons, so a second copy of
// 'Airport pickup' sees the first copy's purchase. The maximum quantity is per stay, so this is what it is checked against.
async function boughtByName(db, orgId, bookingId) {
  const { rows } = await db.query(
    `SELECT a.addon_id, SUM(c.quantity)::int AS n
       FROM listing_addons a
       JOIN listing_addons p ON p.organization_id = a.organization_id AND lower(btrim(p.name)) = lower(btrim(a.name))
       JOIN booking_charges c ON c.addon_id = p.addon_id
      WHERE a.organization_id = $1 AND c.booking_id = $2 AND c.voided_at IS NULL
      GROUP BY a.addon_id`, [orgId, bookingId]);
  return new Map(rows.map((r) => [r.addon_id, r.n]));
}

// Price a guest's picks for one stay. Each line's unit_price is the price for one
// unit of the add-on (so per-night and per-guest add-ons already include the
// nights or guests), and amount = unit_price × quantity. Money is returned as
// strings. Throws a 400 whose field is `addons` if an add-on is unknown, inactive,
// not offered for this listing or in this context, over its maximum (per stay: with `bookingId`, what
// that booking already bought counts too, and that refusal is a 409), or repeated.
async function priceAddons(db, { orgId, unitId, nights, guests, selections, context, bookingId = null }) {
  const ctx = CONTEXTS[context];
  if (!ctx) throw new Error(`unknown add-on context: ${context}`);
  const picks = parsePicks(selections);
  if (!picks.length) return { items: [], total: '0.00' };
  const { rows } = await db.query(
    `SELECT addon_id, name, price, pricing, max_quantity, unit_ids, on_booking_page, before_arrival, active
       FROM listing_addons WHERE organization_id = $1 AND addon_id = ANY($2::uuid[])`,
    [orgId, picks.map((p) => p.addon_id)]);
  const byId = new Map(rows.map((r) => [r.addon_id, r]));
  const listing = String(unitId).toLowerCase();
  const had = bookingId ? await boughtByName(db, orgId, bookingId) : new Map();
  const items = [];
  let total = 0;
  for (const { addon_id: id, quantity } of picks) {
    const a = byId.get(id);
    if (!a || !a.active) throw addonsError('One of these add-ons is no longer available. Please choose again.');
    if (a.unit_ids.length && !a.unit_ids.includes(listing)) throw addonsError(`${a.name} is not offered for this listing.`);
    if (!ctx.offered(a)) throw addonsError(`${a.name} is not offered here.`);
    if (quantity > a.max_quantity) throw addonsError(`You can add up to ${a.max_quantity} of ${a.name}.`);
    const left = a.max_quantity - (had.get(id) || 0);
    if (quantity > left) {
      const msg = left > 0 ? `You can add up to ${left} more of ${a.name}.` : `${a.name} is already on your bill.`;
      throw new HttpError(409, msg, { code: 'ADDON_LIMIT', fields: { addons: msg } });
    }
    const times = { per_stay: 1, per_night: nights, per_guest: guests, per_guest_night: guests * nights }[a.pricing];
    const unitCentavos = toCentavos(a.price) * times;
    const amountCentavos = unitCentavos * quantity;
    if (amountCentavos > MAX_AMOUNT_CENTAVOS) throw addonsError(`The total for ${a.name} is too large.`);
    total += amountCentavos;
    items.push({ addon_id: id, name: a.name, quantity, unit_price: fromCentavos(unitCentavos), amount: fromCentavos(amountCentavos) });
  }
  return { items, total: fromCentavos(total) };
}

// Record priced add-ons as booking charges (category 'addon'), then bring
// bookings.extras_total back in line with the live charges, the same sum
// charges.js keeps. `user` is the signed-in host, or null for a guest's purchase.
// `requestKey` (a guest's Idempotency-Key) is stored on each row as '<key>:<addon_id>'.
// Returns the new charge ids in the order of `items`.
async function createAddonCharges(db, bookingId, items, user, requestKey = null) {
  if (!items.length) return [];
  const { rows: [b] } = await db.query('SELECT organization_id FROM bookings WHERE booking_id = $1', [bookingId]);
  const ids = [];
  for (const it of items) {
    const { rows: [c] } = await db.query(
      `INSERT INTO booking_charges (organization_id, booking_id, category, addon_id, description, quantity, unit_price, created_by, request_key)
       VALUES ($1, $2, 'addon', $3, $4, $5, $6, $7, $8) RETURNING charge_id`,
      [b.organization_id, bookingId, it.addon_id, it.name, it.quantity, it.unit_price, user?.user_id || null,
        requestKey ? `${requestKey}:${it.addon_id}` : null]);
    ids.push(c.charge_id);
    await audit(db, user || { organization_id: b.organization_id }, 'reservation.charge_added', 'booking_charge', c.charge_id,
      { booking_id: bookingId, category: 'addon', addon_id: it.addon_id, quantity: it.quantity, unit_price: it.unit_price });
  }
  await db.query(
    `UPDATE bookings SET extras_total = (SELECT COALESCE(SUM(c.amount), 0) FROM booking_charges c
                                          WHERE c.booking_id = $1 AND c.voided_at IS NULL), updated_at = now()
      WHERE booking_id = $1`, [bookingId]);
  return ids;
}

// The add-ons offered for one listing in one context, for the page that shows them.
// Guests see each name once: the oldest active copy (copies from before the name rule can share a name).
// With `bookingId`, each add-on also says how many that stay already has (`bought`) and how many more it can take (`left`).
async function listAddonsForUnit(db, orgId, unitId, context, bookingId = null) {
  const ctx = CONTEXTS[context];
  if (!ctx) throw new Error(`unknown add-on context: ${context}`);
  const { rows } = await db.query(
    `SELECT addon_id, name, name_tl, description, price, pricing, max_quantity
       FROM (SELECT DISTINCT ON (lower(btrim(name))) addon_id, name, name_tl, description, price, pricing, max_quantity, sort_order, created_at
               FROM listing_addons
              WHERE organization_id = $1 AND active AND (cardinality(unit_ids) = 0 OR $2::uuid = ANY(unit_ids)) AND ${ctx.sql}
              ORDER BY lower(btrim(name)), sort_order, created_at, addon_id) a
      ORDER BY sort_order, created_at, addon_id`,
    [orgId, String(unitId).toLowerCase()]);
  if (!bookingId) return rows;
  const had = await boughtByName(db, orgId, bookingId);
  return rows.map((a) => ({ ...a, bought: had.get(a.addon_id) || 0, left: Math.max(0, a.max_quantity - (had.get(a.addon_id) || 0)) }));
}

module.exports = { priceAddons, createAddonCharges, listAddonsForUnit, PRICING };
