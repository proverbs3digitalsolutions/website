'use strict';

// Mark an account's email as verified (for when email sending isn't set up yet).
// Usage on the server:
//   docker compose -f docker-compose.prod.yml --env-file deploy/.env exec app node scripts/verify-user.js you@example.com

const { pool } = require('../src/db');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email.includes('@')) { console.error('Usage: node scripts/verify-user.js EMAIL'); process.exit(1); }
  const { rowCount } = await pool.query(
    'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE lower(email) = $1', [email]);
  console.log(rowCount ? `Verified ${email}. Refresh BalayHub and click "I've verified — continue".` : `No account found for ${email}.`);
}

main().then(() => pool.end()).catch((err) => { console.error(err.message); process.exit(1); });
