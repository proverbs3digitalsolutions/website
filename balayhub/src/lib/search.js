'use strict';

// Global search (top bar, D-90): one read-only query per group, each limited by the same scope helpers
// the lists use. Items carry id, title, sub and href only: never contact details, notes, money or tokens.

const { query } = require('../db');
const { propertyScope, tenantScope } = require('./access');
const { guestScope } = require('../routes/stays');
const { taskScope } = require('./housekeeping');
const { searchArticles, CATEGORIES } = require('./helpcenter');
const { USES } = require('./discounts');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIMIT = 5;
const ALL = ['owner', 'manager', 'staff'];
const QUOTE_STATUS = { open: 'Open', paid: 'Paid', expired: 'Expired', cancelled: 'Cancelled' };
const MAINT_STATUS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', cancelled: 'Cancelled' };
const CODE_STATUS = { off: 'Off', expired: 'Expired', used_up: 'Used up', active: 'Active' };
const CATEGORY_NAME = Object.fromEntries(CATEGORIES);
const CLEAN_STATUS = { todo: 'To do', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };
const EXPENSE_CATEGORY = { repairs: 'Repairs', utilities: 'Utilities', taxes: 'Taxes', insurance: 'Insurance', association_dues: 'Association dues', supplies: 'Supplies', salaries: 'Salaries', cleaning: 'Cleaning', other: 'Other' };

