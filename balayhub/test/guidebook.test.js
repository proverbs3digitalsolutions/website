'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const ical = require('../src/lib/ical');
const guidebook = require('../src/lib/guidebook');
const messaging = require('../src/lib/messaging');
const secretbox = require('../src/lib/secretbox');
const { exportOrganization } = require('../src/lib/account');

const PASSWORD = 'correct-horse-1';
const DOOR = '2468#A';
const WIFI = 'Azure-5G-secret';
const SHARED_EN = '(shared the day before check-in)';
const SHARED_TL = '(ibabahagi isang araw bago ang check-in)';
const TOKEN_RE = /^https?:\/\/[^/]+\/#\/guide\/([A-Za-z0-9_-]{32})$/;
const NO_UUID = '00000000-0000-4000-8000-000000000000';

const today = guidebook.manilaToday();
const d = (n) => ical.addDays(today, n);

let srv; let owner; let other; let manager; let staff; let guest;
let prop; let unit; let otherListing; let seq = 0;

async function accept(email, role, propertyIds, fullName) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

// A reservation on the listing. It is created on a free slot far from the others, then its dates
// and status are moved to the case under test (creation itself refuses past dates).
async function stay(unitId, { checkIn, checkOut, status = 'confirmed' }) {
  seq += 1;
  const slot = 60 + seq * 4;
  const r = await owner.post('/api/reservations', {
    unit_id: unitId, check_in: d(slot), check_out: d(slot + 2), guest_name: 'Rafael Diaz',
    guest_email: 'rafael@example.com', num_guests: 2, send_confirmation: false,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.reservation.booking_id;
  await sql(`UPDATE bookings SET check_in = $2, check_out = $3, status = $4,
               cancelled_at = CASE WHEN $4 = 'cancelled' THEN now() END WHERE booking_id = $1`, [id, checkIn, checkOut, status]);
  return id;
}

// Each stay gets its own listing with the same guidebook. The database refuses two confirmed stays
// that overlap on one listing, and the window cases overlap by design. The plan caps how many
// listings a workspace can add, so these rows are inserted directly; the guidebook still goes
// through the real save route.
async function freshListing() {
  seq += 1;
  const [u] = await sql(
    `INSERT INTO units (property_id, unit_name, unit_type, nightly_rate, max_guests, checkin_time, checkout_time,
                        wifi_name, wifi_password, checkin_instructions, house_rules)
     VALUES ($1, $2, 'studio', 2000, 4, '14:00', '12:00', 'Azure-Net', $3, 'Tap the card at the gate', 'No pets')
     RETURNING unit_id`, [prop.property_id, `G${seq}`, WIFI]);
  const put = await putAs(owner, `/api/units/${u.unit_id}/guide`, {
    arrival: 'Take the lift to 12F', parking_tl: 'Paradahan sa B2', building_notes: 'Gate B locks at 10pm', door_code: DOOR,
  });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  return u.unit_id;
}

// A stay with its private guide link.
async function linkFor(checkIn, checkOut) {
  const id = await stay(await freshListing(), { checkIn, checkOut });
  const r = await owner.post(`/api/reservations/${id}/guide-link`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { id, token: TOKEN_RE.exec(r.data.url)[1] };
}

// The test client has get/post/patch; PUT goes through the raw call.
const putAs = (c, url, body) => c.raw('PUT', url, body);

const orgOf = async (bookingId) => (await sql('SELECT organization_id FROM bookings WHERE booking_id = $1', [bookingId]))[0].organization_id;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'guide-owner@example.com', 'Guide Stays');
  other = await ownerAccount(srv.base, 'guide-other@example.com', 'Other Stays');
  guest = client(srv.base);
  prop = (await owner.post('/api/properties', {
    property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila',
  })).data.property;
  const elsewhere = (await owner.post('/api/properties', {
    property_name: 'Harbor', property_type: 'condominium', address: 'Roxas Blvd', city: 'Pasay', province: 'Metro Manila',
  })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', max_guests: 4,
    wifi_name: 'Azure-Net', wifi_password: WIFI, checkin_instructions: 'Tap the card at the gate', house_rules: 'No pets',
  })).data.unit;
  otherListing = (await owner.post(`/api/properties/${elsewhere.property_id}/units`, {
    unit_name: '3B', unit_type: 'studio', nightly_rate: '1800', max_guests: 2,
  })).data.unit;
  // Manager assigned to the Azure building only; staff assigned to the same building.
  manager = await accept('guide-manager@example.com', 'manager', [prop.property_id], 'Manager Azure');
  staff = await accept('guide-staff@example.com', 'staff', [prop.property_id], 'Staff Azure');
});

