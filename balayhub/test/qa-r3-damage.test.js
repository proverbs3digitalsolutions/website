'use strict';

// QA round 3, lane C15 (rbac#29): the create response for a damage report
// gives staff and cleaners only the job-detail shape, never the amount,
// status, charge or resolution. Owners and managers keep the full row.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { hashPassword } = require('../src/lib/auth');

const d = (n) => ical.addDays(manilaToday(), n);
const CLEANER_PASSWORD = 'cleaner-pass-1';
const MANAGEMENT_ONLY = ['estimated_cost', 'status', 'charge_id', 'resolution_note', 'resolved_at', 'resolved_by_name'];

let srv; let owner; let manager; let staff; let cleaner; let orgId; let unit; let stay; let task;

async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

async function addCleaner(email, name, propertyId) {
  const [{ user_id: userId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, $2, $3, $4, 'cleaner', now()) RETURNING user_id`,
    [orgId, email, await hashPassword(CLEANER_PASSWORD), name]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [userId, propertyId]);
  const c = client(srv.base);
  const r = await c.post('/api/auth/login', { email, password: CLEANER_PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return c;
}

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'QA Damage Shape');
  [{ organization_id: orgId }] = await sql('SELECT organization_id FROM users WHERE email = $1', ['host@example.com']);
  const prop = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unit = (await owner.post(`/api/properties/${prop.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500', security_deposit_amount: '1000' })).data.unit;
  stay = (await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: d(-3), check_out: d(-1), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  staff = await invite('staff@example.com', 'staff', [prop.property_id]);
  manager = await invite('manager@example.com', 'manager', [prop.property_id]);
  cleaner = await addCleaner('xavier@example.com', 'Xavier Cleaner', prop.property_id);
  [task] = await sql(
    `INSERT INTO cleaning_tasks (organization_id, unit_id, booking_id, due_date, assigned_to)
     VALUES ($1, $2, $3, $4, (SELECT user_id FROM users WHERE email = 'xavier@example.com')) RETURNING task_id`,
    [orgId, unit.unit_id, stay.booking_id, d(-1)]);
});

test.after(async () => { await srv.close(); });

test('staff and cleaners get back only the job-detail shape from a create, with no amounts or resolution', async () => {
  const staffJob = await staff.post(`/api/cleaning-tasks/${task.task_id}/damage`, { description: 'Staff cracked tile', estimated_cost: '55' });
  assert.equal(staffJob.status, 201, JSON.stringify(staffJob.data));
  const cleanerJob = await cleaner.post(`/api/cleaning-tasks/${task.task_id}/damage`, { description: 'Cleaner chipped mug', estimated_cost: '1234' });
  assert.equal(cleanerJob.status, 201, JSON.stringify(cleanerJob.data));
  const staffStay = await staff.post(`/api/reservations/${stay.booking_id}/damage`, { description: 'Staff scuffed door', estimated_cost: '70' });
  assert.equal(staffStay.status, 201, JSON.stringify(staffStay.data));
  const staffUnit = await staff.post(`/api/units/${unit.unit_id}/damage`, { description: 'Staff stain', estimated_cost: '20' });
  assert.equal(staffUnit.status, 403, 'staff cannot report on a whole unit');

  for (const res of [staffJob, cleanerJob, staffStay]) {
    for (const key of MANAGEMENT_ONLY) {
      assert.equal(key in res.data.report, false, `${key} must not come back to the filer (${res.data.report.description})`);
    }
    assert.equal(typeof res.data.report.report_id, 'string');
    assert.equal(typeof res.data.report.created_at, 'string');
  }
  assert.equal(staffJob.data.report.reported_by_name, 'staff@example.com');
  assert.equal(cleanerJob.data.report.reported_by_name, 'Xavier Cleaner');
});

test('a filer\'s create response has the same shape as their own report on the job detail', async () => {
  for (const [who, c] of [['staff', staff], ['cleaner', cleaner]]) {
    const created = await c.post(`/api/cleaning-tasks/${task.task_id}/damage`, { description: `${who} shape check`, estimated_cost: '10' });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const job = await c.get(`/api/cleaning-tasks/${task.task_id}`);
    assert.equal(job.status, 200, JSON.stringify(job.data));
    const mine = job.data.task.damage_reports.find((r) => r.report_id === created.data.report.report_id);
    assert.ok(mine, `${who} sees their own report on the job`);
    assert.deepEqual(Object.keys(created.data.report).sort(), Object.keys(mine).sort(), `${who}: create response matches the job detail`);
  }
});

test('owners and managers still get the full report back from a create', async () => {
  const m = await manager.post(`/api/cleaning-tasks/${task.task_id}/damage`, { description: 'Manager dented rail', estimated_cost: '300' });
  assert.equal(m.status, 201, JSON.stringify(m.data));
  for (const key of MANAGEMENT_ONLY) assert.ok(key in m.data.report, `${key} is in the manager's response`);
  assert.equal(m.data.report.estimated_cost, '300.00');
  assert.equal(m.data.report.status, 'open');

  const o = await owner.post(`/api/cleaning-tasks/${task.task_id}/damage`, { description: 'Owner marked the door', estimated_cost: '45' });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.equal(o.data.report.estimated_cost, '45.00');
  assert.equal(o.data.report.charge_id, null);
});
