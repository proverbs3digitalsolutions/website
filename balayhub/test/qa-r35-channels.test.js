'use strict';

// QA round 35 (ONB-3, ONB-4, D-117): a refused calendar link says why, and the Channels dialog's
// failed-sync sentence points at the link above it, not at the page the owner is already on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sql, ownerAccount } = require('./helpers');
const { problemText } = require('../src/lib/synchealth');

const CHANNELS_PAGE = "Check the link on the listing's Channels page.";
const ABOVE = 'Check the link above, then press Sync now.';
const OLD = 'Paste the full https:// calendar (iCal) link from the channel.';
const IP = "This link is an IP address, not a channel's website, so BalayHub can't read it. Copy the calendar (iCal) link from the channel.";
const PORT = "BalayHub can't read links with a port number or a password in them. Copy the calendar (iCal) link exactly as the channel shows it.";

let srv; let owner; let unit;
test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host35@example.com', 'Channels Test');
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan', city: 'Parañaque', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Tower 1', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
});
test.after(async () => { await srv.close(); });

const add = (url) => owner.post('/api/ical-feeds', { unit_id: unit.unit_id, channel: 'airbnb', url });
const rows = async () => (await sql('SELECT count(*)::int AS n FROM ical_feeds WHERE unit_id = $1', [unit.unit_id]))[0].n;

test('a calendar link to an IP address gets the IP sentence and adds nothing', async () => {
  for (const url of ['https://127.0.0.1:9/cal.ics', 'https://[::1]/cal.ics']) {
    const r = await add(url);
    assert.equal(r.status, 400);
    assert.equal(r.data.fields.url, IP, url);
  }
  assert.equal(await rows(), 0);
});

test('a port or a password in the link gets the port sentence', async () => {
  for (const url of ['https://cal.example.com:8443/x.ics', 'https://user:pw@cal.example.com/x.ics']) {
    const r = await add(url);
    assert.equal(r.status, 400);
    assert.equal(r.data.fields.url, PORT, url);
  }
});

test('a link that is not https, or not a link, keeps the old sentence', async () => {
  for (const url of ['http://cal.example.com/x.ics', 'not a link']) {
    const r = await add(url);
    assert.equal(r.status, 400);
    assert.equal(r.data.fields.url, OLD, url);
  }
  assert.equal(await rows(), 0);
});

test('a good https link is not refused', async () => {
  const r = await add('https://cal.example.com/x.ics');
  assert.notEqual(r.status, 400, JSON.stringify(r.data));
});

test('problemText: the Channels page sentence by default, the "above" sentence inside the dialog', () => {
  for (const last_message of ['getaddrinfo ENOTFOUND x.invalid', 'The channel returned HTTP 404. Check the link.']) {
    const plain = problemText({ last_message }, 'failing').message;
    const inDialog = problemText({ last_message }, 'failing', { inChannels: true }).message;
    assert.ok(plain.endsWith(CHANNELS_PAGE), plain);
    assert.ok(inDialog.endsWith(ABOVE), inDialog);
    assert.equal(inDialog, plain.replace(CHANNELS_PAGE, ABOVE));
  }
  assert.equal(problemText({}, 'stale').message, problemText({}, 'stale', { inChannels: true }).message);
});

test('the channels route gives the "above" sentence for a failing feed', async () => {
  await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status, last_message)
             SELECT p.organization_id, u.unit_id, 'airbnb', 'https://cal.example.com/f.ics', now(), 'error', 'getaddrinfo ENOTFOUND x.invalid'
               FROM units u JOIN properties p ON p.property_id = u.property_id WHERE u.unit_id = $1`, [unit.unit_id]);
  const r = await owner.get(`/api/units/${unit.unit_id}/channels`);
  assert.equal(r.status, 200);
  assert.ok(r.data.feeds[0].problem_message.endsWith(ABOVE), r.data.feeds[0].problem_message);
});

test('the dialog fallback in listings.js uses the same sentence', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/js/views/listings.js'), 'utf8');
  assert.ok(src.includes(`Couldn't reach the calendar link. ${ABOVE}`));
  assert.ok(!src.includes("Couldn't reach the calendar link. Check the link on the listing's Channels page."));
});
