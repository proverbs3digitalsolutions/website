'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Team Stays <host@example.com>';

// helpers must load before any app module so the test database is set first.
const { startServer, client, sql, ownerAccount } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const push = require('../src/lib/push');
const { notifyUser } = require('../src/lib/notify');
const config = require('../src/config');
const { outbox } = require('../src/lib/mailer');
const fs = require('fs');
const path = require('path');

const sent = [];
push.webpush.sendNotification = async (sub, payload) => {
  sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
  return { statusCode: 201 };
};
const subscription = (name) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}-abcdef`, keys: { p256dh: 'BPublicKeyValue123', auth: 'authsecret' } });

const TYPE_KEYS = ['new_booking', 'guest_message', 'checkin_form', 'payment', 'cleaning', 'mention', 'assignment', 'sync_problem', 'owner_activity'];
const day = (n) => new Date(Date.now() + 8 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const idOf = async (email) => (await sql('SELECT user_id, full_name, email FROM users WHERE lower(email) = $1', [email]))[0];
const mention = (u) => `@[${u.full_name}](${u.user_id})`;
const mailTo = (email, subject) => outbox.filter((m) => m.to === email && (!subject || m.subject === subject));
const pushesTo = (name, tag) => sent.filter((s) => s.endpoint.includes(`${name}-abcdef`) && (!tag || s.tag === tag));

async function join(base, ownerClient, email, name, role, propertyIds) {
  const inv = await ownerClient.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const c = client(base);
  const s = await c.post('/api/auth/signup', { full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

let srv; let owner; let mgrA; let mgrA2; let mgrB; let staff; let cleaner;
let propA; let propB; let unitA; let unitB; let convA; let convB;
let ownerU; let mgrAU; let mgrA2U; let mgrBU; let staffU; let orgId;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-team@example.com', 'Team Stays');
  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'condominium', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unitA = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: 'Tower 1 - 1201', unit_type: 'studio', nightly_rate: '2500' })).data.unit;
  unitB = (await owner.post(`/api/properties/${propB.property_id}/units`, { unit_name: 'Grass 805', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
  mgrA = await join(srv.base, owner, 'mgr-a@example.com', 'Mgr A', 'manager', [propA.property_id]);
  mgrA2 = await join(srv.base, owner, 'mgr-a2@example.com', 'Mgr A2', 'manager', [propA.property_id]);
  mgrB = await join(srv.base, owner, 'mgr-b@example.com', 'Mgr B', 'manager', [propB.property_id]);
  staff = await join(srv.base, owner, 'staff-a@example.com', 'Staff A', 'staff', [propA.property_id]);
  cleaner = await join(srv.base, owner, 'cleaner-a@example.com', 'Cleaner A', 'cleaner', [propA.property_id]);
  const resA = (await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: day(2), check_out: day(4), guest_name: 'Rafael Diaz' })).data.reservation;
  const resB = (await owner.post('/api/reservations', { unit_id: unitB.unit_id, check_in: day(1), check_out: day(3), guest_name: 'Other Guest' })).data.reservation;
  convA = (await owner.post(`/api/reservations/${resA.booking_id}/conversation`)).data.conversation_id;
  convB = (await owner.post(`/api/reservations/${resB.booking_id}/conversation`)).data.conversation_id;
  ownerU = await idOf('owner-team@example.com');
  mgrAU = await idOf('mgr-a@example.com');
  mgrA2U = await idOf('mgr-a2@example.com');
  mgrBU = await idOf('mgr-b@example.com');
  staffU = await idOf('staff-a@example.com');
  orgId = (await sql('SELECT organization_id FROM users WHERE user_id = $1', [ownerU.user_id]))[0].organization_id;
});
test.after(async () => { await srv.close(); });

test('a mention is refused when the person cannot see the reservation, and nothing is saved', async () => {
  const count = async () => (await sql('SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = $1', [convA]))[0].n;
  const before = await count();
  const noAccess = await owner.post(`/api/inbox/${convA}/messages`, { body: `Check with ${mention(mgrBU)}`, note: true });
  assert.equal(noAccess.status, 400);
  assert.equal(noAccess.data.code, 'VALIDATION');
  assert.equal(noAccess.data.fields.body, "Mgr B can't see this reservation");
  const staffOnly = await owner.post(`/api/inbox/${convA}/messages`, { body: `Hi ${mention(staffU)}`, note: true });
  assert.equal(staffOnly.data.fields.body, 'Only owners and managers can be mentioned.', 'staff cannot be mentioned');
  const made = await owner.post(`/api/inbox/${convA}/messages`, { body: 'Hi @[Nobody](00000000-0000-0000-0000-000000000000)', note: true });
  assert.equal(made.data.fields.body, 'Unknown person');
  assert.equal(await count(), before, 'a refused note is not saved');
});

test('a valid note returns one mention per person and notifies them, but not the author', async () => {
  assert.equal((await mgrA.post('/api/push/subscribe', { subscription: subscription('mgra') })).status, 200);
  sent.length = 0;
  const r = await owner.post(`/api/inbox/${convA}/messages`, { body: `${mention(mgrAU)} please check, ${mention(mgrAU)}`, note: true });
  assert.equal(r.status, 201);
  assert.equal(r.data.message.status, 'note');
  assert.deepEqual(r.data.mentions, [{ user_id: mgrAU.user_id, full_name: 'Mgr A' }]);
  const pushed = pushesTo('mgra', 'mention');
  assert.equal(pushed.length, 1, 'one push, even though the name appears twice');
  assert.equal(pushed[0].title, 'Maria Santos mentioned you');
  assert.equal(pushed[0].body, '@Mgr A please check, @Mgr A', 'the note shows names, not the raw markup');
  assert.equal(pushed[0].url, `/#/inbox/${convA}`);

  outbox.length = 0;
  await owner.post(`/api/inbox/${convA}/messages`, { body: `Reminder to myself ${mention(ownerU)}`, note: true });
  assert.equal(mailTo('owner-team@example.com', 'Maria Santos mentioned you').length, 0, 'the author is not notified');
});

