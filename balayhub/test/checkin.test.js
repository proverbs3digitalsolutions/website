'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';
process.env.GUEST_ID_RETENTION_DAYS = '30';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { purgeOldIds } = require('../src/routes/checkin');
const messaging = require('../src/lib/messaging');

let srv; let owner; let prop; let unit; let res;
const d = (n) => ical.addDays(manilaToday(), n);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Check-in Stays');
});
test.after(async () => { await srv.close(); });

test('onboarding checklist tracks real progress and can be hidden', async () => {
  let o = (await owner.get('/api/onboarding')).data;
  assert.equal(o.total, 6);
  assert.equal(o.done, 0);
  assert.equal(o.steps[0].key, 'listings');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, wifi_name: 'Net' })).data.unit;
  res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(3), check_out: d(5), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com', num_guests: 3 })).data.reservation;
  o = (await owner.get('/api/onboarding')).data;
  assert.deepEqual(o.steps.filter((x) => x.done).map((x) => x.key), ['listings', 'guest_info', 'reservation']);
  assert.equal((await owner.post('/api/onboarding/dismiss')).status, 200);
  assert.equal((await owner.get('/api/onboarding')).data.dismissed, true);
  await owner.post('/api/onboarding/dismiss', { show: true });
  assert.equal((await owner.get('/api/onboarding')).data.dismissed, false);
});

let link; let token;
test('host gets a private check-in link; it appears in message templates', async () => {
  const c = await owner.get(`/api/reservations/${res.booking_id}/checkin`);
  assert.equal(c.status, 200);
  assert.equal(c.data.registration, null);
  link = c.data.link;
  token = link.split('/checkin/')[1];
  assert.ok(token.length >= 20);
  const tpl = (await owner.get('/api/message-templates')).data.templates.find((t) => t.system_key === 'confirmation');
  const r = await owner.get(`/api/message-templates/${tpl.template_id}/render?booking_id=${res.booking_id}`);
  assert.ok(r.data.body.includes(link), 'confirmation template contains the link');
});

test('guest fills in the form and uploads IDs without an account', async () => {
  const guest = client(srv.base);
  const info = await guest.get(`/api/public/checkin/${token}`);
  assert.equal(info.status, 200);
  assert.equal(info.data.stay.listing, '1201');
  assert.equal(info.data.stay.guest_first_name, 'Rafael');
  assert.equal(info.data.registration, null);
  assert.equal(info.data.stay.guests_allowed, 4);

  assert.equal((await guest.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' })).status, 409, 'form first');
  const noConsent = await guest.post(`/api/public/checkin/${token}`, { lead_name: 'Rafael Diaz', phone: '09171112222', guests: ['Ana Diaz'] });
  assert.equal(noConsent.status, 400);
  assert.ok(noConsent.data.fields.consent);
  const tooMany = await guest.post(`/api/public/checkin/${token}`, { lead_name: 'R', phone: '09171112222', consent: true, guests: ['a', 'b', 'c', 'd'] });
  assert.equal(tooMany.status, 400);
  const ok = await guest.post(`/api/public/checkin/${token}`, {
    lead_name: 'Rafael Diaz', phone: '09171112222', email: 'rafael@example.com', guests: ['Ana Diaz', '  ', 'Leo Diaz'],
    arrival_time: '15:30', vehicle_plate: 'abc 1234', consent: true,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const up = await guest.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 201);
  assert.equal((await guest.post(`/api/public/checkin/${token}/id`, Buffer.from('not an image'), { 'Content-Type': 'image/png' })).status, 415);

  const again = await guest.get(`/api/public/checkin/${token}`);
  assert.deepEqual(again.data.registration.guests, ['Ana Diaz', 'Leo Diaz']);
  assert.equal(again.data.registration.vehicle_plate, 'ABC 1234');
  assert.equal(again.data.registration.id_count, 1);

  assert.equal((await guest.get('/api/public/checkin/short')).status, 404);
  assert.equal((await guest.get('/api/public/checkin/aaaaaaaaaaaaaaaaaaaaaaaa')).status, 404);
});

test('host sees the registration and ID photos; inbox note; staff and other workspaces cannot', async () => {
  const c = await owner.get(`/api/reservations/${res.booking_id}/checkin`);
  assert.equal(c.data.registration.lead_name, 'Rafael Diaz');
  assert.equal(c.data.files.length, 1);
  const img = await owner.raw('GET', `/api/files/${c.data.files[0].file_id}`);
  assert.equal(img.status, 200);
  const inbox = (await owner.get('/api/inbox?view=unread')).data.conversations;
  assert.ok(inbox.some((x) => /check-in form/.test(x.last_body)));

  const inv = await owner.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  const staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal((await staff.get(`/api/reservations/${res.booking_id}/checkin`)).status, 403);
  assert.equal((await staff.raw('GET', `/api/files/${c.data.files[0].file_id}`)).status, 403);
  // Hosts can't upload into a guest registration through the normal upload route.
  const reg = c.data.registration.registration_id;
  assert.equal((await owner.raw('POST', `/api/files?record_type=registration&record_id=${reg}`, PNG, { 'Content-Type': 'image/png' })).status, 400);

  const other = await ownerAccount(srv.base, 'x@example.com', 'Other');
  assert.equal((await other.get(`/api/reservations/${res.booking_id}/checkin`)).status, 404);
  assert.equal((await other.raw('GET', `/api/files/${c.data.files[0].file_id}`)).status, 404);
});

test('replacing the link kills the old one; form closes after the stay; IDs are deleted later', async () => {
  const n = await owner.post(`/api/reservations/${res.booking_id}/checkin/new-link`);
  const newToken = n.data.link.split('/checkin/')[1];
  assert.notEqual(newToken, token);
  assert.equal((await client(srv.base).get(`/api/public/checkin/${token}`)).status, 404);

  await sql(`UPDATE bookings SET check_in = $2, check_out = $3 WHERE booking_id = $1`, [res.booking_id, d(-40), d(-35)]);
  const closed = await client(srv.base).get(`/api/public/checkin/${newToken}`);
  assert.equal(closed.data.stay.closed, true);
  assert.equal((await client(srv.base).post(`/api/public/checkin/${newToken}`, { lead_name: 'X', phone: '09171112222', consent: true })).status, 409);

  assert.equal(await purgeOldIds(), 1);
  const files = await sql(`SELECT COUNT(*)::int AS n FROM files WHERE related_record_type = 'registration'`);
  assert.equal(files[0].n, 0);
  const c = await owner.get(`/api/reservations/${res.booking_id}/checkin`);
  assert.ok(c.data.registration.ids_purged_at);
  assert.equal(c.data.registration.lead_name, 'Rafael Diaz', 'names are kept for the record');
  assert.equal(await purgeOldIds(), 0);
});

test('checkin_link variable is listed for templates', () => {
  assert.ok(messaging.VARIABLE_NAMES.includes('checkin_link'));
});
