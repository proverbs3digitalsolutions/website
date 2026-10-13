'use strict';

// Digital guidebook per listing (D-57). The guest opens it from a private link
// (#/guide/:token). The Wi-Fi password and door code show only from the day
// before check-in through check-out day (Manila time). The link works from 14
// days before check-in until 2 days after check-out, for confirmed stays only.

const crypto = require('crypto');
const config = require('../config');
const { one } = require('../db');
const secretbox = require('./secretbox');
const ical = require('./ical');

// Each text field has an English column and an optional Taglish (_tl) twin.
const TEXT_FIELDS = ['arrival', 'parking', 'building_notes', 'local_tips', 'emergency_contacts'];
const GUIDE_COLUMNS = TEXT_FIELDS.flatMap((f) => [f, `${f}_tl`]);

// Manila has no daylight saving time, so a fixed +8 hours gives the local date.
const manilaToday = (now = Date.now()) => new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);

// Wi-Fi password and door code: from the day before check-in through check-out day.
const secretsOpen = (stay, today = manilaToday()) => today >= ical.addDays(stay.check_in, -1) && today <= stay.check_out;

// The guidebook link: from 14 days before check-in until 2 days after check-out.
const linkOpen = (stay, today = manilaToday()) => today >= ical.addDays(stay.check_in, -14) && today <= ical.addDays(stay.check_out, 2);

const guideLink = (token) => `${config.appUrl}/#/guide/${token}`;

// The private guidebook token for a confirmed stay, created on first use.
// Null when the stay is cancelled (or not a reservation).
async function ensureGuideToken(bookingId) {
  const row = await one(
    `UPDATE bookings SET guide_token = COALESCE(guide_token, $2)
      WHERE booking_id = $1 AND kind = 'reservation' AND status = 'confirmed'
      RETURNING guide_token`, [bookingId, crypto.randomBytes(24).toString('base64url')]);
  return row?.guide_token || null;
}

// The plain door code, or null when none is set or the stored copy can't be read.
const doorCodeOf = (enc) => (enc ? secretbox.decrypt(enc) : null);

// What the host sees. Only owners and managers reach these routes, so the plain door code is returned to them.
function guideForHost(row) {
  const guide = {};
  for (const c of GUIDE_COLUMNS) guide[c] = row?.[c] ?? null;
  guide.door_code = doorCodeOf(row?.door_code_enc);
  guide.has_door_code = Boolean(row?.door_code_enc);
  return guide;
}

// Saves the host's changes inside `db` and returns the stored row. A field that wasn't sent
// keeps its current value. A door code of null (sent as '') clears the code.
async function saveGuide(db, user, unitId, input) {
  const { rows: [cur] } = await db.query('SELECT * FROM unit_guides WHERE unit_id = $1 FOR UPDATE', [unitId]);
  const row = {};
  for (const c of GUIDE_COLUMNS) row[c] = c in input ? input[c] : (cur?.[c] ?? null);
  if ('door_code' in input) row.door_code_enc = input.door_code ? secretbox.encrypt(input.door_code) : null;
  else row.door_code_enc = cur?.door_code_enc ?? null;
  // Column names come from the constants above; every value is a bound parameter.
  const cols = [...GUIDE_COLUMNS, 'door_code_enc'];
  const { rows: [saved] } = await db.query(
    `INSERT INTO unit_guides (unit_id, organization_id, ${cols.join(', ')}, updated_at, updated_by)
     VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}, now(), $${cols.length + 3})
     ON CONFLICT (unit_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
       updated_at = now(), updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [unitId, user.organization_id, ...cols.map((c) => row[c]), user.user_id]);
  return saved;
}

// What the guest sees. The Wi-Fi password and door code are included only inside the window.
// Before it, `secrets_from` says the day they appear; after check-out day, `stay_over` is true and nothing is shown.
function guideForGuest(row, today = manilaToday()) {
  const stay = { check_in: row.check_in, check_out: row.check_out };
  const body = {
    guest_first_name: String(row.guest_name || '').trim().split(/\s+/)[0] || null,
    guest_language: row.guest_language,
    listing: row.unit_name,
    property_name: row.property_name,
    city: row.city,
    check_in: row.check_in,
    check_out: row.check_out,
    checkin_time: row.checkin_time,
    checkout_time: row.checkout_time,
    wifi_name: row.wifi_name,
  };
  if (secretsOpen(stay, today)) {
    body.wifi_password = row.wifi_password;
    body.door_code = doorCodeOf(row.door_code_enc);
  } else if (today > stay.check_out) {
    body.stay_over = true;
  } else {
    body.secrets_from = ical.addDays(row.check_in, -1);
  }
  // The listing's own check-in instructions and house rules have no Taglish version yet.
  body.sections = {
    arrival: row.arrival, arrival_tl: row.arrival_tl,
    parking: row.parking, parking_tl: row.parking_tl,
    building_notes: row.building_notes, building_notes_tl: row.building_notes_tl,
    checkin_instructions: row.checkin_instructions, checkin_instructions_tl: null,
    house_rules: row.house_rules, house_rules_tl: null,
    local_tips: row.local_tips, local_tips_tl: row.local_tips_tl,
    emergency_contacts: row.emergency_contacts, emergency_contacts_tl: row.emergency_contacts_tl,
  };
  return body;
}

module.exports = {
  GUIDE_COLUMNS, manilaToday, secretsOpen, linkOpen, guideLink, ensureGuideToken, doorCodeOf,
  guideForHost, saveGuide, guideForGuest,
};
