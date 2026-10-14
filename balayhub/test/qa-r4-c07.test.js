'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Reyes Staycations <host@example.com>';

// QA round 4, inbox server lane (C07): #7 a template name is unique among active templates (case and end spaces ignored);
// #8 the number of days is required for the before and after automatic messages.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');

let srv; let owner; let checkinId;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Reyes Staycations');
  // The first read of the templates creates the built-in ones.
  const t = (await owner.get('/api/message-templates')).data.templates;
  checkinId = t.find((x) => x.system_key === 'checkin').template_id;
});
test.after(async () => { await srv.close(); });

const tpl = (name, extra = {}) => ({ name, subject: 'Hello {{guest_first_name}}', body: 'Welcome, {{guest_first_name}}.', ...extra });
const countAutomations = async () => (await sql('SELECT COUNT(*)::int AS n FROM automations'))[0].n;

test('#7 a name another active template already uses is refused, whatever its case or end spaces', async () => {
  const dup = await owner.post('/api/message-templates', tpl('  booking CONFIRMATION '));
  assert.equal(dup.status, 400);
  assert.equal(dup.data.fields.name, 'You already have a template called "Booking confirmation".');
  const rows = await sql("SELECT COUNT(*)::int AS n FROM message_templates WHERE lower(btrim(name)) = 'booking confirmation'");
  assert.equal(rows[0].n, 1, 'nothing was saved');
});

test('#7 a name used only by an archived template is free again', async () => {
  const first = await owner.post('/api/message-templates', tpl('Welcome note'));
  assert.equal(first.status, 201);
  const again = await owner.post('/api/message-templates', tpl('welcome note'));
  assert.equal(again.status, 400);
  assert.equal(again.data.fields.name, 'You already have a template called "Welcome note".');
  const arch = await owner.post(`/api/message-templates/${first.data.template.template_id}/archive`);
  assert.equal(arch.status, 200);
  const reuse = await owner.post('/api/message-templates', tpl('welcome note'));
  assert.equal(reuse.status, 201);
});

test('#7 renaming to a name another active template uses is refused; changing the case of its own name is fine', async () => {
  const mine = await owner.post('/api/message-templates', tpl('Parking directions'));
  const id = mine.data.template.template_id;
  const clash = await owner.patch(`/api/message-templates/${id}`, { name: ' check-in INSTRUCTIONS ' });
  assert.equal(clash.status, 400);
  assert.equal(clash.data.fields.name, 'You already have a template called "Check-in instructions".');
  const kept = await sql('SELECT name FROM message_templates WHERE template_id = $1', [id]);
  assert.equal(kept[0].name, 'Parking directions');
  const same = await owner.patch(`/api/message-templates/${id}`, { name: 'PARKING directions' });
  assert.equal(same.status, 200);
  assert.equal(same.data.template.name, 'PARKING directions');
});

test('#7 a duplicate name and an unknown variable are reported together, in one answer', async () => {
  const r = await owner.post('/api/message-templates', { name: 'booking confirmation', subject: 'Hi {{guestname}}', body: 'Hello' });
  assert.equal(r.status, 400);
  assert.equal(r.data.fields.name, 'You already have a template called "Booking confirmation".');
  assert.match(r.data.fields.subject, /guestname/);
});

test('#8 a blank number of days is refused for the before and after triggers, and nothing is saved', async () => {
  await owner.get('/api/automations');
  const before = await countAutomations();
  for (const trigger of ['before_check_in', 'before_check_out', 'after_check_out']) {
    for (const offset_days of ['', null]) {
      const r = await owner.post('/api/automations', { name: 'Blank days', template_id: checkinId, trigger_event: trigger, offset_days, send_time: '10:00', enabled: false });
      assert.equal(r.status, 400, `${trigger} with ${JSON.stringify(offset_days)}`);
      assert.equal(r.data.fields.offset_days, 'Enter the number of days.');
    }
  }
  assert.equal(await countAutomations(), before);
});

test('#8 check-in day and booking-created messages need no number of days and save 0; a typed number is kept', async () => {
  for (const trigger of ['check_in_day', 'booking_created']) {
    const r = await owner.post('/api/automations', { name: `Blank ${trigger}`, template_id: checkinId, trigger_event: trigger, offset_days: '', enabled: false });
    assert.equal(r.status, 201, trigger);
    assert.equal(r.data.automation.offset_days, 0);
  }
  const typed = await owner.post('/api/automations', { name: 'Two days before', template_id: checkinId, trigger_event: 'before_check_in', offset_days: 2, enabled: false });
  assert.equal(typed.status, 201);
  assert.equal(typed.data.automation.offset_days, 2);
});

test('#8 clearing the days on an existing before-check-in message is refused; switching it to check-in day is fine', async () => {
  const created = await owner.post('/api/automations', { name: 'Days kept', template_id: checkinId, trigger_event: 'before_check_in', offset_days: 2, enabled: false });
  assert.equal(created.status, 201);
  const id = created.data.automation.automation_id;

  const cleared = await owner.patch(`/api/automations/${id}`, { offset_days: '' });
  assert.equal(cleared.status, 400);
  assert.equal(cleared.data.fields.offset_days, 'Enter the number of days.');
  assert.equal((await sql('SELECT offset_days FROM automations WHERE automation_id = $1', [id]))[0].offset_days, 2);

  const onDay = await owner.patch(`/api/automations/${id}`, { trigger_event: 'check_in_day', offset_days: '' });
  assert.equal(onDay.status, 200);
  assert.equal(onDay.data.automation.trigger_event, 'check_in_day');

  const backBlank = await owner.patch(`/api/automations/${id}`, { trigger_event: 'before_check_in', offset_days: '' });
  assert.equal(backBlank.status, 400);
  assert.equal(backBlank.data.fields.offset_days, 'Enter the number of days.');
});
