'use strict';

const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { audit } = require('../lib/audit');
const { requireRole } = require('../lib/auth');
const { tenantScope, propertyScope, loadTenant, loadUnit, loadLease, redactTenant } = require('../lib/access');
const { syncCharges, LEASE_BALANCE_CTE, CHARGE_STATUS_CTE, TODAY } = require('../lib/ledger');

const router = express.Router();
const managers = requireRole('owner', 'manager');

const tenantSpec = {
  full_name: { type: 'string', required: true, max: 120, label: 'Full name' },
  email: { type: 'email', label: 'Email' },
  phone: { type: 'phone', label: 'Mobile number' },
  emergency_contact: { type: 'string', max: 200, label: 'Emergency contact' },
  notes: { type: 'text', max: 1000, label: 'Notes' },
};

// ---------------------------------------------------------------- tenants
router.get('/tenants', ah(async (req, res) => {
  const org = req.user.organization_id;
  await syncCharges(org);
  const params = [org];
  const where = [tenantScope(req.user, params)];
  params.push(req.query.status === 'archived' ? 'archived' : 'active');
  where.push(`t.status = $${params.length}`);
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 100)}%`);
    const n = params.length;
    // Staff can't see contact details, so they can't search by them either.
    const contact = req.user.role === 'staff' ? '' : ` OR t.email ILIKE $${n} OR t.phone ILIKE $${n}`;
    where.push(`(t.full_name ILIKE $${n}${contact} OR u.unit_name ILIKE $${n} OR p.property_name ILIKE $${n})`);
  }
  // Non-owners only see the current lease if it is in a property assigned to them.
  let leaseScope = '';
  if (req.user.role !== 'owner') {
    params.push(req.user.user_id);
    leaseScope = ` AND EXISTS (SELECT 1 FROM units ux JOIN property_assignments pa ON pa.property_id = ux.property_id
                                WHERE ux.unit_id = l.unit_id AND pa.user_id = $${params.length})`;
  }
  const { rows } = await query(
    `WITH ${LEASE_BALANCE_CTE}
     SELECT t.tenant_id, t.full_name, t.email, t.phone, t.status, t.created_at,
            l.lease_id, l.start_date, l.end_date, l.monthly_rent, l.due_day,
            u.unit_id, u.unit_name, p.property_id, p.property_name,
            COALESCE(lb.outstanding, 0) AS outstanding, COALESCE(lb.overdue, 0) AS overdue
       FROM tenants t
       LEFT JOIN leases l ON l.tenant_id = t.tenant_id AND l.lease_status = 'active'${leaseScope}
       LEFT JOIN units u ON u.unit_id = l.unit_id
       LEFT JOIN properties p ON p.property_id = u.property_id
       LEFT JOIN lease_balance lb ON lb.lease_id = l.lease_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.full_name`, params);
  res.json({ tenants: rows.map((t) => redactTenant(req.user, t)) });
}));

router.post('/tenants', managers, ah(async (req, res) => {
  const body = validate(req.body, tenantSpec);
  const org = req.user.organization_id;
  if (!req.body.confirm_duplicate) {
    // Only records this user may see are listed, so the check can't reveal
    // contact details from properties they aren't assigned to.
    const dupParams = [body.full_name, body.email, body.phone];
    const { rows: dupes } = await query(
      `SELECT t.tenant_id, t.full_name, t.email, t.phone, t.status FROM tenants t
        WHERE ${tenantScope(req.user, dupParams)}
          AND (lower(t.full_name) = lower($1)
               OR ($2::text IS NOT NULL AND lower(t.email) = lower($2))
               OR ($3::text IS NOT NULL AND regexp_replace(t.phone, '\\D', '', 'g') = regexp_replace($3, '\\D', '', 'g')))`,
      dupParams);
    if (dupes.length) {
      throw new HttpError(409, 'A tenant with the same name, email, or phone already exists. Review the existing record before adding another.',
        { code: 'DUPLICATE', duplicates: dupes.map((d) => redactTenant(req.user, d)) });
    }
  }
  const tenant = await tx(async (db) => {
    const { rows: [t] } = await db.query(
      `INSERT INTO tenants (organization_id, full_name, email, phone, emergency_contact, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [org, body.full_name, body.email, body.phone, body.emergency_contact, body.notes, req.user.user_id]);
    await audit(db, req.user, 'tenant.created', 'tenant', t.tenant_id, { name: t.full_name });
    return t;
  });
  res.status(201).json({ tenant });
}));