test.after(async () => { await srv.close(); });

// ---------------------------------------------------------------- pure rules
test('the link and secrets windows, and the Manila date, follow the spec at every edge', () => {
  const s = { check_in: '2026-10-20', check_out: '2026-10-22' };
  // The link: from 14 days before check-in until 2 days after check-out.
  assert.equal(guidebook.linkOpen(s, '2026-10-05'), false);
  assert.equal(guidebook.linkOpen(s, '2026-10-06'), true);
  assert.equal(guidebook.linkOpen(s, '2026-10-24'), true);
  assert.equal(guidebook.linkOpen(s, '2026-10-25'), false);
  // Wi-Fi password and door code: from the day before check-in through check-out day.
  assert.equal(guidebook.secretsOpen(s, '2026-10-18'), false);
  assert.equal(guidebook.secretsOpen(s, '2026-10-19'), true);
  assert.equal(guidebook.secretsOpen(s, '2026-10-22'), true);
  assert.equal(guidebook.secretsOpen(s, '2026-10-23'), false);
  // Manila is UTC+8: 15:59 UTC is still the same day at 23:59 Manila; 16:00 UTC is the next day.
  assert.equal(guidebook.manilaToday(Date.parse('2026-10-13T15:59:00Z')), '2026-10-13');
  assert.equal(guidebook.manilaToday(Date.parse('2026-10-13T16:00:00Z')), '2026-10-14');
});

// ---------------------------------------------------------------- host side
test('host: a new guidebook starts empty and has no door code', async () => {
  const r = await owner.get(`/api/units/${unit.unit_id}/guide`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data.guide).sort(), [...guidebook.GUIDE_COLUMNS, 'door_code', 'has_door_code'].sort());
  assert.equal(r.data.guide.arrival, null);
  assert.equal(r.data.guide.door_code, null);
  assert.equal(r.data.guide.has_door_code, false);
});

