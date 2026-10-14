'use strict';

// Settings and team (QA round 2, lane B21). A manager invitation needs at least one property, as a
// cleaner's does. The plan panel counts only short-term listings (D-03). Audit details show plain labels,
// pesos and dates, and never ids. Every audit code the server writes has a label.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'Settings Team <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, client, sql, ownerAccount } = require('./helpers');

const UUID = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
let srv; let owner; let prop; let settings; let dir;

async function accept(email, role, propertyIds, name) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: name, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}
const userIdOf = async (email) => (await sql('SELECT user_id FROM users WHERE lower(email) = $1', [email]))[0].user_id;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-settings@example.com', 'Settings Team');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;

  // settings.js is a browser module. Load it from a temp copy, with its browser-only imports stubbed.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-settings-team-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = {}; export async function refreshUser() {}\n');
  fs.writeFileSync(path.join(dir, 'notifications.js'), 'export async function notificationsCard() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'themeswitch.js'), 'export function themeSwitch() { return null; }\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/settings.js'), path.join(dir, 'views', 'settings.js'));
  globalThis.Element = class { };
  settings = await import(pathToFileURL(path.join(dir, 'views', 'settings.js')).href);
});
test.after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a manager invitation needs at least one property, and a refused one is not saved', async () => {
  const email = 'mgr-none@example.com';
  const none = await owner.post('/api/team/invitations', { email, role: 'manager', property_ids: [] });
  assert.equal(none.status, 400, JSON.stringify(none.data));
  assert.equal(none.data.code, 'VALIDATION');
  assert.equal(none.data.fields.property_ids, 'Pick at least one property for a manager.');
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM invitations WHERE lower(email) = $1', [email]))[0].n, 0);

  const ok = await owner.post('/api/team/invitations', { email, role: 'manager', property_ids: [prop.property_id] });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

test('staff can still be invited with no property, and the cleaner message is unchanged', async () => {
  assert.equal((await owner.post('/api/team/invitations', { email: 'staff-none@example.com', role: 'staff', property_ids: [] })).status, 201);
  const cleaner = await owner.post('/api/team/invitations', { email: 'cleaner-none@example.com', role: 'cleaner', property_ids: [] });
  assert.equal(cleaner.data.fields.property_ids, 'Pick at least one property for a cleaner.');
});

test('a manager cannot be left without a property, and staff cannot be made managers without one', async () => {
  await accept('mgr-edit@example.com', 'manager', [prop.property_id], 'Mgr Edit');
  const mgrId = await userIdOf('mgr-edit@example.com');
  const emptied = await owner.patch(`/api/team/members/${mgrId}`, { property_ids: [] });
  assert.equal(emptied.status, 400);
  assert.equal(emptied.data.fields.property_ids, 'Pick at least one property for a manager.');
  assert.equal((await sql('SELECT COUNT(*)::int AS n FROM property_assignments WHERE user_id = $1', [mgrId]))[0].n, 1, 'a refused change keeps the property');

  await accept('staff-edit@example.com', 'staff', [], 'Staff Edit');
  const staffId = await userIdOf('staff-edit@example.com');
  const promoted = await owner.patch(`/api/team/members/${staffId}`, { role: 'manager' });
  assert.equal(promoted.status, 400);
  assert.equal(promoted.data.fields.property_ids, 'Pick at least one property for a manager.');
  assert.equal((await sql('SELECT role FROM users WHERE user_id = $1', [staffId]))[0].role, 'staff', 'a refused change leaves the role alone');

  const demoted = await owner.patch(`/api/team/members/${mgrId}`, { role: 'staff', property_ids: [] });
  assert.equal(demoted.status, 200, JSON.stringify(demoted.data));
});

test('the team form asks for a property for a manager, as it does for a cleaner, and not for staff', () => {
  assert.throws(() => settings.needProperty({ role: 'manager', property_ids: [] }), { message: 'Pick at least one property for a manager.' });
  assert.throws(() => settings.needProperty({ role: 'cleaner' }), { message: 'Pick at least one property for a cleaner.' });
  assert.doesNotThrow(() => settings.needProperty({ role: 'staff', property_ids: [] }));
  assert.doesNotThrow(() => settings.needProperty({ role: 'manager', property_ids: [prop.property_id] }));
});

