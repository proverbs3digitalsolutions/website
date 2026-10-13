'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { outbox } = require('../src/lib/mailer');
const gatepass = require('../src/routes/gatepass');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const d = (n) => ical.addDays(manilaToday(), n);

let srv; let host; let prop; let unit;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Gate Stays');
  prop = (await host.post('/api/properties', { property_name: 'Azure Urban Residences', property_type: 'condominium', address: 'Bicutan Ave', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2500', max_guests: 4 })).data.unit;
});
test.after(async () => { await srv.close(); });

const newStay = async (inDays, name = 'Rafael Diaz', nights = 2) => (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(inDays), check_out: d(inDays + nights), guest_name: name })).data.reservation;
const fillForm = async (booking, ids = 1) => {
  const token = (await host.get(`/api/reservations/${booking.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  const g = client(srv.base);
  await g.post(`/api/public/checkin/${token}`, { lead_name: 'Rafael Diaz', phone: '09171112222', guests: ['Ana Diaz'], arrival_time: '15:30', vehicle_plate: 'ABC 1234', consent: true });
  for (let i = 0; i < ids; i += 1) await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
};

test('settings: admin emails validated; automatic sending needs an email', async () => {
  assert.equal((await host.patch(`/api/properties/${prop.property_id}/gatepass`, { gatepass_enabled: true })).status, 400);
  assert.equal((await host.patch(`/api/properties/${prop.property_id}/gatepass`, { admin_email: 'not-an-email' })).status, 400);
  const r = await host.patch(`/api/properties/${prop.property_id}/gatepass`, {
    admin_email: 'Admin@Azure.ph, security@azure.ph', gatepass_enabled: true, gatepass_days_before: 2, gatepass_authorized_by: 'Maria Santos', gatepass_notes: 'Parking slot B2-15.',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const s = (await host.get('/api/gatepass/settings')).data.properties[0];
  assert.equal(s.admin_email, 'admin@azure.ph, security@azure.ph');
  assert.equal(s.gatepass_days_before, 2);
});

let passToken;
test('scheduler sends when due and the form is in; waits for the form until the day before', async () => {
  const later = await newStay(10);           // not due yet
  const due = await newStay(2);               // due, form filled
  const noForm = await newStay(5);            // not due
  void later; void noForm;
  await fillForm(due);
  outbox.length = 0;
  assert.equal(await gatepass.sendDuePasses(), 1);
  const m = outbox.find((x) => /Guest gate pass/.test(x.subject));
  assert.equal(m.to, 'admin@azure.ph, security@azure.ph');
  assert.match(m.text, /1\. Rafael Diaz\n {2}2\. Ana Diaz/);
  assert.match(m.text, /Vehicle plate: ABC 1234/);
  assert.match(m.text, /expected arrival 3:30 PM/);
  assert.match(m.text, /Parking slot B2-15/);
  assert.match(m.text, /Authorized by: Maria Santos/);
  assert.equal(m.attachments, undefined, 'IDs not attached unless chosen');
  passToken = m.text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1];
  assert.equal(await gatepass.sendDuePasses(), 0, 'sent once');

  // Tomorrow's arrival without a form: sent anyway, host told once.
  const tomorrow = await newStay(1, 'No Form Yet', 1);
  outbox.length = 0;
  assert.equal(await gatepass.sendDuePasses(), 1);
  assert.ok(outbox.some((x) => /No Form Yet/.test(x.text)));
  const inbox = (await host.get('/api/inbox?view=unread')).data.conversations;
  assert.ok(inbox.some((c) => /hasn't filled in the check-in form/.test(c.last_body)));
  const st = (await host.get(`/api/reservations/${tomorrow.booking_id}/gatepass`)).data;
  assert.equal(st.pass.status, 'sent');
});

test('admin page shows names and IDs, confirms receipt; expires after check-out', async () => {
  // IDs show on the link only when the host chose to include them.
  await host.patch(`/api/properties/${prop.property_id}/gatepass`, { gatepass_attach_ids: true });
  const g = client(srv.base);
  const p = (await g.get(`/api/public/gatepass/${passToken}`)).data;
  assert.deepEqual(p.guests, ['Rafael Diaz', 'Ana Diaz']);
  assert.equal(p.unit, 'Paris 1208');
  assert.equal(p.ids.length, 1);
  assert.equal(p.guest_phone, '09171112222');
  const img = await g.raw('GET', p.ids[0].url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await g.raw('GET', p.ids[0].url.replace(/[0-9a-f-]{36}$/, '00000000-0000-0000-0000-000000000000'))).status, 404);
  assert.equal((await g.post(`/api/public/gatepass/${passToken}/ack`)).status, 200);
  const bookingId = (await sql('SELECT booking_id FROM gate_passes WHERE token = $1', [passToken]))[0].booking_id;
  assert.equal((await host.get(`/api/reservations/${bookingId}/gatepass`)).data.pass.status, 'acknowledged');
  assert.equal((await g.get('/api/public/gatepass/not-a-real-token-1234567')).status, 404);
  await sql(`UPDATE bookings SET check_in = $2, check_out = $3 WHERE booking_id = $1`, [bookingId, d(-6), d(-4)]);
  assert.equal((await g.get(`/api/public/gatepass/${passToken}`)).status, 404);
});

test('send by hand with IDs attached; staff and other workspaces can\'t', async () => {
  await host.patch(`/api/properties/${prop.property_id}/gatepass`, { gatepass_attach_ids: true, gatepass_enabled: false });
  const b = await newStay(20);
  await fillForm(b, 2);
  outbox.length = 0;
  const r = await host.post(`/api/reservations/${b.booking_id}/gatepass/send`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const m = outbox.at(-1);
  assert.equal(m.attachments.length, 2);
  const tok1 = m.text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1];
  // Sending again to the same admin keeps the link.
  await host.post(`/api/reservations/${b.booking_id}/gatepass/send`);
  const st = (await host.get(`/api/reservations/${b.booking_id}/gatepass`)).data.pass;
  assert.equal(st.send_count, 2);
  assert.equal(outbox.at(-1).text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1], tok1);
  // A corrected admin email gets a new link; the old recipient loses access.
  await host.patch(`/api/properties/${prop.property_id}/gatepass`, { admin_email: 'newadmin@azure.ph' });
  await host.post(`/api/reservations/${b.booking_id}/gatepass/send`);
  const tok2 = outbox.at(-1).text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1];
  assert.notEqual(tok2, tok1);
  assert.equal((await client(srv.base).get(`/api/public/gatepass/${tok1}`)).status, 404);
  assert.equal((await client(srv.base).get(`/api/public/gatepass/${tok2}`)).status, 200);

  // Moved to another building: the old link stops working and the new building gets a pass.
  const p2 = (await host.post('/api/properties', { property_name: 'Grass Residences', property_type: 'condominium', address: 'EDSA', city: 'Quezon City', province: 'Metro Manila' })).data.property;
  const u2 = (await host.post(`/api/properties/${p2.property_id}/units`, { unit_name: 'T1-805', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 })).data.unit;
  await host.patch(`/api/properties/${p2.property_id}/gatepass`, { admin_email: 'admin@grass.ph', gatepass_enabled: true, gatepass_days_before: 7 });
  const moved = await newStay(4, 'Mover', 1);
  await host.post(`/api/reservations/${moved.booking_id}/gatepass/send`);
  const tokA = outbox.at(-1).text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1];
  assert.equal((await host.patch(`/api/reservations/${moved.booking_id}`, { unit_id: u2.unit_id })).status, 200);
  assert.equal((await client(srv.base).get(`/api/public/gatepass/${tokA}`)).status, 404);
  await fillForm(moved, 0);
  outbox.length = 0;
  assert.ok(await gatepass.sendDuePasses() >= 1);
  assert.ok(outbox.some((x) => x.to === 'admin@grass.ph' && /T1-805/.test(x.text)));

  // Stays that are over can't be sent.
  const past = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-9), check_out: d(-8), guest_name: 'Past' })).data.reservation;
  assert.equal((await host.post(`/api/reservations/${past.booking_id}/gatepass/send`)).status, 409);

  const inv = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  const staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal((await staff.post(`/api/reservations/${b.booking_id}/gatepass/send`)).status, 403);
  const other = await ownerAccount(srv.base, 'x@example.com', 'Other');
  assert.equal((await other.post(`/api/reservations/${b.booking_id}/gatepass/send`)).status, 404);
  assert.equal((await other.patch(`/api/properties/${prop.property_id}/gatepass`, { admin_email: 'evil@example.com' })).status, 404);
});
