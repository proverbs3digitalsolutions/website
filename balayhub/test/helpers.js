'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://balayhub:balayhub@localhost:5432/balayhub_test';
process.env.STORAGE_DIR = require('path').join(require('os').tmpdir(), `balayhub-test-${process.pid}`);
// Tests never run on the dev database: an unset or mistyped TEST_DATABASE_URL must not reach it (D-119).
// The guard resolves the database pg will really open (URL name, else PGDATABASE, else the user name), so a URL with no name,
// a percent-encoded name, a fragment or a different case cannot slip past a text match.
{
  const cs = require('pg-connection-string').parse(process.env.DATABASE_URL);
  const dbName = String(cs.database || process.env.PGDATABASE || cs.user || process.env.PGUSER || require('os').userInfo().username).trim();
  if (dbName.toLowerCase() === 'balayhub') throw new Error('Refusing to run tests on the balayhub database. Set TEST_DATABASE_URL to a test database.');
}

const { pool } = require('../src/db');
const { migrate } = require('../scripts/migrate');
const { createApp } = require('../src/server');

async function startServer() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ quiet: true });
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: async () => { server.close(); await pool.end(); require('fs').rmSync(process.env.STORAGE_DIR, { recursive: true, force: true }); } };
}

// Minimal cookie-keeping API client.
function client(base) {
  let cookie = '';
  async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'X-Requested-With': 'BalayHub',
        ...(body !== undefined && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : (body instanceof Buffer ? body : JSON.stringify(body)),
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) cookie = c.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b = {}, h) => call('POST', u, b, h),
    patch: (u, b, h) => call('PATCH', u, b, h),
    raw: call,
  };
}

const sql = (text, params) => pool.query(text, params).then((r) => r.rows);

// Sign up, verify, and create a workspace. Returns the client.
async function ownerAccount(base, email = 'owner@example.com', workspace = 'Santos Rentals') {
  const c = client(base);
  const s = await c.post('/api/auth/signup', {
    full_name: 'Maria Santos', email, password: 'correct-horse-1', confirm_password: 'correct-horse-1', accept_privacy: true,
  });
  if (s.status !== 201) throw new Error(JSON.stringify(s.data));
  await sql('UPDATE users SET email_verified_at = now() WHERE email = $1', [email]);
  const w = await c.post('/api/workspace', { name: workspace });
  if (w.status !== 201) throw new Error(JSON.stringify(w.data));
  return c;
}

// Today's date in Manila and helpers relative to it.
function manilaToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function addMonths(dateStr, n) {
  const [y, m] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

module.exports = { startServer, client, sql, ownerAccount, manilaToday, addMonths };
