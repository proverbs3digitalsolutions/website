'use strict';

// QA round 8, lane C07 (maintenance). A repair request save that changes nothing writes no row (#57, K22). An
// edit names only the fields that really changed, and a status change names its from and to. The From cleaning
// task link and the recurring job buttons name their row (#45, D-81).
// TEST_DATABASE_URL=postgres://balayhub:balayhub@localhost:5432/balayhub_test_r2_06 node --test --test-concurrency=1 test/qa-r8-c07.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, ownerAccount, sql } = require('./helpers');

const VIEW_SRC = fs.readFileSync(path.join(__dirname, '../public/js/views/maintenance.js'), 'utf8');

let srv; let owner; let prop;

const makeRequest = async (title) => (await owner.post('/api/maintenance', {
  property_id: prop.property_id, title, priority: 'medium', estimated_cost: '500',
})).data.request;

// Every edit row written for one request, in order. The create row is left out.
const editRows = (id) => sql(`SELECT action, details FROM audit_logs
  WHERE record_type = 'maintenance' AND record_id = $1 AND action <> 'maintenance.created' ORDER BY audit_id`, [id]);

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'owner-c07@example.com', 'C07 Co');
  prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
});
test.after(async () => { await srv.close(); });

test('a save that changes nothing writes no row, and the stored values stay (#57, K22)', async () => {
  const m = await makeRequest('Leaking faucet');
  // The same title, priority and status, and the cost typed without cents.
  const r = await owner.patch(`/api/maintenance/${m.request_id}`, { title: 'Leaking faucet', priority: 'medium', status: 'open', estimated_cost: '500' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(await editRows(m.request_id), []);
  assert.equal(r.data.request.estimated_cost, '500.00');
});

test('an edit writes maintenance.updated naming only the field that changed, with no values (#57, K22)', async () => {
  const m = await makeRequest('Water heater');
  assert.equal((await owner.patch(`/api/maintenance/${m.request_id}`, { priority: 'high' })).status, 200);
  assert.deepEqual(await editRows(m.request_id), [{ action: 'maintenance.updated', details: { fields: ['priority'] } }]);
});

test('a status change writes maintenance.status_changed naming the status from and to (#57)', async () => {
  const m = await makeRequest('Gate motor');
  assert.equal((await owner.patch(`/api/maintenance/${m.request_id}`, { status: 'in_progress' })).status, 200);
  assert.deepEqual(await editRows(m.request_id), [
    { action: 'maintenance.status_changed', details: { fields: ['status'], from: 'open', to: 'in_progress' } },
  ]);
});

test('a status sent again is not a change: only the field that moved is named (#57)', async () => {
  const m = await makeRequest('Ceiling fan');
  assert.equal((await owner.patch(`/api/maintenance/${m.request_id}`, { status: 'in_progress' })).status, 200);
  // The status is sent again with the value it already has; only the title moved.
  assert.equal((await owner.patch(`/api/maintenance/${m.request_id}`, { status: 'in_progress', title: 'Ceiling fan and light' })).status, 200);
  assert.deepEqual(await editRows(m.request_id), [
    { action: 'maintenance.status_changed', details: { fields: ['status'], from: 'open', to: 'in_progress' } },
    { action: 'maintenance.updated', details: { fields: ['title'] } },
  ]);
});

test('the From cleaning task link names its unit, or its property when the request has no unit (#45, D-81)', () => {
  const badge = VIEW_SRC.slice(VIEW_SRC.indexOf('const taskBadge'), VIEW_SRC.indexOf('export async function newMaintenanceModal'));
  assert.match(badge, /'aria-label': `From cleaning task, \$\{m\.unit_name \? unitLabel\(m\.unit_name\) : m\.property_name\}`/);
});

test('the Assigned to filter keeps a name from a link, since its names load after the bar is built', () => {
  assert.match(VIEW_SRC, /name: 'assigned', label: 'Assigned to'.*keepUnknown: true/);
});

test('each recurring job names its Edit and Pause or Resume button (D-81)', () => {
  const list = VIEW_SRC.slice(VIEW_SRC.indexOf("schedules.length ? h('ul'"), VIEW_SRC.indexOf("h('p', { class: 'muted' }, 'No recurring jobs yet.')"));
  assert.match(list, /'aria-label': `Edit \$\{x\.title\}`/);
  assert.match(list, /'aria-label': `\$\{x\.active \? 'Pause' : 'Resume'\} \$\{x\.title\}`/);
});
