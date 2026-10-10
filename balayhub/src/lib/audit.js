'use strict';

const { pool } = require('../db');

// Record an important action. `db` may be a transaction client.
async function audit(db, user, action, recordType, recordId, details = null) {
  await (db || pool).query(
    `INSERT INTO audit_logs (organization_id, actor_user_id, action, record_type, record_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user?.organization_id || null, user?.user_id || null, action, recordType, recordId ? String(recordId) : null,
      details ? JSON.stringify(details) : null],
  );
}

module.exports = { audit };
