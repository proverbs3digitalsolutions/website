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
    'maintenance_requests', 'files', 'billing_payments', 'platform_coupon_redemptions', 'invitations', 'audit_logs', 'direct_checkouts', 'balance_checkouts', 'seasons', 'unit_owners', 'guest_reviews', 'discount_codes', 'gate_passes', 'stay_deposits', 'support_tickets', 'booking_charges', 'booking_refunds', 'payment_proofs',
    'owner_statements', 'owner_payouts', 'owner_reserve_entries',
    'cleaner_rates', 'cleaning_inspections', 'damage_reports', 'lost_found_items', 'supplies', 'supply_movements', 'maintenance_schedules',
    'listing_addons', 'pricing_rules', 'booking_groups', 'daily_closes', 'ical_conflicts']) {
    out[t] = await byOrg(t);
  }
  // Phase 4: the guidebook without the encrypted door code; quotes (public_token is stripped by SECRET_KEYS).
  out.unit_guides = await q('SELECT unit_id, organization_id, arrival, arrival_tl, parking, parking_tl, building_notes, building_notes_tl, local_tips, local_tips_tl, emergency_contacts, emergency_contacts_tl, updated_at, updated_by FROM unit_guides WHERE organization_id = $1');
  out.booking_quotes = await byOrg('booking_quotes');
  // Support conversation as the customer sees it: internal staff notes are left
  // out, and BalayHub staff are not identified (the app shows "BalayHub Support").
  const tickets = 'SELECT ticket_id FROM support_tickets WHERE organization_id = $1';
  out.support_messages = await q(`SELECT message_id, ticket_id, CASE WHEN author_kind = 'support' THEN NULL ELSE author_id END AS author_id,
      author_kind, body, created_at FROM support_messages WHERE ticket_id IN (${tickets}) AND NOT internal ORDER BY created_at`);
  out.support_events = await q(`SELECT event_id, ticket_id, kind, from_status, to_status, CASE WHEN actor_kind = 'support' THEN NULL ELSE actor_id END AS actor_id,
      actor_kind, note, created_at FROM support_events WHERE ticket_id IN (${tickets}) ORDER BY created_at`);
  // Privacy Notice / Terms consents of the workspace's members.
  out.consent_records = await q('SELECT c.* FROM consent_records c JOIN users u USING (user_id) WHERE u.organization_id = $1 ORDER BY c.consent_timestamp');
  return out;
}

// Tables purgeOrganization() clears. test/account.test.js fails if a new table
// is added to the schema without being listed here.
const PURGED_TABLES = [
  'notifications', 'bookmarks', 'ical_conflicts', 'daily_closes', 'booking_groups', 'pricing_rules',
  'unit_guides', 'listing_addons', 'booking_quotes',
  'owner_sessions', 'owner_login_tokens', 'owner_reserve_entries', 'owner_payouts', 'owner_statements',
  'supply_movements', 'supplies', 'cleaning_inspections', 'damage_reports', 'lost_found_items', 'cleaner_rates', 'maintenance_schedules',
  'support_events', 'support_messages', 'support_tickets', 'push_subscriptions', 'seasons', 'gate_passes', 'stay_deposits', 'payment_proofs', 'booking_refunds', 'booking_charges', 'guest_reviews', 'balance_checkouts', 'direct_checkouts', 'discount_codes', 'automation_runs', 'messages', 'conversations', 'guest_registrations', 'files', 'cleaning_tasks', 'booking_payments',
  'billing_payments', 'platform_coupon_redemptions', 'receipt_counters', 'bookings', 'ical_feeds', 'guests', 'nightly_rates', 'payments', 'rent_charges',
  'leases', 'tenants', 'expenses', 'maintenance_requests', 'automations', 'message_templates', 'property_assignments',
  'units', 'unit_owners', 'properties', 'invitations', 'audit_logs', 'sessions', 'auth_tokens', 'consent_records', 'users', 'organizations',
];

