'use strict';

// Data rights under the Data Privacy Act: export everything a workspace holds,
// and delete a workspace completely (after a grace period).

const { tx, query } = require('../db');
const storage = require('./storage');

// Never exported: secrets and internal tokens.
const SECRET_KEYS = ['password_hash', 'google_sub', 'token_hash', 'checkin_token', 'reply_token', 'idempotency_key', 'storage_key',
  'checkout_url', 'export_token', 'ical_token', 'url', 'paymongo_key_enc', 'public_token', 'provider_checkout_id', 'key_enc', 'pay_token', 'review_token', 'token', 'p256dh', 'auth', 'endpoint'];
const strip = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_KEYS.includes(k))));

async function exportOrganization(orgId) {
  const q = async (sql) => strip((await query(sql, [orgId])).rows);
  const byOrg = (t) => q(`SELECT * FROM ${t} WHERE organization_id = $1`);
  const units = `SELECT u.unit_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1`;
  const out = {
    exported_at: new Date().toISOString(),
    format: 'BalayHub export v1',
    organization: (await byOrg('organizations'))[0],
    users: await byOrg('users'),
    units: await q(`SELECT u.* FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1`),
    nightly_rates: await q(`SELECT * FROM nightly_rates WHERE unit_id IN (${units})`),
    rent_charges: await q('SELECT c.* FROM rent_charges c JOIN leases l USING (lease_id) WHERE l.organization_id = $1'),
  };
  for (const t of ['properties', 'guests', 'bookings', 'booking_payments', 'guest_registrations', 'conversations', 'messages',
    'message_templates', 'automations', 'cleaning_tasks', 'ical_feeds', 'tenants', 'leases', 'payments', 'expenses',
    'maintenance_requests', 'files', 'billing_payments', 'invitations', 'audit_logs', 'direct_checkouts', 'balance_checkouts', 'seasons', 'unit_owners', 'guest_reviews', 'discount_codes', 'gate_passes', 'stay_deposits']) {
    out[t] = await byOrg(t);
  }
  return out;
}

// Tables purgeOrganization() clears. test/account.test.js fails if a new table
// is added to the schema without being listed here.
const PURGED_TABLES = [
  'push_subscriptions', 'seasons', 'gate_passes', 'stay_deposits', 'guest_reviews', 'balance_checkouts', 'direct_checkouts', 'discount_codes', 'automation_runs', 'messages', 'conversations', 'guest_registrations', 'files', 'cleaning_tasks', 'booking_payments',
  'billing_payments', 'receipt_counters', 'bookings', 'ical_feeds', 'guests', 'nightly_rates', 'payments', 'rent_charges',
  'leases', 'tenants', 'expenses', 'maintenance_requests', 'automations', 'message_templates', 'property_assignments',
  'units', 'unit_owners', 'properties', 'invitations', 'audit_logs', 'sessions', 'auth_tokens', 'consent_records', 'users', 'organizations',
];

// Permanently delete a workspace, its members' accounts and its stored files.
async function purgeOrganization(orgId) {
  const { rows: files } = await query('SELECT * FROM files WHERE organization_id = $1', [orgId]);
  await tx(async (db) => {
    const run = (sql) => db.query(sql, [orgId]);
    const units = 'SELECT u.unit_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1';
    const users = 'SELECT user_id FROM users WHERE organization_id = $1';
    await run('DELETE FROM push_subscriptions WHERE organization_id = $1');
    await run('DELETE FROM seasons WHERE organization_id = $1');
    await run('DELETE FROM balance_checkouts WHERE organization_id = $1');
    await run('DELETE FROM direct_checkouts WHERE organization_id = $1');
    await run('DELETE FROM discount_codes WHERE organization_id = $1');
    await run('DELETE FROM guest_reviews WHERE organization_id = $1');
    await run('DELETE FROM gate_passes WHERE organization_id = $1');
    await run('DELETE FROM stay_deposits WHERE organization_id = $1');
    await run(`DELETE FROM automation_runs WHERE automation_id IN (SELECT automation_id FROM automations WHERE organization_id = $1)
                 OR booking_id IN (SELECT booking_id FROM bookings WHERE organization_id = $1)`);
    for (const t of ['messages', 'conversations', 'guest_registrations', 'files', 'cleaning_tasks', 'booking_payments', 'billing_payments', 'receipt_counters']) {
      await run(`DELETE FROM ${t} WHERE organization_id = $1`);
    }
    await run('DELETE FROM bookings WHERE organization_id = $1');
    await run('DELETE FROM ical_feeds WHERE organization_id = $1');
    await run('DELETE FROM guests WHERE organization_id = $1');
    await run(`DELETE FROM nightly_rates WHERE unit_id IN (${units})`);
    await run('DELETE FROM payments WHERE organization_id = $1');
    await run('DELETE FROM rent_charges WHERE lease_id IN (SELECT lease_id FROM leases WHERE organization_id = $1)');
    await run('DELETE FROM leases WHERE organization_id = $1');
    await run('DELETE FROM tenants WHERE organization_id = $1');
    await run('DELETE FROM expenses WHERE organization_id = $1');
    await run('DELETE FROM maintenance_requests WHERE organization_id = $1');
    await run('DELETE FROM automations WHERE organization_id = $1');
    await run('DELETE FROM message_templates WHERE organization_id = $1');
    await run('DELETE FROM property_assignments WHERE property_id IN (SELECT property_id FROM properties WHERE organization_id = $1)');
    await run('DELETE FROM units WHERE property_id IN (SELECT property_id FROM properties WHERE organization_id = $1)');
    await run('DELETE FROM unit_owners WHERE organization_id = $1');
    await run('DELETE FROM properties WHERE organization_id = $1');
    await run('DELETE FROM invitations WHERE organization_id = $1');
    await run('DELETE FROM audit_logs WHERE organization_id = $1');
    // Keep other workspaces' audit history intact, without pointing at deleted people.
    await run(`UPDATE audit_logs SET actor_user_id = NULL WHERE actor_user_id IN (${users})`);
    await run(`DELETE FROM property_assignments WHERE user_id IN (${users})`);
    await run(`DELETE FROM sessions WHERE user_id IN (${users})`);
    await run(`DELETE FROM auth_tokens WHERE user_id IN (${users})`);
    await run(`DELETE FROM consent_records WHERE user_id IN (${users})`);
    await run('DELETE FROM users WHERE organization_id = $1');
    await run('DELETE FROM organizations WHERE organization_id = $1');
  });
  for (const f of files) await storage.removeStoredFile(f);
  return files.length;
}

// Scheduler: delete workspaces whose grace period has passed.
async function purgeDue() {
  const { rows } = await query(`SELECT organization_id FROM organizations WHERE deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= now() AND NOT is_demo`);
  for (const r of rows) {
    try { await purgeOrganization(r.organization_id); console.log(`[account] deleted workspace ${r.organization_id}`); } catch (err) { console.error('[account] delete failed:', err.message); }
  }
  return rows.length;
}

const GRACE_DAYS = 14;

module.exports = { exportOrganization, purgeOrganization, purgeDue, PURGED_TABLES, GRACE_DAYS };
