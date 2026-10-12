'use strict';

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, forbidden } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { propertyScope, loadProperty, loadUnit } = require('../lib/access');

const router = express.Router();
const managers = requireRole('owner', 'manager');

const PROPERTY_TYPES = ['apartment', 'boarding_house', 'condominium', 'house', 'commercial', 'dormitory', 'other'];
const UNIT_TYPES = ['room', 'studio', 'apartment', 'bedspace', 'house', 'commercial_space', 'other'];

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
  monthly_rent: { type: 'money', label: 'Monthly rent' },
  nightly_rate: { type: 'money', label: 'Nightly rate' },
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
};

// Occupancy is derived from active leases, never stored by hand.
const UNIT_SELECT = `
  SELECT u.unit_id, u.property_id, u.unit_name, u.unit_type, u.monthly_rent, u.security_deposit_amount,
         u.availability, u.availability_date, u.status, u.created_at,
         u.nightly_rate, u.cleaning_fee, u.max_guests, to_char(u.checkin_time, 'HH24:MI') AS checkin_time,
         to_char(u.checkout_time, 'HH24:MI') AS checkout_time, u.cleaning_status,
         u.wifi_name, u.wifi_password, u.checkin_instructions, u.house_rules,
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
    params.push(`%${String(req.query.q).slice(0, 100)}%`);
    where.push(`(p.property_name ILIKE $${params.length} OR p.address ILIKE $${params.length} OR p.city ILIKE $${params.length})`);
  }
  const { rows } = await query(
    `SELECT p.*,
            COUNT(u.unit_id) FILTER (WHERE u.status = 'active') AS unit_count,
            COUNT(l.lease_id) FILTER (WHERE u.status = 'active') AS occupied_count
       FROM properties p
       LEFT JOIN units u ON u.property_id = p.property_id
       LEFT JOIN leases l ON l.unit_id = u.unit_id AND l.lease_status = 'active'
      WHERE ${where.join(' AND ')}
      GROUP BY p.property_id
      ORDER BY p.property_name`, params);
  res.json({ properties: rows });
}));

router.post('/properties', requireRole('owner'), ah(async (req, res) => {
  const body = validate(req.body, propertySpec);
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
  const keys = Object.keys(body);
  if (!keys.length) return res.json({ property });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const updated = await tx(async (db) => {
    const { rows: [p] } = await db.query(
      `UPDATE properties SET ${sets.join(', ')} WHERE property_id = $1 RETURNING *`,
      [property.property_id, ...keys.map((k) => body[k])]);
    await audit(db, req.user, 'property.updated', 'property', p.property_id, {
      before: Object.fromEntries(keys.map((k) => [k, property[k]])), after: body });
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
    `SELECT p.property_name, u.unit_id, u.property_id, u.unit_name, u.unit_type, u.monthly_rent,
            u.security_deposit_amount, u.availability,
            CASE WHEN l.lease_id IS NOT NULL THEN 'occupied'
                 WHEN u.availability = 'unavailable' THEN 'unavailable' ELSE 'vacant' END AS occupancy_status
       FROM units u
       JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN leases l ON l.unit_id = u.unit_id AND l.lease_status = 'active'
      WHERE ${where.join(' AND ')} ORDER BY p.property_name, u.unit_name`, params);
  res.json({ units: rows });
}));

router.post('/properties/:id/units', managers, ah(async (req, res) => {
  const property = await loadProperty(req.user, uuidParam(req.params.id));
  if (property.status !== 'active') throw new HttpError(409, 'Restore this property before adding units.', { code: 'ARCHIVED' });
  const body = validate(req.body, unitSpec);
  try {
    const unit = await tx(async (db) => {
      const { rows: [u] } = await db.query(
        `INSERT INTO units (property_id, unit_name, unit_type, monthly_rent, security_deposit_amount, availability, availability_date,
                            nightly_rate, cleaning_fee, max_guests, checkin_time, checkout_time,
                            wifi_name, wifi_password, checkin_instructions, house_rules)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::time, '14:00'),COALESCE($12::time, '12:00'),$13,$14,$15,$16) RETURNING *`,
        [property.property_id, body.unit_name, body.unit_type, body.monthly_rent || '0.00', body.security_deposit_amount || '0.00',
          body.availability || 'available', body.availability_date, body.nightly_rate, body.cleaning_fee || '0.00',
          body.max_guests, body.checkin_time, body.checkout_time,
          body.wifi_name, body.wifi_password, body.checkin_instructions, body.house_rules]);
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

router.patch('/units/:id', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const body = validate(req.body, unitSpec, { partial: true });
  const keys = Object.keys(body).filter((k) => body[k] !== null
    || ['availability_date', 'nightly_rate', 'max_guests', 'wifi_name', 'wifi_password', 'checkin_instructions', 'house_rules'].includes(k));
  if (!keys.length) return res.json({ unit });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  try {
    const updated = await tx(async (db) => {
      const { rows: [u] } = await db.query(`UPDATE units SET ${sets.join(', ')} WHERE unit_id = $1 RETURNING *`,
        [unit.unit_id, ...keys.map((k) => body[k])]);
      await audit(db, req.user, 'unit.updated', 'unit', u.unit_id, {
        before: Object.fromEntries(keys.map((k) => [k, unit[k]])), after: body });
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
    await query(`UPDATE units SET status = 'active' WHERE unit_id = $1`, [unit.unit_id]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Another active unit already uses this name. Rename one of them first.', { code: 'DUPLICATE' });
    throw err;
  }
  await audit(null, req.user, 'unit.restored', 'unit', unit.unit_id);
  res.json({ ok: true });
}));

module.exports = router;

