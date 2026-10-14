'use strict';

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, forbidden } = require('../lib/http');
const { own } = require('../lib/pick');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { changedKeys } = require('../lib/auditdiff');
const { requireRole } = require('../lib/auth');
const { isOwner, propertyScope, loadProperty, loadUnit } = require('../lib/access');
const { POLICY_KEYS } = require('../lib/policies');

const router = express.Router();
const managers = requireRole('owner', 'manager');

const PROPERTY_TYPES = ['apartment', 'boarding_house', 'condominium', 'house', 'commercial', 'dormitory', 'other'];
const UNIT_TYPES = ['room', 'studio', 'apartment', 'bedspace', 'house', 'commercial_space', 'other'];
// A listing's public page address (/stay/<host>/<address>).
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58})[a-z0-9]$/;

const propertySpec = {
  property_name: { type: 'string', required: true, max: 120, label: 'Property name' },
  property_type: { type: 'enum', values: PROPERTY_TYPES, required: true, label: 'Property type' },
  address: { type: 'string', required: true, max: 250, label: 'Street address' },
  city: { type: 'string', required: true, max: 80, label: 'City / municipality' },
  province: { type: 'string', required: true, max: 80, label: 'Province' },
  postal_code: { type: 'string', max: 10, label: 'Postal code' },
  description: { type: 'text', max: 1000, label: 'Description' },
};

const unitSpec = {
  unit_name: { type: 'string', required: true, max: 60, label: 'Unit name or number' },
  unit_type: { type: 'enum', values: UNIT_TYPES, required: true, label: 'Unit type' },
  monthly_rent: { type: 'money', positive: true, label: 'Monthly rent' },
  nightly_rate: { type: 'money', positive: true, label: 'Nightly rate' },
  cleaning_fee: { type: 'money', label: 'Cleaning fee' },
  max_guests: { type: 'int', min: 1, max: 50, label: 'Maximum guests' },
  checkin_time: { type: 'time', label: 'Check-in time' },
  checkout_time: { type: 'time', label: 'Check-out time' },
  security_deposit_amount: { type: 'money', label: 'Security deposit' },
  availability: { type: 'enum', values: ['available', 'unavailable'], label: 'Availability' },
  availability_date: { type: 'date', label: 'Available from' },
  wifi_name: { type: 'string', max: 100, label: 'Wi-Fi name' },
  wifi_password: { type: 'string', max: 100, label: 'Wi-Fi password' },
  checkin_instructions: { type: 'text', max: 3000, label: 'Check-in instructions' },
  house_rules: { type: 'text', max: 3000, label: 'House rules' },
  description: { type: 'text', max: 3000, label: 'Description' },
  bookable_online: { type: 'bool', label: 'Show on booking page' },
  payment_option: { type: 'enum', values: ['full', 'deposit', 'either'], label: 'Online payment' },
  min_nights: { type: 'int', min: 1, max: 60, label: 'Minimum nights' },
  balance_due_days: { type: 'int', min: 0, max: 60, label: 'Balance due' },
  weekend_rate: { type: 'money', positive: true, label: 'Weekend rate' },
  holiday_rate: { type: 'money', positive: true, label: 'Holiday rate' },
  weekly_discount: { type: 'int', min: 0, max: 50, label: 'Weekly discount' },
  monthly_discount: { type: 'int', min: 0, max: 70, label: 'Monthly discount' },
  cancellation_policy: { type: 'enum', values: POLICY_KEYS, label: 'Cancellation policy' },
  cancellation_policy_text: { type: 'text', max: 1000, label: 'Custom policy text' },
  deposit_pct: { type: 'int', min: 10, max: 90, label: 'Deposit' },
  public_slug: { type: 'string', max: 60, label: 'Page address' },
  room_type: { type: 'string', max: 40, label: 'Room type' },
  min_price: { type: 'money', positive: true, label: 'Lowest price' },
  fortnight_discount: { type: 'int', min: 0, max: 90, label: 'Fourteen-night discount' },
};

