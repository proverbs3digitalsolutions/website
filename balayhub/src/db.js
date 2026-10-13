'use strict';

const { Pool, types } = require('pg');
const config = require('./config');

// Keep NUMERIC as strings (exact money) and DATE as 'YYYY-MM-DD' (no TZ shifts).
types.setTypeParser(1700, (v) => v);
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => Number(v)); // bigint counts

// connectionTimeoutMillis: a request waiting for a free connection fails instead of hanging forever.
const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 15000 });

async function query(text, params) {
  return pool.query(text, params);
}

async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, tx };
