'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';
process.env.DATA_ENCRYPTION_KEY = 'test-encryption-key';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const ical = require('../src/lib/ical');
const { hashPassword } = require('../src/lib/auth');

// Fake PayMongo, just enough for a pay link to open and then be closed (as in charges.test.js).
const realFetch = globalThis.fetch;
const sessions = new Map();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.paymongo.com/')) return realFetch(url, opts);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (opts.method === 'POST' && u.endsWith('/checkout_sessions')) {
    const a = JSON.parse(opts.body).data.attributes;
    const id = `cs_${crypto.randomBytes(6).toString('hex')}`;
    sessions.set(id, { id, attributes: { ...a, checkout_url: `https://checkout.paymongo.com/${id}`, status: 'active', payments: [] } });
    return json({ data: sessions.get(id) });
  }
  const ex = /checkout_sessions\/(cs_\w+)\/expire$/.exec(u);
  if (ex && sessions.has(ex[1])) { sessions.get(ex[1]).attributes.status = 'expired'; return json({ data: sessions.get(ex[1]) }); }
  const m = /checkout_sessions\/(cs_\w+)$/.exec(u);
  if (m && sessions.has(m[1])) return json({ data: sessions.get(m[1]) });
  return json({ errors: [{ detail: 'not found' }] }, 404);
};

const d = (n) => ical.addDays(manilaToday(), n);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a3a30000000049454e44ae426082', 'hex');
const CLEANER_PASSWORD = 'cleaner-pass-1';
const NO_ID = '00000000-0000-4000-8000-000000000000';

let srv; let owner; let orgId; let propA; let propB; let unitA; let unitB;
let stay; let stayFuture; let stayC; let stayD; let stayE; let staff; let manager; let cleanerX; let cleanerY;
let tMine; let tOther; let tFree; let tOutside; let tNoStay; let tPlaceB;
const rep = {};

async function invite(email, role, propertyIds) {
  const inv = await owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', { full_name: email, email, password: 'longenough1', confirm_password: 'longenough1', accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]) });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

// Cleaners are created straight in the database (role 'cleaner', assigned to one property), then sign in.
async function addCleaner(email, name, propertyId) {
  const [{ user_id: userId }] = await sql(
    `INSERT INTO users (organization_id, email, password_hash, full_name, role, email_verified_at)
     VALUES ($1, $2, $3, $4, 'cleaner', now()) RETURNING user_id`,
    [orgId, email, await hashPassword(CLEANER_PASSWORD), name]);
  await sql('INSERT INTO property_assignments (user_id, property_id) VALUES ($1, $2)', [userId, propertyId]);
  const c = client(srv.base);
  const r = await c.post('/api/auth/login', { email, password: CLEANER_PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { c, userId, name };
}

async function makeTask(unit, { booking = null, assigned = null, name = null } = {}) {
  const [{ task_id: taskId }] = await sql(
    `INSERT INTO cleaning_tasks (organization_id, unit_id, booking_id, due_date, assigned_to, assignee_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING task_id`,
    [orgId, unit.unit_id, booking, d(0), assigned, name]);
  return { task_id: taskId, booking_id: booking };
}

const upload = (c, recordType, recordId, body = PNG, mime = 'image/png') =>
  c.raw('POST', `/api/files?record_type=${recordType}&record_id=${recordId}`, body, { 'Content-Type': mime });

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'host@example.com', 'Damage Stays');
  orgId = (await sql('SELECT organization_id FROM users WHERE email = $1', ['host@example.com']))[0].organization_id;
  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Mabini', property_type: 'apartment', address: '12 Mabini St', city: 'Bacoor', province: 'Cavite' })).data.property;
  const unitTerms = { unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500', security_deposit_amount: '1000' };
  unitA = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1201', ...unitTerms })).data.unit;
  unitB = (await owner.post(`/api/properties/${propB.property_id}/units`, { unit_name: '2F-3', ...unitTerms })).data.unit;
  // Two nights, 4500 owed with the cleaning fee.
  stay = (await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: d(-3), check_out: d(-1), guest_name: 'Ana Cruz', guest_email: 'ana@example.com' })).data.reservation;
  stayFuture = (await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: d(5), check_out: d(7), guest_name: 'Ben Lim', guest_email: 'ben@example.com' })).data.reservation;

  staff = await invite('staff@example.com', 'staff', [propA.property_id]);
  manager = await invite('manager@example.com', 'manager', [propA.property_id]);
  cleanerX = await addCleaner('xavier@example.com', 'Xavier Cleaner', propA.property_id);
  cleanerY = await addCleaner('yolanda@example.com', 'Yolanda Cleaner', propA.property_id);

  // A cleaning task is unique per stay, so each task gets its own (past, non-overlapping) stay.
  const pastStay = async (from, to, guest) => (await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: d(from), check_out: d(to), guest_name: guest, guest_email: `${guest.split(' ')[0].toLowerCase()}@example.com` })).data.reservation;
  stayC = await pastStay(-7, -5, 'Cora Diaz');
  stayD = await pastStay(-11, -9, 'Dan Ong');
  stayE = await pastStay(-15, -13, 'Eli Ramos');

  tMine = await makeTask(unitA, { booking: stay.booking_id, assigned: cleanerX.userId });
  tOther = await makeTask(unitA, { booking: stayC.booking_id, assigned: cleanerY.userId });
  tFree = await makeTask(unitA, { booking: stayD.booking_id });
  tOutside = await makeTask(unitA, { booking: stayE.booking_id, name: 'Aling Rosa' });
  tNoStay = await makeTask(unitA, { assigned: cleanerX.userId });
  tPlaceB = await makeTask(unitB);
});