test('a mentioned person with no device gets an email with the link', async () => {
  outbox.length = 0;
  await owner.post(`/api/inbox/${convA}/messages`, { body: `For ${mention(mgrA2U)}`, note: true });
  const [mail] = mailTo('mgr-a2@example.com', 'Maria Santos mentioned you');
  assert.ok(mail, 'email sent');
  assert.ok(mail.text.includes(`${config.appUrl}/#/inbox/${convA}`), 'link to the conversation');
  assert.ok(mail.text.includes('For @Mgr A2'), 'shows the note with names');
  assert.ok(!mail.text.includes(mgrA2U.user_id), 'raw ids are not shown');
});

test('assigning a conversation notifies the new assignee, and not someone who cannot see it or yourself', async () => {
  sent.length = 0; outbox.length = 0;
  assert.equal((await owner.patch(`/api/inbox/${convA}`, { assigned_to: mgrAU.user_id })).status, 200);
  const [assigned] = pushesTo('mgra', 'assignment');
  assert.equal(assigned.title, 'Maria Santos assigned you a conversation');
  assert.ok(assigned.body.includes('Rafael Diaz'));
  assert.equal(assigned.url, `/#/inbox/${convA}`);

  await owner.patch(`/api/inbox/${convA}`, { assigned_to: ownerU.user_id });
  assert.equal(sent.filter((s) => s.tag === 'assignment').length, 1, 'assigning yourself notifies nobody');
  assert.equal(mailTo('owner-team@example.com').filter((m) => m.subject.includes('assigned')).length, 0);

  const refused = await owner.patch(`/api/inbox/${convA}`, { assigned_to: mgrBU.user_id });
  assert.equal(refused.status, 400);
  assert.equal(refused.data.fields.assigned_to, "This person can't see this reservation's property.");
  assert.equal((await owner.get(`/api/inbox/${convA}`)).data.conversation.assigned_to, ownerU.user_id, 'the refused change is not saved');
  assert.equal(mailTo('mgr-b@example.com').length, 0, 'no notice about a reservation they cannot see');

  await owner.patch(`/api/inbox/${convA}`, { assigned_to: mgrA2U.user_id });
  const [mail] = mailTo('mgr-a2@example.com', 'Maria Santos assigned you a conversation');
  assert.ok(mail?.text.includes(`/#/inbox/${convA}`), 'email fallback carries the link');
});

test('a manager can be assigned only conversations on their own properties; owners can take any', async () => {
  assert.equal((await owner.patch(`/api/inbox/${convB}`, { assigned_to: mgrBU.user_id })).status, 200, 'mgr B is on Grass');
  assert.equal((await owner.patch(`/api/inbox/${convB}`, { assigned_to: mgrAU.user_id })).data.fields.assigned_to,
    "This person can't see this reservation's property.");
  assert.equal((await owner.patch(`/api/inbox/${convB}`, { assigned_to: staffU.user_id })).data.fields.assigned_to,
    'Choose an owner or manager in this workspace.');
  assert.equal((await owner.patch(`/api/inbox/${convB}`, { assigned_to: ownerU.user_id })).status, 200, 'owners see every property');
  assert.equal((await owner.get(`/api/inbox/${convB}`)).data.conversation.assigned_to, ownerU.user_id);
  // Clear it again so the assigned-count test below is unaffected.
  assert.equal((await owner.patch(`/api/inbox/${convB}`, { assigned_to: null })).status, 200);
});

