'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Host <host@example.com>';

// QA round 9, lane C10 (onboarding: landing, launchpad, onboarding route). Server: the channels step
// needs a calendar that synced ok (#32), house rules tick the guest info step (#33). Source: the 1 to 3
// unit band (#29), the Taglish first name (#36), a way to show the hidden reminder again (#31), and the
// Launchpad footer pointing at Help & support (K17).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, sql } = require('./helpers');

const views = path.join(__dirname, '..', 'public', 'js', 'views');
const landing = fs.readFileSync(path.join(views, 'landing.js'), 'utf8');
const launchpad = fs.readFileSync(path.join(views, 'launchpad.js'), 'utf8');

let srv; let owner; let unit;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c10-owner@example.com', 'C10 Stays');
  const prop = (await owner.post('/api/properties', { property_name: 'Lumi', property_type: 'condominium', address: 'Pasay Rd', city: 'Pasay', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Tower 1 - 1201', unit_type: 'studio', nightly_rate: '2000', max_guests: 4 })).data.unit;
});
test.after(async () => { await srv.close(); });

const launchpadState = async () => (await owner.get('/api/onboarding')).data;
const stepOf = (o, key) => o.steps.find((x) => x.key === key);
const addFeed = (status) => sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_status)
  SELECT p.organization_id, u.unit_id, 'airbnb', $2, $3 FROM units u JOIN properties p USING (property_id) WHERE u.unit_id = $1`,
[unit.unit_id, `https://example.com/${status}.ics`, status]);

test('channels: a calendar whose last sync failed does not tick the step, and the Launchpad flags it', async () => {
  let o = await launchpadState();
  assert.equal(stepOf(o, 'channels').done, false);
  assert.equal(o.channels_failing, false, 'no calendar yet is not a sync failure');
  await addFeed('error');
  o = await launchpadState();
  assert.equal(stepOf(o, 'channels').done, false, 'a feed that failed must not count as connected');
  assert.equal(o.channels_failing, true);
  await sql(`UPDATE ical_feeds SET last_status = 'ok' WHERE unit_id = $1`, [unit.unit_id]);
  o = await launchpadState();
  assert.equal(stepOf(o, 'channels').done, true);
  assert.equal(o.channels_failing, false);
});

test('guest info: house rules alone tick the step, like Wi-Fi or check-in instructions', async () => {
  let o = await launchpadState();
  assert.equal(stepOf(o, 'guest_info').done, false);
  await sql('UPDATE units SET house_rules = $2 WHERE unit_id = $1', [unit.unit_id, 'No parties after 10 pm.']);
  o = await launchpadState();
  assert.equal(stepOf(o, 'guest_info').done, true);
});

test('landing: the Starting out band says 1 to 3 units, in English and Taglish', () => {
  assert.ok(landing.includes("['1-3', '1–3 units']"), 'the sign-up band text');
  assert.ok(landing.includes("'Starting out', '1–3 units'"), 'the Starting out card');
  assert.ok(landing.includes("'1–3 units': '1–3 unit'"), 'the Taglish entry');
  assert.doesNotMatch(landing, /1–2 units/);
});

test('landing: the Taglish first name is "Unang pangalan", not "Pangalan"', () => {
  assert.ok(landing.includes("'First name': 'Unang pangalan'"));
  assert.ok(!landing.includes("'First name': 'Pangalan'"));
});

test('launchpad: a hidden reminder can be shown again from the Launchpad itself', () => {
  assert.match(launchpad, /Show the reminder on Home/);
  assert.match(launchpad, /post\('\/onboarding\/dismiss', \{ show: true \}\)/);
});

test('launchpad: the channels step says when the calendar is not syncing', () => {
  assert.match(launchpad, /Connected, but the calendar isn\\'t syncing\. Check the link\./);
});

test('launchpad: the footer points at Help & support, not Plan & billing', () => {
  assert.match(launchpad, /h\('a', \{ href: '#\/help' \}, 'contact us from Help & support'\)/);
  assert.doesNotMatch(launchpad, /Plan & billing/);
});
