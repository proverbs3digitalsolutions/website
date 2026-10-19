'use strict';

// QA round 18, lane CF: Reports and Profit and loss say how many channel stays have no
// channel fee entered (a count only, never money), scoped like the report itself. The view
// part is a source scan because the views import app.js, which can't load in Node.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, ownerAccount } = require('./helpers');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

let srv; let host; let mgr; let a; let b; let p2;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'QA R18 CF');
  const mk = async (name, address) => (await host.post('/api/properties', { property_name: name, property_type: 'condominium', address, city: 'Taguig', province: 'Metro Manila' })).data.property;
  const p1 = await mk('Azure', 'Bicutan Ave'); p2 = await mk('Grass', 'Road 8');
  a = (await host.post(`/api/properties/${p1.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  b = (await host.post(`/api/properties/${p2.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const r = (unit, ci, co, extra) => host.post('/api/reservations', { unit_id: unit.unit_id, check_in: ci, check_out: co, guest_name: 'G', ...extra });
  await r(a, '2026-03-02', '2026-03-04', { channel: 'airbnb' });
  await r(a, '2026-03-10', '2026-03-12', { channel: 'airbnb' });
  await r(a, '2026-03-15', '2026-03-17', { channel: 'airbnb', channel_fee: '300' }); // fee entered
  await r(a, '2026-03-20', '2026-03-22'); // direct: never counted
  await r(b, '2026-03-05', '2026-03-07', { channel: 'booking' });
  const inv = await host.post('/api/team/invitations', { email: 'mgr@example.com', role: 'manager', property_ids: [p2.property_id] });
  mgr = client(srv.base);
  await mgr.post('/api/auth/signup', { full_name: 'Mona Manager', email: 'mgr@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); });

const counts = (rows) => Object.fromEntries(rows.map((x) => [x.channel, x.stays]));

test('stay report lists channel stays with no fee entered, per channel, never direct', async () => {
  const r = (await host.get('/api/stay-reports?month=2026-03')).data;
  assert.deepEqual(counts(r.missing_fees), { airbnb: 2, booking: 1 });
  assert.ok(r.missing_fees.every((x) => x.label && Object.keys(x).sort().join() === 'channel,label,stays'), 'a count and a name only, no money');
});

test('the missing-fee count follows the channel, property and listing filters', async () => {
  assert.deepEqual(counts((await host.get('/api/stay-reports?month=2026-03&channel=airbnb')).data.missing_fees), { airbnb: 2 });
  assert.deepEqual(counts((await host.get(`/api/stay-reports?month=2026-03&property_id=${p2.property_id}`)).data.missing_fees), { booking: 1 });
});

test('a manager counts only their own properties', async () => {
  const r = (await mgr.get('/api/stay-reports?month=2026-03')).data;
  assert.deepEqual(counts(r.missing_fees), { booking: 1 });
  const p = (await mgr.get('/api/stay-reports/missing-fees?month=2026-03')).data;
  assert.deepEqual(counts(p.missing_fees), { booking: 1 });
});

test('the Profit and loss count uses its own basis: stays that checked out in the month', async () => {
  const p = (await host.get('/api/stay-reports/missing-fees?month=2026-03')).data;
  assert.deepEqual(counts(p.missing_fees), { airbnb: 2, booking: 1 });
  assert.deepEqual(counts((await host.get('/api/stay-reports/missing-fees?month=2026-04')).data.missing_fees), {});
  assert.equal((await host.get('/api/stay-reports/missing-fees?month=nope')).status, 400);
});

test('the views show the note with a link to the bookings, and tie date errors to the boxes', () => {
  const sr = read('public/js/views/stayreports.js');
  assert.match(sr, /no channel fee entered\. /);
  assert.match(sr, /#\/reservations\$\{qs\(/);
  assert.match(sr, /aria-describedby/);
  const pnl = read('public/js/views/pnl.js');
  assert.match(pnl, /missing-fees/);
  assert.match(pnl, /no channel fee entered\. /);
});
