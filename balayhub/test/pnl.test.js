'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday, addMonths } = require('./helpers');
const ical = require('../src/lib/ical');
const config = require('../src/config');
const { outbox } = require('../src/lib/mailer');
const statements = require('../src/lib/statements');
const { unitPnl } = require('../src/lib/pnl');
const { sendStatementReminders } = require('../src/lib/ownerreminder');

// The report month is last month, so every check-out in it has already happened.
const M = addMonths(manilaToday(), -1).slice(0, 7);
const PREV = addMonths(manilaToday(), -2).slice(0, 7);
const NEXT = addMonths(manilaToday(), 0).slice(0, 7);
const FUTURE = ical.addDays(manilaToday(), 41).slice(0, 7);
const day = (n, ym = M) => `${ym}-${String(n).padStart(2, '0')}`;

let srv; let host; let hostOrg; let hostUser; let p1; let p2; let unitA; let unitB; let unitC;
let stay1; let stay2; let manager; let staff; let other;
const realDraft = statements.draftMonth;
const drafted = [];

const orgId = async (name) => (await sql('SELECT organization_id FROM organizations WHERE name = $1', [name]))[0].organization_id;

// Expense rows go straight to the table: the report only reads them.
async function expense(propertyId, unitId, amount, date, { voided = false } = {}) {
  await sql(`INSERT INTO expenses (organization_id, property_id, unit_id, category, description, amount, expense_date, recorded_by, voided_at, voided_by, void_reason)
             VALUES ($1, $2, $3, 'repairs', 'Test expense', $4, $5, $6, $7, $8, $9)`,
  [hostOrg, propertyId, unitId, amount, date, hostUser, voided ? new Date() : null, voided ? hostUser : null, voided ? 'Entered twice' : null]);
}

async function refund(bookingId, amount, date, { voided = false } = {}) {
  await sql(`INSERT INTO booking_refunds (organization_id, booking_id, amount, refund_date, method, reason, recorded_by, voided_at, voided_by, void_reason)
             VALUES ($1, $2, $3, $4, 'cash', 'Refund', $5, $6, $7, $8)`,
  [hostOrg, bookingId, amount, date, hostUser, voided ? new Date() : null, voided ? hostUser : null, voided ? 'Entered twice' : null]);
}

// Gives a unit an owner (the owners screens are another lane; the report only needs the link).
async function addOwner(workspace, unitId) {
  const [o] = await sql(`INSERT INTO unit_owners (organization_id, full_name) VALUES ((SELECT organization_id FROM organizations WHERE name = $1), 'Maria Santos') RETURNING owner_id`, [workspace]);
  await sql('UPDATE units SET owner_id = $1 WHERE unit_id = $2', [o.owner_id, unitId]);
}

// A workspace with one property, one unit and an owner, so the reminder has something to draft.
async function liveWorkspaceWithOwner(c, workspace) {
  const p = (await c.post('/api/properties', { property_name: `${workspace} house`, property_type: 'house', address: '1 Main St', city: 'Makati', province: 'Metro Manila' })).data.property;
  const u = (await c.post(`/api/properties/${p.property_id}/units`, { unit_name: 'A', unit_type: 'house', nightly_rate: '3000' })).data.unit;
  await addOwner(workspace, u.unit_id);
}