// A custom policy is the host's own wording, so it can't be blank.
function checkCustomPolicy(policy, text) {
  if (policy === 'custom' && !text) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { cancellation_policy_text: 'Write the policy guests will see, or pick a preset.' } });
  }
}

// Lowercase letters, numbers and hyphens, 3 to 60 characters, starting and ending with a letter or number. A blank address is refused too.
function checkSlugFormat(slug) {
  if (!SLUG_RE.test(slug || '')) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { public_slug: 'Use 3 to 60 lowercase letters, numbers or hyphens.' } });
  }
}

// Postal codes are 4 digits. A blank one is allowed.
function checkPostalCode(code) {
  if (code && !/^\d{4}$/.test(code)) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { postal_code: 'Postal code should be 4 digits.' } });
  }
}

// Longer stays get the same or a bigger discount: weekly, then 14+ nights, then monthly. A discount
// that is off (0) is skipped. The refused field is the longer-stay one that breaks the order.
const DISCOUNT_ORDER = [['weekly_discount', 'weekly'], ['fortnight_discount', '14+ night'], ['monthly_discount', 'monthly']];
function checkDiscountOrder(values) {
  let shorter = null;
  for (const [key, name] of DISCOUNT_ORDER) {
    const pct = values[key];
    if (!(pct > 0)) continue;
    if (shorter && pct < shorter.pct) {
      throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { [key]: `The ${name} discount (${pct}%) can't be smaller than the ${shorter.name} discount (${shorter.pct}%). Longer stays get the same or a bigger discount.` } });
    }
    shorter = { name, pct };
  }
}

// Listing tags: lowercase, trimmed, 1 to 30 characters, at most 10 per listing, no repeats.
const TAG_LIMIT = 10;
const tagError = (msg) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { tags: msg } });
function parseTags(raw) {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== 'string')) throw tagError('Tags must be a list of words.');
  const tags = [...new Set(raw.map((t) => t.trim().toLowerCase()))];
  if (tags.some((t) => t.length < 1 || t.length > 30)) throw tagError('Each tag needs 1 to 30 characters.');
  if (tags.length > TAG_LIMIT) throw tagError(`Use at most ${TAG_LIMIT} tags on one listing.`);
  return tags;
}

// Page addresses are unique within a workspace. No database index enforces that (units have no
// organization column), so the workspace is locked while an address is chosen or changed.
const slugTakenError = () => new HttpError(409, 'Another listing in your workspace already uses that page address.', { code: 'SLUG_TAKEN' });
async function lockSlugs(db, orgId) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`unit-slugs:${orgId}`]);
}
async function slugTaken(db, orgId, slug, unitId) {
  const { rows } = await db.query(
    `SELECT 1 FROM units u JOIN properties p USING (property_id)
      WHERE p.organization_id = $1 AND u.public_slug = $2 AND u.unit_id IS DISTINCT FROM $3 LIMIT 1`,
    [orgId, slug, unitId]);
  return rows.length > 0;
}
// "Paris 1208" -> paris-1208, then paris-1208-2, paris-1208-3 while taken. A name too short for
// the 3-character rule gets a prefix: "A" -> listing-a.
async function freeSlug(db, orgId, name) {
  let base = String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  if (base.length < 3) base = base ? `listing-${base}` : 'listing';
  let slug = base;
  for (let n = 2; await slugTaken(db, orgId, slug, null); n += 1) {
    const suffix = `-${n}`;
    slug = `${base.slice(0, 60 - suffix.length).replace(/-+$/, '')}${suffix}`;
  }
  return slug;
}