test('assigned-count and assignees follow the signed-in person and the conversation', async () => {
  assert.equal((await mgrA2.get('/api/inbox/assigned-count')).data.count, 1);
  assert.equal((await owner.get('/api/inbox/assigned-count')).data.count, 0);
  assert.equal((await mgrA.get('/api/inbox/assigned-count')).data.count, 0);

  const names = (list) => list.map((a) => a.full_name);
  assert.deepEqual(names((await owner.get('/api/inbox/assignees')).data.assignees), ['Maria Santos', 'Mgr A', 'Mgr A2', 'Mgr B']);
  assert.deepEqual(names((await owner.get(`/api/inbox/assignees?conversation_id=${convA}`)).data.assignees), ['Maria Santos', 'Mgr A', 'Mgr A2']);
  assert.deepEqual(names((await owner.get(`/api/inbox/assignees?conversation_id=${convB}`)).data.assignees), ['Maria Santos', 'Mgr B']);
  assert.equal((await mgrA.get(`/api/inbox/assignees?conversation_id=${convB}`)).status, 404, 'a conversation outside their properties');
  assert.equal((await owner.get('/api/inbox/assignees?conversation_id=00000000-0000-0000-0000-000000000000')).status, 404);
});

test('notification settings show each role its own types and properties', async () => {
  const o = (await owner.get('/api/account/notify-prefs')).data;
  assert.deepEqual(Object.keys(o.types), TYPE_KEYS);
  assert.equal(o.labels.mention, 'Mentions in notes');
  assert.equal(o.property_ids, null);
  assert.deepEqual(o.properties.map((p) => p.property_id).sort(), [propA.property_id, propB.property_id].sort());

  const m = (await mgrA.get('/api/account/notify-prefs')).data;
  assert.deepEqual(Object.keys(m.types), TYPE_KEYS.filter((k) => k !== 'owner_activity'), 'unit owner activity is for owners only');
  assert.deepEqual(m.properties.map((p) => p.property_id), [propA.property_id]);

  const s = (await staff.get('/api/account/notify-prefs')).data;
  assert.deepEqual(Object.keys(s.types), ['cleaning']);
  assert.deepEqual(s.properties.map((p) => p.property_id), [propA.property_id]);

  const c = await cleaner.get('/api/account/notify-prefs');
  assert.equal(c.status, 200, 'cleaners can reach their own notification settings');
  assert.deepEqual(Object.keys(c.data.types), ['cleaning']);
});

test('switching a type off stops it, and changes are validated', async () => {
  let r = await mgrA.patch('/api/account/notify-prefs', { types: { mention: false } });
  assert.equal(r.status, 200);
  assert.equal(r.data.types.mention, false);
  sent.length = 0;
  const off = await owner.post(`/api/inbox/${convA}/messages`, { body: `Again ${mention(mgrAU)}`, note: true });
  assert.equal(off.status, 201);
  assert.deepEqual(off.data.mentions.map((x) => x.user_id), [mgrAU.user_id], 'the mention is still recorded');
  assert.equal(pushesTo('mgra', 'mention').length, 0);

  r = await mgrA.patch('/api/account/notify-prefs', { types: { mention: true } });
  assert.equal(r.status, 200);
  assert.equal(r.data.types.mention, true);
  assert.equal((await mgrA.patch('/api/account/notify-prefs', { property_ids: [] })).data.fields.property_ids,
    'Pick at least one property, or choose all properties.');
  assert.equal((await mgrA.get('/api/account/notify-prefs')).data.property_ids, null, 'the refused empty list is not saved');

  r = await mgrA.patch('/api/account/notify-prefs', { property_ids: null });
  assert.equal(r.data.property_ids, null);
  await owner.post(`/api/inbox/${convA}/messages`, { body: `Back ${mention(mgrAU)}`, note: true });
  assert.equal(pushesTo('mgra', 'mention').length, 1, 'all properties again');

  assert.equal((await mgrA.patch('/api/account/notify-prefs', { types: { bogus: true } })).data.fields.types,
    'Choose on or off for each notification you can receive.');
  assert.equal((await mgrA.patch('/api/account/notify-prefs', { types: { payment: 'yes' } })).status, 400);
  assert.equal((await mgrA.patch('/api/account/notify-prefs', { types: [] })).status, 400);
  assert.equal((await staff.patch('/api/account/notify-prefs', { types: { mention: false } })).status, 400, 'staff cannot change mention settings');
  assert.equal((await cleaner.patch('/api/account/notify-prefs', { types: { cleaning: false } })).status, 200);
  await cleaner.patch('/api/account/notify-prefs', { types: { cleaning: true } });
  assert.equal((await mgrB.patch('/api/account/notify-prefs', { property_ids: [propA.property_id] })).data.fields.property_ids, 'Choose properties you can see.');
  assert.equal((await mgrB.patch('/api/account/notify-prefs', { property_ids: 'all' })).status, 400);
  assert.equal((await mgrB.patch('/api/account/notify-prefs', { property_ids: ['not-a-uuid'] })).status, 400);
  assert.equal((await mgrB.patch('/api/account/notify-prefs', { property_ids: [propB.property_id, propB.property_id] })).data.property_ids.length, 1, 'duplicates are dropped');
});