test('host: the owner saves the guidebook; the door code is encrypted at rest and shown back to the host', async () => {
  const r = await putAs(owner, `/api/units/${unit.unit_id}/guide`, {
    arrival: 'Take the lift to 12F', parking_tl: 'Paradahan sa B2', door_code: DOOR,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.guide.arrival, 'Take the lift to 12F');
  assert.equal(r.data.guide.parking_tl, 'Paradahan sa B2');
  assert.equal(r.data.guide.door_code, DOOR);
  assert.equal(r.data.guide.has_door_code, true);
  const [row] = await sql('SELECT door_code_enc FROM unit_guides WHERE unit_id = $1', [unit.unit_id]);
  assert.ok(row.door_code_enc.startsWith('v1.'));
  assert.ok(!row.door_code_enc.includes(DOOR), 'the stored value is not the plain code');
  assert.equal(secretbox.decrypt(row.door_code_enc), DOOR);
  // The audit log names the fields that changed, never the code.
  const audit = await sql(`SELECT details FROM audit_logs WHERE action = 'guide.updated' AND record_id = $1`, [unit.unit_id]);
  assert.ok(audit.length >= 1);
  assert.ok(!JSON.stringify(audit).includes(DOOR));
});

test('host: a save changes only the fields sent; an empty door code clears the code; it can be set again', async () => {
  let r = await putAs(owner, `/api/units/${unit.unit_id}/guide`, { building_notes: 'Gate B locks at 10pm' });
  assert.equal(r.data.guide.arrival, 'Take the lift to 12F');
  assert.equal(r.data.guide.building_notes, 'Gate B locks at 10pm');
  assert.equal(r.data.guide.door_code, DOOR);
  r = await putAs(owner, `/api/units/${unit.unit_id}/guide`, { door_code: '' });
  assert.equal(r.data.guide.door_code, null);
  assert.equal(r.data.guide.has_door_code, false);
  assert.equal(r.data.guide.arrival, 'Take the lift to 12F');
  r = await putAs(owner, `/api/units/${unit.unit_id}/guide`, { door_code: DOOR });
  assert.equal(r.data.guide.door_code, DOOR);
});

test('host: bad input is refused field by field and changes nothing', async () => {
  const long = await putAs(owner, `/api/units/${unit.unit_id}/guide`, { arrival: 'x'.repeat(2001) });
  assert.equal(long.status, 400);
  assert.ok(long.data.fields.arrival);
  const longCode = await putAs(owner, `/api/units/${unit.unit_id}/guide`, { door_code: '1'.repeat(41) });
  assert.equal(longCode.status, 400);
  assert.ok(longCode.data.fields.door_code);
  const numberCode = await putAs(owner, `/api/units/${unit.unit_id}/guide`, { door_code: 2468 });
  assert.equal(numberCode.status, 400);
  const after = await owner.get(`/api/units/${unit.unit_id}/guide`);
  assert.equal(after.data.guide.door_code, DOOR);
  assert.equal(after.data.guide.arrival, 'Take the lift to 12F');
});

test('roles: staff are refused; a manager is limited to their own building; other workspaces see nothing', async () => {
  assert.equal((await staff.get(`/api/units/${unit.unit_id}/guide`)).status, 403);
  assert.equal((await putAs(staff, `/api/units/${unit.unit_id}/guide`, { arrival: 'changed' })).status, 403);
  const id = await stay(await freshListing(), { checkIn: d(14), checkOut: d(16) });
  assert.equal((await staff.post(`/api/reservations/${id}/guide-link`)).status, 403);

  const mg = await manager.get(`/api/units/${unit.unit_id}/guide`);
  assert.equal(mg.status, 200, JSON.stringify(mg.data));
  assert.equal(mg.data.guide.door_code, DOOR, 'managers may see the door code');
  assert.equal((await putAs(manager, `/api/units/${unit.unit_id}/guide`, { parking: 'Ground floor' })).status, 200);
  assert.equal((await manager.get(`/api/units/${otherListing.unit_id}/guide`)).status, 404);
  assert.equal((await putAs(manager, `/api/units/${otherListing.unit_id}/guide`, { parking: 'x' })).status, 404);
  const outside = await stay(otherListing.unit_id, { checkIn: d(14), checkOut: d(16) });
  assert.equal((await manager.post(`/api/reservations/${outside}/guide-link`)).status, 404);

  assert.equal((await other.get(`/api/units/${unit.unit_id}/guide`)).status, 404);
  assert.equal((await putAs(other, `/api/units/${unit.unit_id}/guide`, { arrival: 'hacked' })).status, 404);
  assert.equal((await other.post(`/api/reservations/${id}/guide-link`)).status, 404);
  const still = await owner.get(`/api/units/${unit.unit_id}/guide`);
  assert.equal(still.data.guide.arrival, 'Take the lift to 12F');
  assert.equal(still.data.guide.door_code, DOOR);
});

test('guide link: made for confirmed stays only, the same link each time, and only for the workspace that owns the stay', async () => {
  const id = await stay(await freshListing(), { checkIn: d(14), checkOut: d(16) });
  const first = await owner.post(`/api/reservations/${id}/guide-link`);
  assert.equal(first.status, 200);
  assert.ok(TOKEN_RE.test(first.data.url), first.data.url);
  const second = await owner.post(`/api/reservations/${id}/guide-link`);
  assert.equal(second.data.url, first.data.url);
  const cancelled = await stay(await freshListing(), { checkIn: d(14), checkOut: d(16), status: 'cancelled' });
  const refused = await owner.post(`/api/reservations/${cancelled}/guide-link`);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'CANCELLED');
  assert.equal((await other.post(`/api/reservations/${id}/guide-link`)).status, 404);
  assert.equal((await owner.post(`/api/reservations/${NO_UUID}/guide-link`)).status, 404);
  assert.equal((await owner.post('/api/reservations/not-a-uuid/guide-link')).status, 404);
});