// Occupancy is derived from active leases, never stored by hand.
const UNIT_SELECT = `
  SELECT u.unit_id, u.property_id, u.unit_name, u.public_slug, u.unit_type, u.monthly_rent, u.security_deposit_amount,
         u.availability, u.availability_date, u.status, u.created_at,
         u.nightly_rate, u.cleaning_fee, u.max_guests, to_char(u.checkin_time, 'HH24:MI') AS checkin_time,
         to_char(u.checkout_time, 'HH24:MI') AS checkout_time, u.cleaning_status,
         u.wifi_name, u.wifi_password, u.checkin_instructions, u.house_rules,
         u.description, u.bookable_online, u.payment_option, u.min_nights, u.balance_due_days,
         u.weekend_rate, u.holiday_rate, u.weekly_discount, u.monthly_discount,
         u.cancellation_policy, u.cancellation_policy_text, u.deposit_pct,
         u.tags, u.room_type, u.min_price, u.fortnight_discount,
         l.lease_id AS active_lease_id, l.end_date AS lease_end_date, t.tenant_id, t.full_name AS tenant_name,
         CASE WHEN u.status = 'archived' THEN 'archived'
              WHEN l.lease_id IS NOT NULL THEN 'occupied'
              WHEN u.availability = 'unavailable' THEN 'unavailable'
              ELSE 'vacant' END AS occupancy_status
    FROM units u
    LEFT JOIN leases l ON l.unit_id = u.unit_id AND l.lease_status = 'active'
    LEFT JOIN tenants t ON t.tenant_id = l.tenant_id`;

// ---------------------------------------------------------------- properties
router.get('/properties', ah(async (req, res) => {
  const params = [];
  const where = [propertyScope(req.user, params)];
  const status = req.query.status === 'archived' ? 'archived' : 'active';
  params.push(status); where.push(`p.status = $${params.length}`);
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100).replace(/[%_\\]/g, '\\$&')}%`);
    const n = params.length;
    where.push(`(p.property_name ILIKE $${n} OR p.address ILIKE $${n} OR p.city ILIKE $${n} OR p.province ILIKE $${n})`);
  }
  if (PROPERTY_TYPES.includes(req.query.type)) { params.push(req.query.type); where.push(`p.property_type = $${params.length}`); }
  if (req.query.city) { params.push(String(req.query.city).trim().slice(0, 80)); where.push(`lower(trim(p.city)) = lower($${params.length})`); }
  // Occupancy is checked after grouping: vacant = at least one rentable unit without a tenant.
  const vacant = `COUNT(u.unit_id) FILTER (WHERE u.status = 'active' AND l.lease_id IS NULL AND u.availability = 'available')`;
  const having = own({
    vacant: `${vacant} > 0`,
    full: `COUNT(u.unit_id) FILTER (WHERE u.status = 'active') > 0 AND ${vacant} = 0`,
    no_units: `COUNT(u.unit_id) FILTER (WHERE u.status = 'active') = 0`,
  }, req.query.occupancy);
  const SORTS = {
    name: 'p.property_name',
    city: 'lower(p.city), p.property_name',
    units: 'unit_count DESC, p.property_name',
    vacant: 'vacant_count DESC, p.property_name',
    newest: 'p.created_at DESC',
  };
  const { rows } = await query(
    `SELECT p.*,
            COUNT(u.unit_id) FILTER (WHERE u.status = 'active') AS unit_count,
            COUNT(l.lease_id) FILTER (WHERE u.status = 'active') AS occupied_count,
            ${vacant} AS vacant_count
       FROM properties p
       LEFT JOIN units u ON u.property_id = p.property_id
       LEFT JOIN leases l ON l.unit_id = u.unit_id AND l.lease_status = 'active'
      WHERE ${where.join(' AND ')}
      GROUP BY p.property_id${having ? `
     HAVING ${having}` : ''}
      ORDER BY ${own(SORTS, req.query.sort) || SORTS.name}`, params);
  res.json({ properties: rows });
}));

router.post('/properties', requireRole('owner'), ah(async (req, res) => {
  const body = validate(req.body, propertySpec);
  checkPostalCode(body.postal_code);
  const org = req.user.organization_id;
  if (!req.body.confirm_duplicate) {
    const { rows: dupes } = await query(
      `SELECT property_id, property_name, address, city, status FROM properties
        WHERE organization_id = $1
          AND (lower(property_name) = lower($2) OR (lower(address) = lower($3) AND lower(city) = lower($4)))`,
      [org, body.property_name, body.address, body.city]);
    if (dupes.length) {
      throw new HttpError(409, 'A property with the same name or address already exists. Review it before creating another.',
        { code: 'DUPLICATE', duplicates: dupes });
    }
  }
  const property = await tx(async (db) => {
    const { rows: [p] } = await db.query(
      `INSERT INTO properties (organization_id, property_name, property_type, address, city, province, postal_code, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [org, body.property_name, body.property_type, body.address, body.city, body.province, body.postal_code, body.description]);
    await audit(db, req.user, 'property.created', 'property', p.property_id, { name: p.property_name });
    return p;
  });
  res.status(201).json({ property });
}));