// 'YYYY-MM-DD' to 'Oct 20, 2026', no time-zone maths. Ranges join with a spaced en dash.
const d = (x) => { const [y, m, day] = String(x).slice(0, 10).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(day)}, ${y}`; };
const range = (a, b) => `${d(a)} – ${d(b)}`;

// LIKE wildcards in what the person typed are literal characters.
function likePatterns(q) {
  const esc = q.replace(/[\\%_]/g, '\\$&');
  return { sub: `%${esc}%`, pre: `${esc}%` };
}

// Each group: roles, module ('stay' hidden in long_term, 'rent' hidden in short_term), SQL builder and row mapper.
// A builder gets (user, params, q) with $1 = substring pattern, $2 = prefix pattern, and returns SQL.
const GROUPS = [
  { key: 'reservations', label: 'Reservations', roles: ALL, module: 'stay',
    sql: (u, p, q) => { const scope = propertyScope(u, p); const raw = p.push(q); return `SELECT b.booking_id AS id, COALESCE(g.full_name, b.guest_label, 'Guest') AS title, un.unit_name, b.check_in, b.check_out, b.confirmation_code, b.status
        FROM bookings b JOIN units un ON un.unit_id = b.unit_id JOIN properties p ON p.property_id = un.property_id
        LEFT JOIN guests g ON g.guest_id = b.guest_id
       WHERE b.kind = 'reservation' AND ${scope}
         AND (g.full_name ILIKE $1 ESCAPE '\\' OR b.guest_label ILIKE $1 ESCAPE '\\' OR b.confirmation_code ILIKE $2 ESCAPE '\\')
       ORDER BY lower(b.confirmation_code) = lower($${raw}::text) DESC, COALESCE(g.full_name, b.guest_label) ILIKE $2 ESCAPE '\\' DESC,
                abs(b.check_in - (now() AT TIME ZONE 'Asia/Manila')::date) ASC, b.booking_id`; },
    item: (r) => ({ id: r.id, title: r.title, sub: `${r.unit_name} · ${range(r.check_in, r.check_out)} · ${r.confirmation_code}${r.status === 'cancelled' ? ' · Cancelled' : ''}`, href: `#/reservations/${r.id}` }) },
  { key: 'guests', label: 'Guests', roles: ALL, module: 'stay',
    sql: (u, p) => `SELECT g.guest_id AS id, g.full_name AS title, ls.unit_name, ls.check_in FROM guests g
       LEFT JOIN LATERAL (SELECT un.unit_name, b.check_in FROM bookings b JOIN units un ON un.unit_id = b.unit_id JOIN properties p ON p.property_id = un.property_id
                           WHERE b.guest_id = g.guest_id AND b.kind = 'reservation' AND ${propertyScope(u, p)}
                           ORDER BY b.check_in DESC, b.booking_id DESC LIMIT 1) ls ON true
       WHERE ${guestScope(u, p)} AND g.full_name ILIKE $1 ESCAPE '\\'
       ORDER BY g.full_name ILIKE $2 ESCAPE '\\' DESC, g.full_name`,
    item: (r) => ({ id: r.id, title: r.title, sub: r.unit_name ? `Last stay: ${r.unit_name} · ${d(r.check_in)}` : 'No stays yet', href: `#/guests/${r.id}` }) },
  { key: 'listings', label: 'Listings', roles: ALL, module: 'stay',
    sql: (u, p) => `SELECT un.unit_id AS id, un.unit_name AS title, p.property_name AS sub FROM units un JOIN properties p ON p.property_id = un.property_id
       WHERE un.status = 'active' AND p.status = 'active' AND ${propertyScope(u, p)}
         AND (un.unit_name ILIKE $1 ESCAPE '\\' OR p.property_name ILIKE $1 ESCAPE '\\')
       ORDER BY un.unit_name ILIKE $2 ESCAPE '\\' DESC, p.property_name, un.unit_name`,
    item: (r) => ({ id: r.id, title: r.title, sub: r.sub, href: `#/listings?focus=${r.id}` }) },
  { key: 'properties', label: 'Properties', roles: ALL,
    sql: (u, p) => `SELECT p.property_id AS id, p.property_name AS title, p.city AS sub FROM properties p
       WHERE p.status = 'active' AND ${propertyScope(u, p)} AND (p.property_name ILIKE $1 ESCAPE '\\' OR p.city ILIKE $1 ESCAPE '\\')
       ORDER BY p.property_name ILIKE $2 ESCAPE '\\' DESC, p.property_name`,
    item: (r) => ({ id: r.id, title: r.title, sub: r.sub || null, href: `#/properties/${r.id}` }) },
  { key: 'tenants', label: 'Tenants', roles: ALL, module: 'rent',
    sql: (u, p) => `SELECT t.tenant_id AS id, t.full_name AS title FROM tenants t
       WHERE t.status = 'active' AND ${tenantScope(u, p)} AND t.full_name ILIKE $1 ESCAPE '\\'
       ORDER BY t.full_name ILIKE $2 ESCAPE '\\' DESC, t.full_name`,
    item: (r) => ({ id: r.id, title: r.title, sub: null, href: `#/tenants/${r.id}` }) },
  { key: 'owners', label: 'Unit owners', roles: ['owner'], module: 'stay',
    sql: (u, p) => { p.push(u.organization_id); return `SELECT o.owner_id AS id, o.full_name AS title FROM unit_owners o
       WHERE o.organization_id = $${p.length} AND o.archived_at IS NULL AND o.full_name ILIKE $1 ESCAPE '\\'
       ORDER BY o.full_name ILIKE $2 ESCAPE '\\' DESC, o.full_name`; },
    item: (r) => ({ id: r.id, title: r.title, sub: null, href: `#/owners?q=${encodeURIComponent(r.title)}` }) },
  { key: 'quotes', label: 'Quotes', roles: ['owner', 'manager'], module: 'stay',
    sql: (u, p) => `SELECT q.quote_id AS id, q.guest_name AS title, un.unit_name, q.check_in, q.check_out, q.status
        FROM booking_quotes q JOIN units un ON un.unit_id = q.unit_id JOIN properties p ON p.property_id = un.property_id
       WHERE ${propertyScope(u, p)} AND q.guest_name ILIKE $1 ESCAPE '\\'
       ORDER BY q.guest_name ILIKE $2 ESCAPE '\\' DESC, q.created_at DESC`,
    item: (r) => ({ id: r.id, title: r.title, sub: `${r.unit_name} · ${range(r.check_in, r.check_out)} · ${QUOTE_STATUS[r.status]}`, href: `#/quotes/${r.id}` }) },
  { key: 'maintenance', label: 'Repair requests', roles: ALL,
    sql: (u, p) => `SELECT m.request_id AS id, m.title, p.property_name, m.status FROM maintenance_requests m JOIN properties p ON p.property_id = m.property_id
       WHERE ${propertyScope(u, p)} AND m.title ILIKE $1 ESCAPE '\\'
       ORDER BY m.status IN ('open', 'in_progress') DESC, m.title ILIKE $2 ESCAPE '\\' DESC, m.created_at DESC`,
    item: (r) => ({ id: r.id, title: r.title, sub: `${r.property_name} · ${MAINT_STATUS[r.status]}`, href: `#/maintenance/${r.id}` }) },
  { key: 'housekeeping', label: 'Cleaning tasks', roles: ALL, module: 'stay',
    sql: (u, p) => `SELECT t.task_id AS id, un.unit_name AS title, t.due_date, t.status FROM cleaning_tasks t
       JOIN units un ON un.unit_id = t.unit_id JOIN properties p ON p.property_id = un.property_id
       WHERE ${taskScope(u, p)} AND (un.unit_name ILIKE $1 ESCAPE '\\' OR p.property_name ILIKE $1 ESCAPE '\\')
       ORDER BY t.status IN ('todo', 'in_progress') DESC, un.unit_name ILIKE $2 ESCAPE '\\' DESC, abs(t.due_date - (now() AT TIME ZONE 'Asia/Manila')::date) ASC, t.task_id`,
    item: (r) => ({ id: r.id, title: `Cleaning: ${r.title}`, sub: `${d(r.due_date)} · ${CLEAN_STATUS[r.status]}`, href: `#/housekeeping/${r.id}` }) },
  { key: 'supplies', label: 'Supplies', roles: ALL, module: 'stay',
    sql: (u, p) => `SELECT s.supply_id AS id, s.name AS title, p.property_name AS sub FROM supplies s
       JOIN properties p ON p.property_id = s.property_id
       WHERE s.archived_at IS NULL AND ${propertyScope(u, p)} AND s.name ILIKE $1 ESCAPE '\\'
       ORDER BY s.name ILIKE $2 ESCAPE '\\' DESC, s.name, p.property_name`,
    item: (r) => ({ id: r.id, title: r.title, sub: r.sub, href: `#/supplies?q=${encodeURIComponent(r.title)}` }) },
  // Title: the vendor, else the category. Never the description (free text can hold money) or the amount.
  // The vendor rank is COALESCEd so a missing vendor never ranks first.
  { key: 'expenses', label: 'Expenses', roles: ALL,
    sql: (u, p) => `SELECT x.expense_id AS id, COALESCE(NULLIF(btrim(x.vendor_name), ''), x.category) AS title, x.category, x.expense_date, p.property_name
       FROM expenses x JOIN properties p ON p.property_id = x.property_id
       WHERE x.voided_at IS NULL AND ${propertyScope(u, p)} AND (x.vendor_name ILIKE $1 ESCAPE '\\' OR x.description ILIKE $1 ESCAPE '\\')
       ORDER BY COALESCE(x.vendor_name ILIKE $2 ESCAPE '\\', false) DESC, x.expense_date DESC, x.expense_id`,
    item: (r) => ({ id: r.id, title: EXPENSE_CATEGORY[r.title] ?? r.title, sub: `${EXPENSE_CATEGORY[r.category]} · ${r.property_name} · ${d(r.expense_date)}`, href: `#/expenses/${r.id}` }) },
  // Sub: the status word the Discount codes page shows on a row, checked in the same order (off, expired, used up, starts, active).
  // The description is searched but never shown (D-99 O1).
  { key: 'discount_codes', label: 'Discount codes', roles: ['owner', 'manager'], module: 'stay',
    sql: (u, p) => { p.push(u.organization_id); return `SELECT d.code_id AS id, d.code AS title, d.valid_from,
         CASE WHEN NOT d.active THEN 'off' WHEN d.valid_until < (now() AT TIME ZONE 'Asia/Manila')::date THEN 'expired'
              WHEN d.max_uses IS NOT NULL AND ${USES} >= d.max_uses THEN 'used_up'
              WHEN d.valid_from > (now() AT TIME ZONE 'Asia/Manila')::date THEN 'scheduled' ELSE 'active' END AS status
       FROM discount_codes d
       WHERE d.organization_id = $${p.length} AND (d.code ILIKE $1 ESCAPE '\\' OR d.description ILIKE $1 ESCAPE '\\')
       ORDER BY d.code ILIKE $2 ESCAPE '\\' DESC, d.active DESC, d.code`; },
    item: (r) => ({ id: r.id, title: r.title, sub: r.status === 'scheduled' ? `Starts ${d(r.valid_from)}` : CODE_STATUS[r.status], href: `#/discount-codes?q=${encodeURIComponent(r.title)}` }) },
  { key: 'addons', label: 'Add-ons', roles: ['owner', 'manager'], module: 'stay',
    // Archived add-ons are hidden on the Add-ons page's default tab, so they are not found here either.
    sql: (u, p) => { p.push(u.organization_id); return `SELECT a.addon_id AS id, a.name AS title FROM listing_addons a
       WHERE a.organization_id = $${p.length} AND a.active AND (a.name ILIKE $1 ESCAPE '\\' OR a.name_tl ILIKE $1 ESCAPE '\\')
       ORDER BY a.name ILIKE $2 ESCAPE '\\' DESC, a.name`; },
    item: (r) => ({ id: r.id, title: r.title, sub: null, href: `#/addons?q=${encodeURIComponent(r.title)}` }) },
];

const inModule = (g, type) => !((g.module === 'stay' && type === 'long_term') || (g.module === 'rent' && type === 'short_term'));

// q is already trimmed, space-collapsed and cut to 80 characters, and at least 2 long.
async function search(user, q) {
  const { sub, pre } = likePatterns(q);
  const groups = await Promise.all(GROUPS.filter((g) => g.roles.includes(user.role) && inModule(g, user.business_type)).map(async (g) => {
    const params = [sub, pre];
    // One extra row tells "more" without a second trip; the CTE counts every match for the "5 of 8" note.
    // The builder's ORDER BY becomes a row number so the order is explicit, not left to how the CTE is scanned.
    const raw = g.sql(user, params, q);
    const at = raw.lastIndexOf('ORDER BY');
    const ranked = `SELECT row_number() OVER (ORDER BY ${raw.slice(at + 8)}) AS rn, ${raw.slice(raw.indexOf('SELECT') + 6, at)}`;
    const { rows } = await query(`WITH s AS (${ranked}) SELECT s.*, (SELECT count(*)::int FROM s) AS total_matches FROM s ORDER BY rn LIMIT ${LIMIT + 1}`, params);
    return { key: g.key, label: g.label, items: rows.slice(0, LIMIT).map(g.item), total: rows[0]?.total_matches ?? 0, more: rows.length > LIMIT };
  }));
  const help = searchArticles(q, user.role, 4, user.business_type)
    .map((a) => ({ id: a.slug, title: a.title, sub: CATEGORY_NAME[a.category] || null, href: `#/help?q=${encodeURIComponent(a.title)}` }));
  return [...groups, { key: 'help', label: 'Help articles', items: help, total: help.length, more: false }].filter((g) => g.items.length);
}

module.exports = { search, likePatterns };
