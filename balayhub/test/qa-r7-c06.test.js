'use strict';

// QA round 7, lane C06 (maintenance). Resuming a recurring job writes its own activity row, an edit names only
// the fields that really changed, and a save that changes nothing writes no row (#31). The next-due window is
// checked at the field before the past-date question (#30). The Unit list follows the Property (#26). A filter
// value from a link that is not one of the choices is dropped (#32).
// node --test --test-concurrency=1 test/qa-r7-c06.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer, ownerAccount, sql } = require('./helpers');

const VIEW_SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/maintenance.js'), 'utf8');

let srv; let owner; let prop; let today;

const makeSchedule = async (title, priority = 'medium') => (await owner.post('/api/maintenance-schedules', {
  property_id: prop.property_id, title, every_n: 3, every_unit: 'months', next_due: today, priority,
})).data.schedule;

const scheduleRows = (id) => sql(`SELECT action, details FROM audit_logs
  WHERE record_type = 'maintenance_schedule' AND record_id = $1 AND action <> 'maintenance.schedule_created'
  ORDER BY audit_id`, [id]);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-c06@example.com', 'C06 Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Manila')::date::text AS d`))[0].d;
});
test.after(async () => { await srv.close(); });

test('resuming a paused job writes one resumed row with its title, and no edit row (#31)', async () => {
  const s = await makeSchedule('Aircon cleaning');
  assert.equal((await owner.post(`/api/maintenance-schedules/${s.schedule_id}/pause`)).status, 200);
  const r = await owner.patch(`/api/maintenance-schedules/${s.schedule_id}`, { active: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = await scheduleRows(s.schedule_id);
  assert.deepEqual(rows.map((x) => x.action), ['maintenance.schedule_paused', 'maintenance.schedule_resumed']);
  assert.deepEqual(rows[1].details, { title: 'Aircon cleaning' });
});

test('an edit names only the fields that changed, and a save that changes nothing writes no row (#31)', async () => {
  const s = await makeSchedule('Water tank check');
  assert.equal((await owner.patch(`/api/maintenance-schedules/${s.schedule_id}`, { priority: 'high' })).status, 200);
  let rows = await scheduleRows(s.schedule_id);
  assert.deepEqual(rows.map((x) => x.action), ['maintenance.schedule_updated']);
  assert.deepEqual(rows[0].details, { fields: ['priority'] });
  // The same values again: one field, a resume of a job that is already running, and a full form save.
  const same = [
    { priority: 'high' },
    { active: true },
    { title: 'Water tank check', description: '', every_n: 3, every_unit: 'months', next_due: today, priority: 'high', active: true },
  ];
  for (const body of same) {
    const r = await owner.patch(`/api/maintenance-schedules/${s.schedule_id}`, body);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  rows = await scheduleRows(s.schedule_id);
  assert.equal(rows.length, 1, 'no-change saves add no row');
});

// The view imports app.js for the signed-in user, so it is loaded from a temp copy with a stub app.js.
async function loadView() {
  globalThis.Element ??= class { }; // ui.js names the DOM Element class at load time; a stub is enough here
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-r7-c06-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(dir, 'views'));
  for (const f of ['api.js', 'ui.js', 'i18n.js', 'filters.js']) fs.copyFileSync(path.join(__dirname, '../public/js', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const state = { user: null, requireEmailVerification: true };\nexport const navigate = () => {};\n');
  fs.copyFileSync(path.join(__dirname, '../public/js/views/maintenance.js'), path.join(dir, 'views', 'maintenance.js'));
  fs.writeFileSync(path.join(dir, 'views', 'rent.js'), 'export const expenseNeedsAsk = () => false;\n'); // maintenance.js imports expenseNeedsAsk from rent.js
  return { dir, mod: await import(pathToFileURL(path.join(dir, 'views', 'maintenance.js'))) };
}

test('the next-due window matches the server: a year back, five years ahead, day kept to the month (#30)', async () => {
  const { dir, mod } = await loadView();
  try {
    assert.deepEqual(mod.nextDueWindow('2026-10-14'), { earliest: '2025-10-14', latest: '2031-10-14' });
    // Postgres clamps 29 February to the last day of the month in a year that has none.
    assert.deepEqual(mod.nextDueWindow('2028-02-29'), { earliest: '2027-02-28', latest: '2033-02-28' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a next-due date is checked against the window at the field, before the past-date question (#30)', () => {
  const window = VIEW_SRC.indexOf('nextDueWindow()');
  const message = VIEW_SRC.indexOf('Pick a date between ${fmtDate(earliest)} and ${fmtDate(latest)}.');
  const ask = VIEW_SRC.indexOf("title: 'Next due date is in the past'");
  assert.ok(window > 0 && message > window && ask > message, 'the window is read, then the field message, then the question');
  assert.match(VIEW_SRC, /showErrors\(ctx\.form, \{ next_due:/, 'the message shows at the next-due field');
});

test('the recurring job Unit list follows the Property choice (#26)', () => {
  const form = VIEW_SRC.slice(VIEW_SRC.indexOf('const form = (x) =>'), VIEW_SRC.indexOf('const pause = async'));
  assert.match(form, /units\.filter\(\(u\) => u\.property_id === pid\)/, 'the unit options are the chosen property\'s units');
  assert.match(form, /propField\.querySelector\('select'\)\.addEventListener\('change', \(e\) => fillUnits\(e\.target\.value\)\)/, 'a property change rebuilds them');
  assert.match(form, /fillUnits\(propField\.querySelector\('select'\)\.value\)/, 'and they start from the chosen property');
});

test('a priority, sort, cost or assigned value from the link that is not a choice is dropped before the list shows (#32)', () => {
  const init = VIEW_SRC.indexOf("const filters = initFilters('maintenance', query, defaults);");
  const drop = VIEW_SRC.indexOf('Object.entries(FILTER_CHOICES)');
  assert.ok(init > 0 && drop > init, 'the check runs straight after the link is read');
  assert.match(VIEW_SRC, /priority: \['high_up', \.\.\.PRIORITIES\]/);
  assert.match(VIEW_SRC, /sort: \['newest', 'oldest', 'priority', 'cost', 'property'\]/);
  assert.match(VIEW_SRC, /cost: \['recorded', 'none', 'estimate_only'\]/);
  assert.match(VIEW_SRC, /res\.assignees\.includes\(filters\.assigned\)/, 'an assigned name nobody holds is dropped once the names load');
});