// Before the rows go: stop any live subscription at PayMongo. A failed cancel rethrows so the purge skips this
// workspace and purgeDue retries it (the row holds the only copy of the subscription id). Logs ids only.
async function cancelSubscription(orgId) {
  if (!require('../config').paymongoSecretKey) return;
  try {
    await require('./subscriptions').cancelForOrg(orgId, null, 'workspace deleted');
  } catch (err) {
    console.error(`[account] cancel subscription ${orgId}: ${err.message}`);
    throw err;
  }
}

// After the delete commits: remove the saved card and customer at PayMongo. Best effort; logs ids only, never card data.
async function releaseCard(orgId, cus, pmId) {
  const config = require('../config');
  if (!config.paymongoSecretKey || !cus) return;
  const pm = require('./paymongo');
  try {
    if (pmId && !(await pm.detachPaymentMethod(config.paymongoSecretKey, cus, pmId))) {
      console.error(`[account] detach card ${orgId}: PayMongo did not confirm`);
    }
    if (!(await pm.deleteCustomer(config.paymongoSecretKey, cus))) {
      console.error(`[account] delete customer ${orgId} (${cus}): PayMongo did not confirm`);
    }
  } catch (err) { console.error(`[account] release card ${orgId}: ${err.message}`); }
}

// Permanently delete a workspace, its members' accounts and its stored files.
// Returns { deleted: true } or { deleted: false, reason: 'gone' | 'not_due' }. With { scheduledOnly: true } (the scheduler)
// it deletes only a workspace whose deletion date has passed, so a restored workspace is never purged.
async function purgeOrganization(orgId, { scheduledOnly = false } = {}) {
  await cancelSubscription(orgId);
  let files = [];
  let cus = null; let pmId = null;
  const skipped = await tx(async (db) => {
    // The lock serialises two purges of the same workspace; the second finds the row gone.
    const { rows: [lock] } = await db.query('SELECT deletion_scheduled_at, paymongo_customer_id, card_payment_method_id FROM organizations WHERE organization_id = $1 FOR UPDATE', [orgId]);
    if (!lock) return 'gone';
    if (scheduledOnly && (!lock.deletion_scheduled_at || new Date(lock.deletion_scheduled_at) > new Date())) return 'not_due';
    cus = lock.paymongo_customer_id; pmId = lock.card_payment_method_id;
    files = (await db.query('SELECT * FROM files WHERE organization_id = $1', [orgId])).rows;
    const run = (sql) => db.query(sql, [orgId]);
    const units = 'SELECT u.unit_id FROM units u JOIN properties p USING (property_id) WHERE p.organization_id = $1';
    const users = 'SELECT user_id FROM users WHERE organization_id = $1';
    await run('DELETE FROM support_tickets WHERE organization_id = $1'); // messages and events cascade
    await run('DELETE FROM notifications WHERE organization_id = $1');
    await run('DELETE FROM bookmarks WHERE organization_id = $1');
    await run('DELETE FROM push_subscriptions WHERE organization_id = $1');
    await run('DELETE FROM seasons WHERE organization_id = $1');
    await run('DELETE FROM pricing_rules WHERE organization_id = $1'); // points at units and users
    await run('DELETE FROM daily_closes WHERE organization_id = $1'); // points at users
    await run('DELETE FROM ical_conflicts WHERE organization_id = $1'); // points at feeds and units
    await run('DELETE FROM balance_checkouts WHERE organization_id = $1');
    await run('DELETE FROM direct_checkouts WHERE organization_id = $1'); // points at quotes and discount codes
    await run('DELETE FROM booking_quotes WHERE organization_id = $1'); // points at bookings and units
    await run('DELETE FROM unit_guides WHERE organization_id = $1'); // points at units
    await run('DELETE FROM discount_codes WHERE organization_id = $1');
    await run('DELETE FROM guest_reviews WHERE organization_id = $1');
    await run('DELETE FROM gate_passes WHERE organization_id = $1');
    await run('DELETE FROM stay_deposits WHERE organization_id = $1');
    // Phase 3 operations rows point at tasks, units, bookings, charges and users, so they go first.
    await run('DELETE FROM supply_movements WHERE organization_id = $1');
    await run('DELETE FROM supplies WHERE organization_id = $1');
    await run('DELETE FROM cleaning_inspections WHERE organization_id = $1');
    await run('DELETE FROM damage_reports WHERE organization_id = $1');
    await run('DELETE FROM lost_found_items WHERE organization_id = $1');
    await run('DELETE FROM cleaner_rates WHERE organization_id = $1');
    // Tasks point at expenses (pay), requests point at tasks and schedules, expenses point at requests:
    // break the loop at the task, then clear expenses, requests, schedules, tasks in that order.
    await run('UPDATE cleaning_tasks SET pay_expense_id = NULL WHERE organization_id = $1');
    await run('DELETE FROM expenses WHERE organization_id = $1');
    await run('DELETE FROM maintenance_requests WHERE organization_id = $1');
    await run('DELETE FROM maintenance_schedules WHERE organization_id = $1');
    // Proofs point at payments and bookings, so they go first.
    await run('DELETE FROM payment_proofs WHERE organization_id = $1');
    await run('DELETE FROM booking_refunds WHERE organization_id = $1');
    await run('DELETE FROM booking_charges WHERE organization_id = $1');
    await run('DELETE FROM listing_addons WHERE organization_id = $1'); // charges point at add-ons
    await run(`DELETE FROM automation_runs WHERE automation_id IN (SELECT automation_id FROM automations WHERE organization_id = $1)
                 OR booking_id IN (SELECT booking_id FROM bookings WHERE organization_id = $1)`);
    for (const t of ['messages', 'conversations', 'guest_registrations', 'files', 'cleaning_tasks', 'booking_payments', 'billing_payments', 'receipt_counters']) {
      await run(`DELETE FROM ${t} WHERE organization_id = $1`);
    }
    await run('DELETE FROM platform_coupon_redemptions WHERE organization_id = $1'); // billing rows point at redemptions, so they go first
    await run('DELETE FROM bookings WHERE organization_id = $1'); // bookings point at groups
    await run('DELETE FROM booking_groups WHERE organization_id = $1'); // groups point at guests
    await run('DELETE FROM ical_feeds WHERE organization_id = $1');
    await run('DELETE FROM guests WHERE organization_id = $1');
    await run(`DELETE FROM nightly_rates WHERE unit_id IN (${units})`);
    await run('DELETE FROM payments WHERE organization_id = $1');
    await run('DELETE FROM rent_charges WHERE lease_id IN (SELECT lease_id FROM leases WHERE organization_id = $1)');
    await run('DELETE FROM leases WHERE organization_id = $1');
    await run('DELETE FROM tenants WHERE organization_id = $1');
    await run('DELETE FROM automations WHERE organization_id = $1');
    await run('DELETE FROM message_templates WHERE organization_id = $1');
    await run('DELETE FROM property_assignments WHERE property_id IN (SELECT property_id FROM properties WHERE organization_id = $1)');
    await run('DELETE FROM units WHERE property_id IN (SELECT property_id FROM properties WHERE organization_id = $1)');
    // Owner portal and ledger rows point at unit_owners (and statements), so they go first.
    await run('DELETE FROM owner_sessions WHERE organization_id = $1');
    await run('DELETE FROM owner_login_tokens WHERE owner_id IN (SELECT owner_id FROM unit_owners WHERE organization_id = $1)');
    await run('DELETE FROM owner_reserve_entries WHERE organization_id = $1');
    await run('DELETE FROM owner_payouts WHERE organization_id = $1');
    await run('DELETE FROM owner_statements WHERE organization_id = $1');
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
    return null;
  });
  if (skipped) return { deleted: false, reason: skipped };
  await releaseCard(orgId, cus, pmId);
  for (const f of files) await storage.removeStoredFile(f);
  return { deleted: true };
}

// Scheduler: delete workspaces whose grace period has passed.
async function purgeDue() {
  const { rows } = await query(`SELECT organization_id FROM organizations WHERE deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= now() AND NOT is_demo`);
  for (const r of rows) {
    try { const out = await purgeOrganization(r.organization_id, { scheduledOnly: true }); if (out.deleted) console.log(`[account] deleted workspace ${r.organization_id}`); } catch (err) { console.error('[account] delete failed:', err.message); }
  }
  return rows.length;
}

const GRACE_DAYS = 14;

module.exports = { exportOrganization, purgeOrganization, purgeDue, PURGED_TABLES, GRACE_DAYS };