test('allowed(): role, the type switch and the property filter decide', () => {
  const x = propA.property_id;
  assert.equal(push.allowed({ role: 'manager', notify_prefs: {} }, 'mention', x), true);
  assert.equal(push.allowed({ role: 'staff', notify_prefs: {} }, 'mention', x), false);
  assert.equal(push.allowed({ role: 'cleaner', notify_prefs: {} }, 'cleaning', x), true);
  assert.equal(push.allowed({ role: 'owner', notify_prefs: { mention: false } }, 'mention', x), false);
  assert.equal(push.allowed({ role: 'owner', notify_prefs: { property_ids: [] } }, 'payment', x), false);
  assert.equal(push.allowed({ role: 'owner', notify_prefs: { property_ids: [x] } }, 'payment', x), true);
  assert.equal(push.allowed({ role: 'owner', notify_prefs: { property_ids: [x] } }, 'payment', propB.property_id), false);
  assert.equal(push.allowed({ role: 'owner', notify_prefs: {} }, 'unknown_type', x), false);
});

test('notifyUser keeps old settings working: a plain on/off map and a property filter', async () => {
  const body = { title: 'Heads up', body: 'Something happened', propertyId: propA.property_id };
  await sql(`UPDATE users SET notify_prefs = '{"payment": false}' WHERE user_id = $1`, [ownerU.user_id]);
  outbox.length = 0;
  assert.equal(await notifyUser(orgId, ownerU.user_id, 'payment', body), false, 'switched off before this change');
  assert.equal(await notifyUser(orgId, ownerU.user_id, 'assignment', body), true, 'other types still arrive, by email');
  assert.equal(mailTo('owner-team@example.com', 'Heads up').length, 1);

  await sql(`UPDATE users SET notify_prefs = $2::jsonb WHERE user_id = $1`, [ownerU.user_id, JSON.stringify({ property_ids: [propA.property_id] })]);
  assert.equal(await notifyUser(orgId, ownerU.user_id, 'payment', { ...body, propertyId: propB.property_id }), false, 'a property they filtered out');
  assert.equal(await notifyUser(orgId, ownerU.user_id, 'payment', body), true);

  await sql(`UPDATE users SET notify_prefs = '{}' WHERE user_id = $1`, [ownerU.user_id]);
  assert.equal(await notifyUser(orgId, staffU.user_id, 'mention', body), false, 'a role that cannot get mentions');
  assert.equal(await notifyUser(orgId, mgrA2U.user_id, 'mention', { ...body, propertyId: propB.property_id }), false, 'no access to that property');
  assert.equal(await notifyUser(orgId, mgrA2U.user_id, 'mention', body), true);
});

test('other workspaces and signed-out visitors get nothing, and staff and cleaners are kept out', async () => {
  const other = await ownerAccount(srv.base, 'other-owner@example.com', 'Other Co');
  const otherU = await idOf('other-owner@example.com');
  assert.equal((await other.get(`/api/inbox/${convA}`)).status, 404);
  assert.equal((await other.post(`/api/inbox/${convA}/messages`, { body: 'x', note: true })).status, 404);
  assert.equal((await other.get(`/api/inbox/assignees?conversation_id=${convA}`)).status, 404);
  assert.equal((await other.get('/api/inbox/assigned-count')).data.count, 0);
  assert.deepEqual((await other.get('/api/inbox/assignees')).data.assignees.map((a) => a.full_name), ['Maria Santos'], 'only their own workspace');
  assert.equal((await owner.post(`/api/inbox/${convA}/messages`, { body: `Hi ${mention(otherU)}`, note: true })).data.fields.body, 'Unknown person');

  const anon = client(srv.base);
  assert.equal((await anon.get('/api/inbox/assigned-count')).status, 401);
  assert.equal((await anon.get('/api/account/notify-prefs')).status, 401);
  assert.equal((await anon.patch('/api/account/notify-prefs', { types: {} })).status, 401);
  assert.equal((await staff.get('/api/inbox/assigned-count')).status, 403);
  assert.equal((await cleaner.get('/api/inbox/assigned-count')).status, 403);
  assert.equal((await staff.post(`/api/inbox/${convA}/messages`, { body: 'x', note: true })).status, 403);
  assert.equal((await staff.get('/api/inbox/assignees')).status, 403);
});

