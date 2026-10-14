'use strict';

// QA round 2, lane A17 (calendar view).
// calendar#8: the sync warning lists each problem once, with its channel and the link's host.
// calendar#5: a refused drag-move shows the server's reason once, not the field text twice.
// calendar#2: the nightly price form refuses 0 before it saves (the server refuses it too, in A03).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, sql, ownerAccount } = require('./helpers');

const CALENDAR_JS = path.join(__dirname, '..', 'public', 'js', 'views', 'calendar.js');
const source = fs.readFileSync(CALENDAR_JS, 'utf8');

// The text of one function in calendar.js, from its declaration up to the next named function.
function functionBody(declaration, next) {
  const start = source.indexOf(declaration);
  assert.ok(start > -1, `${declaration} is in calendar.js`);
  const end = source.indexOf(next, start);
  assert.ok(end > start, `${next} follows ${declaration}`);
  return source.slice(start, end);
}

let srv; let owner; let prop; let unit; let unit2; let feedSeq = 0;

// A calendar link on a listing. Defaults to a link that could not be reached.
async function addFeed(unitId, { channel = 'other', url, lastStatus = 'error', lastMessage = 'getaddrinfo ENOTFOUND cal.example.org' } = {}) {
  feedSeq += 1;
  const [row] = await sql(
    `INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status, last_message)
     SELECT p.organization_id, u.unit_id, $2::text, $3::text, now(), $4::text, $5::text
       FROM units u JOIN properties p ON p.property_id = u.property_id
      WHERE u.unit_id = $1 RETURNING feed_id`,
    [unitId, channel, url || `https://cal${feedSeq}.example.org/export/${feedSeq}.ics`, lastStatus, lastMessage]);
  return row.feed_id;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'qa-r2-calendar@example.com', 'Calendar QA Co');
  prop = (await owner.post('/api/properties', { property_name: 'Loft Building', property_type: 'condominium', address: 'Makati', city: 'Makati', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Loft A', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
  unit2 = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Loft B', unit_type: 'studio', nightly_rate: '1800' })).data.unit;
});
test.after(async () => {
  await srv.close();
});

test('each sync problem carries the channel and the link host, and never the link itself', async () => {
  const token = 'tok-qa-r2-17-secret';
  await addFeed(unit.unit_id, { url: `https://cal.example.org/export/cal.ics?t=${token}` });
  await addFeed(unit.unit_id, { url: 'https://bad.example.net/feed.ics', lastMessage: 'The channel returned HTTP 404. Check the link.' });

  const res = await owner.get('/api/sync-health');
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const mine = res.data.problems.filter((p) => p.unit_id === unit.unit_id);
  assert.equal(mine.length, 2, JSON.stringify(mine));
  assert.deepEqual(mine.map((p) => p.host).sort(), ['bad.example.net', 'cal.example.org']);
  assert.ok(mine.every((p) => p.channel === 'other'));
  assert.ok(!JSON.stringify(res.data).includes(token), 'the link token stays on the server');
});

test('an overlap problem carries the link host too', async () => {
  const feedId = await addFeed(unit2.unit_id, { url: 'https://ical.example.com/x.ics', lastStatus: 'ok', lastMessage: 'Synced: 0 new, 0 changed, 0 removed.' });
  await sql(`INSERT INTO ical_conflicts (organization_id, feed_id, unit_id, external_uid, check_in, check_out)
    SELECT f.organization_id, f.feed_id, f.unit_id, 'qa-r2-17-ov', CURRENT_DATE + 30, CURRENT_DATE + 32
      FROM ical_feeds f WHERE f.feed_id = $1`, [feedId]);

  const res = await owner.get('/api/sync-health');
  const overlap = res.data.problems.find((p) => p.unit_id === unit2.unit_id);
  assert.equal(overlap.kind, 'overlap');
  assert.equal(overlap.host, 'ical.example.com');
  assert.equal(overlap.channel, 'other');
});

test('a refused drag-move shows the server reason once, not the field text twice', () => {
  const body = functionBody('async function moveBar(', 'function cellMenu(');
  assert.doesNotMatch(body, /Object\.values\(err\.fields/, 'the field text is not joined into the toast');
  assert.match(body, /toast\(err\.message, 'error'\)/, 'the toast shows the server message');
});

test('the sync warning lists each problem once, naming the channel and host, in the badge and its label', () => {
  assert.match(source, /const problemLine = \(p\) => `\$\{CHANNEL_LABEL\[p\.channel\] \|\| 'Calendar'\}\$\{p\.host \? ` \(\$\{p\.host\}\)` : ''\}: \$\{p\.message\}`;/);
  const render = functionBody('function render(data)', 'async function moveBar(');
  assert.match(render, /const lines = \[\.\.\.new Set\(warn\.map\(problemLine\)\)\];/);
  assert.doesNotMatch(render, /warn\.map\(\(p\) => p\.message\)/, 'no raw message list in the warning');
  assert.match(render, /title: lines\.join\(' '\)/);
  assert.match(render, /'aria-label': `Sync problem on \$\{l\.unit_name\}: \$\{lines\.join\(' '\)\}`/);
});

test('the nightly price form refuses 0 with a plain message, and a blank still clears the price', () => {
  const body = functionBody('function priceModal(', 'async function blockMenu(');
  assert.match(body, /Price must be greater than zero\. Leave it blank to use your usual price\./);
  assert.match(body, /throw new ApiError\(/, 'the refusal stops the save before PUT /rates');
  assert.match(body, /d\.price\.trim\(\) !== ''/, 'a blank price is not refused');
  assert.match(body, /Number\(d\.price\) === 0/);
});
