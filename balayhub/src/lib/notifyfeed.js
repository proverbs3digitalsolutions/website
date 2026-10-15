'use strict';

// The bell's feed (D-90): one row per person per alert, written where every alert already
// passes (push.notify) and read back with the same role, property and settings scope.

const { query } = require('../db');

const CATEGORY = {
  new_booking: 'reservations', checkin_form: 'reservations', sync_problem: 'reservations',
  payment: 'payments', cleaning: 'cleaning',
  guest_message: 'messages', mention: 'messages', assignment: 'messages',
  owner_activity: 'owners',
};
const CATEGORY_ORDER = ['reservations', 'payments', 'cleaning', 'messages', 'owners'];

const URL_RE = /^\/#\/[A-Za-z0-9._~/?=&%-]{0,300}$/;

// Never throws: the feed must not stop the phone alert. Returns how many rows were written.
async function add(orgId, type, userIds, { title, body, url, propertyId } = {}) {
  try {
    if (!userIds.length) return 0;
    const { rowCount } = await query(
      `INSERT INTO notifications (organization_id, user_id, type, property_id, title, body, url)
       SELECT $1, uid, $2, $3, $4, $5, $6 FROM unnest($7::uuid[]) AS uid`,
      [orgId, type, propertyId || null, String(title || '').slice(0, 200), body == null ? null : String(body).slice(0, 500),
        URL_RE.test(url || '') ? url : '/#/home', userIds]);
    return rowCount;
  } catch (err) {
    console.error('[notifyfeed]', err.message);
    return 0;
  }
}

// The types this person may see in the bell: what their role and workspace can receive, minus the ones they turned off.
function visibleTypes(user, prefs) {
  const { typesFor } = require('../routes/push');
  return typesFor(user.role, user.business_type).filter((t) => prefs[t] !== false);
}

// WHERE for this person's rows. Mirrors push.allowed: assigned properties only (owners all), and a saved property list.
function scopeSql(user, prefs, params) {
  params.push(user.user_id, user.organization_id, visibleTypes(user, prefs));
  const n = params.length;
  let sql = `n.user_id = $${n - 2} AND n.organization_id = $${n - 1} AND n.type = ANY($${n})`;
  if (user.role !== 'owner') {
    // Every bell type is about a property, so a row with no property is never shown to a non-owner.
    sql += ' AND EXISTS (SELECT 1 FROM property_assignments pa WHERE pa.user_id = n.user_id AND pa.property_id = n.property_id)';
  }
  if (Array.isArray(prefs.property_ids)) {
    params.push(prefs.property_ids);
    sql += ` AND n.property_id = ANY($${params.length}::uuid[])`;
  }
  return sql;
}

async function purgeOld() {
  const { rowCount } = await query(`DELETE FROM notifications WHERE created_at < now() - interval '90 days'`);
  return rowCount;
}

module.exports = { add, CATEGORY, CATEGORY_ORDER, visibleTypes, scopeSql, purgeOld };
