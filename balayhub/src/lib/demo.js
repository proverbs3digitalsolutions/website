'use strict';

// Sample short-term rental workspace: used by the local seed script and for the
// public, read-only demo ("Try the demo" on the landing page). The demo's dates
// are moved forward every day so it always looks current.

const crypto = require('crypto');
const config = require('../config');
const { tx, one } = require('../db');

const DEMO_EMAIL = 'demo@demo.balayhub';
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const dayOffset = (n) => { const d = new Date(Date.now() + 8 * 3600 * 1000); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const code = () => `BH-${crypto.randomBytes(5).toString('base64url').replace(/[^A-Za-z0-9]/g, 'X').slice(0, 7).toUpperCase()}`;

const CONVERSATIONS = [
  [['in', 'Hi! We\'re arriving around 11 AM. Is early check-in possible? Thank you po!'],
    ['out', 'Hi! Check-in is from 2:00 PM, but we can keep your bags at the lobby while we finish cleaning. We\'ll message you as soon as the unit is ready.'],
    ['in', 'Perfect, salamat po!']],
  [['in', 'Good evening! Is there parking available in the building? We\'re bringing a car.']],
  [['out', 'Hi! Thank you for booking with us. Your stay is confirmed. We\'ll send check-in instructions a day before you arrive.'],
    ['note', 'Guest is celebrating an anniversary. Prepare a small welcome note.'],
    ['in', 'Thank you! Can we request extra towels?']],
  [['in', 'Hello po, what\'s the Wi-Fi password again? Hindi ko po mahanap sa message.']],
];

/**
 * Build a sample "Reyes Staycations" workspace. Returns the organization id.
 */
async function createStaysWorkspace({ email, passwordHash, isDemo = false }) {
  return tx(async (db) => {
    const { rows: [org] } = await db.query(
      `INSERT INTO organizations (name, business_type, plan, is_demo, demo_anchor)
       VALUES ('Reyes Staycations', 'short_term', 'comped', $1, $2) RETURNING organization_id`, [isDemo, isDemo ? manilaToday() : null]);
    const orgId = org.organization_id;
    const { rows: [owner] } = await db.query(
      `INSERT INTO users (full_name, email, password_hash, organization_id, role, email_verified_at)
       VALUES ('Bea Reyes', $1, $2, $3, 'owner', now()) RETURNING user_id`, [email, passwordHash, orgId]);
    await db.query(`INSERT INTO consent_records (user_id, consent_type, policy_version) VALUES ($1, 'privacy_notice', $2)`, [owner.user_id, config.privacyPolicyVersion]);
    const buildings = [
      ['Azure Urban Residences', 'Parañaque', [['Paris 1208', 2800, 600, 4], ['Rio 2210', 2500, 500, 3]]],
      ['SMDC Grass Residences', 'Quezon City', [['Tower 3 - 1815', 1900, 400, 2], ['Tower 4 - 0912', 2100, 400, 4]]],
      ['Pine Suites Tagaytay', 'Tagaytay', [['Loft A', 4200, 800, 6]]],
    ];
    const units = [];
    for (const [name, city, us] of buildings) {
      const { rows: [p] } = await db.query(
        `INSERT INTO properties (organization_id, property_name, property_type, address, city, province) VALUES ($1,$2,'condominium',$3,$4,$5) RETURNING property_id`,
        [orgId, name, `${name}, ${city}`, city, city === 'Tagaytay' ? 'Cavite' : 'Metro Manila']);
      for (const [un, rate, fee, guests] of us) {
        const { rows: [u] } = await db.query(
          `INSERT INTO units (property_id, unit_name, unit_type, nightly_rate, cleaning_fee, max_guests, checkin_time, checkout_time,
                              wifi_name, wifi_password, checkin_instructions, house_rules)
           VALUES ($1,$2,'studio',$3,$4,$5,'14:00','11:00',$6,'staycation2026',
                   'Show a valid ID at the lobby. The guard will give you the key card. Take the elevator to your floor.',
                   'No smoking inside the unit. No parties. Quiet hours 10 PM – 7 AM. Max guests as booked.') RETURNING unit_id`,
          [p.property_id, un, rate, fee, guests, `${un.replace(/\W+/g, '')}_WiFi`]);
        units.push({ ...u, rate, fee, name: un });
      }
    }
    const names = ['Rafael Diaz', 'Emily Lim', 'Katherine Santos', 'Peter Tan', 'Laura Garcia', 'Archer Cruz', 'Mika Villanueva', 'Joseph Ramos', 'Stephanie Uy', 'Carlo Mendoza', 'Ana Dela Cruz', 'Ken Navarro'];
    const channels = ['direct', 'airbnb', 'airbnb', 'booking', 'direct', 'agoda', 'airbnb'];
    const upcoming = [];
    let n = 0;
    for (const [ui, u] of units.entries()) {
      // Back-to-back stays from ~40 days ago to ~30 days ahead, with gaps.
      let cursor = -40 + ui * 2;
      while (cursor < 30) {
        const nights = 1 + ((n * 7 + ui) % 4);
        const gap = (n + ui) % 3;
        const ci = dayOffset(cursor); const co = dayOffset(cursor + nights);
        const guest = names[n % names.length];
        const { rows: [g] } = await db.query(
          `INSERT INTO guests (organization_id, full_name, phone, email, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING guest_id`,
          [orgId, guest, `0917 555 ${String(1000 + n).slice(-4)}`, `${guest.split(' ')[0].toLowerCase()}.${n}@example.com`, owner.user_id]);
        const channel = channels[n % channels.length];
        const accommodation = Math.round(u.rate * nights * (channel === 'direct' ? 1 : 1.1));
        const { rows: [b] } = await db.query(
          `INSERT INTO bookings (organization_id, unit_id, kind, guest_id, channel, check_in, check_out, num_guests, accommodation_total, cleaning_fee,
                                 confirmation_code, checked_in_at, checked_out_at, created_by)
           VALUES ($1,$2,'reservation',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING booking_id`,
          [orgId, u.unit_id, g.guest_id, channel, ci, co, 1 + (n % 3), accommodation, u.fee, code(),
            cursor <= 0 ? new Date() : null, cursor + nights <= 0 ? new Date() : null, owner.user_id]);
        if (cursor < 5) {
          const total = accommodation + u.fee;
          const paid = cursor + nights <= 0 || n % 4 !== 0 ? total : Math.round(total / 2);
          await db.query(
            `INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, recorded_by, receipt_number)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [orgId, b.booking_id, paid, dayOffset(Math.min(cursor, 0)), channel === 'direct' ? 'gcash' : 'channel_payout', owner.user_id, `AR-${String(n + 1).padStart(6, '0')}`]);
        }
        if (cursor >= -1 && cursor <= 6) upcoming.push({ booking_id: b.booking_id, guest_id: g.guest_id, unit: u, ci, co, guest });
        if (cursor + nights >= 0 && cursor + nights <= 1) {
          await db.query(
            `INSERT INTO cleaning_tasks (organization_id, unit_id, booking_id, due_date, checklist, assignee_name)
             SELECT $1, $2, $3, $4, (SELECT jsonb_agg(jsonb_build_object('text', item, 'done', false)) FROM jsonb_array_elements_text(o.cleaning_checklist) item),
                    $5 FROM organizations o WHERE o.organization_id = $1`,
            [orgId, u.unit_id, b.booking_id, co, n % 2 ? 'Aling Rosa' : null]);
        }
        cursor += nights + gap;
        n += 1;
      }
    }
    await db.query('INSERT INTO receipt_counters (organization_id, last_number) VALUES ($1, $2)', [orgId, n + 1]);
    await db.query(`UPDATE units SET cleaning_status = 'dirty' WHERE unit_id = ANY($1)`, [[units[1].unit_id, units[3].unit_id]]);
    await db.query(`INSERT INTO nightly_rates (unit_id, rate_date, price) SELECT $1, d::date, 5200 FROM generate_series($2::date, $3::date, interval '1 day') d
                    ON CONFLICT DO NOTHING`, [units[4].unit_id, dayOffset(31), dayOffset(40)]);
    const expenses = [[0, 'cleaning', 'Housekeeping (weekly)', 3500, 3], [0, 'utilities', 'Meralco', 2850.4, 8], [1, 'association_dues', 'Condo dues', 4200, 12], [2, 'supplies', 'Toiletries & linens', 2600, 5]];
    const { rows: props } = await db.query('SELECT property_id FROM properties WHERE organization_id = $1 ORDER BY created_at', [orgId]);
    for (const [pi, cat, desc, amt, ago] of expenses) {
      await db.query(`INSERT INTO expenses (organization_id, property_id, category, description, amount, expense_date, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orgId, props[pi].property_id, cat, desc, amt, dayOffset(-ago), owner.user_id]);
    }
    // A few guest conversations for the inbox.
    for (const [i, msgs] of CONVERSATIONS.entries()) {
      const s = upcoming[i * 2];
      if (!s) break;
      const { rows: [c] } = await db.query(
        `INSERT INTO conversations (organization_id, booking_id, guest_id, subject, reply_token, unread, last_message_at)
         VALUES ($1,$2,$3,$4,$5,$6, now() - make_interval(mins => $7)) RETURNING conversation_id`,
        [orgId, s.booking_id, s.guest_id, `${s.unit.name} · ${s.ci} – ${s.co}`, crypto.randomBytes(9).toString('hex'), msgs.at(-1)[0] === 'in', 30 + i * 90]);
      for (const [j, [dir, body]] of msgs.entries()) {
        const minsAgo = 30 + i * 90 + (msgs.length - j) * 25;
        await db.query(
          `INSERT INTO messages (conversation_id, organization_id, direction, from_name, to_email, body, status, sent_at, created_at, sent_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now() - make_interval(mins => $8), now() - make_interval(mins => $8), $9)`,
          [c.conversation_id, orgId, dir, dir === 'in' ? s.guest : 'Bea Reyes', dir === 'out' ? 'guest@example.com' : null, body,
            { in: 'received', out: 'sent', note: 'note' }[dir], minsAgo, dir === 'in' ? null : owner.user_id]);
      }
    }
    return orgId;
  });
}

// Create the public demo workspace if it doesn't exist. Returns its user id.
async function ensureDemo() {
  const u = await one(`SELECT u.user_id FROM users u JOIN organizations o USING (organization_id) WHERE u.email = $1 AND o.is_demo`, [DEMO_EMAIL]);
  if (u) return u.user_id;
  // Unusable password: the demo is entered only through "Try the demo".
  await createStaysWorkspace({ email: DEMO_EMAIL, passwordHash: `demo$${crypto.randomBytes(32).toString('hex')}`, isDemo: true });
  return (await one('SELECT user_id FROM users WHERE email = $1', [DEMO_EMAIL])).user_id;
}

// Move the demo's dates forward to today (bookings first, latest first, so
// stays never overlap mid-update).
async function refreshDemo() {
  const org = await one(`SELECT organization_id, demo_anchor FROM organizations WHERE is_demo ORDER BY created_at LIMIT 1`);
  if (!org || !org.demo_anchor) return 0;
  const days = Math.round((Date.parse(manilaToday()) - Date.parse(org.demo_anchor)) / 86400000);
  if (days <= 0) return 0;
  await tx(async (db) => {
    const id = org.organization_id;
    const { rows } = await db.query('SELECT booking_id FROM bookings WHERE organization_id = $1 ORDER BY check_in DESC', [id]);
    for (const r of rows) {
      await db.query(
        `UPDATE bookings SET check_in = check_in + $2::int, check_out = check_out + $2::int,
                checked_in_at = CASE WHEN check_in + $2::int <= $3::date THEN COALESCE(checked_in_at, now()) END,
                checked_out_at = CASE WHEN check_out + $2::int <= $3::date THEN COALESCE(checked_out_at, now()) END
          WHERE booking_id = $1`, [r.booking_id, days, manilaToday()]);
    }
    const shift = `make_interval(days => ${days})`;
    await db.query(`UPDATE booking_payments SET payment_date = payment_date + $2::int WHERE organization_id = $1`, [id, days]);
    await db.query(`UPDATE expenses SET expense_date = expense_date + $2::int WHERE organization_id = $1`, [id, days]);
    // Price overrides: delete and re-add (shifting in place would collide on the key).
    const { rows: rates } = await db.query(
      `DELETE FROM nightly_rates r USING units u JOIN properties p USING (property_id)
        WHERE r.unit_id = u.unit_id AND p.organization_id = $1 RETURNING r.unit_id, r.rate_date::text AS rate_date, r.price`, [id]);
    if (rates.length) {
      await db.query(
        `INSERT INTO nightly_rates (unit_id, rate_date, price)
         SELECT unit_id, rate_date + $4::int, price FROM unnest($1::uuid[], $2::date[], $3::numeric[]) AS t(unit_id, rate_date, price)`,
        [rates.map((r) => r.unit_id), rates.map((r) => r.rate_date), rates.map((r) => r.price), days]);
    }
    await db.query(`UPDATE cleaning_tasks SET due_date = due_date + $2::int, next_check_in = next_check_in + $2::int WHERE organization_id = $1`, [id, days]);
    await db.query(`UPDATE conversations SET last_message_at = last_message_at + ${shift} WHERE organization_id = $1`, [id]);
    await db.query(`UPDATE messages SET sent_at = sent_at + ${shift}, created_at = created_at + ${shift} WHERE organization_id = $1`, [id]);
    await db.query('UPDATE organizations SET demo_anchor = $2 WHERE organization_id = $1', [id, manilaToday()]);
  });
  return days;
}

module.exports = { createStaysWorkspace, ensureDemo, refreshDemo, DEMO_EMAIL };
