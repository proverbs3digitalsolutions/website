'use strict';

// Global search (top bar, D-90): one read-only query per group, each limited by the same scope helpers
// the lists use. Items carry id, title, sub and href only: never contact details, notes, money or tokens.

const { query } = require('../db');
const { propertyScope, tenantScope } = require('./access');
const { guestScope } = require('../routes/stays');
const { searchArticles, CATEGORIES } = require('./helpcenter');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIMIT = 5;
const ALL = ['owner', 'manager', 'staff'];
const QUOTE_STATUS = { open: 'Open', paid: 'Paid', expired: 'Expired', cancelled: 'Cancelled' };
const MAINT_STATUS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', cancelled: 'Cancelled' };
const CATEGORY_NAME = Object.fromEntries(CATEGORIES);

// 'YYYY-MM-DD' to '20 Oct 2026', no time-zone maths.
const d = (x) => { const [y, m, day] = String(x).slice(0, 10).split('-'); return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`; };

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
                abs(b.check_in - (now() AT TIME ZONE 'Asia/Manila')::date) ASC, b.booking_id LIMIT ${LIMIT}`; },
    item: (r) => ({ id: r.id, title: r.title, sub: `${r.unit_name} · ${d(r.check_in)} to ${d(r.check_out)} · ${r.confirmation_code}${r.status === 'cancelled' ? ' · Cancelled' : ''}`, href: `#/reservations/${r.id}` }) },
  { key: 'guests', label: 'Guests', roles: ALL, module: 'stay',
    sql: (u, p) => `SELECT g.guest_id AS id, g.full_name AS title FROM guests g
       WHERE ${guestScope(u, p)} AND g.full_name ILIKE $1 ESCAPE '\\'
       ORDER BY g.full_name ILIKE $2 ESCAPE '\\' DESC, g.full_name LIMIT ${LIMIT}`,
    item: (r) => ({ id: r.id, title: r.title, sub: null, href: `#/guests/${r.id}` }) },
  { key: 'listings', label: 'Listings', roles: ALL, module: 'stay',
    sql: (u, p) => `SELECT un.unit_id AS id, un.unit_name AS title, p.property_name AS sub FROM units un JOIN properties p ON p.property_id = un.property_id
       WHERE un.status = 'active' AND p.status = 'active' AND ${propertyScope(u, p)}
         AND (un.unit_name ILIKE $1 ESCAPE '\\' OR p.property_name ILIKE $1 ESCAPE '\\')
       ORDER BY un.unit_name ILIKE $2 ESCAPE '\\' DESC, p.property_name, un.unit_name LIMIT ${LIMIT}`,
    item: (r) => ({ id: r.id, title: r.title, sub: r.sub, href: `#/listings?focus=${r.id}` }) },
  { key: 'properties', label: 'Properties', roles: ALL,
    sql: (u, p) => `SELECT p.property_id AS id, p.property_name AS title, p.city AS sub FROM properties p
       WHERE p.status = 'active' AND ${propertyScope(u, p)} AND (p.property_name ILIKE $1 ESCAPE '\\' OR p.city ILIKE $1 ESCAPE '\\')
       ORDER BY p.property_name ILIKE $2 ESCAPE '\\' DESC, p.property_name LIMIT ${LIMIT}`,
    item: (r) => ({ id: r.id, title: r.title, sub: r.sub || null, href: `#/properties/${r.id}` }) },
  { key: 'tenants', label: 'Tenants', roles: ALL, module: 'rent',
    sql: (u, p) => `SELECT t.tenant_id AS id, t.full_name AS title FROM tenants t
       WHERE t.status = 'active' AND ${tenantScope(u, p)} AND t.full_name ILIKE $1 ESCAPE '\\'
       ORDER BY t.full_name ILIKE $2 ESCAPE '\\' DESC, t.full_name LIMIT ${LIMIT}`,
    item: (r) => ({ id: r.id, title: r.title, sub: null, href: `#/tenants/${r.id}` }) },
  { key: 'owners', label: 'Unit owners', roles: ['owner'], module: 'stay',
    sql: (u, p) => { p.push(u.organization_id); return `SELECT o.owner_id AS id, o.full_name AS title FROM unit_owners o
       WHERE o.organization_id = $${p.length} AND o.archived_at IS NULL AND o.full_name ILIKE $1 ESCAPE '\\'
       ORDER BY o.full_name ILIKE $2 ESCAPE '\\' DESC, o.full_name LIMIT ${LIMIT}`; },
    item: (r) => ({ id: r.id, title: r.title, sub: null, href: `#/owners?q=${encodeURIComponent(r.title)}` }) },
  { key: 'quotes', label: 'Quotes', roles: ['owner', 'manager'], module: 'stay',
    sql: (u, p) => `SELECT q.quote_id AS id, q.guest_name AS title, un.unit_name, q.check_in, q.check_out, q.status
        FROM booking_quotes q JOIN units un ON un.unit_id = q.unit_id JOIN properties p ON p.property_id = un.property_id
       WHERE ${propertyScope(u, p)} AND q.guest_name ILIKE $1 ESCAPE '\\'
       ORDER BY q.guest_name ILIKE $2 ESCAPE '\\' DESC, q.created_at DESC LIMIT ${LIMIT}`,
    item: (r) => ({ id: r.id, title: r.title, sub: `${r.unit_name} · ${d(r.check_in)} to ${d(r.check_out)} · ${QUOTE_STATUS[r.status]}`, href: `#/quotes/${r.id}` }) },
  { key: 'maintenance', label: 'Maintenance', roles: ALL,
    sql: (u, p) => `SELECT m.request_id AS id, m.title, p.property_name, m.status FROM maintenance_requests m JOIN properties p ON p.property_id = m.property_id
       WHERE ${propertyScope(u, p)} AND m.title ILIKE $1 ESCAPE '\\'
       ORDER BY m.status IN ('open', 'in_progress') DESC, m.title ILIKE $2 ESCAPE '\\' DESC, m.created_at DESC LIMIT ${LIMIT}`,
    item: (r) => ({ id: r.id, title: r.title, sub: `${r.property_name} · ${MAINT_STATUS[r.status]}`, href: `#/maintenance/${r.id}` }) },
];

const inModule = (g, type) => !((g.module === 'stay' && type === 'long_term') || (g.module === 'rent' && type === 'short_term'));

// q is already trimmed, space-collapsed and cut to 80 characters, and at least 2 long.
async function search(user, q) {
  const { sub, pre } = likePatterns(q);
  const groups = await Promise.all(GROUPS.filter((g) => g.roles.includes(user.role) && inModule(g, user.business_type)).map(async (g) => {
    const params = [sub, pre];
    const { rows } = await query(g.sql(user, params, q), params);
    return { key: g.key, label: g.label, items: rows.map(g.item) };
  }));
  const help = searchArticles(q, user.role, 4, user.business_type)
    .map((a) => ({ id: a.slug, title: a.title, sub: CATEGORY_NAME[a.category] || null, href: `#/help?q=${encodeURIComponent(a.title)}` }));
  return [...groups, { key: 'help', label: 'Help articles', items: help }].filter((g) => g.items.length);
}

module.exports = { search, likePatterns };