test('the account export never includes the door code', async () => {
  const [{ organization_id: orgId }] = await sql('SELECT organization_id FROM unit_guides WHERE unit_id = $1', [unit.unit_id]);
  const exported = await exportOrganization(orgId);
  const text = JSON.stringify(exported);
  assert.ok(exported.unit_guides.length >= 1);
  assert.ok(!text.includes(DOOR));
  assert.ok(!text.includes('door_code_enc'));
});

// ---------------------------------------------------------------- guest side
test('guest page: opens from 14 days before check-in until 2 days after check-out, and not otherwise', async () => {
  const opens = await linkFor(d(14), d(16));
  const tooEarly = await linkFor(d(15), d(17));
  const closing = await linkFor(d(-4), d(-2));
  const tooLate = await linkFor(d(-5), d(-3));

  const first = await guest.get(`/api/public/guide/${opens.token}`);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.secrets_from, d(13));
  const early = await guest.get(`/api/public/guide/${tooEarly.token}`);
  assert.equal(early.status, 409, JSON.stringify(early.data));
  assert.equal(early.data.code, 'GUIDE_NOT_YET');
  assert.equal(early.data.opens_on, d(1), 'opens 14 days before check-in');
  const last = await guest.get(`/api/public/guide/${closing.token}`);
  assert.equal(last.status, 200);
  assert.equal(last.data.stay_over, true, 'after check-out the page says the stay is over');
  assert.equal('secrets_from' in last.data, false, 'and gives no date for secrets that will not show');
  assert.equal(await guest.get(`/api/public/guide/${tooLate.token}`).then((r) => r.status), 404);
});

