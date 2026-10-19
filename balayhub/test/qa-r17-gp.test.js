'use strict';

// QA round 17, lane GP (#9, O7): the gate pass counts registered people and says the booked number
// when it differs, also when only the main guest has registered ("1 (booked for 2)").

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { outbox } = require('../src/lib/mailer');
const gatepass = require('../src/routes/gatepass');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const d = (n) => ical.addDays(manilaToday(), n);

let srv; let host; let unit;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Headcount Stays');
  const prop = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1208', unit_type: 'studio', nightly_rate: '2500', max_guests: 8 })).data.unit;
  await host.patch(`/api/properties/${prop.property_id}/gatepass`, { admin_email: 'admin@azure.ph', gatepass_enabled: true });
});
test.after(async () => { await srv.close(); });

let n = 0;
async function stay(numGuests, others) {
  n += 1;
  const start = 2 + n * 4;
  const r = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(start), check_out: d(start + 2), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com', num_guests: numGuests })).data.reservation;
  if (others) {
    const token = (await host.get(`/api/reservations/${r.booking_id}/checkin`)).data.link.split('/checkin/')[1];
    const g = client(srv.base);
    await g.post(`/api/public/checkin/${token}`, { lead_name: 'Rafael Diaz', phone: '09171112222', consent: true, guests: others, id_photos: 1 });
    await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  }
  outbox.length = 0;
  await gatepass.sendPass(r.booking_id);
  const m = outbox.find((x) => /Guest gate pass/.test(x.subject));
  const pub = (await client(srv.base).get(`/api/public/gatepass/${m.text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1]}`)).data;
  return { text: m.text, pub };
}

test('2 booked, only the main guest registered: "1 (booked for 2)"', async () => {
  const { text, pub } = await stay(2, []);
  assert.equal(pub.registered, 1);
  assert.match(text, /Number of guests: 1 \(booked for 2\)/);
});

test('4 booked, 6 registered stays "6 (booked for 4)"', async () => {
  const { text } = await stay(4, ['A One', 'B Two', 'C Three', 'D Four', 'E Five']);
  assert.match(text, /Number of guests: 6 \(booked for 4\)/);
});

test('no registration shows the booked number only', async () => {
  const { text, pub } = await stay(2, null);
  assert.equal(pub.registered, null);
  assert.match(text, /Number of guests: 2\n/);
});

test('view: guestCountText gives the same three answers', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/gatepass.js'), 'utf8');
  const m = src.match(/export function guestCountText\(d\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'guestCountText exported');
  const guestCountText = new Function(`${m[0].replace('export ', '')}; return guestCountText;`)();
  assert.equal(guestCountText({ guests: ['A'], num_guests: 2, registered: 1 }), '1 (booked for 2)');
  assert.equal(guestCountText({ guests: ['A', 'B', 'C', 'D', 'E', 'F'], num_guests: 4, registered: 6 }), '6 (booked for 4)');
  assert.equal(guestCountText({ guests: ['A'], num_guests: 2, registered: null }), '2');
  assert.match(src, /guestCountText\(d\)/);
});
