'use strict';

// The BalayHub assistant, against a stand-in for the Claude API.
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.ASSISTANT_MODEL = 'claude-opus-5-5';

const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');

let stub; let calls = []; let nextReply = 'Go to Listings → Add listing.';
let nextStop = 'end_turn';
let srv; let host; let staff; let h;

test.before(async () => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      if (nextReply === 'ERROR429') {
        res.statusCode = 429;
        res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }));
        return;
      }
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: nextStop, stop_sequence: null,
        content: nextStop === 'refusal' ? [] : [{ type: 'text', text: nextReply }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }));
    });
  });
  await new Promise((r) => stub.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${stub.address().port}`;
  h = require('./helpers');
  srv = await h.startServer();
  host = await h.ownerAccount(srv.base, 'host@example.com', 'Chat Stays');
  const prop = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  const inv = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [prop.property_id] });
  staff = h.client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Nene Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
});
test.after(async () => { await srv.close(); stub.close(); });

test('answers from the guides, with role and page context and a cached knowledge prompt', async () => {
  assert.equal((await host.get('/api/assistant')).data.enabled, true);
  calls = [];
  const r = await host.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'How do I add a listing?' }], page: '#/listings' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.reply, 'Go to Listings → Add listing.');
  assert.equal(r.data.offer_ticket, false);
  assert.ok(r.data.articles.some((a) => a.slug === 'add-listing'));
  const { body, headers } = calls[0];
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
  assert.match(body.system[0].text, /Add a listing \(unit\)/);
  assert.match(body.system[1].text, /Page they are on: #\/listings/);
  assert.match(body.system[1].text, /Workspace: Chat Stays/);
  assert.ok(!/Chat Stays/.test(body.system[0].text), 'per-user details stay out of the cached part');
});

test('staff get a staff-only knowledge base', async () => {
  calls = [];
  await staff.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'How do I invite my team?' }] });
  const sys = calls[0].body.system[0].text;
  assert.match(sys, /Staff: sees reservations/);
  assert.ok(!/### Invite your team and set roles/.test(sys), 'owner-only guide not included');
  assert.match(sys, /Invite your team and set roles/, 'but named as something the owner can do');
});

test('hands off to support with the ticket marker; refusals and errors are friendly', async () => {
  nextReply = 'That looks like a billing problem. BalayHub Support can check it.\n[[TICKET]]';
  let r = await host.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'I was charged twice' }] });
  assert.equal(r.data.offer_ticket, true);
  assert.ok(!r.data.reply.includes('[[TICKET]]'));

  nextStop = 'refusal';
  r = await host.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'something odd' }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.offer_ticket, true);
  nextStop = 'end_turn';

  nextReply = 'ERROR429';
  r = await host.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(r.status, 503);
  assert.match(r.data.error?.message || r.data.message || JSON.stringify(r.data), /busy/);
  nextReply = 'OK';
});

test('validates the conversation and trims it to recent turns', async () => {
  assert.equal((await host.post('/api/assistant/chat', { messages: [] })).status, 400);
  assert.equal((await host.post('/api/assistant/chat', { messages: [{ role: 'system', content: 'x' }] })).status, 400);
  assert.equal((await host.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] })).status, 400, 'must end with a question');
  calls = [];
  const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })).concat([{ role: 'user', content: 'last' }]);
  assert.equal((await host.post('/api/assistant/chat', { messages: long })).status, 200);
  const sent = calls[0].body.messages;
  assert.ok(sent.length <= 12);
  assert.equal(sent[0].role, 'user');
  assert.equal(sent.at(-1).content, 'last');
  for (let i = 1; i < sent.length; i++) assert.notEqual(sent[i].role, sent[i - 1].role, 'roles alternate');
});

test('read-only workspaces can still ask; signed-out users cannot', async () => {
  await h.sql(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE name = 'Chat Stays'`);
  assert.equal((await host.post('/api/assistant/chat', { messages: [{ role: 'user', content: 'How do I pay for a plan?' }] })).status, 200);
  assert.equal((await h.client(srv.base).post('/api/assistant/chat', { messages: [{ role: 'user', content: 'hi' }] })).status, 401);
});
