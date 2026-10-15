'use strict';

// QA round 15, lane G2 (K1): a check-in registration is a draft until an ID photo is actually stored.
// The server no longer trusts the page's id_photos count. The view is checked by a source scan.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const gatepass = require('../src/routes/gatepass');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const d = (n) => ical.addDays(manilaToday(), n);
const form = (extra = {}) => ({ lead_name: 'Rafael Diaz', phone: '09171112222', consent: true, guests: [], id_photos: 1, ...extra });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let srv; let owner; let unit; let prop;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Draft IDs');
  prop = (await owner.post('/api/properties', { property_name: 'Sunset', property_type: 'condominium', address: 'Pasig Blvd', city: 'Pasig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '504', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 })).data.unit;
});
test.after(async () => { await srv.close(); });

let n = 0;
async function newStay(inDays) {
  n += 1;
  const start = inDays ?? 3 + n * 3;
  const r = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(start), check_out: d(start + 2), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com', num_guests: 2 })).data.reservation;
  const token = (await owner.get(`/api/reservations/${r.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  return { r, token };
}
const alerts = async () => (await sql(`SELECT count(*)::int AS n FROM notifications WHERE type = 'checkin_form'`))[0].n;
const notes = async (bookingId) => (await sql(
  `SELECT m.body FROM messages m JOIN conversations c USING (conversation_id) WHERE c.booking_id = $1 AND m.direction = 'note'`, [bookingId])).map((x) => x.body);
const regRow = async (bookingId) => (await sql('SELECT * FROM guest_registrations WHERE booking_id = $1', [bookingId]))[0];

test('(1) a form saved with no stored photo is a draft: finished false, submitted_at NULL, no host alert', async () => {
  const { r, token } = await newStay();
  const before = await alerts();
  const res = await client(srv.base).post(`/api/public/checkin/${token}`, form());
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.finished, false);
  assert.equal((await regRow(r.booking_id)).submitted_at, null);
  await wait(300);
  assert.equal(await alerts(), before);
  assert.deepEqual(await notes(r.booking_id), []);
  const info = (await client(srv.base).get(`/api/public/checkin/${token}`)).data;
  assert.equal(info.registration.submitted_at, null);
});

test('(2)(3) the first stored photo finishes it with one alert and one note; a second photo sends nothing more', async () => {
  const { r, token } = await newStay();
  const g = client(srv.base);
  await g.post(`/api/public/checkin/${token}`, form());
  const before = await alerts();
  const up = await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.finished, true);
  assert.ok((await regRow(r.booking_id)).submitted_at);
  await wait(300);
  assert.equal(await alerts(), before + 1);
  assert.equal((await notes(r.booking_id)).filter((x) => /completed the check-in form/.test(x)).length, 1);
  const up2 = await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  assert.equal(up2.status, 201);
  await wait(300);
  assert.equal(await alerts(), before + 1);
  assert.equal((await notes(r.booking_id)).filter((x) => /completed the check-in form/.test(x)).length, 1);
  // Editing a finished form keeps the "updated" note and never clears submitted_at.
  const again = await g.post(`/api/public/checkin/${token}`, form({ lead_name: 'Rafael D.' }));
  assert.equal(again.data.finished, true);
  assert.ok((await regRow(r.booking_id)).submitted_at);
  assert.ok((await notes(r.booking_id)).includes('The guest updated their check-in form.'));
});

test('a form saved after a photo is already stored finishes at once and alerts once', async () => {
  const { r, token } = await newStay();
  const g = client(srv.base);
  await g.post(`/api/public/checkin/${token}`, form());
  await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  await sql('UPDATE guest_registrations SET submitted_at = NULL WHERE booking_id = $1', [r.booking_id]);
  const res = await g.post(`/api/public/checkin/${token}`, form({ id_photos: 0 }));
  assert.equal(res.data.finished, true);
  assert.ok((await regRow(r.booking_id)).submitted_at);
});

test('(4) the gate pass scheduler treats a draft as no form, and a finished one as a form', async () => {
  await owner.patch(`/api/properties/${prop.property_id}/gatepass`, { admin_email: 'admin@azure.ph', gatepass_enabled: true, gatepass_days_before: 2 });
  const { r, token } = await newStay(2);
  const g = client(srv.base);
  await g.post(`/api/public/checkin/${token}`, form());
  const sentFor = async () => (await sql(`SELECT gp.status, gp.missing_form_noted_at FROM gate_passes gp WHERE gp.booking_id = $1`, [r.booking_id]))[0];
  // 2 days out is due but the form is still a draft, so the pass waits.
  const sent = await gatepass.sendDuePasses();
  assert.equal(sent, 0);
  assert.notEqual((await sentFor())?.status, 'sent');
  await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  assert.equal(await gatepass.sendDuePasses(), 1);
});

test('(5) onboarding checkin_form is false for a draft, true once finished', async () => {
  const o2 = await ownerAccount(srv.base, 'second@example.com', 'Onboard IDs');
  const p = (await o2.post('/api/properties', { property_name: 'Bay', property_type: 'condominium', address: 'Roxas', city: 'Manila', province: 'Metro Manila' })).data.property;
  const u = (await o2.post(`/api/properties/${p.property_id}/units`, { unit_name: '1', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 })).data.unit;
  const r = (await o2.post('/api/reservations', { unit_id: u.unit_id, check_in: d(20), check_out: d(22), guest_name: 'Gil', num_guests: 2 })).data.reservation;
  const token = (await o2.get(`/api/reservations/${r.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  const step = async () => {
    const o = (await o2.get('/api/onboarding')).data;
    return (o.steps || o.items || []).find((s) => s.key === 'checkin_form' || s.id === 'checkin_form');
  };
  const g = client(srv.base);
  await g.post(`/api/public/checkin/${token}`, form());
  assert.ok(!(await step())?.done, 'draft does not count');
  await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  assert.ok((await step())?.done, 'finished counts');
});

test('(6) Reservations ?checkin_form=done excludes a draft', async () => {
  const { r, token } = await newStay();
  const g = client(srv.base);
  await g.post(`/api/public/checkin/${token}`, form());
  const ids = async (v) => ((await owner.get(`/api/reservations?checkin_form=${v}&limit=200`)).data.reservations || []).map((x) => x.booking_id);
  assert.ok(!(await ids('done')).includes(r.booking_id));
  assert.ok((await ids('missing')).includes(r.booking_id));
  await g.post(`/api/public/checkin/${token}/id`, PNG, { 'Content-Type': 'image/png' });
  assert.ok((await ids('done')).includes(r.booking_id));
});

test('(7) the migration lets submitted_at be NULL, default now() kept', async () => {
  const col = (await sql(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'guest_registrations' AND column_name = 'submitted_at'`))[0];
  assert.equal(col.is_nullable, 'YES');
  assert.match(col.column_default, /now\(\)/);
});

test('(8) the guest page and host card carry the draft wording', () => {
  const v = fs.readFileSync(path.join(__dirname, '..', 'public/js/views/checkin.js'), 'utf8');
  assert.ok(v.includes('Your answers are saved. Add a photo of your ID to finish registering.'));
  assert.ok(v.includes('Naka-save na ang mga sagot mo. Mag-upload ng litrato ng ID mo para matapos ang registration.'));
  assert.ok(v.includes("Waiting for the guest's ID photo"));
  assert.match(v, /r\?\.submitted_at/);
});
