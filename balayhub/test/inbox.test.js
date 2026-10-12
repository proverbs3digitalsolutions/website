'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Reyes Staycations <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { outbox } = require('../src/lib/mailer');
const messaging = require('../src/lib/messaging');
const inbound = require('../src/lib/inbound');

let srv; let owner; let prop; let prop2; let unit; let unit2; let resA; let resNoEmail; let resOther;
const today = manilaToday();
const d = (n) => ical.addDays(today, n);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Reyes Staycations');
  prop = (await owner.post('/api/properties', { property_name: 'Azure Residences', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  prop2 = (await owner.post('/api/properties', { property_name: 'SMDC Grass', property_type: 'condominium', address: 'Project 8', city: 'Quezon City', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, {
    unit_name: 'Tower 1 - 1201', unit_type: 'studio', nightly_rate: '2500', checkin_time: '14:00', checkout_time: '11:00',
    wifi_name: 'Azure1201', wifi_password: 'beach-please', checkin_instructions: 'Get the key at the lobby.', house_rules: 'No smoking.',
  })).data.unit;
  unit2 = (await owner.post(`/api/properties/${prop2.property_id}/units`, { unit_name: 'Grass 805', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
  resA = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(2), check_out: d(4), guest_name: 'Rafael Diaz', guest_email: 'rafael@example.com', num_guests: 2 })).data.reservation;
  resNoEmail = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(10), check_out: d(11), guest_name: 'No Email' })).data.reservation;
  resOther = (await owner.post('/api/reservations', { unit_id: unit2.unit_id, check_in: d(1), check_out: d(3), guest_name: 'Other Guest', guest_email: 'other@example.com' })).data.reservation;
});
test.after(async () => { await srv.close(); });

let convA;
test('listing stores Wi-Fi, check-in instructions and house rules', async () => {
  const u = await sql('SELECT wifi_name, wifi_password, checkin_instructions, house_rules FROM units WHERE unit_id = $1', [unit.unit_id]);
  assert.deepEqual(u[0], { wifi_name: 'Azure1201', wifi_password: 'beach-please', checkin_instructions: 'Get the key at the lobby.', house_rules: 'No smoking.' });
  const p = await owner.patch(`/api/units/${unit.unit_id}`, { house_rules: '' });
  assert.equal(p.status, 200);
  assert.equal((await sql('SELECT house_rules FROM units WHERE unit_id = $1', [unit.unit_id]))[0].house_rules, null);
  await owner.patch(`/api/units/${unit.unit_id}`, { house_rules: 'No smoking. Quiet hours 10pm.' });
});

test('start a conversation from a reservation, templates are filled in', async () => {
  const c = await owner.post(`/api/reservations/${resA.booking_id}/conversation`);
  assert.equal(c.status, 200);
  convA = c.data.conversation_id;
  const again = await owner.post(`/api/reservations/${resA.booking_id}/conversation`);
  assert.equal(again.data.conversation_id, convA, 'one conversation per reservation');

  const t = await owner.get('/api/message-templates');
  assert.ok(t.data.templates.length >= 4);
  assert.ok(t.data.variables.includes('wifi_password'));
  const checkin = t.data.templates.find((x) => x.system_key === 'checkin');
  const r = await owner.get(`/api/message-templates/${checkin.template_id}/render?booking_id=${resA.booking_id}`);
  assert.equal(r.status, 200);
  assert.match(r.data.body, /Hi Rafael/);
  assert.match(r.data.body, /beach-please/);
  assert.match(r.data.body, /Get the key at the lobby/);
  assert.match(r.data.body, /2:00 PM/);
  assert.doesNotMatch(r.data.body, /\{\{/);
});

test('send a message: emailed with a reply-to tag and threaded', async () => {
  outbox.length = 0;
  const s = await owner.post(`/api/inbox/${convA}/messages`, { body: 'Hello Rafael! Looking forward to hosting you.' });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  assert.equal(s.data.message.status, 'sent');
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'rafael@example.com');
  assert.match(outbox[0].replyTo, /^host\+bh-[a-z0-9]+@example\.com$/);
  assert.match(outbox[0].from, /Reyes Staycations/);

  const s2 = await owner.post(`/api/inbox/${convA}/messages`, { body: 'One more thing.' });
  assert.equal(s2.data.message.status, 'sent');
  assert.equal(outbox[1].headers['In-Reply-To'], outbox[0].messageId);

  const conv = await owner.get(`/api/inbox/${convA}`);
  assert.equal(conv.data.messages.length, 2);
  assert.equal(conv.data.conversation.guest_name, 'Rafael Diaz');
});

test('guest replies are matched to the conversation (and only once)', async () => {
  const token = (await sql('SELECT reply_token FROM conversations WHERE conversation_id = $1', [convA]))[0].reply_token;
  const parsed = {
    to: { value: [{ address: `host+bh-${token}@example.com` }] },
    from: { value: [{ name: 'Rafael Diaz', address: 'rafael@example.com' }] },
    subject: 'Re: hello', messageId: '<abc123@mail.example.com>', date: new Date(),
    text: 'What time can we check in?\n\nOn Mon, Oct 12, 2026 at 9:00 AM Reyes Staycations wrote:\n> Hello Rafael!',
    headers: new Map(),
  };
  assert.equal(await inbound.storeInbound(parsed), true);
  assert.equal(await inbound.storeInbound(parsed), false, 'duplicates are ignored');
  assert.equal(await inbound.storeInbound({ ...parsed, messageId: '<x@y>', to: { value: [{ address: 'host@example.com' }] } }), false, 'untagged mail ignored');
  assert.equal(await inbound.storeInbound({ ...parsed, messageId: '<x2@y>', to: { value: [{ address: 'host+bh-nosuchtoken@example.com' }] } }), false);

  const counts = await owner.get('/api/inbox/counts');
  assert.equal(Number(counts.data.counts.unread), 1);
  const list = await owner.get('/api/inbox?view=unread');
  assert.equal(list.data.conversations.length, 1);
  assert.equal(list.data.conversations[0].last_body, 'What time can we check in?');

  const conv = await owner.get(`/api/inbox/${convA}`);
  const last = conv.data.messages.at(-1);
  assert.equal(last.direction, 'in');
  assert.equal(last.body, 'What time can we check in?');
  assert.equal(Number((await owner.get('/api/inbox/counts')).data.counts.unread), 0, 'opening marks it read');
});

test('stripQuoted and findToken handle common reply formats', () => {
  assert.equal(inbound.stripQuoted('Thanks!\n\n-----Original Message-----\nFrom: x'), 'Thanks!');
  assert.equal(inbound.stripQuoted('Sige po\n> quoted\n> more'), 'Sige po');
  assert.equal(inbound.findToken({ to: { value: [{ address: 'A+BH-AbC123xyz@x.com' }] } }), 'abc123xyz');
  assert.equal(inbound.parseImapUrl('imaps://admin%40x.com:pw@imap.gmail.com:993').auth.user, 'admin@x.com');
  assert.equal(inbound.parseImapUrl('https://x'), null);
});

test('notes, scheduling, cancelling, failures and retry', async () => {
  outbox.length = 0;
  const n = await owner.post(`/api/inbox/${convA}/messages`, { body: 'Guest asked for early check-in.', note: true });
  assert.equal(n.data.message.status, 'note');
  assert.equal(outbox.length, 0, 'notes are never emailed');

  const later = new Date(Date.now() + 3600 * 1000).toISOString();
  const sch = await owner.post(`/api/inbox/${convA}/messages`, { body: 'Reminder!', send_at: later });
  assert.equal(sch.data.message.status, 'scheduled');
  assert.equal(outbox.length, 0);
  assert.equal(Number((await owner.get(`/api/inbox?view=open`)).data.conversations.find((c) => c.conversation_id === convA).scheduled_count), 1);
  const cancel = await owner.post(`/api/inbox/messages/${sch.data.message.message_id}/cancel`);
  assert.equal(cancel.status, 200);
  assert.equal((await owner.post(`/api/inbox/messages/${sch.data.message.message_id}/cancel`)).status, 409);

  const sch2 = await owner.post(`/api/inbox/${convA}/messages`, { body: 'Due soon', send_at: later });
  await sql(`UPDATE messages SET scheduled_at = now() - interval '1 minute' WHERE message_id = $1`, [sch2.data.message.message_id]);
  assert.equal(await messaging.sendDueMessages(), 1);
  assert.equal(outbox.length, 1);
  assert.equal(await messaging.sendDueMessages(), 0, 'sent only once');

  const bad = await owner.post(`/api/inbox/${convA}/messages`, { body: 'x', send_at: 'not a date' });
  assert.equal(bad.status, 400);

  // Guest without email: clear error; note still allowed.
  const c2 = (await owner.post(`/api/reservations/${resNoEmail.booking_id}/conversation`)).data.conversation_id;
  const noEmail = await owner.post(`/api/inbox/${c2}/messages`, { body: 'Hi' });
  assert.equal(noEmail.status, 409);
  assert.equal(noEmail.data.code, 'NO_EMAIL');
  assert.equal((await owner.post(`/api/inbox/${c2}/messages`, { body: 'Called the guest instead', note: true })).status, 201);

  // A refused email is recorded as failed and can be retried.
  const g = await owner.get(`/api/reservations/${resNoEmail.booking_id}`);
  await owner.patch(`/api/guests/${g.data.reservation.guest_id}`, { full_name: 'No Email', email: 'fail-me@example.com' });
  const f = await owner.post(`/api/inbox/${c2}/messages`, { body: 'Will fail' });
  assert.equal(f.data.message.status, 'failed');
  assert.match(f.data.message.error, /550/);
  await owner.patch(`/api/guests/${g.data.reservation.guest_id}`, { full_name: 'No Email', email: 'works@example.com' });
  await sql('UPDATE messages SET to_email = NULL WHERE message_id = $1', [f.data.message.message_id]);
  const retry = await owner.post(`/api/inbox/messages/${f.data.message.message_id}/retry`);
  assert.equal(retry.data.ok, true);
});

test('archive, snooze, assign and views', async () => {
  assert.equal((await owner.patch(`/api/inbox/${convA}`, { snoozed_until: new Date(Date.now() - 1000).toISOString() })).status, 400);
  await owner.patch(`/api/inbox/${convA}`, { snoozed_until: new Date(Date.now() + 86400000).toISOString() });
  assert.ok(!(await owner.get('/api/inbox')).data.conversations.some((c) => c.conversation_id === convA));
  assert.ok((await owner.get('/api/inbox?view=snoozed')).data.conversations.some((c) => c.conversation_id === convA));
  await owner.patch(`/api/inbox/${convA}`, { snoozed_until: null, status: 'archived' });
  assert.ok((await owner.get('/api/inbox?view=archived')).data.conversations.some((c) => c.conversation_id === convA));
  const me = (await owner.get('/api/auth/me')).data.user;
  await owner.patch(`/api/inbox/${convA}`, { status: 'open', assigned_to: me.user_id });
  assert.equal((await owner.get('/api/inbox?view=mine')).data.conversations.length, 1);
  assert.equal((await owner.patch(`/api/inbox/${convA}`, { assigned_to: '00000000-0000-0000-0000-000000000000' })).status, 400);
  assert.equal((await owner.get('/api/inbox?q=Rafael')).data.conversations.length, 1);
  assert.equal((await owner.get('/api/inbox?q=zzz%25')).data.conversations.length, 0);

  // A guest reply re-opens and un-snoozes the conversation.
  await owner.patch(`/api/inbox/${convA}`, { status: 'archived' });
  const token = (await sql('SELECT reply_token FROM conversations WHERE conversation_id = $1', [convA]))[0].reply_token;
  await inbound.storeInbound({ to: { value: [{ address: `host+bh-${token}@example.com` }] }, from: { value: [{ address: 'rafael@example.com' }] }, messageId: '<reopen@x>', text: 'Hello again', headers: new Map() });
  assert.equal((await sql('SELECT status FROM conversations WHERE conversation_id = $1', [convA]))[0].status, 'open');
});

test('automatic messages: only for stays due in the last day, once each, when turned on', async () => {
  outbox.length = 0;
  const autos = (await owner.get('/api/automations')).data.automations;
  assert.equal(autos.length, 3);
  assert.ok(autos.every((a) => !a.enabled), 'defaults start off');
  const checkin = autos.find((a) => a.trigger_event === 'before_check_in');
  assert.equal(await messaging.runAutomations(), 0);

  // resOther checks in tomorrow: a "1 day before at 00:00" automation is due now.
  const p = await owner.patch(`/api/automations/${checkin.automation_id}`, { enabled: true, send_time: '00:00' });
  assert.equal(p.status, 200);
  // Pretend it was turned on yesterday so today's send time counts.
  await sql(`UPDATE automations SET created_at = now() - interval '2 days' WHERE automation_id = $1`, [checkin.automation_id]);
  const sent = await messaging.runAutomations();
  assert.equal(sent, 1);
  assert.equal(outbox[0].to, 'other@example.com');
  assert.match(outbox[0].subject, /Check-in details/);
  assert.equal(await messaging.runAutomations(), 0, 'never sent twice');
  const runs = await sql('SELECT COUNT(*)::int AS n FROM automation_runs WHERE automation_id = $1', [checkin.automation_id]);
  assert.equal(runs[0].n, 1);

  // Cancelled stays are skipped.
  const created = await owner.post('/api/automations', { name: 'Welcome', template_id: (await owner.get('/api/message-templates')).data.templates[0].template_id, trigger_event: 'booking_created', enabled: true });
  assert.equal(created.status, 201);
  const r = await owner.post('/api/reservations', { unit_id: unit2.unit_id, check_in: d(30), check_out: d(31), guest_name: 'Cancel Me', guest_email: 'cancel@example.com' });
  await owner.post(`/api/reservations/${r.data.reservation.booking_id}/cancel`, { reason: 'test' });
  const r2 = await owner.post('/api/reservations', { unit_id: unit2.unit_id, check_in: d(40), check_out: d(41), guest_name: 'Keep Me', guest_email: 'keep@example.com' });
  assert.equal(r2.status, 201);
  outbox.length = 0;
  await messaging.runAutomations();
  assert.deepEqual(outbox.map((m) => m.to), ['keep@example.com'], 'only the new confirmed stay, not old ones or cancelled');
});

test('access: managers see only their properties, staff have no inbox, owners-only automations', async () => {
  const inv = await owner.post('/api/team/invitations', { email: 'mgr@example.com', role: 'manager', property_ids: [prop2.property_id] });
  const token = decodeURIComponent(inv.data.inviteLink.split('invite=')[1]);
  const mgr = client(srv.base);
  await mgr.post('/api/auth/signup', { full_name: 'Manager', email: 'mgr@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: token });
  const list = await mgr.get('/api/inbox');
  assert.equal(list.status, 200);
  assert.ok(!list.data.conversations.some((c) => c.conversation_id === convA));
  assert.equal((await mgr.get(`/api/inbox/${convA}`)).status, 404);
  assert.equal((await mgr.post(`/api/inbox/${convA}/messages`, { body: 'x' })).status, 404);
  assert.equal((await mgr.post(`/api/reservations/${resA.booking_id}/conversation`)).status, 404);
  assert.equal((await mgr.post(`/api/reservations/${resOther.booking_id}/conversation`)).status, 200);
  const auto = (await mgr.get('/api/automations')).data;
  assert.equal(auto.can_edit, false);
  assert.equal((await mgr.patch(`/api/automations/${auto.automations[0].automation_id}`, { enabled: true })).status, 403);

  const inv2 = await owner.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  const st = client(srv.base);
  await st.post('/api/auth/signup', { full_name: 'Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv2.data.inviteLink.split('invite=')[1]) });
  assert.equal((await st.get('/api/inbox')).status, 403);
  assert.equal((await st.get(`/api/inbox/${convA}`)).status, 403);
  assert.equal((await st.get('/api/message-templates')).status, 403);

  // Another workspace can't touch these records.
  const other = await ownerAccount(srv.base, 'stranger@example.com', 'Other Co');
  assert.equal((await other.get(`/api/inbox/${convA}`)).status, 404);
  const tpl = (await owner.get('/api/message-templates')).data.templates[0];
  assert.equal((await other.patch(`/api/message-templates/${tpl.template_id}`, { name: 'hijack' })).status, 404);
});
