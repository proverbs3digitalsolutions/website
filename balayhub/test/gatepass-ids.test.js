'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { outbox } = require('../src/lib/mailer');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const d = (n) => ical.addDays(manilaToday(), n);

let srv; let host; let prop; let unit;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Gate Stays');
  prop = (await host.post('/api/properties', { property_name: 'Azure Urban Residences', property_type: 'condominium', address: 'Bicutan Ave', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await host.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Paris 1208', unit_type: 'studio', nightly_rate: '2500', max_guests: 4 })).data.unit;
  await host.patch(`/api/properties/${prop.property_id}/gatepass`, { admin_email: 'admin@azure.ph' });
});
test.after(async () => { await srv.close(); });

const setAttach = async (on) => assert.equal((await host.patch(`/api/properties/${prop.property_id}/gatepass`, { gatepass_attach_ids: on })).status, 200);

async function sentPassWithIds(inDays) {
  const b = (await host.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(inDays), check_out: d(inDays + 2), guest_name: 'Rafael Diaz' })).data.reservation;
  const token = (await host.get(`/api/reservations/${b.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  const g = client(srv.base);
  await g.post(`/api/public/checkin/${token}`, { lead_name: 'Rafael Diaz', phone: '09171112222', guests: ['Ana Diaz'], consent: true, id_photos: 1 });
  await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  outbox.length = 0;
  assert.equal((await host.post(`/api/reservations/${b.booking_id}/gatepass/send`)).status, 200);
  return outbox.at(-1);
}

test('setting on: IDs attached, listed on the pass and served', async () => {
  await setAttach(true);
  const m = await sentPassWithIds(3);
  assert.equal(m.attachments.length, 1);
  assert.match(m.text, /Gate pass with guest IDs/);
  const passToken = m.text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1];
  const g = client(srv.base);
  const p = (await g.get(`/api/public/gatepass/${passToken}`)).data;
  assert.equal(p.ids.length, 1);
  const img = await g.raw('GET', p.ids[0].url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
});

test('setting off: no IDs on the pass, the ID URL 404s like an unknown file', async () => {
  await setAttach(false);
  const m = await sentPassWithIds(10);
  assert.equal(m.attachments, undefined);
  assert.doesNotMatch(m.text, /with guest IDs/);
  const passToken = m.text.match(/#\/gatepass\/([A-Za-z0-9_-]+)/)[1];
  const g = client(srv.base);
  const p = await g.get(`/api/public/gatepass/${passToken}`);
  assert.equal(p.status, 200);
  assert.deepEqual(p.data.ids, []);
  assert.deepEqual(p.data.guests, ['Rafael Diaz', 'Ana Diaz'], 'the rest of the pass still shows');

  // Turn it on to learn the real file URL, then off again: decided at view time.
  await setAttach(true);
  const url = (await g.get(`/api/public/gatepass/${passToken}`)).data.ids[0].url;
  assert.equal((await g.raw('GET', url)).status, 200);
  await setAttach(false);
  assert.deepEqual((await g.get(`/api/public/gatepass/${passToken}`)).data.ids, []);
  const hidden = await g.raw('GET', url);
  const unknown = await g.raw('GET', url.replace(/[0-9a-f-]{36}$/, '00000000-0000-0000-0000-000000000000'));
  assert.equal(hidden.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(hidden.data, unknown.data, 'same response as an unknown file');
  assert.equal(hidden.headers.get('content-type'), unknown.headers.get('content-type'));
});
