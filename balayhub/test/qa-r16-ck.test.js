'use strict';

// QA round 16, lane CK (#5, #6): the host sees registered vs booked guests on the check-in card,
// the gate pass and its email; a failed upload while online no longer says "You're offline".
// The views are checked by a source scan (the test runner has no DOM).

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { outbox } = require('../src/lib/mailer');
const gatepass = require('../src/routes/gatepass');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const d = (n) => ical.addDays(manilaToday(), n);
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let srv; let host; let unit; let prop;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Headcount Stays');
  prop = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Paranaque', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1208', unit_type: 'studio', nightly_rate: '2500', max_guests: 8 })).data.unit;
  await host.patch(`/api/properties/${prop.property_id}/gatepass`, { admin_email: 'admin@azure.ph', gatepass_enabled: true });
});
test.after(async () => { await srv.close(); });

let n = 0;
async function stay(numGuests, others) {
  n += 1;
  const start = 2 + n * 4;
  const r = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(start), check_out: d(start + 2), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com', num_guests: numGuests })).data.reservation;
  const token = (await host.get(`/api/reservations/${r.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  const g = client(srv.base);
  await g.post(`/api/public/checkin/${token}`, { lead_name: 'Rafael Diaz', phone: '09171112222', consent: true, guests: others, id_photos: 1 });
  await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  return { r, token, g };
}
const hostNote = async (id) => (await sql(
  `SELECT m.body FROM messages m JOIN conversations c USING (conversation_id) WHERE c.booking_id = $1 AND m.body LIKE 'The guest completed%'`, [id])).map((x) => x.body)[0];

test('registered 6 of 4 booked: host note, check-in card data and gate pass all say booked for 4', async () => {
  const { r, token, g } = await stay(4, ['A One', 'B Two', 'C Three', 'D Four', 'E Five']);
  await wait(300);
  assert.match(await hostNote(r.booking_id), /\(6 guests, .*booked for 4\)\.$/);
  const card = (await host.get(`/api/reservations/${r.booking_id}/checkin`)).data;
  assert.equal(card.num_guests, 4);
  outbox.length = 0;
  await gatepass.sendPass(r.booking_id);
  const m = outbox.find((x) => /Guest gate pass/.test(x.subject));
  assert.match(m.text, /Number of guests: 6 \(booked for 4\)/);
  const gpToken = m.text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1];
  const pub = (await g.get(`/api/public/gatepass/${gpToken}`)).data;
  assert.equal(pub.registered, 6);
  assert.equal(pub.num_guests, 4);
  void token;
});

test('registered equals booked: no "booked for" anywhere', async () => {
  const { r, g } = await stay(3, ['A One', 'B Two']);
  await wait(300);
  assert.doesNotMatch(await hostNote(r.booking_id), /booked for/);
  outbox.length = 0;
  await gatepass.sendPass(r.booking_id);
  const m = outbox.find((x) => /Guest gate pass/.test(x.subject));
  assert.match(m.text, /Number of guests: 3\n/);
  assert.doesNotMatch(m.text, /booked for/);
  void g;
});

test('view scans: guest sentence, host card line, gate pass line, #6 wording, Taglish', () => {
  const v = read('public/js/views/checkin.js');
  const i18n = read('public/js/i18n.js');
  const gp = read('public/js/views/gatepass.js');
  assert.match(v, /This booking is for \{n\} guests\. If more people are coming, your host will see the new number\./);
  assert.match(v, /This booking is for 1 guest\. If more people are coming, your host will see the new number\./);
  assert.match(v, /registered · booked for/);
  assert.match(v, /navigator\.onLine === false/);
  assert.match(v, /That didn't go through\. Your answers are still here; please try again\./);
  assert.match(gp, /booked for/);
  for (const s of [
    'Para sa {n} guests ang booking na ito. Kung mas marami ang darating, makikita ito ng host mo.',
    'Para sa 1 guest ang booking na ito. Kung mas marami ang darating, makikita ito ng host mo.',
    'Hindi natuloy. Nandito pa rin ang mga sagot mo; subukan ulit.']) assert.ok(i18n.includes(s), s);
});