test('a mention is saved with the name on record, not the name typed, so the note and the alert agree', async () => {
  sent.length = 0;
  const r = await owner.post(`/api/inbox/${convA}/messages`, { body: `Ask @[Boss Man](${mgrAU.user_id}) about the key`, note: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data.mentions, [{ user_id: mgrAU.user_id, full_name: 'Mgr A' }]);
  const saved = (await owner.get(`/api/inbox/${convA}`)).data.messages.find((m) => m.body.includes('about the key'));
  assert.equal(saved.body, `Ask @[Mgr A](${mgrAU.user_id}) about the key`);
  const pushed = pushesTo('mgra', 'mention');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].body, 'Ask @Mgr A about the key');
});

test('mention notes are capped at 60 an hour per person; notes without a mention and other people are not capped', async () => {
  const withMention = { body: `Check ${mention(mgrAU)}`, note: true };
  for (let i = 1; i <= 60; i += 1) {
    assert.equal((await mgrA2.post(`/api/inbox/${convA}/messages`, withMention)).status, 201, `note ${i}`);
  }
  const limited = await mgrA2.post(`/api/inbox/${convA}/messages`, withMention);
  assert.equal(limited.status, 429);
  assert.equal(limited.data.code, 'RATE_LIMITED');
  assert.equal(limited.data.error, 'Too many attempts. Please wait a few minutes and try again.');
  assert.equal((await mgrA2.post(`/api/inbox/${convA}/messages`, { body: 'No mention here', note: true })).status, 201);
  assert.equal((await owner.post(`/api/inbox/${convA}/messages`, { body: `Hi ${mention(mgrAU)}`, note: true })).status, 201);
});

test('assignment changes are capped at 60 an hour per person; a PATCH that keeps the same assignee is not counted', async () => {
  // Assigned to mgr A2 now. Each change below moves the conversation to the other manager.
  for (let i = 0; i < 60; i += 1) {
    const to = i % 2 === 0 ? mgrAU.user_id : mgrA2U.user_id;
    assert.equal((await mgrA2.patch(`/api/inbox/${convA}`, { assigned_to: to })).status, 200, `change ${i + 1}`);
  }
  const limited = await mgrA2.patch(`/api/inbox/${convA}`, { assigned_to: mgrAU.user_id });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.code, 'RATE_LIMITED');
  assert.equal((await mgrA2.patch(`/api/inbox/${convA}`, { assigned_to: mgrA2U.user_id })).status, 200, 'same assignee: not a change');
  assert.equal((await mgrA2.patch(`/api/inbox/${convA}`, { unread: true })).status, 200, 'not an assignment change');
});

test('the mention renderer runs on internal notes only; guest messages show their raw text', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'views', 'inbox.js'), 'utf8');
  assert.match(src, /const show = \(t\) => \(m\.direction === 'note' \? renderMentions\(t\) : t\);/);
  assert.match(src, /'msg__body' \}, show\(full\)\)/);
  // The renderer uses the server's pattern, so it highlights only mentions the server would have saved.
  const mentionPattern = (...file) => fs.readFileSync(path.join(__dirname, '..', ...file), 'utf8')
    .match(/^const MENTION(?:_RE)? = \/(.+)\/(gi?);$/m).slice(1);
  const [body, flags] = mentionPattern('public', 'js', 'views', 'inbox.js');
  assert.deepEqual([body, flags], mentionPattern('src', 'routes', 'inbox.js'));
  const mentions = (text) => text.match(new RegExp(body, flags));
  const id = '0b9d3c1e-5a7f-4e2b-9c8d-123456789abc';
  assert.equal(mentions(`Call @[Ana Cruz](${id}) back`).length, 1);
  assert.equal(mentions(`@[Ana\nCruz](${id})`), null, 'a name with a line break is plain text');
  assert.equal(mentions('@[Ana Cruz](not-an-id)'), null, 'the id must be a real uuid');
});
