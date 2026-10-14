'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';
process.env.GUEST_ID_RETENTION_DAYS = '30';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

// QA round 2, guest pages: the check-in payload says whether the guest already checked in (guest#4),
// and the four guest pages title an error by its cause, not always "Link not found" (guest#3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, ownerAccount, manilaToday, sql } = require('./helpers');
const ical = require('../src/lib/ical');

const view = (f) => fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');

test('the check-in link says whether the guest has checked in', async () => {
  const srv = await startServer();
  try {
    const owner = await ownerAccount(srv.base, 'gp-host@example.com', 'Guest Pages');
    const prop = (await owner.post('/api/properties', { property_name: 'Cove', property_type: 'condominium', address: 'Ayala Ave', city: 'Makati', province: 'Metro Manila' })).data.property;
    const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Cove 1', unit_type: 'studio', nightly_rate: '2500', cleaning_fee: '500', max_guests: 4 })).data.unit;
    const day = (n) => ical.addDays(manilaToday(), n);
    const r = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: day(0), check_out: day(2), guest_name: 'Rafael Diaz', num_guests: 2 })).data.reservation;
    const token = (await owner.get(`/api/reservations/${r.booking_id}/checkin`)).data.link.split('/checkin/')[1];
    const read = async () => (await fetch(`${srv.base}/api/public/checkin/${token}`).then((x) => x.json())).stay;
    let s = await read();
    assert.equal(s.checked_in, false);
    await sql('UPDATE bookings SET checked_in_at = now() WHERE booking_id = $1', [r.booking_id]);
    s = await read();
    assert.equal(s.checked_in, true);
    assert.equal(s.closed, false, 'the form stays editable until check-out');
  } finally { await srv.close(); }
});

test('no guest page titles every error "Link not found" / "Quote not found"', () => {
  for (const f of ['pay.js', 'checkin.js', 'review.js', 'quote.js']) {
    const src = view(f);
    assert.doesNotMatch(src, /h\('h1', null, t\('Link not found'\)\)/, `${f}: unconditional Link not found`);
    assert.doesNotMatch(src, /stateCard\(null, t\('Quote not found'\), err\.message\)/, `${f}: unconditional Quote not found`);
    assert.match(src, /Too many attempts/, `${f}: names a 429`);
    assert.match(src, /err\.status === 429/, `${f}: checks the status`);
  }
});

test('the pay page owes nothing on a cancelled booking and the proof form has one wrong-file message', () => {
  const pay = view('pay.js');
  assert.match(pay, /d\.cancelled/);
  assert.doesNotMatch(pay, /Please use a JPG, PNG, WEBP or PDF file\./);
  assert.match(pay, /Already on your bill/);
});

test('the quote page checks every field in one pass', () => {
  const q = view('quote.js');
  assert.match(q, /problems\.name/);
  assert.match(q, /problems\.phone/);
  assert.match(q, /problems\.email/);
});