router.get('/properties/:id', ah(async (req, res) => {
  const property = await loadProperty(req.user, uuidParam(req.params.id));
  const { rows: units } = await query(
    `${UNIT_SELECT} WHERE u.property_id = $1 ORDER BY u.status, u.unit_name`, [property.property_id]);
  res.json({ property, units });
}));

router.patch('/properties/:id', managers, ah(async (req, res) => {
  const property = await loadProperty(req.user, uuidParam(req.params.id));
  const body = validate(req.body, propertySpec, { partial: true });
  checkPostalCode(body.postal_code);
  const keys = Object.keys(body);
  if (!keys.length) return res.json({ property });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const updated = await tx(async (db) => {
    const { rows: [p] } = await db.query(
      `UPDATE properties SET ${sets.join(', ')} WHERE property_id = $1 RETURNING *`,
      [property.property_id, ...keys.map((k) => body[k])]);
    const fields = changedKeys(property, body);
    if (fields.length) await audit(db, req.user, 'property.updated', 'property', p.property_id, { fields });
    return p;
  });
  res.json({ property: updated });
}));

router.post('/properties/:id/archive', requireRole('owner'), ah(async (req, res) => {
  const property = await loadProperty(req.user, uuidParam(req.params.id));
  const active = await one(
    `SELECT COUNT(*) AS n FROM leases l JOIN units u ON u.unit_id = l.unit_id
      WHERE u.property_id = $1 AND l.lease_status = 'active'`, [property.property_id]);
  if (active.n > 0) {
    throw new HttpError(409, `This property still has ${active.n} active lease(s). End them before archiving.`, { code: 'HAS_ACTIVE_LEASES' });
  }
  await query(`UPDATE properties SET status = 'archived' WHERE property_id = $1`, [property.property_id]);
  await audit(null, req.user, 'property.archived', 'property', property.property_id);
  res.json({ ok: true });
}));

