'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, ownerAccount, client } = require('./helpers');

test('every text on the guest pages has a Taglish translation', () => {
  const dict = fs.readFileSync(path.join(__dirname, '../public/js/i18n.js'), 'utf8');
  const keys = new Set();
  // Keys in the TL dictionary: 'key': or "key":
  for (const m of dict.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"):/gm)) keys.add((m[1] ?? m[2]).replace(/\\'/g, "'"));
  for (const m of dict.matchAll(/,\s*'((?:[^'\\]|\\.)*)':/g)) keys.add(m[1].replace(/\\'/g, "'"));
  const missing = [];
  for (const f of ['book.js', 'pay.js', 'checkin.js', 'review.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../public/js/views', f), 'utf8');
    for (const m of src.matchAll(/\bt\((?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
      const k = (m[1] ?? m[2]).replace(/\\'/g, "'");
      if (!keys.has(k)) missing.push(`${f}: ${k}`);
    }
  }
  assert.deepEqual(missing, []);
});

let srv; let host;
test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Wika Stays');
});
test.after(async () => { await srv.close(); });

test('host sets Taglish for guests; built-in messages switch and custom wording is kept', async () => {
  const tpls = (await host.get('/api/message-templates')).data.templates;
  const thanks = tpls.find((t) => t.system_key === 'thanks');
  await host.patch(`/api/message-templates/${thanks.template_id}`, { body: 'Hi {{guest_first_name}}, salamat! — My own words' });
  assert.equal((await host.patch('/api/workspace', { guest_language: 'xx' })).status, 400);
  assert.equal((await host.patch('/api/workspace', { guest_language: 'tl' })).status, 200);
  assert.equal((await host.get('/api/auth/me')).data.user.guest_language, 'tl');
  const r = await host.post('/api/message-templates/language', { language: 'tl' });
  assert.equal(r.data.copied, 1);
  const after = (await host.get('/api/message-templates')).data.templates;
  const conf = after.find((t) => t.system_key === 'confirmation');
  assert.match(conf.subject, /Confirmed na ang stay mo/);
  assert.match(after.find((t) => t.system_key === 'payment_reminder').body, /\{\{payment_link\}\}/);
  assert.ok(after.some((t) => !t.system_key && /my version/.test(t.name) && /My own words/.test(t.body)));
  // Back to English: stock Taglish isn't copied again.
  const back = await host.post('/api/message-templates/language', { language: 'en' });
  assert.equal(back.data.copied, 0);
  assert.match((await host.get('/api/message-templates')).data.templates.find((t) => t.system_key === 'confirmation').subject, /is confirmed/);
  // Staff can't switch.
  const inv = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [] });
  const staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'S', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal((await staff.post('/api/message-templates/language', { language: 'tl' })).status, 403);
});
