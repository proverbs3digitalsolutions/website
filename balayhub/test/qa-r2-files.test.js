'use strict';

// Photo uploads must have the structure of their type, not just the first bytes (QA round 2, ops#12).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

// A real 1x1 PNG (69 bytes), the fixture the other upload tests use.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const PNG_SIGNATURE_AND_HEADER = PNG.subarray(0, 33);
const PNG_END_CHUNK = PNG.subarray(PNG.length - 12);
const PNG_SIGNATURE_ONLY = Buffer.from('89504e470d0a1a0a', 'hex');
const PDF = Buffer.from('%PDF-1.4\n% qa r2 files\n');

// A RIFF/WEBP file of `total` bytes whose first chunk is `chunk`.
function webp(chunk, total = 68, riffSize = total - 8) {
  const body = Buffer.alloc(total);
  body.write('RIFF', 0, 'latin1');
  body.writeUInt32LE(riffSize, 4);
  body.write('WEBP', 8, 'latin1');
  body.write(chunk, 12, 'latin1');
  body.writeUInt32LE(total - 20, 16);
  return body;
}

// Start-of-image, an APP0 marker, padding, then end-of-image.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(60), Buffer.from([0xff, 0xd9])]);

let srv; let owner; let expenseId; let property;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base);
  property = (await owner.post('/api/properties', { property_name: 'Sampaguita', property_type: 'apartment', address: '12 Mabini St', city: 'Bacoor', province: 'Cavite' })).data.property;
  expenseId = (await owner.post('/api/expenses', { property_id: property.property_id, expense_date: manilaToday(), category: 'utilities', amount: '500', description: 'Bill' })).data.expense.expense_id;
});

function upload(body, mime) {
  return owner.raw('POST', `/api/files?record_type=expense&record_id=${expenseId}`, body, { 'Content-Type': mime });
}

async function assertRefused(body, mime) {
  const res = await upload(body, mime);
  assert.equal(res.status, 415, JSON.stringify(res.data));
  assert.equal(res.data.code, 'UNSUPPORTED_FILE');
}

test('a PNG that is only the file signature is refused', async () => {
  await assertRefused(Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png');
});

test('a PNG with no header chunk after the signature is refused', async () => {
  await assertRefused(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(20)]), 'image/png');
  const notIhdr = Buffer.from(PNG);
  notIhdr.write('XXXX', 12, 'latin1');
  await assertRefused(notIhdr, 'image/png');
});

test('a PNG whose last chunk is not IEND is refused', async () => {
  await assertRefused(Buffer.concat([PNG.subarray(0, PNG.length - 12), Buffer.alloc(20)]), 'image/png');
});

test('a PNG under the minimum size is refused even with a header and end chunk', async () => {
  await assertRefused(Buffer.concat([PNG_SIGNATURE_AND_HEADER, PNG_END_CHUNK]), 'image/png');
});

test('a JPEG needs a valid marker after the start marker and an end marker', async () => {
  await assertRefused(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0x00]), Buffer.alloc(60), Buffer.from([0xff, 0xd9])]), 'image/jpeg');
  await assertRefused(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]), 'image/jpeg');
});

test('a WEBP needs a RIFF size that matches the file and a known first chunk', async () => {
  await assertRefused(webp('VP8L', 68, 999), 'image/webp');
  await assertRefused(webp('XYZ '), 'image/webp');
});

test('well-formed PNG, JPEG, WEBP and PDF uploads are still accepted', async () => {
  for (const [body, mime] of [
    [PNG, 'image/png'],
    [JPEG, 'image/jpeg'],
    [webp('VP8 '), 'image/webp'],
    [webp('VP8L'), 'image/webp'],
    [webp('VP8X'), 'image/webp'],
    [PDF, 'application/pdf'],
  ]) {
    const res = await upload(body, mime);
    assert.equal(res.status, 201, `${mime}: ${JSON.stringify(res.data)}`);
  }
});

// A reservation on its own unit, two nights starting three days from today.
async function stay(unitName) {
  const unit = (await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: unitName, unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: ical.addDays(manilaToday(), 3), check_out: ical.addDays(manilaToday(), 5), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com' });
  assert.ok(r.data.reservation, JSON.stringify(r.data));
  return r.data.reservation;
}

test('a signature-only PNG is refused as a unit photo', async () => {
  const unit = (await owner.post(`/api/properties/${property.property_id}/units`, { unit_name: 'Photo', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const up = await owner.raw('POST', `/api/units/${unit.unit_id}/photos`, PNG_SIGNATURE_ONLY, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 415, JSON.stringify(up.data));
  assert.equal(up.data.code, 'UNSUPPORTED_FILE');
});

test('a signature-only PNG is refused as a payment screenshot', async () => {
  // A guest can only send a proof once manual payment details are on.
  assert.equal((await owner.patch('/api/workspace/manual-payments', { enabled: true, instructions: 'GCash 0917 123 4567 (Maria Santos)' })).status, 200);
  const b = await stay('Pay');
  const link = (await owner.get(`/api/reservations/${b.booking_id}/payment-link`)).data.link;
  const token = link.split('/#/pay/')[1];
  const guest = client(srv.base);
  const proof = await guest.post(`/api/public/pay/${token}/proofs`, { amount: '1000', method: 'gcash' });
  assert.equal(proof.status, 201, JSON.stringify(proof.data));
  const up = await guest.post(`/api/public/pay/${token}/proofs/${proof.data.proof_id}/image`, PNG_SIGNATURE_ONLY, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 415, JSON.stringify(up.data));
  assert.equal(up.data.code, 'UNSUPPORTED_FILE');
});

test('a signature-only PNG, JPEG or WEBP is refused as a guest ID photo', async () => {
  const b = await stay('Guest');
  const token = (await owner.get(`/api/reservations/${b.booking_id}/checkin`)).data.link.split('/checkin/')[1];
  const guest = client(srv.base);
  const form = await guest.post(`/api/public/checkin/${token}`, { lead_name: 'Rafael Diaz', phone: '09171112222', consent: true, guests: ['Ana Diaz'] });
  assert.equal(form.status, 200, JSON.stringify(form.data));
  for (const [body, mime] of [
    [PNG_SIGNATURE_ONLY, 'image/png'],
    [Buffer.from('ffd8ff', 'hex'), 'image/jpeg'],
    [Buffer.from('524946460000000057454250', 'hex'), 'image/webp'], // "RIFF", a zero size, "WEBP" and no chunk
  ]) {
    const up = await guest.post(`/api/public/checkin/${token}/id`, body, { 'Content-Type': mime });
    assert.equal(up.status, 415, `${mime}: ${JSON.stringify(up.data)}`);
    assert.equal(up.data.code, 'UNSUPPORTED_FILE');
  }
});

test.after(async () => { await srv.close(); });
