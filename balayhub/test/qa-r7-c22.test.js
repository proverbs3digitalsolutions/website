'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// QA r7 lane C22: staff can email a receipt when recording a payment or deposit. The staff reservation row says
// whether the guest has an email (guest_has_email), never the address; a failed deposit email gives staff a fixed sentence.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const PASSWORD = 'longenough1';
const d = (n) => ical.addDays(manilaToday(), n);
let srv; let owner; let staff; let withMail; let noMail; let failMail;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'r7c22-owner@example.com', 'R7 C22');
  const prop = (await owner.post('/api/properties', { property_name: 'R7 C22 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'C1', unit_type: 'studio', nightly_rate: '2000', max_guests: 4, room_type: 'studio' })).data.unit;
  const inv = await owner.post('/api/team/invitations', { email: 'r7c22-staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  staff = client(srv.base);
  const s = await staff.post('/api/auth/signup', {
    full_name: 'R7 Staff', email: 'r7c22-staff@example.com', password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  const mk = async (i, extra) => (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(i * 3), check_out: d(i * 3 + 2), guest_name: `Guest ${i}`, ...extra })).data.reservation;
  withMail = await mk(0, { guest_email: 'rita@example.com' });
  noMail = await mk(1, {});
  failMail = await mk(2, { guest_email: 'x@fail-me.example.com' });
});
test.after(async () => { await srv.close(); });

const find = (c, b) => c.get('/api/reservations?view=all').then((r) => r.data.reservations.find((x) => x.booking_id === b.booking_id));

test('staff row says whether the guest has an email, never the address', async () => {
  const a = await find(staff, withMail);
  const b = await find(staff, noMail);
  assert.equal(a.guest_has_email, true);
  assert.equal(b.guest_has_email, false);
  assert.ok(!('guest_email' in a) && !('guest_email' in b));
  const det = (await staff.get(`/api/reservations/${withMail.booking_id}`)).data.reservation;
  assert.equal(det.guest_has_email, true);
  assert.ok(!('guest_email' in det));
});

test('owner rows are unchanged: the address, no guest_has_email', async () => {
  const a = await find(owner, withMail);
  assert.equal(a.guest_email, 'rita@example.com');
  assert.ok(!('guest_has_email' in a));
});

test('a failed deposit email gives staff a fixed sentence and the owner the raw text', async () => {
  const body = { amount: '1000', received_date: manilaToday(), method: 'cash', send_receipt: true };
  const s = await staff.post(`/api/reservations/${failMail.booking_id}/deposit`, body);
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal(s.data.receipt.sent, false);
  assert.equal(s.data.receipt.error, 'The email could not be sent. Ask an owner or manager to send it again.');
  assert.ok(!/refused|fail-me/i.test(s.data.receipt.error));
  const set = await owner.post(`/api/reservations/${failMail.booking_id}/deposit/settle`, { refund_method: 'cash', send_receipt: true });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal(set.data.receipt.sent, false);
  assert.match(set.data.receipt.error, /email server refused/i);
});

test('the receipt and deposit checkboxes show when the address or guest_has_email is set', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public/js/views', f), 'utf8');
  const res = read('reservations.js');
  assert.match(res, /\(r\.guest_email \|\| r\.guest_has_email\) && field\(\{ name: 'send_receipt'/);
  assert.match(res, /Email a receipt to the guest/);
  const dep = read('deposits.js');
  assert.equal((dep.match(/\(r\.guest_email \|\| r\.guest_has_email\) && field\(\{ name: 'send_receipt'/g) || []).length, 2);
  assert.ok(!/\br\.guest_email && field\(\{ name: 'send_receipt'/.test(res + dep));
});
