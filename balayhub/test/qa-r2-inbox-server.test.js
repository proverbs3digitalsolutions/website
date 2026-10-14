'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Reyes Staycations <host@example.com>';

// QA round 2, inbox server lane: #5 the assignment alert gives the check-in as "Oct 20, 2026", not YYYY-MM-DD;
// #7 a filter id that isn't a UUID is ignored (the list still loads), instead of a 404 that blanks the page.
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { outbox } = require('../src/lib/mailer');
const test = require('node:test');
const assert = require('node:assert/strict');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const ids = (list) => list.map((c) => c.conversation_id);

const MANAGER_EMAIL = 'mgr-r2-inbox@example.com';
let srv; let owner; let conv; let propId; let checkIn;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host-r2-inbox@example.com', 'Reyes Staycations');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  propId = prop.property_id;
  const unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  checkIn = ical.addDays(manilaToday(), 2);
  const res = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: checkIn, check_out: ical.addDays(checkIn, 2), guest_name: 'Lourdes Cruz' })).data.reservation;
  conv = (await owner.post(`/api/reservations/${res.booking_id}/conversation`)).data.conversation_id;
  const inv = await owner.post('/api/team/invitations', { email: MANAGER_EMAIL, role: 'manager', property_ids: [prop.property_id] });
  const s = await client(srv.base).post('/api/auth/signup', {
    full_name: 'Ana Reyes', email: MANAGER_EMAIL, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
});
test.after(async () => { await srv.close(); });

test('#5 the assignment alert gives the check-in date as "Oct 20, 2026", not YYYY-MM-DD', async () => {
  const [{ user_id: managerId }] = await sql('SELECT user_id FROM users WHERE email = $1', [MANAGER_EMAIL]);
  outbox.length = 0;
  assert.equal((await owner.patch(`/api/inbox/${conv}`, { assigned_to: managerId })).status, 200);
  // The manager has no device, so the alert goes out by email, with the same text as the push.
  const mail = outbox.find((m) => m.to === MANAGER_EMAIL && m.subject.endsWith('assigned you a conversation'));
  assert.ok(mail, 'the new assignee gets the alert');
  assert.ok(mail.text.includes(`Lourdes Cruz · 1201, ${shortDate(checkIn)}`), mail.text);
  assert.doesNotMatch(mail.text, /\d{4}-\d{2}-\d{2}/, 'no ISO date in the alert');
});

test('#7 a filter id that is not a UUID is ignored: the list loads and nothing is filtered out', async () => {
  const all = ids((await owner.get('/api/inbox')).data.conversations);
  assert.ok(all.includes(conv));
  for (const q of ['property_id=garbage', 'unit_id=garbage', 'assigned=garbage', 'property_id=1&property_id=2', 'unit_id[x]=1']) {
    const r = await owner.get(`/api/inbox?${q}`);
    assert.equal(r.status, 200, q);
    assert.deepEqual(ids(r.data.conversations), all, `${q} changes nothing`);
  }
});

test('#7 a valid id still filters, and an unknown valid id gives an empty list', async () => {
  assert.deepEqual(ids((await owner.get(`/api/inbox?property_id=${propId}`)).data.conversations), [conv]);
  assert.deepEqual(ids((await owner.get('/api/inbox?property_id=00000000-0000-0000-0000-000000000000')).data.conversations), []);
});
