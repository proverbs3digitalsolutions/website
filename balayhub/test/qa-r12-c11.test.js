'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// QA round 12, lane C11 (daily close). #33: a date outside 2000 to 2100 is "That date isn't valid." with today's
// checklist, not an error page (the view runs from a temp copy, as in qa-r1-dailyclose-date). K20: GET /daily-close
// says whether the viewer may change a stored close (closed.can_change), and the page hides Reopen and Update when
// it is false. Runs on its own database (TEST_DATABASE_URL) because the test resets the schema.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
const PASSWORD = 'longenough1';
const DAILYCLOSE_JS = path.join(__dirname, '..', 'public', 'js', 'views', 'dailyclose.js');
const INVALID = "That date isn't valid, so this shows today.";
const day = (date) => `/api/daily-close?date=${date}`;

let srv; let owner; let manager; let orgId; let propA; let propB; let today; let dailyclose; let dir;

async function accept(email, role, propertyIds, fullName) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

test.before(async () => {
  // The real view, copied with the real api.js and ui.js and the real addDays (as qa-r1-dailyclose-date does).
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-c11-dailyclose-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.copyFileSync(DAILYCLOSE_JS, path.join(dir, 'views', 'dailyclose.js'));
  const reservations = fs.readFileSync(path.join(__dirname, '../public/js/views/reservations.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'views', 'reservations.js'), reservations.match(/export function addDays[\s\S]*?\n}\n/)[0]);
  globalThis.Element = class { };
  dailyclose = await import(pathToFileURL(path.join(dir, 'views', 'dailyclose.js')));

  srv = await startServer();
  owner = await ownerAccount(srv.base, 'c11-owner@example.com', 'Lane C11 Stays');
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['Lane C11 Stays']))[0].organization_id;
  today = manilaToday();
  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'house', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'house', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  manager = await accept('c11-manager@example.com', 'manager', [propA.property_id], 'Manager Azure');
});

test.after(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a date outside 2000 to 2100 is refused on the page with today shown, never sent to the server', () => {
  assert.deepEqual(dailyclose.closeDayFor('1900-01-01', '2026-10-15'), { date: '2026-10-15', message: INVALID });
  assert.deepEqual(dailyclose.closeDayFor('1999-12-31', '2026-10-15'), { date: '2026-10-15', message: INVALID });
  assert.deepEqual(dailyclose.closeDayFor('2101-01-01', '2026-10-15'), { date: '2026-10-15', message: INVALID });
  assert.deepEqual(dailyclose.closeDayFor('2000-01-01', '2026-10-15'), { date: '2000-01-01', message: null });
});

test('an owner close covers the whole workspace: the owner may change it, the manager may not and cannot reopen it', async () => {
  const d = addDays(today, -4);
  assert.equal((await owner.post('/api/daily-close', { date: d, note: 'Owner closed' })).status, 200);

  const ownerView = await owner.get(day(d));
  assert.equal(ownerView.status, 200, JSON.stringify(ownerView.data));
  assert.equal(ownerView.data.closed.can_change, true);
  assert.equal(ownerView.data.closed.whole_workspace, true);

  const managerView = await manager.get(day(d));
  assert.equal(managerView.status, 200, JSON.stringify(managerView.data));
  assert.equal(managerView.data.closed.note, 'Owner closed', 'the manager still sees that the day is closed');
  assert.equal(managerView.data.closed.can_change, false);
  assert.equal((await manager.post('/api/daily-close/reopen', { date: d })).status, 409);

  assert.equal((await owner.get(day(addDays(today, -3)))).data.closed, null, 'a day that is not closed has no close to change');
});

test('a manager close covers only their property: the manager may change it', async () => {
  const d = addDays(today, -5);
  assert.equal((await manager.post('/api/daily-close', { date: d, note: 'Azure only' })).status, 200);

  const managerView = await manager.get(day(d));
  assert.equal(managerView.data.closed.can_change, true);
  assert.equal((await owner.get(day(d))).data.closed.can_change, true);
  assert.equal((await manager.post('/api/daily-close', { date: d, note: 'Azure again' })).status, 200);
});

test('a close covering a property the manager does not manage is visible to them but cannot be changed', async () => {
  const d = addDays(today, -6);
  await sql(`INSERT INTO daily_closes (organization_id, close_date, property_ids, summary, note)
             VALUES ($1, $2, ARRAY[$3::uuid, $4::uuid], '{}', 'Both properties')`, [orgId, d, propA.property_id, propB.property_id]);

  const managerView = await manager.get(day(d));
  assert.equal(managerView.data.closed.note, 'Both properties');
  assert.equal(managerView.data.closed.whole_workspace, false);
  assert.equal(managerView.data.closed.can_change, false);
  assert.equal((await manager.post('/api/daily-close', { date: d, note: 'Mine' })).status, 409);
});

test('the locked-close line names the kind of close: whole workspace, or properties the viewer does not all manage', async () => {
  assert.equal(dailyclose.lockedCloseText({ whole_workspace: true }), 'This day was closed for the whole workspace. Only an owner can change it.');
  assert.equal(dailyclose.lockedCloseText({ whole_workspace: false }), "This day was closed for properties you don't all manage. Only an owner or the manager who covers them all can change it.");
});

test('the page shows Reopen and Update only when the viewer may change the close, with the locked-close line', () => {
  const src = fs.readFileSync(DAILYCLOSE_JS, 'utf8');
  assert.match(src, /closed\?\.can_change && h\('button', \{ class: 'btn btn--secondary', 'data-focus-key': 'dc-reopen', onclick: reopen \}, 'Reopen day'\)/);
  assert.match(src, /\(!closed \|\| closed\.can_change\) && h\('button', \{ class: 'btn btn--primary', 'data-focus-key': 'dc-close', onclick: closeDay \}/);
  assert.match(src, /closed && !closed\.can_change && h\('p', \{ class: 'muted small' \}, lockedCloseText\(closed\)\)/);
});
