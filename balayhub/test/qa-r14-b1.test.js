'use strict';
// QA round 14, lane B1 (bookings views, frontend only, no database).
// #1 refund method starts on "Choose…", #2 amount checked before any question, #3 listing guest limit first,
// #5 .link-tap on plain links, #6 New reservation folds the rarely used boxes.
// node --test --test-concurrency=1 test/qa-r14-b1.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ref = read('public/js/views/refunds.js');
const res = read('public/js/views/reservations.js');
const cal = read('public/js/views/calendar.js');
const grab = (src, name) => {
  const m = src.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}\\n`));
  assert.ok(m, `export function ${name} not found`);
  return m[0].replace('export ', '');
};

test('#2 refundAmountProblem gives the server sentences', () => {
  const refundAmountProblem = new Function('parseAmount', `${grab(ref, 'refundAmountProblem')}\nreturn refundAmountProblem;`)((v) => Number(v));
  assert.equal(refundAmountProblem(-4), 'Amount cannot be negative.');
  assert.equal(refundAmountProblem(0), 'Amount must be greater than zero.');
  assert.equal(refundAmountProblem(500), null);
});

test('#2 onSubmit checks the amount, then the cap, then asks the owed question', () => {
  const sub = ref.slice(ref.indexOf('onSubmit:'));
  const a = sub.indexOf('refundAmountProblem(amount)');
  const b = sub.indexOf('refundCapProblem(amount, data)');
  const c = sub.indexOf('refundOwedAfter(reservation, amount)');
  assert.ok(a > 0 && b > a && c > b, 'amount, then cap, then owed');
});

test('#1 the refund method has no default and asks to choose', () => {
  const m = ref.match(/name: 'method'[^\n]*/)[0];
  assert.doesNotMatch(m, /value: 'gcash'/);
  assert.match(m, /placeholderOption: 'Choose…'/);
  assert.match(ref, /f\.method = 'Choose how the money was refunded\.'/);
});

test('#3 guestsProblem checks the listing limit before the 50 cap', () => {
  const guestsProblem = new Function(`${grab(res, 'guestsProblem')}\nreturn guestsProblem;`)();
  assert.equal(guestsProblem('99', 6), 'This listing allows up to 6 guests.');
  assert.equal(guestsProblem('6', 6), null);
  assert.equal(guestsProblem('0', 6), 'Enter a whole number of guests, 1 or more.');
  assert.equal(guestsProblem('99'), null);
  assert.match(res, /guestsProblem\(changes\.num_guests, r\.max_guests\)/);
});

test('#6 New reservation folds Where did they book and Other fees under More details', () => {
  const start = res.indexOf('title: \'New reservation\'');
  const end = res.indexOf('onSubmit', start);
  const body = res.slice(start, end);
  const m = body.match(/h\('details', \{ class: 'form-section'[\s\S]*?name: 'notes'/);
  assert.ok(m, 'a form-section details');
  assert.match(m[0], /More details/);
  assert.match(m[0], /name: 'source'/);
  assert.match(m[0], /name: 'other_fees'/);
  assert.doesNotMatch(m[0], /name: 'channel_fee'/);
  assert.match(res, /syncChannelFee/);
});

test('#5 .link-tap on the date, Guest profile, phone links and calendar listing names', () => {
  assert.match(res, /h\('a', \{ class: 'link-tap', href: `#\/reservations\/\$\{r\.booking_id\}`/);
  assert.match(res, /h\('a', \{ class: 'link-tap', href: `#\/guests\//);
  assert.match(res, /h\('a', \{ class: 'link-tap', href: `tel:/);
  assert.match(cal, /h\('a', \{ href: `#\/listings\?focus=\$\{l\.unit_id\}`, class: 'cal-name link-tap' \}/);
});

// ---- server: the listing's guest limit is checked before the general cap of 50 (needs TEST_DATABASE_URL)
const { startServer, ownerAccount } = require('./helpers');
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('#3 server: 99 guests on a 6-guest listing names the listing limit (POST and PATCH); no limit keeps 50', async () => {
  const srv = await startServer();
  try {
    const owner = await ownerAccount(srv.base, 'b1-host@example.com', 'B1 Stays');
    const prop = (await owner.post('/api/properties', { property_name: 'B1 House', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
    const mk = async (name, extra) => (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000', ...extra })).data.unit;
    const six = await mk('Six', { max_guests: 6 }); const none = await mk('NoLimit', {});
    const body = (u, n, o = 0) => ({ unit_id: u.unit_id, check_in: day(40 + o), check_out: day(42 + o), guest_name: 'G', num_guests: n });
    let r = await owner.post('/api/reservations', body(six, 99));
    assert.equal(r.status, 400); assert.equal(r.data.fields.num_guests, 'This listing allows up to 6 guests.');
    r = await owner.post('/api/reservations', body(none, 99, 10));
    assert.equal(r.status, 400); assert.equal(r.data.fields.num_guests, 'Number of guests must be at most 50.');
    const ok = await owner.post('/api/reservations', body(six, 4, 20));
    assert.equal(ok.status, 201);
    r = await owner.patch(`/api/reservations/${ok.data.reservation.booking_id}`, { num_guests: 99 });
    assert.equal(r.status, 400); assert.equal(r.data.fields.num_guests, 'This listing allows up to 6 guests.');
  } finally { await srv.close(); }
});