test.after(async () => { globalThis.fetch = realFetch; await srv.close(); });

test('a cleaner logs damage on a task they can see, and nowhere else', async () => {
  assert.equal((await client(srv.base).post(`/api/cleaning-tasks/${tMine.task_id}/damage`, { description: 'Cracked tile' })).status, 401);

  const a = await cleanerX.c.post(`/api/cleaning-tasks/${tMine.task_id}/damage`, { description: 'Cracked tile by the sink', estimated_cost: '250' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  rep.A = a.data.report;
  assert.equal(rep.A.status, 'open');
  assert.equal(rep.A.estimated_cost, '250.00');
  assert.equal(rep.A.booking_id, stay.booking_id, 'the report is for the task\'s stay');
  assert.equal(rep.A.task_id, tMine.task_id);
  assert.equal(rep.A.unit_name, '1201');
  assert.equal(rep.A.property_name, 'Azure');
  assert.equal(rep.A.reported_by_name, 'Xavier Cleaner');
  assert.equal(rep.A.photo_count, 0);
  assert.equal(rep.A.charge_id, null);
  assert.equal(typeof rep.A.created_at, 'string', 'dates come back as ISO text');

  const b = await cleanerX.c.post(`/api/cleaning-tasks/${tFree.task_id}/damage`, { description: 'Scuffed wall', estimated_cost: '100' });
  assert.equal(b.status, 201, 'an unassigned task is visible to a cleaner');
  rep.B = b.data.report;
  assert.equal(rep.B.estimated_cost, '100.00');
  assert.equal(rep.B.booking_id, stayD.booking_id);

  const c = await cleanerX.c.post(`/api/cleaning-tasks/${tNoStay.task_id}/damage`, { description: 'Broken towel rail' });
  assert.equal(c.status, 201);
  rep.C = c.data.report;
  assert.equal(rep.C.booking_id, null, 'a task with no stay gives a report with no stay');
  assert.equal(rep.C.estimated_cost, null);

  for (const t of [tOther, tOutside, tPlaceB]) {
    assert.equal((await cleanerX.c.post(`/api/cleaning-tasks/${t.task_id}/damage`, { description: 'x' })).status, 404, 'not theirs, or not their property');
  }
  assert.equal((await cleanerX.c.post(`/api/reservations/${stay.booking_id}/damage`, { description: 'x' })).status, 403, 'cleaners use the task route only');
  assert.equal((await cleanerX.c.post(`/api/units/${unitA.unit_id}/damage`, { description: 'x' })).status, 403);

  const blank = await cleanerX.c.post(`/api/cleaning-tasks/${tMine.task_id}/damage`, { description: '   ' });
  assert.equal(blank.status, 400);
  assert.ok(blank.data.fields.description);
  const negative = await cleanerX.c.post(`/api/cleaning-tasks/${tMine.task_id}/damage`, { description: 'Chair', estimated_cost: '-5' });
  assert.equal(negative.status, 400);
  assert.ok(negative.data.fields.estimated_cost);
});

test('staff and managers log damage on a stay or a unit; out-of-scope units are refused', async () => {
  const d1 = await staff.post(`/api/reservations/${stay.booking_id}/damage`, { description: 'Smashed mirror' });
  assert.equal(d1.status, 201, JSON.stringify(d1.data));
  rep.D = d1.data.report;
  assert.equal(rep.D.estimated_cost, null, 'the estimate is optional');
  assert.equal(rep.D.reported_by_name, 'staff@example.com');

  const e = await staff.post(`/api/units/${unitA.unit_id}/damage`, { description: 'Ceiling stain', estimated_cost: '1200.5' });
  assert.equal(e.status, 201, JSON.stringify(e.data));
  rep.E = e.data.report;
  assert.equal(rep.E.estimated_cost, '1200.50');
  assert.equal(rep.E.booking_id, null);

  rep.F = (await staff.post(`/api/reservations/${stay.booking_id}/damage`, { description: 'Broken lamp', estimated_cost: '80' })).data.report;
  rep.G = (await staff.post(`/api/reservations/${stay.booking_id}/damage`, { description: 'Old stain', estimated_cost: '999' })).data.report;
  assert.equal(rep.G.status, 'open');

  assert.equal((await staff.post(`/api/units/${unitB.unit_id}/damage`, { description: 'x' })).status, 404, 'a unit in another property');
  assert.equal((await staff.post(`/api/reservations/${stay.booking_id}/damage`, {})).status, 400);
});

test('the damage lists: owners and managers only, filtered and scoped to the workspace', async () => {
  const all = await owner.get('/api/damage-reports');
  assert.equal(all.status, 200);
  assert.equal(all.data.reports.length, 7, 'reports A to G');
  const row = all.data.reports.find((r) => r.report_id === rep.A.report_id);
  assert.equal(row.unit_name, '1201');
  assert.equal(row.property_name, 'Azure');
  assert.equal(row.reported_by_name, 'Xavier Cleaner');

  assert.equal((await owner.get('/api/damage-reports?status=open')).data.reports.length, 7, 'all seven are still open here');
  assert.equal((await owner.get('/api/damage-reports?status=charged')).data.reports.length, 0);
  assert.equal((await owner.get('/api/damage-reports?status=bogus')).data.reports.length, 7, 'an unknown status is ignored');
  assert.equal((await owner.get(`/api/damage-reports?unit_id=${unitB.unit_id}`)).data.reports.length, 0);
  assert.equal((await manager.get('/api/damage-reports')).data.reports.length, 7);

  const onStay = await owner.get(`/api/reservations/${stay.booking_id}/damage`);
  assert.deepEqual(onStay.data.reports.map((r) => r.report_id).sort(), [rep.A, rep.D, rep.F, rep.G].map((r) => r.report_id).sort(), 'B is on another stay');

  assert.equal((await staff.get('/api/damage-reports')).status, 403);
  assert.equal((await staff.get(`/api/reservations/${stay.booking_id}/damage`)).status, 403);
  assert.equal((await cleanerX.c.get('/api/damage-reports')).status, 403);
  assert.equal((await cleanerX.c.get(`/api/reservations/${stay.booking_id}/damage`)).status, 403);

  const other = await ownerAccount(srv.base, 'other-owner@example.com', 'Other Lets');
  assert.equal((await other.get('/api/damage-reports')).data.reports.length, 0, 'another workspace sees nothing');
  assert.equal((await other.post(`/api/damage-reports/${rep.A.report_id}/waive`, {})).status, 404);
});

test('charging the guest adds a damage line to the bill and marks the report charged', async () => {
  const before = (await owner.get(`/api/reservations/${stay.booking_id}`)).data.reservation;
  assert.equal(before.total_amount, '4500.00');
  assert.equal(before.extras_total, '0.00');

  assert.equal((await staff.post(`/api/damage-reports/${rep.D.report_id}/charge`, { amount: '50', description: 'x' })).status, 403);

  const charged = await owner.post(`/api/damage-reports/${rep.A.report_id}/charge`, { amount: '300', description: 'Damage: Cracked tile by the sink' });
  assert.equal(charged.status, 200, JSON.stringify(charged.data));
  assert.equal(charged.data.report.status, 'charged');
  assert.ok(charged.data.report.charge_id);
  assert.equal(charged.data.report.resolved_by_name, 'Maria Santos');
  assert.equal(charged.data.charge.category, 'damage');
  assert.equal(charged.data.charge.amount, '300.00');
  assert.equal(charged.data.charge.quantity, 1);

  const after = (await owner.get(`/api/reservations/${stay.booking_id}`)).data.reservation;
  assert.equal(after.extras_total, '300.00');
  assert.equal(after.total_amount, '4800.00');
  assert.equal(after.balance, '4800.00');
  const lines = (await owner.get(`/api/reservations/${stay.booking_id}/charges`)).data.charges;
  assert.deepEqual(lines.map((c) => [c.category, c.amount]), [['damage', '300.00']]);

  assert.equal((await owner.post(`/api/damage-reports/${rep.A.report_id}/charge`, { amount: '10', description: 'again' })).status, 409, 'once only');

  const managerCharge = await manager.post(`/api/damage-reports/${rep.B.report_id}/charge`, { amount: '150.25', description: 'Damage: Scuffed wall' });
  assert.equal(managerCharge.status, 200, 'managers can charge too');
  assert.equal(managerCharge.data.report.status, 'charged');
  assert.equal((await owner.get(`/api/reservations/${stayD.booking_id}`)).data.reservation.extras_total, '150.25', 'lands on its own stay');
  assert.equal((await owner.get(`/api/reservations/${stay.booking_id}`)).data.reservation.extras_total, '300.00', 'the first stay is unchanged');

  assert.equal((await owner.post(`/api/damage-reports/${rep.F.report_id}/charge`, { amount: '0', description: 'x' })).status, 400);

  const noStay = await owner.post(`/api/damage-reports/${rep.C.report_id}/charge`, { amount: '50', description: 'Towel rail' });
  assert.equal(noStay.status, 409);
  assert.equal(noStay.data.code, 'NO_STAY');

  const future = await staff.post(`/api/reservations/${stayFuture.booking_id}/damage`, { description: 'Cracked cup', estimated_cost: '20' });
  rep.H = future.data.report;
  assert.equal((await owner.post(`/api/reservations/${stayFuture.booking_id}/cancel`, { reason: 'Guest cancelled' })).status, 200);
  const cancelled = await owner.post(`/api/damage-reports/${rep.H.report_id}/charge`, { amount: '50', description: 'Cup' });
  assert.equal(cancelled.status, 409);
  assert.equal(cancelled.data.code, 'CANCELLED');
  assert.equal((await owner.get('/api/damage-reports?status=open')).data.reports.some((r) => r.report_id === rep.H.report_id), true, 'still open');
});

test('deduct and waive, and the deposit suggests what open and deducted estimates add up to', async () => {
  assert.equal((await owner.post(`/api/damage-reports/${rep.F.report_id}/deduct`, {})).status, 200);
  const deducted = await owner.post(`/api/damage-reports/${rep.F.report_id}/deduct`, {});
  assert.equal(deducted.status, 409, 'already deducted');
  assert.equal((await owner.post(`/api/damage-reports/${rep.A.report_id}/deduct`, {})).status, 409, 'already charged');
  const noStay = await owner.post(`/api/damage-reports/${rep.C.report_id}/deduct`, {});
  assert.equal(noStay.status, 409);
  assert.equal(noStay.data.code, 'NO_STAY');

  const waived = await owner.post(`/api/damage-reports/${rep.G.report_id}/waive`, { note: 'Old stain, already there at check-in' });
  assert.equal(waived.status, 200, JSON.stringify(waived.data));
  assert.equal(waived.data.report.status, 'waived');
  assert.equal(waived.data.report.resolution_note, 'Old stain, already there at check-in');
  assert.equal((await owner.post(`/api/damage-reports/${rep.G.report_id}/waive`, {})).status, 409);

  const bare = await owner.post(`/api/damage-reports/${rep.E.report_id}/waive`, {});
  assert.equal(bare.status, 200, 'the note is optional');
  assert.equal(bare.data.report.resolution_note, null);

  const chipped = await staff.post(`/api/reservations/${stay.booking_id}/damage`, { description: 'Chipped cup', estimated_cost: '20' });
  const sofa = await staff.post(`/api/reservations/${stay.booking_id}/damage`, { description: 'Sofa stain', estimated_cost: '45.5' });
  assert.equal(chipped.status, 201);
  assert.equal(sofa.status, 201);

  // Open or deducted on this stay: Broken lamp (80, deducted), Chipped cup (20), Sofa stain (45.50). Not the charged, waived or estimate-less ones.
  const dep = await owner.get(`/api/reservations/${stay.booking_id}/deposit`);
  assert.equal(dep.status, 200);
  assert.equal(dep.data.suggested, '1000.00');
  assert.equal(dep.data.suggested_deduction, '145.50');
  assert.equal((await staff.get(`/api/reservations/${stay.booking_id}/deposit`)).data.suggested_deduction, null, 'staff never see damage costs');
});

test('lost and found: cleaners log items on their tasks; owners see the log with guest names', async () => {
  const phone = await cleanerX.c.post(`/api/cleaning-tasks/${tMine.task_id}/lost-found`, { description: 'Pink phone case', found_where: 'Under the bed', found_on: manilaToday() });
  assert.equal(phone.status, 201, JSON.stringify(phone.data));
  rep.phone = phone.data.item;
  assert.equal(rep.phone.status, 'held');
  assert.equal(rep.phone.booking_id, stay.booking_id);
  assert.equal('guest_name' in rep.phone, false, 'cleaners never see guest names');

  assert.equal((await cleanerX.c.post(`/api/cleaning-tasks/${tOther.task_id}/lost-found`, { description: 'x' })).status, 404);
  const future = await cleanerX.c.post(`/api/cleaning-tasks/${tMine.task_id}/lost-found`, { description: 'Keys', found_on: d(1) });
  assert.equal(future.status, 400);
  assert.ok(future.data.fields.found_on);
  assert.equal((await cleanerX.c.post(`/api/cleaning-tasks/${tMine.task_id}/lost-found`, { description: 'Keys', found_on: 'not a date' })).status, 400);

  const sun = await staff.post(`/api/reservations/${stay.booking_id}/lost-found`, { description: 'Sunglasses', found_where: 'Balcony', found_on: d(-1) });
  assert.equal(sun.status, 201, JSON.stringify(sun.data));
  rep.sun = sun.data.item;
  assert.equal(rep.sun.guest_name, 'Ana Cruz');
  assert.equal((await cleanerX.c.post(`/api/reservations/${stay.booking_id}/lost-found`, { description: 'x' })).status, 403);

  const list = await owner.get('/api/lost-found');
  assert.equal(list.status, 200);
  assert.equal(list.data.items.length, 2);
  for (const item of list.data.items) {
    assert.equal(item.unit_name, '1201');
    assert.equal(item.property_name, 'Azure');
    assert.equal(item.booking_id, stay.booking_id);
    assert.equal(item.guest_name, 'Ana Cruz');
  }
  assert.equal((await owner.get('/api/lost-found?status=held')).data.items.length, 2);
  assert.equal((await owner.get('/api/lost-found?status=returned')).data.items.length, 0);
  assert.equal((await owner.get('/api/lost-found?q=sunglass')).data.items.length, 1, 'search on the item');
  assert.equal((await owner.get('/api/lost-found?q=balcony')).data.items.length, 1, 'search on where it was found');
  assert.equal((await owner.get('/api/lost-found?q=ana')).data.items.length, 2, 'search on the guest name');
  assert.equal((await owner.get('/api/lost-found?q=1201')).data.items.length, 2, 'search on the unit');
  assert.equal((await owner.get('/api/lost-found?q=nothing-matches')).data.items.length, 0);

  const onStay = await owner.get(`/api/reservations/${stay.booking_id}/lost-found`);
  assert.equal(onStay.data.items.length, 2);
  assert.equal((await staff.get(`/api/reservations/${stay.booking_id}/lost-found`)).status, 403);
  assert.equal((await staff.get('/api/lost-found')).status, 403);
  assert.equal((await cleanerX.c.get('/api/lost-found')).status, 403);
});

test('lost and found: status moves between held, returned and disposed, with a note that is replaced', async () => {
  const id = rep.phone.item_id;
  const returned = await owner.patch(`/api/lost-found/${id}`, { status: 'returned', status_note: 'Picked up 2 Nov' });
  assert.equal(returned.status, 200, JSON.stringify(returned.data));
  assert.equal(returned.data.item.status, 'returned');
  assert.equal(returned.data.item.status_note, 'Picked up 2 Nov');
  assert.equal(returned.data.item.updated_by_name, 'Maria Santos');

  const back = await owner.patch(`/api/lost-found/${id}`, { status: 'held' });
  assert.equal(back.status, 200, 'back to held');
  assert.equal(back.data.item.status, 'held');
  assert.equal(back.data.item.status_note, null, 'a note that is left out is cleared');

  assert.equal((await owner.patch(`/api/lost-found/${id}`, { status: 'lost' })).status, 400);
  assert.equal((await owner.patch(`/api/lost-found/${NO_ID}`, { status: 'held' })).status, 404);
  assert.equal((await staff.patch(`/api/lost-found/${id}`, { status: 'returned' })).status, 403);
  assert.equal((await cleanerX.c.patch(`/api/lost-found/${id}`, { status: 'returned' })).status, 403);

  const other = await ownerAccount(srv.base, 'other-lf@example.com', 'Other Lost');
  assert.equal((await other.patch(`/api/lost-found/${id}`, { status: 'returned' })).status, 404, 'another workspace cannot change it');

  const disposed = await manager.patch(`/api/lost-found/${rep.sun.item_id}`, { status: 'disposed', status_note: 'Donated' });
  assert.equal(disposed.status, 200, 'managers can change items too');
  assert.equal((await owner.get('/api/lost-found?status=disposed')).data.items.length, 1);
});

test('photos: the reporter adds photos, others and the wrong record types are refused', async () => {
  const mine = await upload(cleanerX.c, 'damage', rep.A.report_id);
  assert.equal(mine.status, 201, JSON.stringify(mine.data));
  assert.equal((await upload(cleanerY.c, 'damage', rep.A.report_id)).status, 404, 'a cleaner who did not file it');
  assert.equal((await upload(cleanerX.c, 'damage', rep.D.report_id)).status, 404, 'a report someone else filed');

  assert.equal((await upload(cleanerX.c, 'deposit', NO_ID)).status, 403);
  assert.equal((await upload(cleanerX.c, 'inspection', NO_ID)).status, 403);
  assert.equal((await upload(cleanerX.c, 'listing', unitA.unit_id)).status, 403, 'refused by type, before anything else');
  assert.equal((await upload(cleanerX.c, 'lease', NO_ID)).status, 403);

  assert.equal((await upload(staff, 'damage', rep.A.report_id)).status, 201, 'staff who can see the unit can add photos');
  const list = await owner.get('/api/damage-reports');
  assert.equal(list.data.reports.find((r) => r.report_id === rep.A.report_id).photo_count, 2);

  const fileId = mine.data.file.file_id;
  assert.equal((await cleanerX.c.get(`/api/files/${fileId}`)).status, 200);
  assert.equal((await cleanerY.c.get(`/api/files/${fileId}`)).status, 404);

  const lf = await upload(cleanerX.c, 'lost_found', rep.phone.item_id);
  assert.equal(lf.status, 201, JSON.stringify(lf.data));
  assert.equal((await upload(cleanerY.c, 'lost_found', rep.phone.item_id)).status, 404);
  assert.equal((await upload(cleanerX.c, 'lost_found', rep.sun.item_id)).status, 404, 'an item someone else logged');

  assert.equal((await upload(cleanerY.c, 'cleaning', tMine.task_id)).status, 404, 'a cleaning task another cleaner has');
  assert.equal((await upload(cleanerX.c, 'cleaning', tFree.task_id)).status, 201, 'an unassigned cleaning task is open to a cleaner');
});

test('photos: inspection photos are for owners and managers only', async () => {
  const [{ user_id: ownerId }] = await sql('SELECT user_id FROM users WHERE email = $1', ['host@example.com']);
  const [{ inspection_id: inspectionId }] = await sql(
    `INSERT INTO cleaning_inspections (organization_id, task_id, inspected_by, items, score, passed)
     VALUES ($1, $2, $3, '[]', 80, false) RETURNING inspection_id`, [orgId, tMine.task_id, ownerId]);
  const ownerUpload = await upload(owner, 'inspection', inspectionId);
  assert.equal(ownerUpload.status, 201, JSON.stringify(ownerUpload.data));
  assert.equal((await upload(manager, 'inspection', inspectionId)).status, 201);
  assert.equal((await upload(staff, 'inspection', inspectionId)).status, 403);
  assert.equal((await upload(cleanerX.c, 'inspection', inspectionId)).status, 403);
  assert.equal((await staff.get(`/api/files/${ownerUpload.data.file.file_id}`)).status, 403);
  assert.equal((await owner.get(`/api/files/${ownerUpload.data.file.file_id}`)).status, 200);
});

test('a charge closes an open pay link, the same as charges.js', async () => {
  assert.equal((await owner.patch('/api/direct-booking', { paymongo_secret_key: 'sk_test_hostKEY1234567890' })).status, 200);
  const pay = (await owner.post('/api/reservations', { unit_id: unitA.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Pay Test', guest_email: 'pay@example.com' })).data.reservation;
  const link = await owner.get(`/api/reservations/${pay.booking_id}/payment-link`);
  assert.equal(link.data.available, true);
  const token = link.data.link.split('/#/pay/')[1];
  assert.equal((await client(srv.base).post(`/api/public/pay/${token}/checkout`)).status, 200);
  const open = await sql('SELECT status FROM balance_checkouts WHERE booking_id = $1', [pay.booking_id]);
  assert.deepEqual(open.map((x) => x.status), ['pending']);

  const dmg = await owner.post(`/api/reservations/${pay.booking_id}/damage`, { description: 'Remote lost', estimated_cost: '40' });
  assert.equal(dmg.status, 201);
  const charged = await owner.post(`/api/damage-reports/${dmg.data.report.report_id}/charge`, { amount: '40', description: 'Remote' });
  assert.equal(charged.status, 200, JSON.stringify(charged.data));
  const closed = await sql('SELECT status FROM balance_checkouts WHERE booking_id = $1', [pay.booking_id]);
  assert.deepEqual(closed.map((x) => x.status), ['expired'], 'the stale checkout can no longer be paid');
});
