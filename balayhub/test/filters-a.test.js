'use strict';

// List filters for guests, housekeeping and the inbox: each param narrows the
// list, bad values are ignored (or 404 for ids), and role scoping still holds.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Filter Stays <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');

const d = (n) => ical.addDays(manilaToday(), n);
const names = (rows, key = 'full_name') => rows.map((r) => r[key]).sort();

let srv; let owner; let prop; let prop2; let unit; let unit2; let staff; let mgr; let staffUser;
const res = {};
async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: `${role} person`, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Filter Stays');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  prop2 = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8', city: 'Quezon City', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unit2 = (await owner.post(`/api/properties/${prop2.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const book = async (key, body) => {
    const r = await owner.post('/api/reservations', body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    res[key] = r.data.reservation;
  };
  // Ana: two past stays at Azure (direct, then Airbnb), VIP.
  await book('ana1', { unit_id: unit.unit_id, check_in: d(-30), check_out: d(-28), guest_name: 'Ana Cruz', guest_email: 'ana@example.com', channel: 'direct', accommodation_total: '4000' });
  await book('ana2', { unit_id: unit.unit_id, check_in: d(-10), check_out: d(-8), guest_name: 'Ana Cruz', guest_email: 'ana@example.com', channel: 'airbnb', accommodation_total: '6000' });
  // Ben: upcoming at Grass via Airbnb.
  await book('ben', { unit_id: unit2.unit_id, check_in: d(5), check_out: d(7), guest_name: 'Ben Reyes', guest_email: 'ben@example.com', channel: 'airbnb', accommodation_total: '3000' });
  // Cara: staying now at Azure.
  await book('cara', { unit_id: unit.unit_id, check_in: d(-1), check_out: d(2), guest_name: 'Cara Lim', guest_email: 'cara@example.com', channel: 'booking', accommodation_total: '6000' });
  // Dan: one past stay at Grass, do not rebook.
  await book('dan', { unit_id: unit2.unit_id, check_in: d(-40), check_out: d(-38), guest_name: 'Dan Uy', guest_email: 'dan@example.com', channel: 'direct', accommodation_total: '2000' });
  await owner.patch(`/api/guests/${res.ana1.guest_id}`, { vip: true });
  await owner.patch(`/api/guests/${res.dan.guest_id}`, { do_not_rebook: true });
  await owner.post('/api/guests', { full_name: 'Eve Walk-in' });
  staff = await invite('staff@example.com', 'staff', [prop.property_id]);
  mgr = await invite('mgr@example.com', 'manager', [prop2.property_id]);
  staffUser = (await sql(`SELECT user_id FROM users WHERE email = 'staff@example.com'`))[0];
});
test.after(async () => { await srv.close(); });

// ---------------------------------------------------------------- guests
test('guests: segment, stay, channel, property, latest stay, min stays, rating and sort', async () => {
  const g = async (q) => { const r = await owner.get(`/api/guests${q}`); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.guests; };
  assert.deepEqual(names(await g('?segment=vip')), ['Ana Cruz']);
  assert.deepEqual(names(await g('?segment=repeat')), ['Ana Cruz']);
  assert.deepEqual(names(await g('?segment=first')), ['Ben Reyes', 'Cara Lim', 'Dan Uy']);
  assert.deepEqual(names(await g('?segment=do_not_rebook')), ['Dan Uy']);
  assert.deepEqual(names(await g('?segment=no_stays')), ['Eve Walk-in']);
  assert.deepEqual(names(await g('?stay=upcoming')), ['Ben Reyes']);
  assert.deepEqual(names(await g('?stay=in_house')), ['Cara Lim']);
  assert.deepEqual(names(await g('?stay=none_upcoming')), ['Ana Cruz', 'Dan Uy', 'Eve Walk-in']);
  assert.deepEqual(names(await g('?channel=airbnb')), ['Ana Cruz', 'Ben Reyes']);
  assert.deepEqual(names(await g(`?property_id=${prop2.property_id}`)), ['Ben Reyes', 'Dan Uy']);
  assert.deepEqual(names(await g(`?channel=direct&property_id=${prop.property_id}`)), ['Ana Cruz']);
  assert.deepEqual(names(await g(`?last_from=${d(-15)}&last_to=${d(0)}`)), ['Ana Cruz', 'Cara Lim']);
  assert.deepEqual(names(await g('?min_stays=2')), ['Ana Cruz']);
  await sql(`INSERT INTO guest_reviews (organization_id, booking_id, guest_id, rating) SELECT b.organization_id, b.booking_id, b.guest_id, 2 FROM bookings b WHERE b.booking_id = $1`, [res.dan.booking_id]);
  assert.deepEqual(names(await g('?rating=low')), ['Dan Uy']);
  assert.equal((await g('?rating=4')).length, 0);
  assert.ok(!names(await g('?rating=none')).includes('Dan Uy'));

  const byStays = await g('?sort=stays');
  assert.equal(byStays[0].full_name, 'Ana Cruz');
  assert.equal(Number(byStays[0].stays), 2);
  const bySpent = await g('?sort=spent');
  assert.equal(bySpent[0].full_name, 'Ana Cruz');
  assert.equal(bySpent[0].total_spent, '10000.00');
  assert.equal((await g('?sort=next'))[0].full_name, 'Ben Reyes');
  assert.equal((await g('?sort=recent'))[0].full_name, 'Ben Reyes');
  assert.equal((await g('?sort=name'))[0].full_name, 'Ana Cruz');
});

test('guests: bad values are ignored; a bad property id is a 404', async () => {
  const all = (await owner.get('/api/guests')).data.guests.length;
  for (const q of ['segment=nope', 'stay=x', 'channel=myspace', 'last_from=2026-02-31', 'last_to=yesterday', 'min_stays=-1', 'min_stays=abc', 'rating=5', "sort=g.full_name;DROP TABLE guests"]) {
    const r = await owner.get(`/api/guests?${q}`);
    assert.equal(r.status, 200, q);
    assert.equal(r.data.guests.length, all, q);
  }
  assert.equal((await owner.get('/api/guests?property_id=not-a-uuid')).status, 404);
});

test('guests: staff and managers only see stays (and guests) in their properties; staff get no amounts', async () => {
  const s = (await staff.get('/api/guests?sort=spent')).data.guests;
  assert.ok(s.every((g) => g.total_spent === undefined && g.email === undefined));
  assert.deepEqual(names(s), ['Ana Cruz', 'Cara Lim', 'Eve Walk-in'], 'sort=spent is ignored for staff, falls back to name');
  assert.equal(s[0].full_name, 'Ana Cruz');
  assert.equal((await staff.get(`/api/guests?property_id=${prop2.property_id}`)).data.guests.length, 0, 'no stays visible at another property');
  assert.equal((await staff.get('/api/guests?channel=airbnb')).data.guests.map((g) => g.full_name).join(), 'Ana Cruz');
  const m = (await mgr.get('/api/guests?segment=repeat')).data.guests;
  assert.equal(m.length, 0, 'Ana stayed twice, but not at the manager\'s property');
  assert.deepEqual(names((await mgr.get('/api/guests?stay=upcoming')).data.guests), ['Ben Reyes']);
  assert.equal((await mgr.get('/api/guests?sort=spent')).data.guests.find((g) => g.full_name === 'Ben Reyes').total_spent, '3000.00');
});

// ---------------------------------------------------------------- housekeeping
let tasks;
test('housekeeping: status, property, listing, assignee, due dates, overdue, turnover, search and sort', async () => {
  const add = async (body) => {
    const r = await owner.post('/api/cleaning-tasks', body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.task;
  };
  tasks = {
    late: await add({ unit_id: unit.unit_id, due_date: d(-2), assigned_to: staffUser.user_id, notes: 'Deep clean the oven' }),
    today: await add({ unit_id: unit2.unit_id, due_date: d(0), assignee_name: 'Aling Rosa' }),
    soon: await add({ unit_id: unit2.unit_id, due_date: d(5) }),
    done: await add({ unit_id: unit.unit_id, due_date: d(-5) }),
  };
  await owner.post(`/api/cleaning-tasks/${tasks.done.task_id}/status`, { status: 'done' });
  await owner.post(`/api/cleaning-tasks/${tasks.today.task_id}/status`, { status: 'in_progress' });
  const ids = async (q, who = owner) => { const r = await who.get(`/api/cleaning-tasks${q}`); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.tasks.map((t) => t.task_id).sort(); };
  const want = (...keys) => keys.map((k) => tasks[k].task_id).sort();

  assert.deepEqual(await ids('?view=all'), want('late', 'today', 'soon', 'done'));
  assert.deepEqual(await ids('?view=all&status=in_progress'), want('today'));
  assert.deepEqual(await ids('?view=open&status=done'), [], 'filters add to the view');
  assert.deepEqual(await ids(`?view=all&property_id=${prop2.property_id}`), want('today', 'soon'));
  assert.deepEqual(await ids(`?view=all&unit_id=${unit.unit_id}`), want('late', 'done'));
  assert.deepEqual(await ids(`?view=all&assignee=${staffUser.user_id}`), want('late'));
  assert.deepEqual(await ids('?view=all&assignee=outside'), want('today'));
  assert.deepEqual(await ids('?view=all&assignee=unassigned'), want('soon', 'done'));
  assert.deepEqual(await ids(`?view=all&from=${d(-3)}&to=${d(0)}`), want('late', 'today'));
  assert.deepEqual(await ids('?view=all&late=1'), want('late'));
  assert.deepEqual(await ids('?view=all&q=oven'), want('late'));
  assert.deepEqual(await ids('?view=all&q=rosa'), want('today'));
  assert.deepEqual(await ids('?view=all&q=%25'), [], 'wildcards are literal');
  await sql('UPDATE cleaning_tasks SET next_check_in = due_date WHERE task_id = $1', [tasks.today.task_id]);
  await sql('UPDATE cleaning_tasks SET next_check_in = NULL WHERE task_id <> $1', [tasks.today.task_id]);
  assert.deepEqual(await ids('?view=all&turnover=same_day'), want('today'));
  assert.deepEqual(await ids('?view=all&turnover=next_booked'), want('today'));
  assert.deepEqual(await ids('?view=all&turnover=no_next'), want('late', 'soon', 'done'));
  const sorted = (await owner.get('/api/cleaning-tasks?view=all&sort=due_desc')).data.tasks.map((t) => t.task_id);
  assert.deepEqual(sorted, [tasks.soon, tasks.today, tasks.late, tasks.done].map((t) => t.task_id));
  assert.equal((await owner.get('/api/cleaning-tasks?view=all&sort=completed')).data.tasks[0].task_id, tasks.done.task_id);
});

test('housekeeping: bad values are ignored or 404; staff stay scoped', async () => {
  const all = (await owner.get('/api/cleaning-tasks?view=all')).data.tasks.length;
  for (const q of ['status=dusty', 'from=2026-13-01', 'to=soon', 'late=yes', 'turnover=x', 'sort=1;DROP', 'mine=2']) {
    const r = await owner.get(`/api/cleaning-tasks?view=all&${q}`);
    assert.equal(r.status, 200, q);
    assert.equal(r.data.tasks.length, all, q);
  }
  for (const q of ['property_id=x', 'unit_id=1', 'assignee=everyone']) assert.equal((await owner.get(`/api/cleaning-tasks?view=all&${q}`)).status, 404, q);
  // Staff see Azure only, even when asking for Grass.
  assert.equal((await staff.get(`/api/cleaning-tasks?view=all&property_id=${prop2.property_id}`)).data.tasks.length, 0);
  assert.equal((await staff.get(`/api/cleaning-tasks?view=all&unit_id=${unit2.unit_id}`)).data.tasks.length, 0);
  assert.equal((await staff.get('/api/cleaning-tasks?view=all&q=rosa')).data.tasks.length, 0);
  assert.deepEqual((await staff.get('/api/cleaning-tasks?view=all&mine=1')).data.tasks.map((t) => t.task_id), [tasks.late.task_id]);
});

// ---------------------------------------------------------------- inbox
test('inbox: unread, channel, property, listing, stay, assigned, last message dates, attention and sort', async () => {
  const conv = {};
  for (const k of ['ana2', 'ben', 'cara', 'dan']) {
    const r = await owner.post(`/api/reservations/${res[k].booking_id}/conversation`);
    assert.ok(r.status < 300, JSON.stringify(r.data));
    conv[k] = r.data.conversation_id;
  }
  const orgId = (await sql('SELECT organization_id FROM conversations LIMIT 1'))[0].organization_id;
  const msg = (k, direction, status) => sql(
    `INSERT INTO messages (conversation_id, organization_id, direction, body, status) VALUES ($1, $2, $3, 'Hello', $4)`, [conv[k], orgId, direction, status]);
  await msg('ben', 'in', 'received');
  await msg('cara', 'out', 'failed');
  await msg('dan', 'out', 'scheduled');
  await sql('UPDATE conversations SET unread = true WHERE conversation_id = $1', [conv.ben]);
  await sql(`UPDATE conversations SET last_message_at = now() - interval '20 days' WHERE conversation_id = $1`, [conv.dan]);
  const ownerId = (await sql(`SELECT user_id FROM users WHERE email = 'host@example.com'`))[0].user_id;
  await sql('UPDATE conversations SET assigned_to = $2 WHERE conversation_id = $1', [conv.cara, ownerId]);

  const ids = async (q) => { const r = await owner.get(`/api/inbox${q}`); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.conversations.map((c) => c.conversation_id).sort(); };
  const want = (...keys) => keys.map((k) => conv[k]).sort();
  assert.deepEqual(await ids(''), want('ana2', 'ben', 'cara', 'dan'));
  assert.deepEqual(await ids('?unread=1'), want('ben'));
  assert.deepEqual(await ids('?channel=airbnb'), want('ana2', 'ben'));
  assert.deepEqual(await ids(`?property_id=${prop2.property_id}`), want('ben', 'dan'));
  assert.deepEqual(await ids(`?unit_id=${unit.unit_id}`), want('ana2', 'cara'));
  assert.deepEqual(await ids('?stay=upcoming'), want('ben'));
  assert.deepEqual(await ids('?stay=in_house'), want('cara'));
  assert.deepEqual(await ids('?stay=past'), want('ana2', 'dan'));
  assert.deepEqual(await ids('?stay=cancelled'), []);
  assert.deepEqual(await ids(`?assigned=${ownerId}`), want('cara'));
  assert.deepEqual(await ids('?assigned=unassigned'), want('ana2', 'ben', 'dan'));
  assert.deepEqual(await ids(`?msg_to=${d(-10)}`), want('dan'));
  assert.deepEqual(await ids(`?msg_from=${d(-1)}`), want('ana2', 'ben', 'cara'));
  assert.deepEqual(await ids('?attention=awaiting_reply'), want('ben'));
  assert.deepEqual(await ids('?attention=failed'), want('cara'));
  assert.deepEqual(await ids('?attention=scheduled'), want('dan'));
  assert.deepEqual(await ids('?view=unread&channel=booking'), [], 'filters add to the view');
  const oldest = (await owner.get('/api/inbox?sort=oldest')).data.conversations;
  assert.equal(oldest[0].conversation_id, conv.dan);
  const byCheckIn = (await owner.get('/api/inbox?sort=check_in')).data.conversations;
  assert.equal(byCheckIn[0].conversation_id, conv.dan);
  assert.equal(byCheckIn.at(-1).conversation_id, conv.ben);

  // Bad values are ignored, or 404 for ids.
  const all = (await owner.get('/api/inbox')).data.conversations.length;
  for (const q of ['unread=yes', 'channel=x', 'stay=forever', 'msg_from=2026-02-30', 'msg_to=x', 'attention=all', 'sort=c.unread;DROP']) {
    const r = await owner.get(`/api/inbox?${q}`);
    assert.equal(r.status, 200, q);
    assert.equal(r.data.conversations.length, all, q);
  }
  for (const q of ['property_id=x', 'unit_id=x', 'assigned=nobody']) assert.equal((await owner.get(`/api/inbox?${q}`)).status, 404, q);

  // Managers stay scoped; staff have no inbox at all.
  const m = await mgr.get(`/api/inbox?property_id=${prop.property_id}`);
  assert.equal(m.data.conversations.length, 0);
  assert.equal((await mgr.get(`/api/inbox?unit_id=${unit.unit_id}`)).data.conversations.length, 0);
  assert.deepEqual((await mgr.get('/api/inbox?channel=airbnb')).data.conversations.map((c) => c.conversation_id), [conv.ben]);
  assert.equal((await staff.get('/api/inbox?unread=1')).status, 403);
});