test('guest page: the Wi-Fi password and door code appear only from the day before check-in through check-out day', async () => {
  const dayBefore = await linkFor(d(1), d(3));
  const checkInDay = await linkFor(d(0), d(2));
  const checkOutDay = await linkFor(d(-1), d(0));
  const twoDaysBefore = await linkFor(d(2), d(4));
  const dayAfter = await linkFor(d(-3), d(-1));

  for (const x of [dayBefore, checkInDay, checkOutDay]) {
    const r = await guest.get(`/api/public/guide/${x.token}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.wifi_password, WIFI);
    assert.equal(r.data.door_code, DOOR);
    assert.equal('secrets_from' in r.data, false);
  }
  const early = await guest.get(`/api/public/guide/${twoDaysBefore.token}`);
  assert.equal(early.status, 200, JSON.stringify(early.data));
  assert.equal(early.data.secrets_from, d(1));
  assert.equal('stay_over' in early.data, false);
  const over = await guest.get(`/api/public/guide/${dayAfter.token}`);
  assert.equal(over.status, 200, JSON.stringify(over.data));
  assert.equal(over.data.stay_over, true);
  assert.equal('secrets_from' in over.data, false, 'after check-out nothing says when they appear');
  for (const r of [early, over]) {
    assert.equal('wifi_password' in r.data, false);
    assert.equal('door_code' in r.data, false);
  }
  const text = JSON.stringify([early.data, over.data]);
  assert.ok(!text.includes(WIFI) && !text.includes(DOOR), 'no secret leaks outside the window');
});

test('guest page: a cancelled stay gets no page, even inside the window', async () => {
  const x = await linkFor(d(1), d(3));
  await sql(`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE booking_id = $1`, [x.id]);
  assert.equal((await guest.get(`/api/public/guide/${x.token}`)).status, 404);
});

test('guest page: bad or unknown tokens get the same 404 as a closed link', async () => {
  const bad = await guest.get('/api/public/guide/short');
  const unknown = await guest.get(`/api/public/guide/${'A'.repeat(32)}`);
  assert.equal(bad.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(bad.data, unknown.data);
});

test('guest page: carries the stay and the sections, never contact details, and is not cached', async () => {
  const x = await linkFor(d(1), d(3));
  const r = await guest.get(`/api/public/guide/${x.token}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.data.guest_first_name, 'Rafael');
  assert.equal(r.data.guest_language, 'en');
  const [{ unit_name: listingName }] = await sql('SELECT u.unit_name FROM bookings b JOIN units u USING (unit_id) WHERE b.booking_id = $1', [x.id]);
  assert.equal(r.data.listing, listingName);
  assert.equal(r.data.property_name, 'Azure');
  assert.equal(r.data.city, 'Taguig');
  assert.equal(r.data.check_in, d(1));
  assert.equal(r.data.check_out, d(3));
  assert.equal(r.data.wifi_name, 'Azure-Net');
  assert.equal(r.data.sections.arrival, 'Take the lift to 12F');
  assert.equal(r.data.sections.arrival_tl, null);
  assert.equal(r.data.sections.parking_tl, 'Paradahan sa B2');
  assert.equal(r.data.sections.building_notes, 'Gate B locks at 10pm');
  assert.equal(r.data.sections.checkin_instructions, 'Tap the card at the gate');
  assert.equal(r.data.sections.checkin_instructions_tl, null);
  assert.equal(r.data.sections.house_rules, 'No pets');
  assert.equal(r.data.sections.house_rules_tl, null);
  assert.equal(r.data.sections.emergency_contacts, null);
  const text = JSON.stringify(r.data);
  assert.ok(!text.includes('rafael@example.com'));
  assert.ok(!text.includes('Diaz'), 'only the first name is shown');
});

// ---------------------------------------------------------------- staff never see the token
test('staff do not see a guest link token on a reservation', async () => {
  const x = await linkFor(d(1), d(3));
  const asOwner = await owner.get(`/api/reservations/${x.id}`);
  assert.equal(asOwner.status, 200, JSON.stringify(asOwner.data));
  assert.equal(asOwner.data.reservation.guide_token, x.token);
  const asStaff = await staff.get(`/api/reservations/${x.id}`);
  assert.equal(asStaff.status, 200, JSON.stringify(asStaff.data));
  assert.equal('guide_token' in asStaff.data.reservation, false);
  assert.equal(asStaff.data.reservation.limited, true);
  assert.ok(!JSON.stringify(asStaff.data).includes(x.token));
});

// ---------------------------------------------------------------- messages
test('message variables: the guidebook link and door code follow the stay; the Wi-Fi password follows the same window', async () => {
  const open = await linkFor(d(1), d(3));
  const closed = await linkFor(d(2), d(4));
  const vOpen = messaging.variables(await messaging.bookingContext(open.id));
  assert.ok(vOpen.guidebook_link.endsWith(`/#/guide/${open.token}`), vOpen.guidebook_link);
  assert.equal(vOpen.door_code, DOOR);
  assert.equal(vOpen.wifi_password, WIFI);

  const vClosed = messaging.variables(await messaging.bookingContext(closed.id));
  assert.equal(vClosed.door_code, SHARED_EN);
  assert.equal(vClosed.wifi_password, SHARED_EN);
  assert.equal(messaging.render('Code {{door_code}} / Wi-Fi {{wifi_password}}', vClosed), `Code ${SHARED_EN} / Wi-Fi ${SHARED_EN}`);

  const orgId = await orgOf(closed.id);
  const [{ guest_language: before }] = await sql('SELECT guest_language FROM organizations WHERE organization_id = $1', [orgId]);
  await sql(`UPDATE organizations SET guest_language = 'tl' WHERE organization_id = $1`, [orgId]);
  try {
    const tl = messaging.variables(await messaging.bookingContext(closed.id));
    assert.equal(tl.door_code, SHARED_TL);
    assert.equal(tl.wifi_password, SHARED_TL);
    assert.equal(messaging.variables(await messaging.bookingContext(open.id)).door_code, DOOR);
    const page = await guest.get(`/api/public/guide/${closed.token}`);
    assert.equal(page.status, 200);
    assert.equal(page.data.guest_language, 'tl');
  } finally {
    await sql('UPDATE organizations SET guest_language = $2 WHERE organization_id = $1', [orgId, before]);
  }

  const cancelled = await linkFor(d(1), d(3));
  await sql(`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE booking_id = $1`, [cancelled.id]);
  assert.equal(messaging.variables(await messaging.bookingContext(cancelled.id)).guidebook_link, '');

  // A listing with no guidebook yet: the door code says to ask the host, not a blank.
  const bare = await stay(otherListing.unit_id, { checkIn: d(1), checkOut: d(3) });
  const vBare = messaging.variables(await messaging.bookingContext(bare));
  assert.equal(vBare.door_code, '(ask your host)');
  assert.equal(vBare.wifi_password, '(ask your host)');
});

test('message templates: the default check-in text carries the guidebook link, and the variables list names the new fields', async () => {
  const list = await owner.get('/api/message-templates');
  assert.equal(list.status, 200, JSON.stringify(list.data));
  for (const name of ['guidebook_link', 'door_code', 'returning_guest_code', 'wifi_password']) {
    assert.ok(list.data.variables.includes(name), name);
  }
  const checkin = list.data.templates.find((t) => t.system_key === 'checkin');
  assert.ok(checkin.body.includes('{{guidebook_link}}'), 'the seeded check-in text is updated for new workspaces');
  assert.ok(messaging.DEFAULT_TEMPLATES.find((t) => t.system_key === 'checkin').body.includes('{{guidebook_link}}'));
  assert.ok(messaging.TAGLISH_TEMPLATES.checkin.body.includes('{{guidebook_link}}'));

  const open = await linkFor(d(1), d(3));
  const shown = await owner.get(`/api/message-templates/${checkin.template_id}/render?booking_id=${open.id}`);
  assert.equal(shown.status, 200, JSON.stringify(shown.data));
  assert.ok(shown.data.body.includes(`/#/guide/${open.token}`));
  assert.ok(shown.data.body.includes(WIFI));

  const closed = await linkFor(d(2), d(4));
  const hidden = await owner.get(`/api/message-templates/${checkin.template_id}/render?booking_id=${closed.id}`);
  assert.ok(!hidden.data.body.includes(WIFI));
  assert.ok(hidden.data.body.includes(SHARED_EN));
});

test('a language switch does not copy the earlier check-in text as a custom version', async () => {
  await other.get('/api/message-templates');
  const [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE email = $1', ['guide-other@example.com']);
  const legacy = messaging.DEFAULT_TEMPLATES.find((t) => t.system_key === 'checkin').body
    .replace(/Your digital guidebook .*\n\n/, '');
  await sql(`UPDATE message_templates SET body = $2 WHERE organization_id = $1 AND system_key = 'checkin'`, [orgId, legacy]);
  const { copied } = await messaging.setTemplateLanguage(orgId, 'en', null);
  assert.equal(copied, 0);
});

test('returning-guest code: the placeholder never leaks into a message', async () => {
  const x = await linkFor(d(1), d(3));
  const orgId = await orgOf(x.id);
  const [{ template_id: tid }] = await sql(
    `INSERT INTO message_templates (organization_id, name, subject, body) VALUES ($1, 'Returning test', 'Salamat', $2) RETURNING template_id`,
    [orgId, 'Salamat! Your code: {{returning_guest_code}}']);
  const out = await messaging.renderTemplateFor(tid, x.id, 'Owner');
  assert.ok(!out.body.includes('{{'), out.body);
  // lib/returning is added separately; until it exists the variable is empty.
  if (!fs.existsSync(path.join(__dirname, '../src/lib/returning.js'))) assert.equal(out.body, 'Salamat! Your code:');
});