router.post('/properties/:id/restore', requireRole('owner'), ah(async (req, res) => {
  const property = await loadProperty(req.user, uuidParam(req.params.id));
  if (property.status !== 'active') {
    const { n } = await one(`SELECT COUNT(*)::int AS n FROM units WHERE property_id = $1 AND status = 'active' AND nightly_rate IS NOT NULL`, [property.property_id]);
    await checkListingLimit(req.user, n);
  }
  await query(`UPDATE properties SET status = 'active' WHERE property_id = $1`, [property.property_id]);
  await audit(null, req.user, 'property.restored', 'property', property.property_id);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- units
router.get('/units', ah(async (req, res) => {
  const params = [];
  const where = [propertyScope(req.user, params), `u.status = 'active'`, `p.status = 'active'`];
  if (req.query.vacant === '1') where.push(`l.lease_id IS NULL AND u.availability = 'available'`);
  if (req.query.property_id) { params.push(uuidParam(req.query.property_id)); where.push(`u.property_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT p.property_name, u.unit_id, u.property_id, u.unit_name, u.unit_type, u.monthly_rent, u.nightly_rate,
            u.security_deposit_amount, u.availability,
            CASE WHEN l.lease_id IS NOT NULL THEN 'occupied'
                 WHEN u.availability = 'unavailable' THEN 'unavailable' ELSE 'vacant' END AS occupancy_status
       FROM units u
       JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN leases l ON l.unit_id = u.unit_id AND l.lease_status = 'active'
      WHERE ${where.join(' AND ')} ORDER BY p.property_name, u.unit_name`, params);
  res.json({ units: rows });
}));

// Plans limit the number of short-term listings (units with a nightly rate).
async function checkListingLimit(user, adding = 1) {
  const { planStatus } = require('../lib/plans');
  const s = planStatus(user);
  const { n } = await one(
    `SELECT COUNT(*)::int AS n FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE p.organization_id = $1 AND u.status = 'active' AND p.status = 'active' AND u.nightly_rate IS NOT NULL`, [user.organization_id]);
  if (adding > 0 && n + adding > s.listing_limit) {
    // The plan's listing limit is the owner's to see; other roles are told to ask them.
    const msg = isOwner(user)
      ? `Your ${s.name} plan includes up to ${s.listing_limit} listing${s.listing_limit === 1 ? '' : 's'}. Upgrade your plan in Settings to add more.`
      : "Your plan's listing limit is reached. Ask the workspace owner to upgrade.";
    throw new HttpError(402, msg, { code: 'PLAN_LIMIT' });
  }
}

router.post('/properties/:id/units', managers, ah(async (req, res) => {
  const property = await loadProperty(req.user, uuidParam(req.params.id));
  if (req.body?.nightly_rate) await checkListingLimit(req.user);
  if (property.status !== 'active') throw new HttpError(409, 'Restore this property before adding units.', { code: 'ARCHIVED' });
  const body = validate(req.body, unitSpec);
  checkCustomPolicy(body.cancellation_policy, body.cancellation_policy_text);
  checkDiscountOrder(body);
  if (body.public_slug) checkSlugFormat(body.public_slug);
  const tags = parseTags(req.body?.tags);
  try {
    const unit = await tx(async (db) => {
      const org = req.user.organization_id;
      await lockSlugs(db, org);
      if (body.public_slug && await slugTaken(db, org, body.public_slug, null)) throw slugTakenError();
      const publicSlug = body.public_slug || await freeSlug(db, org, body.unit_name);
      const { rows: [u] } = await db.query(
        `INSERT INTO units (property_id, unit_name, unit_type, monthly_rent, security_deposit_amount, availability, availability_date,
                            nightly_rate, cleaning_fee, max_guests, checkin_time, checkout_time,
                            wifi_name, wifi_password, checkin_instructions, house_rules,
                            description, bookable_online, payment_option, min_nights, balance_due_days,
                            weekend_rate, holiday_rate, weekly_discount, monthly_discount,
                            cancellation_policy, cancellation_policy_text, deposit_pct, public_slug,
                            room_type, min_price, fortnight_discount, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::time, '14:00'),COALESCE($12::time, '12:00'),$13,$14,$15,$16,
                 $17, $18, COALESCE($19, 'either'), COALESCE($20, 1), COALESCE($21, 3),
                 $22, $23, COALESCE($24, 0), COALESCE($25, 0), $26, $27, COALESCE($28, 50), $29,
                 $30, $31, COALESCE($32, 0), $33::text[]) RETURNING *`,
        [property.property_id, body.unit_name, body.unit_type, body.monthly_rent || '0.00', body.security_deposit_amount || '0.00',
          body.availability || 'available', body.availability_date, body.nightly_rate, body.cleaning_fee || '0.00',
          body.max_guests, body.checkin_time, body.checkout_time,
          body.wifi_name, body.wifi_password, body.checkin_instructions, body.house_rules,
          body.description, Boolean(body.bookable_online), body.payment_option, body.min_nights, body.balance_due_days,
          body.weekend_rate, body.holiday_rate, body.weekly_discount, body.monthly_discount,
          body.cancellation_policy, body.cancellation_policy_text, body.deposit_pct, publicSlug,
          body.room_type, body.min_price, body.fortnight_discount, tags]);
      await audit(db, req.user, 'unit.created', 'unit', u.unit_id, { property_id: property.property_id, name: u.unit_name });
      return u;
    });
    res.status(201).json({ unit });
  } catch (err) {
    if (err.code === '23505') {
      throw new HttpError(409, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { unit_name: 'This property already has a unit with that name.' } });
    }
    throw err;
  }
}));

// A blank field on a unit edit either clears, or is refused with a field message. A cleared money or
// discount field goes to 0, the same as a new unit stores it. Never a save that reports success
// while the old value stays. A blank deposit percentage still leaves the deposit alone.
const BLANK_TO_ZERO = { monthly_rent: '0.00', cleaning_fee: '0.00', security_deposit_amount: '0.00', weekly_discount: 0, monthly_discount: 0, fortnight_discount: 0 };
const BLANK_CLEARS = ['availability_date', 'nightly_rate', 'max_guests', 'wifi_name', 'wifi_password', 'checkin_instructions', 'house_rules', 'description',
  'weekend_rate', 'holiday_rate', 'cancellation_policy', 'cancellation_policy_text', 'room_type', 'min_price'];
function settleBlanks(body) {
  const fields = {};
  for (const k of Object.keys(body)) {
    if (body[k] !== null) continue;
    if (k in BLANK_TO_ZERO) body[k] = BLANK_TO_ZERO[k];
    else if (k === 'deposit_pct') delete body[k];
    else if (!BLANK_CLEARS.includes(k)) fields[k] = `${unitSpec[k].label} is required.`;
  }
  if (Object.keys(fields).length) throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
}

router.patch('/units/:id', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const body = validate(req.body, unitSpec, { partial: true });
  if (req.body?.tags !== undefined) body.tags = parseTags(req.body.tags);
  checkCustomPolicy(
    'cancellation_policy' in body ? body.cancellation_policy : unit.cancellation_policy,
    'cancellation_policy_text' in body ? body.cancellation_policy_text : unit.cancellation_policy_text);
  if ('public_slug' in body) checkSlugFormat(body.public_slug);
  settleBlanks(body);
  // A discount change is checked against the saved values it leaves in place.
  if (DISCOUNT_ORDER.some(([key]) => key in body)) checkDiscountOrder({ ...unit, ...body });
  // Giving a long-term unit a nightly rate turns it into a listing.
  if (body.nightly_rate && !unit.nightly_rate && unit.status === 'active') await checkListingLimit(req.user);
  const keys = Object.keys(body);
  if (!keys.length) return res.json({ unit });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  try {
    const updated = await tx(async (db) => {
      if ('public_slug' in body) {
        const org = req.user.organization_id;
        await lockSlugs(db, org);
        if (await slugTaken(db, org, body.public_slug, unit.unit_id)) throw slugTakenError();
      }
      const { rows: [u] } = await db.query(`UPDATE units SET ${sets.join(', ')} WHERE unit_id = $1 RETURNING *`,
        [unit.unit_id, ...keys.map((k) => body[k])]);
      const fields = changedKeys(unit, body);
      if (fields.length) await audit(db, req.user, 'unit.updated', 'unit', u.unit_id, { fields });
      return u;
    });
    res.json({ unit: updated });
  } catch (err) {
    if (err.code === '23505') {
      throw new HttpError(409, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { unit_name: 'This property already has a unit with that name.' } });
    }
    throw err;
  }
}));

router.post('/units/:id/archive', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const active = await one(`SELECT 1 FROM leases WHERE unit_id = $1 AND lease_status = 'active'`, [unit.unit_id]);
  if (active) throw new HttpError(409, 'This unit has an active lease. End the lease before archiving the unit.', { code: 'HAS_ACTIVE_LEASES' });
  await query(`UPDATE units SET status = 'archived' WHERE unit_id = $1`, [unit.unit_id]);
  await audit(null, req.user, 'unit.archived', 'unit', unit.unit_id);
  res.json({ ok: true });
}));

router.post('/units/:id/restore', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  if (unit.property_status !== 'active') throw forbidden('Restore the property first.');
  try {
    if (unit.nightly_rate) await checkListingLimit(req.user);
    await query(`UPDATE units SET status = 'active' WHERE unit_id = $1`, [unit.unit_id]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Another active unit already uses this name. Rename one of them first.', { code: 'DUPLICATE' });
    throw err;
  }
  await audit(null, req.user, 'unit.restored', 'unit', unit.unit_id);
  res.json({ ok: true });
}));

module.exports = router;

