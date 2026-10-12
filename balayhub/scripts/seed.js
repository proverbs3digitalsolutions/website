'use strict';

// Demo data for local testing. Creates a verified owner account:
//   email: demo@balayhub.test   password: demo-password-1
// Refuses to run in production.

const config = require('../src/config');
const { pool, tx } = require('../src/db');
const { migrate } = require('./migrate');
const { hashPassword } = require('../src/lib/auth');
const { syncCharges } = require('../src/lib/ledger');
const { createStaysWorkspace } = require('../src/lib/demo');

if (config.isProd) { console.error('Refusing to seed in production.'); process.exit(1); }

const EMAIL = 'demo@balayhub.test';

function monthsAgo(n, day = 1) {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day));
  return d.toISOString().slice(0, 10);
}

async function main() {
  await migrate({ quiet: true });
  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [EMAIL]);
  if (exists.rowCount) { console.log(`Demo account already exists: ${EMAIL} / demo-password-1`); await seedStays(); return; }

  const passwordHash = await hashPassword('demo-password-1');
  await tx(async (db) => {
    const { rows: [org] } = await db.query(`INSERT INTO organizations (name) VALUES ('Santos Family Rentals') RETURNING organization_id`);
    const orgId = org.organization_id;
    const { rows: [owner] } = await db.query(
      `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
       VALUES ('Maria Santos', $1, $2, $3, 'owner', now()) RETURNING user_id`, [EMAIL, passwordHash, orgId]);
    await db.query(`INSERT INTO consent_records (user_id, consent_type, policy_version) VALUES ($1, 'privacy_notice', $2)`, [owner.user_id, config.privacyPolicyVersion]);

    const props = [
      ['Sampaguita Apartments', 'apartment', '12 Mabini St., Brgy. Molino III', 'Bacoor', 'Cavite', [['101', 'studio', 8000], ['102', 'studio', 8000], ['201', 'apartment', 12000], ['202', 'apartment', 12000]]],
      ['Ilang-Ilang Boarding House', 'boarding_house', '5 Rizal Ave., Brgy. Real', 'Calamba', 'Laguna', [['Room A', 'room', 3500], ['Room B', 'room', 3500], ['Room C', 'room', 4000]]],
      ['Narra Townhouse', 'house', '88 Narra St., Brgy. Pinagbuhatan', 'Pasig', 'Metro Manila', [['Unit 1', 'house', 18000]]],
    ];
    const units = [];
    for (const [name, type, address, city, province, us] of props) {
      const { rows: [p] } = await db.query(
        `INSERT INTO properties (organization_id, property_name, property_type, address, city, province) VALUES ($1,$2,$3,$4,$5,$6) RETURNING property_id`,
        [orgId, name, type, address, city, province]);
      for (const [un, ut, rent] of us) {
        const { rows: [u] } = await db.query(
          `INSERT INTO units (property_id, unit_name, unit_type, monthly_rent, security_deposit_amount) VALUES ($1,$2,$3,$4,$5) RETURNING unit_id`,
          [p.property_id, un, ut, rent, rent * 2]);
        units.push({ ...u, property_id: p.property_id, rent });
      }
    }

    // [unit index, tenant, phone, start months ago, due day, payments: [months ago, day, fraction of rent]]
    const tenancies = [
      [0, 'Juan Dela Cruz', '0917 555 0101', 5, 5, [[5, 4, 1], [4, 5, 1], [3, 5, 1], [2, 6, 1], [1, 5, 1], [0, 3, 1]]],
      [1, 'Ana Reyes', '0918 555 0102', 3, 10, [[3, 10, 1], [2, 12, 1], [1, 15, 0.5]]],
      [2, 'Carlo Mendoza', '0919 555 0103', 8, 1, [[8, 1, 1], [7, 1, 1], [6, 2, 1], [5, 1, 1], [4, 1, 1], [3, 3, 1], [2, 1, 1], [1, 1, 1], [0, 1, 1]]],
      [4, 'Liza Bautista', '0920 555 0104', 4, 15, [[4, 15, 1], [3, 16, 1], [2, 20, 1]]],
      [5, 'Mark Villanueva', '0921 555 0105', 2, 1, [[2, 1, 1], [1, 1, 1], [0, 1, 1]]],
      [7, 'Grace Tan', '0922 555 0106', 10, 28, [[10, 28, 1], [9, 28, 1], [8, 28, 1], [7, 28, 1], [6, 28, 1], [5, 28, 1], [4, 28, 1], [3, 28, 1], [2, 28, 1], [1, 28, 1]]],
    ];
    for (const [ui, name, phone, startAgo, dueDay, pays] of tenancies) {
      const u = units[ui];
      const { rows: [t] } = await db.query(
        `INSERT INTO tenants (organization_id, full_name, phone, email, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING tenant_id`,
        [orgId, name, phone, `${name.split(' ')[0].toLowerCase()}@example.com`, owner.user_id]);
      const end = name === 'Liza Bautista' ? monthsAgo(-1, 14) : null;
      const { rows: [l] } = await db.query(
        `INSERT INTO leases (organization_id, unit_id, tenant_id, start_date, end_date, monthly_rent, due_day, deposit_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING lease_id`,
        [orgId, u.unit_id, t.tenant_id, monthsAgo(startAgo, 1), end, u.rent, dueDay, u.rent * 2, owner.user_id]);
      const methods = ['gcash', 'cash', 'bank_transfer', 'maya'];
      for (const [ago, day, frac] of pays) {
        const date = monthsAgo(ago, day);
        if (date > new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)) continue;
        await db.query(
          `INSERT INTO payments (organization_id, lease_id, amount_paid, payment_date, payment_method, reference_number, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [orgId, l.lease_id, (u.rent * frac).toFixed(2), date, methods[day % 4], day % 4 === 0 ? `GC${Math.floor(Math.random() * 1e8)}` : null, owner.user_id]);
      }
    }

    const expenses = [
      [0, 'utilities', 'Meralco — common areas', 2450.75, 1], [0, 'repairs', 'Repaint hallway', 6500, 2], [1, 'utilities', 'Water bill', 1800, 1],
      [1, 'cleaning', 'Septic tank declogging', 4500, 3], [2, 'association_dues', 'HOA dues', 1500, 0], [0, 'taxes', 'Real property tax (Q3)', 8200, 2],
      [1, 'salaries', 'Caretaker allowance', 5000, 0], [0, 'salaries', 'Caretaker allowance', 5000, 1],
    ];
    const propIds = [...new Set(units.map((u) => u.property_id))];
    for (const [pi, cat, desc, amt, ago] of expenses) {
      await db.query(
        `INSERT INTO expenses (organization_id, property_id, category, description, amount, expense_date, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orgId, propIds[pi], cat, desc, amt, monthsAgo(ago, 3), owner.user_id]);
    }
    await db.query(
      `INSERT INTO maintenance_requests (organization_id, property_id, unit_id, title, description, priority, status, reported_by, assigned_to, created_by)
       VALUES ($1,$2,$3,'Leaking kitchen faucet','Tenant reports constant drip under the sink.','high','open','Juan Dela Cruz','Mang Tony (plumber)',$4),
              ($1,$5,NULL,'Replace hallway light bulbs',NULL,'low','in_progress','Caretaker',NULL,$4)`,
      [orgId, propIds[0], units[0].unit_id, owner.user_id, propIds[1]]);
    await syncCharges(orgId, db);
  });
  console.log(`Seeded demo workspace. Log in with ${EMAIL} / demo-password-1`);
  await seedStays();
}

// Short-term demo: a Metro Manila staycation host with 5 condo listings.
const STAY_EMAIL = 'stays@balayhub.test';
async function seedStays() {
  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [STAY_EMAIL]);
  if (exists.rowCount) { console.log(`Short-term demo already exists: ${STAY_EMAIL} / demo-password-1`); return; }
  await createStaysWorkspace({ email: STAY_EMAIL, passwordHash: await hashPassword('demo-password-1') });
  console.log(`Seeded short-term demo. Log in with ${STAY_EMAIL} / demo-password-1`);
}

main().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });
