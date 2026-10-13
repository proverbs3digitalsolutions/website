'use strict';

process.env.SMTP_URL = 'test://';
process.env.PLATFORM_ADMIN_EMAILS = 'boss@example.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount } = require('./helpers');
const { outbox } = require('../src/lib/mailer');
const support = require('../src/routes/support');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');

let srv; let host; let other; let boss; let staff; let ticket;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Help Stays');
  other = await ownerAccount(srv.base, 'other@example.com', 'Other Stays');
  boss = await ownerAccount(srv.base, 'boss@example.com', 'BalayHub HQ');
  const prop = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const inv = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Nene Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); });

test('help articles: search and role filtering', async () => {
  const all = (await host.get('/api/help/articles')).data;
  assert.ok(all.categories.length >= 5);
  assert.ok(all.articles.length >= 15);
  const found = (await host.get('/api/help/articles?q=connect airbnb calendar')).data.articles;
  assert.ok(found.length > 0);
  assert.match(found[0].title, /Airbnb|calendar/i);
  const staffSees = (await staff.get('/api/help/articles')).data.articles.length;
  assert.ok(staffSees < all.articles.length, 'staff don\'t see owner-only guides');
});

test('open a ticket: number, timeline, emails to support and the customer', async () => {
  outbox.length = 0;
  assert.equal((await host.post('/api/support/tickets', { subject: 'x', category: 'problem', body: 'hi' })).status, 400);
  assert.equal((await host.post('/api/support/tickets', { subject: 'Calendar is empty', category: 'nope', body: 'hi' })).status, 400);
  const r = await host.post('/api/support/tickets', {
    subject: 'Airbnb bookings not showing', category: 'problem', priority: 'urgent', body: 'I connected Airbnb yesterday but the calendar is empty.',
    context: { page: '#/calendar', screen: '390x844', theme: 'dark', language: 'en-PH' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.number, /^T-\d{4,}$/);
  ticket = r.data.ticket_id;
  assert.ok(outbox.some((m) => m.to === 'boss@example.com' && /URGENT/.test(m.subject) && /#\/calendar/.test(m.text)));
  assert.ok(outbox.some((m) => m.to === 'host@example.com' && /We received your request/.test(m.subject)));

  const d = (await host.get(`/api/support/tickets/${ticket}`)).data;
  assert.equal(d.ticket.status, 'new');
  assert.equal(d.ticket.status_label, 'Received');
  assert.equal(d.ticket.context.page, '#/calendar');
  assert.equal(d.ticket.context.role, 'owner');
  assert.equal(d.messages.length, 1);
  assert.equal(d.events[0].kind, 'created');

  const up = await host.raw('POST', `/api/files?record_type=support&record_id=${ticket}`, PNG, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 201);
  assert.equal((await host.get(`/api/support/tickets/${ticket}`)).data.files.length, 1);
});

test('tickets are private: other workspaces, and staff only see their own', async () => {
  assert.equal((await other.get(`/api/support/tickets/${ticket}`)).status, 404);
  assert.equal((await other.post(`/api/support/tickets/${ticket}/reply`, { body: 'hi' })).status, 404);
  assert.equal((await other.raw('POST', `/api/files?record_type=support&record_id=${ticket}`, PNG, { 'Content-Type': 'image/png' })).status, 404);
  assert.equal((await other.get('/api/support/tickets')).data.tickets.length, 0);
  assert.equal((await staff.get(`/api/support/tickets/${ticket}`)).status, 404);
  const s = await staff.post('/api/support/tickets', { subject: 'How do I mark a room clean?', category: 'question', body: 'Where is the button?' });
  assert.equal(s.status, 201);
  assert.equal((await staff.get('/api/support/tickets')).data.tickets.length, 1);
  assert.equal((await host.get('/api/support/tickets')).data.tickets.length, 2, 'the owner sees the whole workspace');
  // Only platform admins reach the queue.
  assert.equal((await host.get('/api/admin/support/tickets')).status, 404);
  assert.equal((await host.get(`/api/admin/support/tickets/${ticket}`)).status, 404);
});

test('support replies, internal notes stay hidden, status moves through the steps', async () => {
  const q = (await boss.get('/api/admin/support/tickets?status=open')).data;
  assert.equal(q.tickets[0].ticket_id, ticket, 'urgent first');
  assert.equal(q.counts.new, 2);
  assert.equal((await boss.post(`/api/admin/support/tickets/${ticket}/assign`)).status, 200);
  let d = (await host.get(`/api/support/tickets/${ticket}`)).data;
  assert.equal(d.ticket.status, 'in_progress');

  assert.equal((await boss.post(`/api/admin/support/tickets/${ticket}/reply`, { body: 'Feed URL looks wrong — check notes', internal: true })).status, 201);
  outbox.length = 0;
  assert.equal((await boss.post(`/api/admin/support/tickets/${ticket}/reply`, { body: 'Can you paste the Airbnb calendar link you used?' })).status, 201);
  assert.ok(outbox.some((m) => m.to === 'host@example.com' && /Can you paste/.test(m.text) && /Waiting for you/.test(m.text)));
  d = (await host.get(`/api/support/tickets/${ticket}`)).data;
  assert.equal(d.ticket.status, 'waiting_on_customer');
  assert.ok(d.ticket.first_response_at);
  assert.equal(d.messages.length, 2, 'internal note hidden');
  assert.equal(d.messages[1].author_name, 'BalayHub Support');
  assert.ok(!JSON.stringify(d).includes('Feed URL looks wrong'));
  assert.ok(d.events.every((e) => e.kind !== 'assigned' || e.actor_name === 'BalayHub Support'));
  const admin = (await boss.get(`/api/admin/support/tickets/${ticket}`)).data;
  assert.equal(admin.messages.length, 3);
  assert.equal(admin.workspace.name, 'Help Stays');
  assert.equal(admin.ticket.created_by_email, 'host@example.com');

  // The customer answers: back to support.
  assert.equal((await host.post(`/api/support/tickets/${ticket}/reply`, { body: 'https://www.airbnb.com/calendar/ical/123.ics' })).status, 201);
  assert.equal((await host.get(`/api/support/tickets/${ticket}`)).data.ticket.status, 'in_progress');
});

test('resolve, rate, reopen by replying, and auto-close', async () => {
  assert.equal((await host.post(`/api/support/tickets/${ticket}/rate`, { rating: 5 })).status, 409, 'not resolved yet');
  outbox.length = 0;
  assert.equal((await boss.post(`/api/admin/support/tickets/${ticket}/status`, { status: 'resolved', note: 'Fixed the feed link.' })).status, 200);
  assert.ok(outbox.some((m) => m.to === 'host@example.com' && /reply within 14 days/.test(m.text)));
  let d = (await host.get(`/api/support/tickets/${ticket}`)).data;
  assert.equal(d.ticket.can_reopen, true);
  assert.equal((await host.post(`/api/support/tickets/${ticket}/rate`, { rating: 6 })).status, 400);
  assert.equal((await host.post(`/api/support/tickets/${ticket}/rate`, { rating: 5, comment: 'Quick help!' })).status, 200);

  assert.equal((await host.post(`/api/support/tickets/${ticket}/reply`, { body: 'It stopped syncing again.' })).status, 201);
  d = (await host.get(`/api/support/tickets/${ticket}`)).data;
  assert.equal(d.ticket.status, 'in_progress');
  assert.ok(d.events.some((e) => e.kind === 'status' && e.note === 'Reopened by a reply'));

  assert.equal((await host.post(`/api/support/tickets/${ticket}/resolve`)).status, 200);
  await sql(`UPDATE support_tickets SET resolved_at = now() - interval '8 days', updated_at = now() - interval '8 days' WHERE ticket_id = $1`, [ticket]);
  assert.equal(await support.autoClose(), 1);
  d = (await host.get(`/api/support/tickets/${ticket}`)).data;
  assert.equal(d.ticket.status, 'closed');
  assert.equal(d.ticket.can_reopen, false);
  assert.equal((await host.post(`/api/support/tickets/${ticket}/reply`, { body: 'Hello?' })).status, 409);
});

test('a view-only workspace can still contact support', async () => {
  await sql(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE name = 'Other Stays'`);
  assert.equal((await other.post('/api/properties', { property_name: 'X', property_type: 'condominium', address: 'a', city: 'b', province: 'c' })).status, 402);
  const r = await other.post('/api/support/tickets', { subject: 'How do I pay for a plan?', category: 'payments', body: 'My trial ended.' });
  assert.equal(r.status, 201);
  assert.equal((await other.raw('POST', `/api/files?record_type=support&record_id=${r.data.ticket_id}`, PNG, { 'Content-Type': 'image/png' })).status, 201);
});