const statementMails = () => outbox.filter((m) => /^Owner statements for/.test(m.subject));

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Azure Stays');
  hostOrg = await orgId('Azure Stays');
  hostUser = (await sql(`SELECT user_id FROM users WHERE email = 'host@example.com'`))[0].user_id;

  p1 = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  p2 = (await host.post('/api/properties', { property_name: 'Bluewater', property_type: 'condominium', address: 'Ocean Dr', city: 'Pasay', province: 'Metro Manila' })).data.property;
  unitA = (await host.post(`/api/properties/${p1.property_id}/units`, { unit_name: '1201', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  unitB = (await host.post(`/api/properties/${p1.property_id}/units`, { unit_name: '805', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  unitC = (await host.post(`/api/properties/${p2.property_id}/units`, { unit_name: '301', unit_type: 'studio', nightly_rate: '1800', cleaning_fee: '500' })).data.unit;

  // Two stays that checked out in the month: 2 nights (4500 with cleaning) and 1 night (2500).
  stay1 = (await host.post('/api/reservations', { unit_id: unitA.unit_id, check_in: day(9), check_out: day(11), guest_name: 'Ana Cruz', channel: 'airbnb', channel_fee: '600' })).data.reservation;
  stay2 = (await host.post('/api/reservations', { unit_id: unitA.unit_id, check_in: day(19), check_out: day(20), guest_name: 'Ben Reyes' })).data.reservation;
  // Not counted: a cancelled stay, a block the owner made, and a stay that hasn't checked out yet.
  const cancelled = (await host.post('/api/reservations', { unit_id: unitA.unit_id, check_in: day(27), check_out: day(28), guest_name: 'Cid Lim' })).data.reservation;
  await sql(`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE booking_id = $1`, [cancelled.booking_id]);
  await sql(`INSERT INTO bookings (organization_id, unit_id, kind, check_in, check_out, confirmation_code, block_reason, created_by)
             VALUES ($1, $2, 'block', $3, $4, 'BLK-1', 'Owner stay', $5)`, [hostOrg, unitA.unit_id, day(25), day(26), hostUser]);
  await host.post('/api/reservations', { unit_id: unitB.unit_id, check_in: ical.addDays(manilaToday(), 40), check_out: ical.addDays(manilaToday(), 41), guest_name: 'Dee Tan' });

  // Payments: stay 1 paid in full; stay 2 overpaid by 200.
  await sql(`INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, recorded_by) VALUES ($1, $2, '4500.00', $3, 'cash', $4)`, [hostOrg, stay1.booking_id, day(11), hostUser]);
  await sql(`INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, recorded_by) VALUES ($1, $2, '2700.00', $3, 'cash', $4)`, [hostOrg, stay2.booking_id, day(20), hostUser]);
  // Refunds count only the part beyond the overpayment, where overpayment = paid - (total - channel fee) (D-37, D-44).
  // Stay 1: paid 4,500, total 4,500, channel fee 600, so the overpayment is 4,500 - 3,900 = 600. Its 200 refund in
  // the month only returns that overpayment, so none of it counts.
  // Stay 2: paid 2,700, total 2,500, no channel fee, so the overpayment is 2,700 - 2,500 = 200. 150 went back before
  // the month and uses up part of it, leaving 50. The month's refunds (200 + 100 = 300) count 250; the other 50 is covered.
  // A voided refund is ignored.
  await refund(stay2.booking_id, '150.00', day(25, PREV));
  await refund(stay1.booking_id, '200.00', day(15));
  await refund(stay2.booking_id, '200.00', day(10));
  await refund(stay2.booking_id, '100.00', day(12));
  await refund(stay2.booking_id, '500.00', day(13), { voided: true });

  // Expenses: the unit's 800 counts; a voided one, next month's and a voided unlinked one don't.
  await expense(p1.property_id, unitA.unit_id, '800.00', day(20));
  await expense(p1.property_id, unitA.unit_id, '300.00', day(21), { voided: true });
  await expense(p1.property_id, unitA.unit_id, '900.00', day(3, NEXT));
  await expense(p1.property_id, null, '150.00', day(5));
  await expense(p1.property_id, null, '40.00', day(6), { voided: true });
  await expense(p2.property_id, unitC.unit_id, '500.00', day(8));
  await expense(p2.property_id, null, '75.00', day(6));

  const invM = await host.post('/api/team/invitations', { email: 'manager@example.com', role: 'manager', property_ids: [p1.property_id] });
  manager = client(srv.base);
  await manager.post('/api/auth/signup', { full_name: 'Mila Manager', email: 'manager@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(invM.data.inviteLink.split('invite=')[1]) });
  const invS = await host.post('/api/team/invitations', { email: 'staff@example.com', role: 'staff', property_ids: [p1.property_id] });
  staff = client(srv.base);
  await staff.post('/api/auth/signup', { full_name: 'Nene Staff', email: 'staff@example.com', password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(invS.data.inviteLink.split('invite=')[1]) });

  other = await ownerAccount(srv.base, 'other@example.com', 'Other Stays');

  // Reminder fixtures: a live workspace with an owner, a lapsed trial, a demo, and one with no owners.
  await addOwner('Azure Stays', unitA.unit_id);
  const lapsed = await ownerAccount(srv.base, 'lapsed@example.com', 'Lapsed Stays');
  await liveWorkspaceWithOwner(lapsed, 'Lapsed Stays');
  await sql(`UPDATE organizations SET trial_ends_at = now() - interval '1 day' WHERE name = 'Lapsed Stays'`);
  const demo = await ownerAccount(srv.base, 'demo@example.com', 'Sample Stays');
  await liveWorkspaceWithOwner(demo, 'Sample Stays');
  await sql(`UPDATE organizations SET is_demo = true WHERE name = 'Sample Stays'`);
  await ownerAccount(srv.base, 'plain@example.com', 'Plain Stays');

  // The reminder drafts through statements.draftMonth. Use the real one when it exists, otherwise record the call.
  statements.draftMonth = async (org, month) => {
    drafted.push([org, month]);
    if (realDraft) return realDraft(org, month);
  };
});

test.after(async () => {
  if (realDraft) statements.draftMonth = realDraft; else delete statements.draftMonth;
  await srv.close();
});

test('owner report: every unit, the refunds rule, unlinked expenses; cancelled, blocked and unfinished stays left out', async () => {
  const r = await host.get(`/api/reports/pnl?month=${M}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.month, M);
  const row = (id) => r.data.rows.find((x) => x.unit_id === id);
  // Unit 1201: net = 7,000 gross - 600 channel fees - 250 refunds - 800 expenses = 5,350. Refunds are 250 (stay 2 only, see above).
  assert.deepEqual(row(unitA.unit_id), {
    unit_id: unitA.unit_id, unit_name: '1201', property_name: 'Azure', stays: 2, nights: 3,
    gross: '7000.00', channel_fees: '600.00', refunds: '250.00', expenses: '800.00', net: '5350.00',
  });
  assert.deepEqual(row(unitB.unit_id), {
    unit_id: unitB.unit_id, unit_name: '805', property_name: 'Azure', stays: 0, nights: 0,
    gross: '0.00', channel_fees: '0.00', refunds: '0.00', expenses: '0.00', net: '0.00',
  });
  assert.deepEqual(row(unitC.unit_id), {
    unit_id: unitC.unit_id, unit_name: '301', property_name: 'Bluewater', stays: 0, nights: 0,
    gross: '0.00', channel_fees: '0.00', refunds: '0.00', expenses: '500.00', net: '-500.00',
  });
  assert.deepEqual(r.data.rows[3], {
    unit_id: null, unit_name: 'Not linked to a unit', property_name: null, stays: 0, nights: 0,
    gross: '0.00', channel_fees: '0.00', refunds: '0.00', expenses: '225.00', net: '-225.00',
  });
  // Totals: expenses 800 + 500 + 225 = 1,525; net = 7,000 - 600 - 250 - 1,525 = 4,625 (unit 301's -500 and the unlinked -225 included).
  assert.deepEqual(r.data.totals, {
    stays: 2, nights: 3, gross: '7000.00', channel_fees: '600.00', refunds: '250.00', expenses: '1525.00', net: '4625.00',
  });
});

test('property filter keeps that property\'s unlinked expenses', async () => {
  const r = await host.get(`/api/reports/pnl?month=${M}&property_id=${p2.property_id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.rows.map((x) => x.unit_name), ['301', 'Not linked to a unit']);
  assert.deepEqual(r.data.totals, {
    stays: 0, nights: 0, gross: '0.00', channel_fees: '0.00', refunds: '0.00', expenses: '575.00', net: '-575.00',
  });
});

test('a manager sees only assigned properties; other workspaces get 404', async () => {
  const r = await manager.get(`/api/reports/pnl?month=${M}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.rows.map((x) => x.unit_name), ['1201', '805', 'Not linked to a unit']);
  assert.equal(r.data.rows[2].expenses, '150.00', 'the unlinked row covers only the assigned property');
  // Manager totals: net = 7,000 - 600 - 250 - 950 (800 for 1201 plus the unlinked 150 at Azure) = 5,200.
  assert.deepEqual(r.data.totals, {
    stays: 2, nights: 3, gross: '7000.00', channel_fees: '600.00', refunds: '250.00', expenses: '950.00', net: '5200.00',
  });
  assert.equal((await manager.get(`/api/reports/pnl?month=${M}&property_id=${p2.property_id}`)).status, 404);
  assert.equal((await other.get(`/api/reports/pnl?month=${M}&property_id=${p1.property_id}`)).status, 404);
});

test('staff are refused, signed-out callers get 401, bad input gets 400', async () => {
  assert.equal((await staff.get(`/api/reports/pnl?month=${M}`)).status, 403);
  assert.equal((await staff.get(`/api/reports/pnl.csv?month=${M}`)).status, 403);
  assert.equal((await client(srv.base).get(`/api/reports/pnl?month=${M}`)).status, 401);
  assert.equal((await host.get('/api/reports/pnl')).status, 400);
  assert.equal((await host.get('/api/reports/pnl?month=2026-13')).status, 400);
  assert.equal((await host.get(`/api/reports/pnl?month=${M}&property_id=not-a-uuid`)).status, 400);
});

test('CSV download has the same rows and totals as the screen', async () => {
  const csv = await host.raw('GET', `/api/reports/pnl.csv?month=${M}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.match(csv.headers.get('content-disposition'), new RegExp(`balayhub-pnl-${M}\\.csv`));
  assert.ok(csv.data.startsWith('BalayHub profit and loss\r\n'));
  assert.ok(csv.data.includes('Azure,1201,2,3,7000.00,600.00,250.00,800.00,5350.00'));
  assert.ok(csv.data.includes(',Not linked to a unit,0,0,0.00,0.00,0.00,225.00,-225.00'));
  assert.ok(csv.data.includes('Total,,2,3,7000.00,600.00,250.00,1525.00,4625.00'));
});

test('the owner-portal call (unitIds) leaves out other units and the unlinked row', async () => {
  const scoped = await unitPnl(hostOrg, M, { unitIds: [unitA.unit_id, unitB.unit_id] });
  assert.deepEqual(scoped.rows.map((x) => x.unit_name), ['1201', '805']);
  assert.deepEqual(scoped.totals, {
    stays: 2, nights: 3, gross: '7000.00', channel_fees: '600.00', refunds: '250.00', expenses: '800.00', net: '5350.00',
  });
});

test('a stay that has not checked out yet is not in its month', async () => {
  const later = await unitPnl(hostOrg, FUTURE);
  assert.equal(later.rows.find((x) => x.unit_id === unitB.unit_id).stays, 0);
  assert.equal(later.totals.stays, 0);
});

test('reminder: waits until the 3rd (Manila), then emails the live workspace that has owners', async () => {
  assert.deepEqual(await sendStatementReminders(new Date('2026-11-02T12:00:00+08:00')), { sent: 0 });
  assert.equal(statementMails().length, 0);
  assert.deepEqual(await sendStatementReminders(new Date('2026-11-03T09:00:00+08:00')), { sent: 1 });
  const mails = statementMails();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, 'Owner statements for October 2026 are ready to review (1)');
  assert.equal(mails[0].to, 'host@example.com');
  assert.ok(mails[0].text.includes(`${config.appUrl}/#/owners/statements?month=2026-10`));
  assert.deepEqual(drafted, [[hostOrg, '2026-10']], 'only the live workspace with owners is drafted');
});

test('reminder: leaves the statements as drafts, nothing published or sent', { skip: realDraft ? false : 'statements.draftMonth is not exported yet (owner statements lane)' }, async () => {
  const rows = await sql(`SELECT status, snapshot, sent_at FROM owner_statements WHERE organization_id = $1 AND month = '2026-10'`, [hostOrg]);
  assert.deepEqual(rows, [{ status: 'draft', snapshot: null, sent_at: null }]);
});

test('reminder: once per workspace per month', async () => {
  assert.deepEqual(await sendStatementReminders(new Date('2026-11-03T18:00:00+08:00')), { sent: 0 });
  assert.equal(statementMails().length, 1);
  const audits = await sql(`SELECT details FROM audit_logs WHERE organization_id = $1 AND action = 'owner_statements.reminder_sent'`, [hostOrg]);
  assert.deepEqual(audits.map((a) => a.details), [{ month: '2026-10' }]);
  assert.deepEqual(await sendStatementReminders(new Date('2026-12-03T09:00:00+08:00')), { sent: 1 });
  assert.equal(statementMails().length, 2);
  assert.ok(statementMails()[1].subject.startsWith('Owner statements for November 2026'));
});