router.get('/tenants/:id', ah(async (req, res) => {
  const tenant = await loadTenant(req.user, uuidParam(req.params.id));
  const org = req.user.organization_id;
  await syncCharges(org);
  const params = [org, tenant.tenant_id];
  const scope = propertyScope(req.user, params);
  const { rows: leases } = await query(
    `WITH ${LEASE_BALANCE_CTE}
     SELECT l.*, u.unit_name, p.property_id, p.property_name,
            lb.total_charged, lb.total_paid, lb.outstanding, lb.overdue, lb.credit
       FROM leases l
       JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
       JOIN lease_balance lb ON lb.lease_id = l.lease_id
      WHERE l.tenant_id = $2 AND ${scope}
      ORDER BY (l.lease_status = 'active') DESC, l.start_date DESC`, params);
  const leaseIds = leases.map((l) => l.lease_id);
  const { rows: payments } = await query(
    `SELECT pm.*, u.full_name AS recorded_by_name, un.unit_name
       FROM payments pm
       JOIN users u ON u.user_id = pm.recorded_by
       JOIN leases l ON l.lease_id = pm.lease_id
       JOIN units un ON un.unit_id = l.unit_id
      WHERE pm.lease_id = ANY($1) ORDER BY pm.payment_date DESC, pm.created_at DESC`, [leaseIds]);
  const { rows: charges } = await query(
    `WITH ${CHARGE_STATUS_CTE}
     SELECT * FROM charges WHERE lease_id = ANY($2) ORDER BY due_date DESC`, [org, leaseIds]);
  res.json({ tenant: redactTenant(req.user, tenant), leases, payments, charges });
}));

router.patch('/tenants/:id', managers, ah(async (req, res) => {
  const tenant = await loadTenant(req.user, uuidParam(req.params.id));
  const body = validate(req.body, tenantSpec, { partial: true });
  const keys = Object.keys(body);
  if (!keys.length) return res.json({ tenant });
  const updated = await tx(async (db) => {
    const { rows: [t] } = await db.query(
      `UPDATE tenants SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE tenant_id = $1 RETURNING *`,
      [tenant.tenant_id, ...keys.map((k) => body[k])]);
    await audit(db, req.user, 'tenant.updated', 'tenant', t.tenant_id, {
      fields: keys, before: Object.fromEntries(keys.map((k) => [k, tenant[k]])) });
    return t;
  });
  res.json({ tenant: updated });
}));

router.post('/tenants/:id/archive', managers, ah(async (req, res) => {
  const tenant = await loadTenant(req.user, uuidParam(req.params.id));
  const active = await one(`SELECT 1 FROM leases WHERE tenant_id = $1 AND lease_status = 'active'`, [tenant.tenant_id]);
  if (active) throw new HttpError(409, 'This tenant has an active lease. End the lease before archiving the tenant.', { code: 'HAS_ACTIVE_LEASES' });
  await query(`UPDATE tenants SET status = 'archived' WHERE tenant_id = $1`, [tenant.tenant_id]);
  await audit(null, req.user, 'tenant.archived', 'tenant', tenant.tenant_id);
  res.json({ ok: true });
}));

router.post('/tenants/:id/restore', managers, ah(async (req, res) => {
  const tenant = await loadTenant(req.user, uuidParam(req.params.id));
  await query(`UPDATE tenants SET status = 'active' WHERE tenant_id = $1`, [tenant.tenant_id]);
  await audit(null, req.user, 'tenant.restored', 'tenant', tenant.tenant_id);
  res.json({ ok: true });
}));

// Data-subject access request support (Data Privacy Act): everything held about one tenant.
router.get('/tenants/:id/export', requireRole('owner'), ah(async (req, res) => {
  const tenant = await loadTenant(req.user, uuidParam(req.params.id));
  const { rows: leases } = await query('SELECT * FROM leases WHERE tenant_id = $1', [tenant.tenant_id]);
  const { rows: payments } = await query(
    'SELECT * FROM payments WHERE lease_id = ANY($1)', [leases.map((l) => l.lease_id)]);
  await audit(null, req.user, 'tenant.exported', 'tenant', tenant.tenant_id);
  res.set('Content-Disposition', `attachment; filename="tenant-${tenant.tenant_id}.json"`);
  res.json({ exported_at: new Date().toISOString(), tenant, leases, payments });
}));

