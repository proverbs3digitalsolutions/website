'use strict';

// Owner portal: emailed sign-in, what an owner sees and can do, what they can't, and the host's invite and disable.

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');
const { outbox } = require('../src/lib/mailer');
const { purgeExpiredAuth, hashToken } = require('../src/lib/auth');
const ical = require('../src/lib/ical');

const TODAY = manilaToday();
const d = (n) => ical.addDays(TODAY, n);
const PDF = Buffer.from('%PDF-1.4\n% owner portal receipt\n');
const tokenFrom = (mail) => decodeURIComponent(/token=([^&\s]+)/.exec(mail.text)[1]);
const sentTo = (email) => outbox.filter((m) => m.to === email);
// Sign-in mail goes out after the reply, so tests wait for it to land, or let a moment pass before asserting none.
async function waitForMail(email, count = 1) {
  for (let i = 0; i < 300 && sentTo(email).length < count; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(sentTo(email).length >= count, `expected ${count} email(s) to ${email}`);
}
const settle = () => new Promise((r) => setTimeout(r, 100));

let srv; let host; let orgId; let propertyId;
let unitA; let unitB; let unitC;
let maria; let ben; let carl; let dana;
let mariaC; let benC;
let anaRes; let anaBookingId; let gilBookingId;
let expE1; let expE2; let expE3;
let mariaBlockId;

test.before(async () => {
  srv = await startServer();
  host = await ownerAccount(srv.base, 'host@example.com', 'Portal Stays');
  orgId = (await sql(`SELECT organization_id FROM organizations WHERE name = 'Portal Stays'`))[0].organization_id;
  const p = (await host.post('/api/properties', { property_name: 'Azure', property_type: 'condominium', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propertyId = p.property_id;
  const unit = async (name) => (await host.post(`/api/properties/${propertyId}/units`, { unit_name: name, unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  unitA = await unit('1201');
  unitB = await unit('805');
  unitC = await unit('902');

  const addOwner = async (body) => (await host.post('/api/unit-owners', body)).data.owner_id;
  maria = await addOwner({ full_name: 'Maria Santos', email: 'maria@example.com', unit_ids: [unitA.unit_id] });
  ben = await addOwner({ full_name: 'Ben Reyes', email: 'ben@example.com', unit_ids: [unitB.unit_id] });
  carl = await addOwner({ full_name: 'Carl Cruz', email: 'carl@example.com' });
  dana = await addOwner({ full_name: 'Dana Diaz' });

  anaRes = (await host.post('/api/reservations', {
    unit_id: unitA.unit_id, check_in: d(10), check_out: d(12), guest_name: 'Ana Cruz', guest_email: 'ana@example.com',
    guest_phone: '0917 123 4567', notes: 'Gate code 4455, arriving late', channel: 'airbnb', channel_fee: '600',
  })).data.reservation;
  assert.ok(anaRes.confirmation_code, 'the reservation has a confirmation code');
  anaBookingId = anaRes.booking_id;
  const gil = (await host.post('/api/reservations', { unit_id: unitB.unit_id, check_in: d(5), check_out: d(6), guest_name: 'Gil Garcia' })).data.reservation;
  gilBookingId = gil.booking_id;

  const expense = async (unit, description) => (await host.post('/api/expenses', {
    property_id: propertyId, unit_id: unit.unit_id, category: 'repairs', description, amount: '800',
    expense_date: d(-5), vendor_name: 'Aircon Pro',
  })).data.expense.expense_id;
  expE1 = await expense(unitA, 'Aircon service');
  expE2 = await expense(unitA, 'Door lock');
  expE3 = await expense(unitB, 'Gate motor');
});
test.after(async () => { await srv.close(); });

// Signs in with the link in an emailed message. Returns a client that holds the bh_owner cookie.
async function signInWith(mail) {
  const oc = client(srv.base);
  const r = await oc.post('/api/owner-portal/session', { token: tokenFrom(mail) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return oc;
}

test('the host invites an owner, who signs in once with the emailed link', async () => {
  const noEmail = await host.post(`/api/unit-owners/${dana}/portal-invite`);
  assert.equal(noEmail.status, 409);
  assert.equal(noEmail.data.code, 'NO_EMAIL');

  outbox.length = 0;
  const invite = await host.post(`/api/unit-owners/${maria}/portal-invite`);
  assert.equal(invite.status, 200, JSON.stringify(invite.data));
  assert.deepEqual(invite.data, { ok: true, sent: true });
  const mail = sentTo('maria@example.com')[0];
  assert.match(mail.text, /#\/owner\/signin\?token=/);

  mariaC = await signInWith(mail);
  const me = await mariaC.get('/api/owner-portal/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.owner.full_name, 'Maria Santos');
  assert.equal(me.data.workspace_name, 'Portal Stays');
  assert.deepEqual(me.data.units.map((u) => u.unit_name), ['1201']);

  // The link works once.
  const again = await client(srv.base).post('/api/owner-portal/session', { token: tokenFrom(mail) });
  assert.equal(again.status, 400);
  assert.equal(again.data.code, 'INVALID_LINK');

  // No cookie, and the team member's own session cookie, both fail on portal data.
  assert.equal((await client(srv.base).get('/api/owner-portal/me')).status, 401);
  const asTeam = await host.get('/api/owner-portal/me');
  assert.equal(asTeam.status, 401);
  assert.equal(asTeam.data.code, 'OWNER_SIGNED_OUT');
  // The owner's cookie gets nothing from workspace routes.
  const asOwnerOnTeamRoute = await mariaC.get('/api/unit-owners');
  assert.equal(asOwnerOnTeamRoute.status, 401);
});

test('sign-in gives the same answer for any email and is rate limited per email', async () => {
  const anon = client(srv.base);
  outbox.length = 0;
  for (const email of ['nobody@example.com', 'ben@example.com']) { // Ben's portal is still off
    const r = await anon.post('/api/owner-portal/login', { email });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data, { sent: true });
  }
  await settle();
  assert.equal(outbox.length, 0, 'no email for an unknown address or an owner without portal access');
  assert.equal((await anon.post('/api/owner-portal/login', { email: 'not-an-email' })).status, 400);

  // Maria: five emails in 15 minutes (case doesn't change the count), then the limit.
  for (let i = 0; i < 5; i++) {
    const r = await anon.post('/api/owner-portal/login', { email: i % 2 ? 'maria@example.com' : 'MARIA@example.com' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  await waitForMail('maria@example.com', 5);
  const blocked = await anon.post('/api/owner-portal/login', { email: 'maria@example.com' });
  assert.equal(blocked.status, 429);
  await settle();
  assert.equal(sentTo('maria@example.com').length, 5, 'one sign-in email per request, none after the limit');
  assert.match(sentTo('maria@example.com')[0].subject, /owner portal sign-in link/);
});

test('an expired link is refused; a fresh link from the login page signs in; logout ends the session', async () => {
  const invite = await host.post(`/api/unit-owners/${ben}/portal-invite`);
  assert.equal(invite.status, 200);

  const anon = client(srv.base);
  outbox.length = 0;
  assert.equal((await anon.post('/api/owner-portal/login', { email: 'ben@example.com' })).status, 200);
  await waitForMail('ben@example.com');
  const link = sentTo('ben@example.com')[0];
  await sql(`UPDATE owner_login_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [hashToken(tokenFrom(link))]);
  const expired = await anon.post('/api/owner-portal/session', { token: tokenFrom(link) });
  assert.equal(expired.status, 400);
  assert.equal(expired.data.code, 'INVALID_LINK');

  // Each login email carries a new link with its own 30-minute life.
  outbox.length = 0;
  await anon.post('/api/owner-portal/login', { email: 'ben@example.com' });
  await waitForMail('ben@example.com');
  const fresh = sentTo('ben@example.com')[0];
  const [{ minutes }] = await sql(
    `SELECT ROUND(EXTRACT(EPOCH FROM (expires_at - now())) / 60)::int AS minutes FROM owner_login_tokens WHERE token_hash = $1`,
    [hashToken(tokenFrom(fresh))]);
  assert.ok(minutes >= 29 && minutes <= 30, `expires in about 30 minutes, got ${minutes}`);
  benC = await signInWith(fresh);
  assert.equal((await benC.get('/api/owner-portal/me')).status, 200);

  // Logout is tested on a separate session, so Ben's main client stays signed in for later tests.
  outbox.length = 0;
  await anon.post('/api/owner-portal/login', { email: 'ben@example.com' });
  await waitForMail('ben@example.com');
  const tmp = await signInWith(sentTo('ben@example.com')[0]);
  assert.equal((await tmp.post('/api/owner-portal/logout')).status, 200);
  assert.equal((await tmp.get('/api/owner-portal/me')).status, 401);
  assert.equal((await benC.get('/api/owner-portal/me')).status, 200);
});

test('owners see only their published statements, with payouts; drafts and other owners are hidden', async () => {
  const publish = (ownerId, month, snapshot) => sql(
    `INSERT INTO owner_statements (organization_id, owner_id, month, status, snapshot, published_at)
     VALUES ($1, $2, $3, 'published', $4, now())`, [orgId, ownerId, month, JSON.stringify(snapshot)]);
  const benOwner = (await sql(`SELECT owner_id FROM unit_owners WHERE full_name = 'Ben Reyes'`))[0].owner_id;
  await publish(maria, '2026-06', {
    month: '2026-06', workspace: 'Portal Stays', totals: { payout: '1500.00' },
    expenses: [{ expense_id: expE1, description: 'Aircon service', amount: '800.00', unit_name: '1201' }],
  });
  await publish(maria, '2026-07', { month: '2026-07', workspace: 'Portal Stays', totals: { payout: '1920.00' }, expenses: [] });
  await sql(`INSERT INTO owner_statements (organization_id, owner_id, month, status, snapshot) VALUES ($1, $2, '2026-08', 'draft', $3)`,
    [orgId, maria, JSON.stringify({ totals: { payout: '9999.00' } })]);
  await publish(benOwner, '2026-05', { month: '2026-05', workspace: 'Portal Stays', totals: { payout: '777.00' }, expenses: [{ expense_id: expE3 }] });
  // July: one paid, and one voided payout that must not count.
  await sql(`INSERT INTO owner_payouts (organization_id, owner_id, month, amount, paid_on, method, reference_number, note)
             VALUES ($1, $2, '2026-07', 1000, '2026-07-31', 'gcash', 'GC-1', 'First half')`, [orgId, maria]);
  await sql(`INSERT INTO owner_payouts (organization_id, owner_id, month, amount, paid_on, method, void_reason, voided_at)
             VALUES ($1, $2, '2026-07', 500, '2026-07-31', 'cash', 'Typed the wrong amount', now())`, [orgId, maria]);

  const list = (await mariaC.get('/api/owner-portal/statements')).data.statements;
  assert.deepEqual(list.map((s) => [s.month, s.month_label, s.payout, s.paid]), [
    ['2026-07', 'July 2026', '1920.00', '1000.00'],
    ['2026-06', 'June 2026', '1500.00', '0.00'],
  ]);

  const july = await mariaC.get('/api/owner-portal/statements/2026-07');
  assert.equal(july.status, 200, JSON.stringify(july.data));
  assert.equal(july.data.statement.totals.payout, '1920.00');
  assert.equal(july.data.statement.month_label, 'July 2026');
  assert.equal(july.data.paid, '1000.00');
  assert.deepEqual(july.data.payouts.map((p) => [p.amount, p.method, p.reference_number]), [['1000.00', 'gcash', 'GC-1']]);

  assert.equal((await mariaC.get('/api/owner-portal/statements/2026-08')).status, 404, 'a draft is invisible');
  assert.equal((await mariaC.get('/api/owner-portal/statements/2026-05')).status, 404, 'Ben\'s statement is invisible');
  assert.equal((await mariaC.get('/api/owner-portal/statements/2026-7')).status, 400);
  assert.equal((await host.get('/api/owner-portal/statements')).status, 401, 'a team member gets no owner statements');
});

test('bookings show guests by first name only, and only the owner\'s units', async () => {
  const r = await mariaC.get('/api/owner-portal/bookings');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.bookings.length, 1, 'Ben\'s stay on another unit is not listed');
  const [b] = r.data.bookings;
  assert.equal(b.booking_id, anaBookingId);
  assert.equal(b.kind, 'reservation');
  assert.equal(b.guest_first_name, 'Ana');
  assert.equal(b.gross, '4500.00');
  assert.equal(b.channel_fee, '600.00');
  assert.equal(b.nights, 2);

  const text = JSON.stringify(r.data);
  for (const secret of ['ana@example.com', '0917', 'Gate code', 'Cruz', anaRes.confirmation_code, 'Gil', 'Garcia']) {
    assert.ok(!text.includes(secret), `response must not contain ${secret}`);
  }

  assert.equal((await mariaC.get('/api/owner-portal/bookings?from=2026-09-10&to=2026-09-01')).status, 400);
  assert.equal((await mariaC.get('/api/owner-portal/bookings?from=2026-01-01&to=2027-02-05')).status, 200, 'exactly 400 days is allowed');
  assert.equal((await mariaC.get('/api/owner-portal/bookings?from=2026-01-01&to=2027-02-06')).status, 400, 'more than 400 days');
  assert.equal((await mariaC.get('/api/owner-portal/bookings?from=soon')).status, 400);
});

test('an owner blocks dates on their own unit; overlaps and other owners\' units are refused', async () => {
  outbox.length = 0;
  const block = await mariaC.post('/api/owner-portal/blocks', { unit_id: unitA.unit_id, check_in: d(30), check_out: d(33), reason: 'Family visit' });
  assert.equal(block.status, 201, JSON.stringify(block.data));
  mariaBlockId = block.data.block_id;
  const hostMail = sentTo('host@example.com')[0];
  assert.match(hostMail.subject, /Maria Santos blocked 1201 from/);

  const listed = (await mariaC.get('/api/owner-portal/bookings')).data.bookings.find((b) => b.booking_id === mariaBlockId);
  assert.equal(listed.kind, 'block');
  assert.equal(listed.mine, true);
  assert.equal(listed.label, 'Family visit');
  assert.equal(listed.guest_first_name, null);

  // Overlaps Ana's stay: refused, and the message doesn't name the guest.
  const clash = await mariaC.post('/api/owner-portal/blocks', { unit_id: unitA.unit_id, check_in: d(11), check_out: d(13) });
  assert.equal(clash.status, 409);
  assert.equal(clash.data.code, 'DATES_TAKEN');
  assert.deepEqual(clash.data.fields, { check_in: 'Dates not available', check_out: 'Dates not available' });
  assert.ok(!JSON.stringify(clash.data).includes('Ana'));
  assert.ok(!JSON.stringify(clash.data).includes(anaRes.confirmation_code));

  // Another owner's unit, and a unit with no owner, look the same as a unit that doesn't exist.
  assert.equal((await mariaC.post('/api/owner-portal/blocks', { unit_id: unitB.unit_id, check_in: d(40), check_out: d(41) })).status, 404);
  assert.equal((await mariaC.post('/api/owner-portal/blocks', { unit_id: unitC.unit_id, check_in: d(40), check_out: d(41) })).status, 404);

  const bad = [
    [{ check_in: d(-1), check_out: d(1) }, 'check_in'],
    [{ check_in: d(45), check_out: d(45) }, 'check_out'],
    [{ check_in: d(50), check_out: d(111) }, 'check_out'], // 61 nights
    [{ check_in: '2026-02-30', check_out: d(1) }, 'check_in'],
  ];
  for (const [body, field] of bad) {
    const r = await mariaC.post('/api/owner-portal/blocks', { unit_id: unitA.unit_id, ...body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.data.fields[field], `names ${field}`);
  }
  assert.equal((await mariaC.post('/api/owner-portal/blocks', { check_in: d(50), check_out: d(51) })).status, 400, 'a unit is required');
});

test('an owner cancels only their own future blocks', async () => {
  // Ben can't cancel Maria's block; the host's own block on her unit isn't hers either.
  assert.equal((await benC.post(`/api/owner-portal/blocks/${mariaBlockId}/cancel`)).status, 404);
  const hostBlock = await host.post('/api/blocks', { unit_id: unitA.unit_id, start_date: d(70), end_date: d(70), reason: 'Painting' });
  assert.equal(hostBlock.status, 201, JSON.stringify(hostBlock.data));
  assert.equal((await mariaC.post(`/api/owner-portal/blocks/${hostBlock.data.block_id}/cancel`)).status, 404);

  const ok = await mariaC.post(`/api/owner-portal/blocks/${mariaBlockId}/cancel`);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const again = await mariaC.post(`/api/owner-portal/blocks/${mariaBlockId}/cancel`);
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'ALREADY_CANCELLED');
  const [row] = await sql(`SELECT status, cancel_reason FROM bookings WHERE booking_id = $1`, [mariaBlockId]);
  assert.deepEqual(row, { status: 'cancelled', cancel_reason: 'Cancelled by owner' });

  // A block that starts today has started.
  const today = await mariaC.post('/api/owner-portal/blocks', { unit_id: unitA.unit_id, check_in: TODAY, check_out: d(1) });
  assert.equal(today.status, 201, JSON.stringify(today.data));
  const started = await mariaC.post(`/api/owner-portal/blocks/${today.data.block_id}/cancel`);
  assert.equal(started.status, 409);
  assert.equal(started.data.code, 'BLOCK_STARTED');

  // No reason given: the block says "Owner stay".
  const noReason = await mariaC.post('/api/owner-portal/blocks', { unit_id: unitA.unit_id, check_in: d(60), check_out: d(61) });
  assert.equal(noReason.status, 201);
  const label = (await mariaC.get('/api/owner-portal/bookings')).data.bookings.find((b) => b.booking_id === noReason.data.block_id).label;
  assert.equal(label, 'Owner stay');
});

test('owner block creates and cancels share a limit of 20 an hour per owner', async () => {
  const unit = (await host.post(`/api/properties/${propertyId}/units`, { unit_name: '1505', unit_type: 'studio', nightly_rate: '2000', cleaning_fee: '500' })).data.unit;
  const eva = (await host.post('/api/unit-owners', { full_name: 'Eva Lim', email: 'eva@example.com', unit_ids: [unit.unit_id] })).data.owner_id;
  outbox.length = 0;
  assert.equal((await host.post(`/api/unit-owners/${eva}/portal-invite`)).status, 200);
  const evaC = await signInWith(sentTo('eva@example.com')[0]);

  // Every block is one night, two days apart, so none overlap.
  const span = (i) => ({ check_in: d(100 + 2 * i), check_out: d(101 + 2 * i) });
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const r = await evaC.post('/api/owner-portal/blocks', { unit_id: unit.unit_id, ...span(i) });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    ids.push(r.data.block_id);
  }
  for (const id of ids.slice(0, 5)) assert.equal((await evaC.post(`/api/owner-portal/blocks/${id}/cancel`)).status, 200);
  for (let i = 10; i < 15; i++) assert.equal((await evaC.post('/api/owner-portal/blocks', { unit_id: unit.unit_id, ...span(i) })).status, 201);

  // That is 20 requests this hour (15 creates, 5 cancels), so the next one is refused, create or cancel.
  const over = await evaC.post('/api/owner-portal/blocks', { unit_id: unit.unit_id, ...span(15) });
  assert.equal(over.status, 429, JSON.stringify(over.data));
  assert.equal(over.data.code, 'RATE_LIMITED');
  assert.ok(Number(over.headers.get('retry-after')) > 0, 'says when to try again');
  assert.equal((await evaC.post(`/api/owner-portal/blocks/${ids[5]}/cancel`)).status, 429);
  const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM bookings WHERE owner_block_by = $1 AND status = 'confirmed'`, [eva]);
  assert.equal(n, 10, 'the refused requests changed nothing');
});

test('payouts and the repairs reserve show the owner their own records; voided entries are left out', async () => {
  const reserveOwner = (await sql(`SELECT owner_id FROM unit_owners WHERE full_name = 'Maria Santos'`))[0].owner_id;
  await sql(`UPDATE unit_owners SET reserve_target = 5000, reserve_monthly = 250 WHERE owner_id = $1`, [reserveOwner]);
  await sql(`INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, note)
             VALUES ($1, $2, 'deposit', 1000, '2026-06-30', NULL), ($1, $2, 'withdrawal', 200, '2026-07-15', 'Water heater')`,
  [orgId, reserveOwner]);
  await sql(`INSERT INTO owner_reserve_entries (organization_id, owner_id, kind, amount, entry_date, voided_at, void_reason)
             VALUES ($1, $2, 'deposit', 300, '2026-06-30', now(), 'Entered twice')`, [orgId, reserveOwner]);

  const payouts = (await mariaC.get('/api/owner-portal/payouts')).data.payouts;
  assert.deepEqual(payouts.map((p) => [p.amount, p.month, p.method]), [['1000.00', '2026-07', 'gcash']]);

  const reserve = (await mariaC.get('/api/owner-portal/reserve')).data;
  assert.equal(reserve.balance, '800.00');
  assert.equal(reserve.target, '5000.00');
  assert.equal(reserve.monthly, '250.00');
  assert.deepEqual(reserve.entries.map((e) => [e.kind, e.amount, e.note]), [['deposit', '1000.00', null], ['withdrawal', '200.00', 'Water heater']]);
});

test('the activity feed covers the owner\'s units, statements and payouts, newest first', async () => {
  await sql(`UPDATE bookings SET checked_in_at = now() - interval '1 day' WHERE booking_id = $1`, [anaBookingId]);
  await sql(`UPDATE bookings SET checked_in_at = now() - interval '1 day' WHERE booking_id = $1`, [gilBookingId]);
  await sql(`INSERT INTO cleaning_tasks (organization_id, unit_id, due_date, status, completed_at, assignee_name)
             VALUES ($1, $2, $3, 'done', now(), 'Lourdes'), ($1, $4, $3, 'done', now(), 'Lourdes')`,
  [orgId, unitA.unit_id, TODAY, unitB.unit_id]);
  await sql(`INSERT INTO maintenance_requests (organization_id, property_id, unit_id, reported_by, title, status)
             VALUES ($1, $2, $3, 'Tenant Juan', 'Leaking shower', 'in_progress'), ($1, $2, $4, 'Tenant Pia', 'Broken gate', 'open')`,
  [orgId, propertyId, unitA.unit_id, unitB.unit_id]);

  const { activity } = (await mariaC.get('/api/owner-portal/activity?limit=50')).data;
  const titles = activity.map((a) => a.title);
  assert.ok(titles.includes('Ana checked in'));
  assert.ok(titles.includes('Cleaning completed'));
  assert.ok(titles.includes('Maintenance: Leaking shower (in progress)'));
  assert.ok(titles.includes('Expense: Aircon service (₱800.00)'));
  assert.ok(titles.includes('Statement ready for July 2026'));
  assert.ok(titles.includes('Payout of ₱1,000.00 recorded'));

  const text = JSON.stringify(activity);
  for (const hidden of ['Gil', 'Broken gate', 'Gate motor', 'Tenant Juan', 'Tenant Pia', 'Ben']) {
    assert.ok(!text.includes(hidden), `activity must not contain ${hidden}`);
  }
  for (const a of activity) {
    assert.deepEqual(Object.keys(a).sort(), ['at', 'kind', 'title', 'unit_name']);
    assert.ok(a.unit_name === '1201' || a.unit_name === null);
  }
  for (let i = 1; i < activity.length; i++) assert.ok(activity[i - 1].at >= activity[i].at, 'newest first');
  assert.equal((await mariaC.get('/api/owner-portal/activity?limit=0')).status, 400);
});

test('receipts open only for an expense on the owner\'s unit that is in one of their published statements', async () => {
  const upload = (expenseId, name) => host.raw('POST', `/api/files?record_type=expense&record_id=${expenseId}`, PDF,
    { 'Content-Type': 'application/pdf', 'X-File-Name': name });
  const receipt1 = await upload(expE1, 'aircon-receipt.pdf');
  assert.equal(receipt1.status, 201, JSON.stringify(receipt1.data));
  const receipt2 = await upload(expE2, 'lock-receipt.pdf');
  const receipt3 = await upload(expE3, 'gate-receipt.pdf');

  const ok = await mariaC.get(`/api/owner-portal/receipts/${receipt1.data.file.file_id}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.headers.get('content-type'), 'application/pdf');
  assert.match(ok.headers.get('content-disposition'), /^inline; filename="aircon-receipt\.pdf"/);
  assert.match(ok.data, /^%PDF/);

  // On her unit but not in a published statement; and on Ben's unit.
  assert.equal((await mariaC.get(`/api/owner-portal/receipts/${receipt2.data.file.file_id}`)).status, 404);
  assert.equal((await mariaC.get(`/api/owner-portal/receipts/${receipt3.data.file.file_id}`)).status, 404);
  assert.equal((await mariaC.get('/api/owner-portal/receipts/00000000-0000-4000-8000-000000000000')).status, 404);
  assert.equal((await mariaC.get('/api/owner-portal/receipts/not-a-uuid')).status, 404);
  assert.equal((await client(srv.base).get(`/api/owner-portal/receipts/${receipt1.data.file.file_id}`)).status, 401);

  // A name with CJK characters, an emoji and header-unsafe punctuation: the plain name stays ASCII,
  // and filename* carries the real name.
  const odd = '領収書 📄 "Aircon" it\'s (1)*.pdf';
  await sql('UPDATE files SET file_name = $1 WHERE file_id = $2', [odd, receipt1.data.file.file_id]);
  const uni = await mariaC.get(`/api/owner-portal/receipts/${receipt1.data.file.file_id}`);
  assert.equal(uni.status, 200, JSON.stringify(uni.data));
  const disposition = /^inline; filename="([^"]*)"; filename\*=UTF-8''(\S+)$/.exec(uni.headers.get('content-disposition'));
  assert.ok(disposition, uni.headers.get('content-disposition'));
  assert.match(disposition[1], /^[\x20-\x7e]+$/);
  assert.equal(decodeURIComponent(disposition[2]), odd);
});

test('only the workspace owner can invite or disable; disabling signs the owner out and stops sign-in emails', async () => {
  const inv = await host.post('/api/team/invitations', { email: 'mgr@example.com', role: 'manager', property_ids: [propertyId] });
  const mgr = client(srv.base);
  await mgr.post('/api/auth/signup', {
    full_name: 'Mona Manager', email: 'mgr@example.com', password: 'longenough1', confirm_password: 'longenough1',
    accept_privacy: true, invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  await sql(`UPDATE users SET email_verified_at = now() WHERE email = 'mgr@example.com'`);
  const denied = await mgr.post(`/api/unit-owners/${carl}/portal-invite`);
  assert.equal(denied.status, 403);
  assert.equal(denied.data.code, 'FORBIDDEN');
  assert.equal((await mgr.post(`/api/unit-owners/${carl}/portal-disable`)).status, 403);

  const other = await ownerAccount(srv.base, 'other@example.com', 'Other Stays');
  assert.equal((await other.post(`/api/unit-owners/${maria}/portal-disable`)).status, 404, 'another workspace can\'t touch this owner');

  // Carl is invited, then turned off.
  assert.equal((await host.post(`/api/unit-owners/${carl}/portal-invite`)).status, 200);
  assert.equal((await host.post(`/api/unit-owners/${carl}/portal-disable`)).status, 200);
  outbox.length = 0;
  assert.equal((await client(srv.base).post('/api/owner-portal/login', { email: 'carl@example.com' })).status, 200);
  assert.equal(sentTo('carl@example.com').length, 0, 'no sign-in email once access is off');

  // Maria's live session stops working when the host turns her access off.
  assert.equal((await mariaC.get('/api/owner-portal/me')).status, 200);
  const off = await host.post(`/api/unit-owners/${maria}/portal-disable`);
  assert.equal(off.status, 200, JSON.stringify(off.data));
  const after = await mariaC.get('/api/owner-portal/me');
  assert.equal(after.status, 401);
  assert.equal(after.data.code, 'OWNER_SIGNED_OUT');
  assert.equal((await mariaC.get('/api/owner-portal/statements')).status, 401);
  const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM owner_sessions WHERE owner_id = $1', [maria]);
  assert.equal(n, 0);
});

test('profit and loss shows the owner\'s own units; an owner with no units sees an empty table', async () => {
  // Carl has no units. Invited again, he gets an empty table, not the whole workspace.
  assert.equal((await host.post(`/api/unit-owners/${carl}/portal-invite`)).status, 200);
  const carlC = await signInWith(sentTo('carl@example.com').at(-1));
  const empty = await carlC.get('/api/owner-portal/pnl?month=2026-07');
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data.rows, []);
  assert.equal(empty.data.totals.net, '0.00');

  // Ben's table: his unit only, with no "not linked" row.
  const month = TODAY.slice(0, 7);
  const r = await benC.get(`/api/owner-portal/pnl?month=${month}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.rows.length, 1);
  assert.equal(r.data.rows[0].unit_id, unitB.unit_id, 'Ben sees only unit 805');
  assert.ok(!r.data.rows.some((row) => row.unit_name === 'Whole-property expenses'));

  // Maria was switched off earlier; invite her again for her own table.
  outbox.length = 0;
  assert.equal((await host.post(`/api/unit-owners/${maria}/portal-invite`)).status, 200);
  mariaC = await signInWith(sentTo('maria@example.com')[0]);
  const mine = await mariaC.get(`/api/owner-portal/pnl?month=${month}`);
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.equal(mine.data.month, month);
  assert.ok(mine.data.rows.length === 1 && mine.data.rows[0].unit_id === unitA.unit_id);
  assert.deepEqual(Object.keys(mine.data.totals).sort(), ['channel_fees', 'expenses', 'gross', 'net', 'nights', 'refunds', 'stays']);
  assert.equal((await mariaC.get('/api/owner-portal/pnl?month=2026-13')).status, 400);
});

test('the cleanup job removes expired and idle owner sessions and old sign-in links, and keeps live ones', async () => {
  const ownerId = maria;
  const hash = (s) => hashToken(s);
  await sql(`INSERT INTO owner_sessions (token_hash, owner_id, organization_id, created_at, last_seen_at, expires_at)
             VALUES ($1, $3, $4, now(), now(), now() - interval '1 minute'),
                    ($2, $3, $4, now(), now() - interval '8 days', now() + interval '1 day'),
                    ($5, $3, $4, now(), now(), now() + interval '1 day')`,
  [hash('o-expired'), hash('o-idle'), ownerId, orgId, hash('o-live')]);
  await sql(`INSERT INTO owner_login_tokens (token_hash, owner_id, expires_at, used_at)
             VALUES ($1, $3, now() - interval '1 minute', NULL),
                    ($2, $3, now() + interval '30 days', now() - interval '8 days'),
                    ($4, $3, now() + interval '1 hour', NULL)`,
  [hash('l-expired'), hash('l-old'), ownerId, hash('l-fresh')]);

  const deleted = await purgeExpiredAuth();
  assert.ok(deleted >= 4, `deleted ${deleted}`);
  const has = async (table, s) => (await sql(`SELECT 1 FROM ${table} WHERE token_hash = $1`, [hash(s)])).length === 1;
  assert.equal(await has('owner_sessions', 'o-expired'), false);
  assert.equal(await has('owner_sessions', 'o-idle'), false);
  assert.equal(await has('owner_sessions', 'o-live'), true);
  assert.equal(await has('owner_login_tokens', 'l-expired'), false);
  assert.equal(await has('owner_login_tokens', 'l-old'), false);
  assert.equal(await has('owner_login_tokens', 'l-fresh'), true);
});

test('a read-only workspace turns off owner blocks and the host\'s changes, but owners can still read', async () => {
  // Ben's sign-in link comes from a host invite (no sign-in rate limit involved).
  outbox.length = 0;
  assert.equal((await host.post(`/api/unit-owners/${ben}/portal-invite`)).status, 200);
  const benSession = await client(srv.base).raw('POST', '/api/owner-portal/session', { token: tokenFrom(sentTo('ben@example.com')[0]) }, {});
  assert.equal(benSession.status, 200, JSON.stringify(benSession.data));
  const benCookie = benSession.headers.getSetCookie().find((c) => c.startsWith('bh_owner=')).split(';')[0];

  // Now the trial ends: the workspace is view-only.
  await sql(`UPDATE organizations SET plan = 'trial', trial_ends_at = now() - interval '1 day' WHERE organization_id = $1`, [orgId]);
  const hostLogin = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'BalayHub' },
    body: JSON.stringify({ email: 'host@example.com', password: 'correct-horse-1' }),
  });
  assert.equal(hostLogin.status, 200);
  const teamCookie = hostLogin.headers.getSetCookie().find((c) => c.startsWith('bh_session=')).split(';')[0];
  const both = `${teamCookie}; ${benCookie}`;

  // The owner's block is refused with a plain message, and nothing is saved.
  const blockDay = d(80);
  const ownerWrite = await client(srv.base).raw('POST', '/api/owner-portal/blocks',
    { unit_id: unitB.unit_id, check_in: blockDay, check_out: d(81) }, { Cookie: both });
  assert.equal(ownerWrite.status, 402, JSON.stringify(ownerWrite.data));
  assert.equal(ownerWrite.data.code, 'PLAN_READ_ONLY');
  assert.match(ownerWrite.data.error, /view-only right now.*property manager/);
  const [{ n: savedBlocks }] = await sql('SELECT COUNT(*)::int AS n FROM bookings WHERE unit_id = $1 AND check_in = $2', [unitB.unit_id, blockDay]);
  assert.equal(savedBlocks, 0);

  // The host's own write is refused by the plan guard, as before.
  const hostWrite = await client(srv.base).raw('POST', '/api/blocks',
    { unit_id: unitB.unit_id, start_date: d(90), end_date: d(90) }, { Cookie: both });
  assert.equal(hostWrite.status, 402, 'the host is still blocked by the plan');
  assert.equal(hostWrite.data.code, 'PLAN_READ_ONLY');

  // Cancelling a block is refused too: Maria's block for 60 days out stays confirmed.
  const [{ booking_id: blockId }] = await sql(
    `SELECT booking_id FROM bookings WHERE owner_block_by = $1 AND kind = 'block' AND check_in = $2 AND status = 'confirmed'`, [maria, d(60)]);
  const cancel = await mariaC.post(`/api/owner-portal/blocks/${blockId}/cancel`);
  assert.equal(cancel.status, 402, JSON.stringify(cancel.data));
  assert.equal(cancel.data.code, 'PLAN_READ_ONLY');
  const [{ status }] = await sql('SELECT status FROM bookings WHERE booking_id = $1', [blockId]);
  assert.equal(status, 'confirmed');

  // Reads keep working for the owner.
  assert.equal((await client(srv.base).get('/api/owner-portal/me', { Cookie: benCookie })).status, 200);
  assert.equal((await mariaC.get('/api/owner-portal/bookings')).status, 200);
  assert.equal((await mariaC.get('/api/owner-portal/statements')).status, 200);

  // A demo workspace answers 403 to owner writes, as planGuard does for the host.
  await sql('UPDATE organizations SET is_demo = true WHERE organization_id = $1', [orgId]);
  const demo = await client(srv.base).raw('POST', '/api/owner-portal/blocks',
    { unit_id: unitB.unit_id, check_in: d(82), check_out: d(83) }, { Cookie: both });
  assert.equal(demo.status, 403, JSON.stringify(demo.data));
  assert.equal(demo.data.code, 'DEMO_READ_ONLY');
  await sql('UPDATE organizations SET is_demo = false WHERE organization_id = $1', [orgId]);
});