test('the plan panel counts only short-term listings, the way the server counts them for the plan limit', async () => {
  await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2500' });
  await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: 'Room 2', unit_type: 'room', monthly_rent: '8000' });
  const { listings } = (await owner.get('/api/listings')).data;
  assert.equal(listings.length, 2, 'the long-term room is listed too');
  assert.equal(settings.shortTermCount(listings), 1);
  const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM units WHERE nightly_rate IS NOT NULL AND status = $1', ['active']);
  assert.equal(settings.shortTermCount(listings), n);
});

test('audit details show plain labels, pesos and dates, and never ids', () => {
  const text = settings.summarize({
    booking_id: UUID, amount: '8750.00', estimated_cost: 1200, reason: 'Guest asked', role: 'manager', check_in: '2026-10-20',
    enabled: true, method: 'bank_transfer', property_ids: [UUID], note: null,
  });
  assert.equal(text, 'Amount: ₱8,750.00 · Estimated cost: ₱1,200.00 · Reason: Guest asked · Role: Property manager · Check-in: Oct 20, 2026 · Turned on: Yes · Method: Bank transfer');
});

test('an uncommon detail key is still shown in plain words, and a UUID in any field is dropped', () => {
  assert.equal(settings.summarize({ every_n: 2, stray: UUID }), 'Every n: 2');
});

// Every audit code the server writes needs a label. The codes are read from the source: literal codes in
// audit() calls (including a ternary of literals), raw audit_logs inserts, and action options and constants.
// Codes built from a variable are listed here with every value they can take.
const BUILT = {
  '`cleaning.task_${status}`': ['cleaning.task_todo', 'cleaning.task_in_progress', 'cleaning.task_done', 'cleaning.task_cancelled'],
  '`cleaning.${status}`': ['cleaning.clean', 'cleaning.dirty'],
  '`reservation.${action}`': ['reservation.check_in', 'reservation.undo_check_in', 'reservation.check_out', 'reservation.undo_check_out'],
  '`lease.${body.lease_status}`': ['lease.ended', 'lease.terminated'],
};
const VARIABLE_CODES = ['action', 'ACTION']; // their values are read from the literal options and constants below
const CODE = /'([a-z_]+\.[a-z_]+)'/g;

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}
// The action argument of the audit( call whose arguments start at `start` (the third one).
function actionArg(text, start) {
  const parts = []; let depth = 0; let cur = '';
  for (let i = start; i < text.length && parts.length < 3; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += c;
  }
  return parts[2] ?? cur.trim();
}

test('every audit code the server writes has a label in settings.js', () => {
  const srcDir = path.join(__dirname, '../src');
  const codes = new Set(); const unknown = [];
  for (const file of jsFiles(srcDir)) {
    const rel = path.relative(srcDir, file);
    if (rel === path.join('lib', 'audit.js')) continue; // the writer itself
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\baudit\(/g)) {
      const arg = actionArg(text, m.index + 6);
      const quoted = [...arg.matchAll(CODE)].map((c) => c[1]);
      if (quoted.length) quoted.forEach((c) => codes.add(c));
      else if (BUILT[arg]) BUILT[arg].forEach((c) => codes.add(c));
      else if (!VARIABLE_CODES.includes(arg)) unknown.push(`${rel}: ${arg}`);
    }
    for (const m of text.matchAll(/INSERT INTO audit_logs[\s\S]*?VALUES\s*\(([^)]*)\)/g)) for (const c of m[1].matchAll(CODE)) codes.add(c[1]);
    for (const m of text.matchAll(/\baction(?::| =) '([a-z_]+\.[a-z_]+)'/g)) codes.add(m[1]);
    for (const m of text.matchAll(/const ACTION = '([a-z_]+\.[a-z_]+)'/g)) codes.add(m[1]);
  }
  assert.deepEqual(unknown, [], 'an audit() call whose code this scan cannot read: add its values to BUILT');
  assert.ok(codes.has('member.invited') && codes.has('booking_group.created'), 'the scan found the codes it should');
  assert.deepEqual([...codes].filter((c) => !settings.ACTIONS[c]).sort(), [], 'audit codes with no label in ACTIONS');
});
