'use strict';

// Round 29 (GUEST-EMPTY, D-111): the three guest-facing upload routes answer an empty body with 400 EMPTY_FILE
// (not the wrong-type 415), after the access checks; the guest pages refuse a 0-byte file before sending.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const EMPTY = 'This file is empty. Choose the file again.';
const TL = 'Walang laman ang file. Piliin ulit ang file.';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

let srv; let owner; let guest; let unit; let booking; let ckToken; let payToken; let proofId;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'guest-empty-r29@example.com', 'Guest Empty');
  guest = client(srv.base);
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 })).data.unit;
  booking = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: ical.addDays(manilaToday(), 3), check_out: ical.addDays(manilaToday(), 5), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com', num_guests: 2 })).data.reservation;
  ckToken = (await owner.get(`/api/reservations/${booking.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  assert.equal((await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: 'GCash 0917 123 4567' })).status, 200);
  payToken = (await owner.get(`/api/reservations/${booking.booking_id}/payment-link`)).data.link.split('/#/pay/')[1];
  const p = await guest.post(`/api/public/pay/${payToken}/proofs`, { amount: '1000', method: 'gcash' });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  proofId = p.data.proof_id;
});
test.after(async () => { await srv.close(); });

const isEmpty = (r) => { assert.equal(r.status, 400, JSON.stringify(r.data)); assert.equal(r.data.code, 'EMPTY_FILE'); assert.equal(r.data.error, EMPTY); };

test('guest ID photo: an empty body is EMPTY_FILE; a wrong type is still 415; nothing stored', async () => {
  isEmpty(await guest.raw('POST', `/api/public/checkin/${ckToken}/id`, Buffer.alloc(0), { 'Content-Type': 'image/png' }));
  isEmpty(await guest.raw('POST', `/api/public/checkin/${ckToken}/id`, Buffer.alloc(0), { 'Content-Type': 'text/plain' }));
  assert.equal((await guest.raw('POST', `/api/public/checkin/${ckToken}/id`, Buffer.from('hi'), { 'Content-Type': 'text/plain' })).status, 415);
});

test('guest payment screenshot: an empty body is EMPTY_FILE; a wrong type is still 415; nothing stored', async () => {
  const url = `/api/public/pay/${payToken}/proofs/${proofId}/image`;
  isEmpty(await guest.raw('POST', url, Buffer.alloc(0), { 'Content-Type': 'image/png' }));
  isEmpty(await guest.raw('POST', url, Buffer.alloc(0), { 'Content-Type': 'text/plain' }));
  assert.equal((await guest.raw('POST', url, Buffer.from('hi'), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await sql(`SELECT count(*)::int AS n FROM files WHERE related_record_id = $1`, [proofId]))[0].n, 0);
});

test('direct-booking listing photo: an empty body is EMPTY_FILE; access checks come first', async () => {
  const url = `/api/units/${unit.unit_id}/photos`;
  isEmpty(await owner.raw('POST', url, Buffer.alloc(0), { 'Content-Type': 'image/png' }));
  assert.equal((await owner.raw('POST', url, Buffer.from('hi'), { 'Content-Type': 'text/plain' })).status, 415);
  const stranger = await ownerAccount(srv.base, 'guest-empty-other-r29@example.com', 'Other');
  assert.notEqual((await stranger.raw('POST', url, Buffer.alloc(0), { 'Content-Type': 'image/png' })).data.code, 'EMPTY_FILE');
  assert.equal((await owner.raw('POST', url, PNG, { 'Content-Type': 'image/png' })).status, 201);
});

test('the guest pages refuse a 0-byte file before sending, in English and Taglish', () => {
  const ck = read('public/js/views/checkin.js'); const pay = read('public/js/views/pay.js'); const ls = read('public/js/views/listings.js');
  assert.match(ck, /f\.size === 0/); assert.ok(ck.includes(`t('${EMPTY}')`));
  assert.ok(ck.indexOf('f.size === 0') < ck.indexOf('shrinkImage(f)'), 'checked before the photo is shrunk');
  assert.equal(pay.split("!file.size").length - 1 + pay.split('!f.size').length - 1, 2, 'both proof uploads check size');
  assert.ok(pay.includes(`t('${EMPTY}')`));
  assert.ok(ls.includes(EMPTY) && /!f\.size/.test(ls));
  assert.ok(read('public/js/i18n.js').includes(`'${EMPTY}': '${TL}'`));
});