// ---------------------------------------------------------------- leases
const leaseSpec = {
  tenant_id: { type: 'uuid', required: true, label: 'Tenant' },
  unit_id: { type: 'uuid', required: true, label: 'Unit' },
  start_date: { type: 'date', required: true, label: 'Lease start' },
  end_date: { type: 'date', label: 'Lease end' },
  monthly_rent: { type: 'money', required: true, positive: true, label: 'Monthly rent' },
  due_day: { type: 'int', required: true, min: 1, max: 31, label: 'Rent due day' },
  deposit_amount: { type: 'money', label: 'Security deposit' },
};

router.post('/leases', managers, ah(async (req, res) => {
  const body = validate(req.body, leaseSpec);
  if (body.end_date && body.end_date < body.start_date) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { end_date: 'Lease end must be on or after the start date.' } });
  }
  const tenant = await loadTenant(req.user, body.tenant_id);
  const unit = await loadUnit(req.user, body.unit_id);
  if (tenant.status !== 'active') throw new HttpError(409, 'This tenant is archived. Restore them first.', { code: 'ARCHIVED' });
  if (unit.status !== 'active' || unit.property_status !== 'active') throw new HttpError(409, 'This unit or its property is archived.', { code: 'ARCHIVED' });
  if (unit.availability === 'unavailable') throw new HttpError(409, 'This unit is marked unavailable. Change its availability first.', { code: 'UNIT_UNAVAILABLE' });
  try {
    const lease = await tx(async (db) => {
      const { rows: [l] } = await db.query(
        `INSERT INTO leases (organization_id, unit_id, tenant_id, start_date, end_date, monthly_rent, due_day, deposit_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.user.organization_id, unit.unit_id, tenant.tenant_id, body.start_date, body.end_date, body.monthly_rent,
          body.due_day, body.deposit_amount || '0.00', req.user.user_id]);
      await audit(db, req.user, 'lease.created', 'lease', l.lease_id, { tenant: tenant.full_name, unit: unit.unit_name, monthly_rent: l.monthly_rent });
      await syncCharges(req.user.organization_id, db);
      return l;
    });
    res.status(201).json({ lease });
  } catch (err) {
    if (err.constraint === 'leases_one_active_per_unit') {
      throw new HttpError(409, 'This unit already has an active lease. End it before assigning a new tenant.', { code: 'UNIT_OCCUPIED' });
    }
    throw err;
  }
}));

router.get('/leases/:id', ah(async (req, res) => {
  const lease = await loadLease(req.user, uuidParam(req.params.id));
  await syncCharges(req.user.organization_id);
  const { rows: [balance] } = await query(
    `WITH ${LEASE_BALANCE_CTE} SELECT * FROM lease_balance WHERE lease_id = $2`, [req.user.organization_id, lease.lease_id]);
  const { rows: charges } = await query(
    `WITH ${CHARGE_STATUS_CTE} SELECT * FROM charges WHERE lease_id = $2 ORDER BY due_date DESC`,
    [req.user.organization_id, lease.lease_id]);
  const { rows: files } = await query(
    `SELECT file_id, file_name, mime_type, size_bytes, uploaded_at FROM files
      WHERE related_record_type = 'lease' AND related_record_id = $1 AND organization_id = $2 ORDER BY uploaded_at DESC`,
    [lease.lease_id, req.user.organization_id]);
  res.json({ lease, balance, charges, files: req.user.role === 'staff' ? [] : files });
}));

// Adjust the remaining terms. Changing rent affects charges not yet generated.
router.patch('/leases/:id', managers, ah(async (req, res) => {
  const lease = await loadLease(req.user, uuidParam(req.params.id));
  if (lease.lease_status !== 'active') throw new HttpError(409, 'Only active leases can be changed.', { code: 'LEASE_CLOSED' });
  const body = validate(req.body, {
    end_date: { type: 'date', label: 'Lease end' },
    monthly_rent: { type: 'money', positive: true, label: 'Monthly rent' },
    due_day: { type: 'int', min: 1, max: 31, label: 'Rent due day' },
    deposit_amount: { type: 'money', label: 'Security deposit' },
  }, { partial: true });
  const keys = Object.keys(body).filter((k) => body[k] !== null || k === 'end_date');
  if (body.end_date && body.end_date < lease.start_date) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { end_date: 'Lease end must be on or after the start date.' } });
  }
  if (!keys.length) return res.json({ lease });
  const updated = await tx(async (db) => {
    const { rows: [l] } = await db.query(
      `UPDATE leases SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE lease_id = $1 RETURNING *`,
      [lease.lease_id, ...keys.map((k) => body[k])]);
    // An earlier end date removes charges for months after the lease ends.
    if (l.end_date) {
      await db.query(`DELETE FROM rent_charges WHERE lease_id = $1 
         AND period > date_trunc('month', (SELECT start_date FROM leases WHERE lease_id = $1)) AND (period > date_trunc('month', $2::date) OR due_date > $2::date)`, [l.lease_id, l.end_date]);
    }
    await audit(db, req.user, 'lease.updated', 'lease', l.lease_id, {
      before: Object.fromEntries(keys.map((k) => [k, lease[k]])), after: body });
    return l;
  });
  res.json({ lease: updated });
}));

router.post('/leases/:id/end', managers, ah(async (req, res) => {
  const lease = await loadLease(req.user, uuidParam(req.params.id));
  if (lease.lease_status !== 'active') throw new HttpError(409, 'This lease is already closed.', { code: 'LEASE_CLOSED' });
  const body = validate(req.body, {
    end_date: { type: 'date', required: true, label: 'Move-out date' },
    lease_status: { type: 'enum', values: ['ended', 'terminated'], required: true, label: 'Reason' },
    note: { type: 'text', max: 500, label: 'Note' },
  });
  if (body.end_date < lease.start_date) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { end_date: 'Move-out date must be on or after the lease start.' } });
  }
  const { today } = await one(`SELECT ${TODAY} AS today`);
  if (body.end_date > today) {
    throw new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields: { end_date: 'Move-out date can’t be in the future. To plan a move-out, set the lease end date with “Change terms” and end the lease on the day they leave.' } });
  }
  await tx(async (db) => {
    await syncCharges(req.user.organization_id, db);
    await db.query(
      `UPDATE leases SET lease_status = $2, end_date = $3, ended_at = now() WHERE lease_id = $1`,
      [lease.lease_id, body.lease_status, body.end_date]);
    await db.query(`DELETE FROM rent_charges WHERE lease_id = $1 
         AND period > date_trunc('month', (SELECT start_date FROM leases WHERE lease_id = $1)) AND (period > date_trunc('month', $2::date) OR due_date > $2::date)`, [lease.lease_id, body.end_date]);
    await audit(db, req.user, `lease.${body.lease_status}`, 'lease', lease.lease_id, { end_date: body.end_date, note: body.note });
  });
  res.json({ ok: true });
}));

// Cancel a lease entered by mistake. Only allowed before any payment is recorded.
router.post('/leases/:id/cancel', managers, ah(async (req, res) => {
  const lease = await loadLease(req.user, uuidParam(req.params.id));
  if (lease.lease_status !== 'active') throw new HttpError(409, 'This lease is already closed.', { code: 'LEASE_CLOSED' });
  const paid = await one('SELECT 1 FROM payments WHERE lease_id = $1 AND voided_at IS NULL', [lease.lease_id]);
  if (paid) throw new HttpError(409, 'Payments have been recorded on this lease. End the lease instead of cancelling it.', { code: 'HAS_PAYMENTS' });
  await tx(async (db) => {
    await db.query(`UPDATE leases SET lease_status = 'cancelled', ended_at = now() WHERE lease_id = $1`, [lease.lease_id]);
    await db.query('DELETE FROM rent_charges WHERE lease_id = $1', [lease.lease_id]);
    await audit(db, req.user, 'lease.cancelled', 'lease', lease.lease_id);
  });
  res.json({ ok: true });
}));

// Leases ending within the next N days (renewal prep).
router.get('/leases-expiring', ah(async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `SELECT l.lease_id, l.end_date, t.tenant_id, t.full_name AS tenant_name, u.unit_name, p.property_name
       FROM leases l JOIN units u ON u.unit_id = l.unit_id JOIN properties p ON p.property_id = u.property_id
       JOIN tenants t ON t.tenant_id = l.tenant_id
      WHERE ${scope} AND l.lease_status = 'active' AND l.end_date IS NOT NULL
        AND l.end_date <= ${TODAY} + 60
      ORDER BY l.end_date`, params);
  res.json({ leases: rows });
}));

module.exports = router;
