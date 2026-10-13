'use strict';

// Server-side data scoping. Every query that reads or writes workspace data
// goes through these helpers: owners see the whole workspace; managers and
// staff see only the properties they were assigned.

const { one } = require('../db');
const { notFound } = require('./http');

const isOwner = (user) => user.role === 'owner';

// SQL condition limiting alias `p` (a properties row) to what `user` may see.
function propertyScope(user, params, alias = 'p') {
  params.push(user.organization_id);
  let sql = `${alias}.organization_id = $${params.length}`;
  if (!isOwner(user)) {
    params.push(user.user_id);
    sql += ` AND EXISTS (SELECT 1 FROM property_assignments pa
                          WHERE pa.property_id = ${alias}.property_id AND pa.user_id = $${params.length})`;
  }
  return sql;
}

// Tenants are workspace-level. Non-owners see tenants who have a lease in an
// assigned property, plus tenants not yet placed in any unit.
function tenantScope(user, params, alias = 't') {
  params.push(user.organization_id);
  let sql = `${alias}.organization_id = $${params.length}`;
  if (!isOwner(user)) {
    params.push(user.user_id);
    const u = params.length;
    sql += ` AND (NOT EXISTS (SELECT 1 FROM leases lx WHERE lx.tenant_id = ${alias}.tenant_id)
              OR EXISTS (SELECT 1 FROM leases lx
                           JOIN units ux ON ux.unit_id = lx.unit_id
                           JOIN property_assignments pa ON pa.property_id = ux.property_id AND pa.user_id = $${u}
                          WHERE lx.tenant_id = ${alias}.tenant_id))`;
  }
  return sql;
}

async function loadProperty(user, propertyId, db) {
  const params = [propertyId];
  const sql = `SELECT p.* FROM properties p WHERE p.property_id = $1 AND ${propertyScope(user, params)}`;
  const row = db ? (await db.query(sql, params)).rows[0] : await one(sql, params);
  if (!row) throw notFound();
  return row;
}

async function loadUnit(user, unitId) {
  const params = [unitId];
  const row = await one(
    `SELECT u.*, p.property_name, p.status AS property_status
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.unit_id = $1 AND ${propertyScope(user, params)}`, params,
  );
  if (!row) throw notFound();
  return row;
}

async function loadTenant(user, tenantId) {
  const params = [tenantId];
  const row = await one(`SELECT t.* FROM tenants t WHERE t.tenant_id = $1 AND ${tenantScope(user, params)}`, params);
  if (!row) throw notFound();
  return row;
}

async function loadLease(user, leaseId, db) {
  const params = [leaseId];
  const sql = `SELECT l.*, u.unit_name, u.property_id, p.property_name, t.full_name AS tenant_name
       FROM leases l
       JOIN units u ON u.unit_id = l.unit_id
       JOIN properties p ON p.property_id = u.property_id
       JOIN tenants t ON t.tenant_id = l.tenant_id
      WHERE l.lease_id = $1 AND ${propertyScope(user, params)}`;
  const row = db ? (await db.query(sql, params)).rows[0] : await one(sql, params);
  if (!row) throw notFound();
  return row;
}

// Staff and cleaners get a limited tenant view: no contact details or private notes.
function redactTenant(user, t) {
  if (!['staff', 'cleaner'].includes(user.role) || !t) return t;
  const { email, phone, emergency_contact, notes, ...rest } = t;
  return { ...rest, limited: true };
}

module.exports = { isOwner, propertyScope, tenantScope, loadProperty, loadUnit, loadTenant, loadLease, redactTenant };
