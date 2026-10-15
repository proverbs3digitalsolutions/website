'use strict';

// QA round 13, fix lane F07 (inbox and help). #18 a renamed built-in template keeps its name on a language switch;
// #19 Assigned to only with someone to assign to; N1 the MAIL_OFF wording; K8 the template row is locked while
// archive and automation writes run; K7b `?.archived`; #17 `.link-tap` on the four standalone links; conv-* focus keys.
const { startServer, ownerAccount } = require('./helpers');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const view = read('public', 'js', 'views', 'inbox.js');
const help = read('public', 'js', 'views', 'help.js');
const route = read('src', 'routes', 'inbox.js');
const handler = (src, start) => { const i = src.indexOf(start); return src.slice(i, src.indexOf('\n}));', i)); };

let srv; let owner;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host-r13-f07@example.com', 'Reyes Staycations');
});
test.after(async () => { await srv.close(); });

const checkin = async () => (await owner.get('/api/message-templates')).data.templates.find((t) => t.system_key === 'checkin');

test('#18 a renamed built-in template keeps its name when the language switches, both ways', async () => {
  const t = await checkin();
  assert.equal((await owner.patch(`/api/message-templates/${t.template_id}`, { name: 'My check-in' })).status, 200);
  assert.equal((await owner.post('/api/message-templates/language', { language: 'tl' })).status, 200);
  let now = await checkin();
  assert.equal(now.name, 'My check-in');
  assert.match(now.body, /Salamat|po|mo/);
  assert.notEqual(now.body, t.body);
  assert.equal((await owner.post('/api/message-templates/language', { language: 'en' })).status, 200);
  now = await checkin();
  assert.equal(now.name, 'My check-in');
  assert.equal(now.body, t.body);
});

test('#18 an untouched built-in template is still renamed with the language', async () => {
  const thanks = (await owner.get('/api/message-templates')).data.templates.find((t) => t.system_key === 'thanks');
  assert.equal((await owner.post('/api/message-templates/language', { language: 'tl' })).status, 200);
  const tl = (await owner.get('/api/message-templates')).data.templates.find((t) => t.system_key === 'thanks');
  assert.notEqual(tl.name, thanks.name);
  assert.match(tl.name, /Taglish/);
  assert.equal((await owner.post('/api/message-templates/language', { language: 'en' })).status, 200);
  assert.equal((await owner.get('/api/message-templates')).data.templates.find((t) => t.system_key === 'thanks').name, thanks.name);
});

test('K8 template archive and automation create and PATCH lock the template row inside a transaction', () => {
  for (const start of ["router.post('/message-templates/:id/archive'", "router.post('/automations'", "router.patch('/automations/:id'"]) {
    const src = handler(route, start);
    assert.match(src, /tx\(/, `${start} runs in a transaction`);
    assert.match(src, /FROM message_templates WHERE template_id = \$1 FOR UPDATE/, `${start} locks the template row`);
  }
});

test('N1 the MAIL_OFF sentence and the banner no longer name a server file', () => {
  const msg = 'Email sending isn\'t turned on for BalayHub yet, so messages can\'t be sent. Contact BalayHub support.';
  assert.ok(route.includes(msg.replace(/'/g, "\\'")) || route.includes(msg), 'server sentence');
  assert.ok(view.includes(msg.replace(/'/g, "\\'")) || view.includes(msg), 'banner sentence');
  assert.doesNotMatch(route + view, /EMAIL-SETUP/);
});

test('#19 the header Assigned to select shows only with more than one assignee or an assigned conversation', () => {
  assert.match(view, /\(assignees\.length > 1 \|\| c\.assigned_to\) && h\('select'/);
});

test('K7b the automation PATCH reads the locked template with ?.archived', () => {
  assert.match(handler(route, "router.patch('/automations/:id'"), /tpl\?\.archived/);
});

test('K8 an automation row whose template was deleted shows Turn on dimmed with the hint', () => {
  assert.match(view, /'aria-disabled': a\.template_archived && !a\.enabled \? 'true' : undefined/);
  assert.match(view, /Choose a template first\./);
});

test('#17 .link-tap on the Reservation Open, guest phone, Language for guests and Help ticket links', () => {
  assert.match(view, /class: 'link-tap', href: `#\/reservations\/\$\{c\.booking_id\}` \}, 'Open'\)/);
  assert.match(view, /class: 'link-tap', href: `tel:/);
  assert.match(view, /class: 'link-tap', href: '#\/settings' \}, 'Settings, Language for guests'/);
  assert.match(help, /class: 'link-tap', href: '#\/help\/new' \}, 'Open a support ticket'/);
});

test('focus keys: conv-snooze on Snooze and Unsnooze, conv-archive on Archive and Unarchive', () => {
  assert.equal((view.match(/'data-focus-key': 'conv-snooze'/g) || []).length, 2);
  assert.equal((view.match(/'data-focus-key': 'conv-archive'/g) || []).length, 2);
});
