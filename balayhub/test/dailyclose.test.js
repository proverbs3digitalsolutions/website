'use strict';

process.env.SMTP_URL = 'test://';
process.env.MAIL_FROM = 'BalayHub <host@example.com>';

// Daily close (D-72): the checklist for a day, the stored close, and the history list.
// Owners and managers only; a manager sees only their properties. Runs on its own database
// (TEST_DATABASE_URL) because the test resets the schema.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, sql, ownerAccount, manilaToday } = require('./helpers');

const addDays = (s, n) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
// "Oct 14, 2026" for a YYYY-MM-DD date: the text the balances list shows for a check-in date.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const PASSWORD = 'longenough1';
const SECTION_KEYS = ['arrivals_pending', 'departures_pending', 'cleanings_open', 'payments_today',
  'balances_due', 'proofs_pending', 'damage_open', 'sync_problems'];

let srv; let owner; let manager; let staff; let other;
let propA; let propB; let unitA; let unitB; let orgId; let today; let tomorrow; let yesterday;
let bookingArrival; let bookingDeparture; let bookingLater;

const invite = (email, role, propertyIds) => owner.post('/api/team/invitations', { email, role, property_ids: propertyIds });

// Accepts an invitation through the sign-up form, which also signs the new account in.
async function accept(email, role, propertyIds, fullName) {
  const inv = await invite(email, role, propertyIds);
  assert.equal(inv.status, 201, JSON.stringify(inv.data));
  const c = client(srv.base);
  const s = await c.post('/api/auth/signup', {
    full_name: fullName, email, password: PASSWORD, confirm_password: PASSWORD, accept_privacy: true,
    invite_token: decodeURIComponent(inv.data.inviteLink.split('invite=')[1]),
  });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  return c;
}

const section = (body, key) => body.sections.find((s) => s.key === key);
const itemTexts = (body, key) => section(body, key).items.map((i) => i.text);
const day = (date, extra = '') => `/api/daily-close?date=${date}${extra}`;

test.before(async () => {
  srv = await startServer();
  owner = await ownerAccount(srv.base, 'dc-owner@example.com', 'Daily Close Stays');
  other = await ownerAccount(srv.base, 'dc-other@example.com', 'Other Stays');
  orgId = (await sql('SELECT organization_id FROM organizations WHERE name = $1', ['Daily Close Stays']))[0].organization_id;
  today = manilaToday();
  tomorrow = addDays(today, 1);
  yesterday = addDays(today, -1);

  propA = (await owner.post('/api/properties', { property_name: 'Azure', property_type: 'house', address: 'Bicutan Ave', city: 'Taguig', province: 'Metro Manila' })).data.property;
  propB = (await owner.post('/api/properties', { property_name: 'Grass', property_type: 'house', address: 'Project 8 Road', city: 'Taguig', province: 'Metro Manila' })).data.property;
  unitA = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1A', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  unitB = (await owner.post(`/api/properties/${propB.property_id}/units`, { unit_name: '2B', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  manager = await accept('dc-manager@example.com', 'manager', [propA.property_id], 'Manager Azure');
  staff = await accept('dc-staff@example.com', 'staff', [propA.property_id], 'Staff Azure');

  const reserve = async (unit, checkIn, checkOut, guest, total) => {
    const r = await owner.post('/api/reservations', {
      unit_id: unit.unit_id, check_in: checkIn, check_out: checkOut, guest_name: guest, accommodation_total: total, channel: 'direct',
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.reservation;
  };
  // Arrives today on A, not checked in, 3000 owed, 1000 paid today by GCash: balance 2000.00.
  bookingArrival = await reserve(unitA, today, addDays(today, 2), 'Juan Dela Cruz', '3000.00');
  // Checked in on B and due to leave today: a departure still open.
  bookingDeparture = await reserve(unitB, addDays(today, -2), today, 'Maria Reyes', '2000.00');
  assert.equal((await owner.post(`/api/reservations/${bookingDeparture.booking_id}/stay-status`, { action: 'check_in' })).status, 200);
  // Due in two days on B, nothing paid: inside the 2-day balance window.
  bookingLater = await reserve(unitB, addDays(today, 2), addDays(today, 4), 'Ana Cruz', '4000.00');
  // Due in three days on A: outside the window, so not on today's balances list.
  await reserve(unitA, addDays(today, 3), addDays(today, 5), 'Late Arrival', '5000.00');

  const pay = (id, amount, method, date = today) => owner.post(`/api/reservations/${id}/payments`, { amount, payment_date: date, payment_method: method });
  assert.equal((await pay(bookingArrival.booking_id, '1000.00', 'gcash')).status, 201);
  assert.equal((await pay(bookingDeparture.booking_id, '300.00', 'cash')).status, 201);
  // Voided payment: must not count toward today's totals.
  await sql(`INSERT INTO booking_payments (organization_id, booking_id, amount, payment_date, payment_method, recorded_by, voided_at, voided_by, void_reason)
             VALUES ($1, $2, 500, $3, 'cash', (SELECT user_id FROM users WHERE email = 'dc-owner@example.com'), now(), (SELECT user_id FROM users WHERE email = 'dc-owner@example.com'), 'Entered twice')`,
  [orgId, bookingArrival.booking_id, today]);

  // Cleaning due today on each property.
  assert.equal((await owner.post('/api/cleaning-tasks', { unit_id: unitA.unit_id, due_date: today })).status, 201);
  assert.equal((await owner.post('/api/cleaning-tasks', { unit_id: unitB.unit_id, due_date: today })).status, 201);

  // Payment proof waiting on each property; damage open on each property.
  await sql(`INSERT INTO payment_proofs (organization_id, booking_id, amount, method, payer_name, status)
             VALUES ($1, $2, 500, 'gcash', 'Juan', 'pending'), ($1, $3, 700, 'maya', 'Maria', 'pending')`,
  [orgId, bookingArrival.booking_id, bookingDeparture.booking_id]);
  await sql(`INSERT INTO damage_reports (organization_id, unit_id, description, estimated_cost, status)
             VALUES ($1, $2, 'Cracked tile', 1500, 'open'), ($1, $3, 'Broken blind', NULL, 'open')`,
  [orgId, unitA.unit_id, unitB.unit_id]);

  // Calendar sync: A's feed failed, B's feed has not synced for 4 hours, and A has one open overlap.
  const feedA = (await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status, last_message)
                            VALUES ($1, $2, 'airbnb', 'https://example.com/a.ics', now(), 'error', 'boom') RETURNING feed_id`, [orgId, unitA.unit_id]))[0];
  await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status)
             VALUES ($1, $2, 'booking', 'https://example.com/b.ics', now() - interval '4 hours', 'ok')`, [orgId, unitB.unit_id]);
  await sql(`INSERT INTO ical_conflicts (organization_id, feed_id, unit_id, external_uid, check_in, check_out)
             VALUES ($1, $2, $3, 'uid-1', $4, $5)`, [orgId, feedA.feed_id, unitA.unit_id, today, addDays(today, 1)]);
});
test.after(async () => { await srv.close(); });

test('only owners and managers can see or close the day', async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get(day(today))).status, 401);
  assert.equal((await staff.get(day(today))).status, 403);
  assert.equal((await staff.post('/api/daily-close', { date: today })).status, 403);
  assert.equal((await staff.get('/api/daily-closes?from=2026-01-01&to=2026-01-02')).status, 403);
});

test('owner sees every open item for today, with money as strings', async () => {
  const r = await owner.get(day(today));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.date, today);
  assert.deepEqual(r.data.sections.map((s) => s.key), SECTION_KEYS);
  assert.equal(r.data.closed, null);

  assert.deepEqual(itemTexts(r.data, 'arrivals_pending'), ['Juan · 1A']);
  assert.equal(section(r.data, 'arrivals_pending').items[0].link, `#/reservations/${bookingArrival.booking_id}`);
  assert.deepEqual(itemTexts(r.data, 'departures_pending'), ['Maria · 2B']);
  assert.equal(section(r.data, 'cleanings_open').count, 2);
  assert.equal(section(r.data, 'cleanings_open').items[0].link.startsWith('#/housekeeping/'), true);

  const pay = section(r.data, 'payments_today');
  assert.equal(pay.total, '1300.00');
  assert.equal(pay.count, 2);
  assert.deepEqual(pay.by_method, [
    { method: 'cash', count: 1, total: '300.00' },
    { method: 'gcash', count: 1, total: '1000.00' },
  ]);

  // Maria is staying and owes 1700.00; Juan (2000.00) and Ana (4000.00) are due within two days.
  // The late arrival is due in three days, so it is out of range.
  const balances = section(r.data, 'balances_due');
  assert.equal(balances.title, 'Balances due');
  assert.deepEqual(balances.items.map((i) => i.text), ['Maria · 2B', 'Juan · 1A', 'Ana · 2B']);
  assert.deepEqual(balances.items.map((i) => i.amount), ['1700.00', '2000.00', '4000.00']);
  assert.equal(balances.items[0].detail, 'Staying now');
  assert.equal(balances.items[1].detail, `Check-in ${shortDate(today)}`);

  assert.equal(section(r.data, 'proofs_pending').count, 2);
  assert.equal(section(r.data, 'damage_open').count, 2);
  assert.equal(section(r.data, 'damage_open').items.find((i) => i.text === '1A').amount, '1500.00');
  assert.equal(section(r.data, 'sync_problems').count, 3);
});

test('a manager sees only their property', async () => {
  const r = await manager.get(day(today));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(section(r.data, 'departures_pending').count, 0);
  assert.deepEqual(itemTexts(r.data, 'arrivals_pending'), ['Juan · 1A']);
  assert.equal(section(r.data, 'cleanings_open').count, 1);
  assert.equal(section(r.data, 'payments_today').total, '1000.00');
  assert.deepEqual(itemTexts(r.data, 'balances_due'), ['Juan · 1A']);
  assert.equal(section(r.data, 'proofs_pending').count, 1);
  assert.equal(section(r.data, 'damage_open').count, 1);
  assert.equal(section(r.data, 'sync_problems').count, 2);
});

test('another workspace sees none of these items', async () => {
  const r = await other.get(day(today));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const s of r.data.sections) assert.equal(s.count, 0, s.key);
  assert.equal(r.data.sections.find((s) => s.key === 'payments_today').total, '0.00');
  assert.equal(r.data.closed, null);
});

test('the day defaults to today and cannot be later than tomorrow', async () => {
  const dflt = await owner.get('/api/daily-close');
  assert.equal(dflt.status, 200);
  assert.equal(dflt.data.date, today);

  const tom = await owner.get(day(tomorrow));
  assert.equal(tom.status, 200);
  assert.equal(tom.data.date, tomorrow);

  const late = await owner.get(day(addDays(today, 2)));
  assert.equal(late.status, 400);
  assert.equal(late.data.code, 'VALIDATION');
  assert.ok(late.data.fields.date);

  for (const bad of ['2026-02-30', 'tomorrow', '2026-1-5']) {
    const r = await owner.get(day(bad));
    assert.equal(r.status, 400, bad);
    assert.ok(r.data.fields.date, bad);
  }
});

test('closing the day stores a snapshot; re-closing updates it and is audited; the snapshot does not move', async () => {
  const first = await owner.post('/api/daily-close', { date: today, note: 'All good' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const closed = first.data.closed;
  assert.equal(closed.close_date, today);
  assert.equal(closed.closed_by_name, 'Maria Santos');
  assert.equal(closed.note, 'All good');
  assert.equal(closed.summary.payments.total, '1300.00');
  assert.equal(closed.summary.counts.arrivals_pending, 1);
  assert.equal(closed.summary.counts.sync_problems, 3);
  assert.ok(!Number.isNaN(Date.parse(closed.closed_at)));

  const shown = (await owner.get(day(today))).data.closed;
  assert.equal(shown.note, 'All good');
  assert.deepEqual(shown.summary, closed.summary);

  // Re-closing with a new note replaces the row (one per workspace per day) and writes another audit line.
  assert.equal((await owner.post('/api/daily-close', { date: today, note: 'Reopened and closed again' })).status, 200);
  const rows = await sql('SELECT note FROM daily_closes WHERE organization_id = $1 AND close_date = $2', [orgId, today]);
  assert.deepEqual(rows, [{ note: 'Reopened and closed again' }]);
  const audits = await sql("SELECT count(*)::int AS n FROM audit_logs WHERE organization_id = $1 AND action = 'daily_close.saved' AND record_type = 'daily_close'", [orgId]);
  assert.equal(audits[0].n, 2);

  // A payment recorded after the close changes the live checklist but not the stored snapshot.
  assert.equal((await owner.post(`/api/reservations/${bookingLater.booking_id}/payments`, { amount: '100.00', payment_date: today, payment_method: 'cash' })).status, 201);
  const live = await owner.get(day(today));
  assert.equal(section(live.data, 'payments_today').total, '1400.00');
  assert.equal(live.data.closed.summary.payments.total, '1300.00');
});

test('a manager close records their property; the summary shows only to someone with that same scope', async () => {
  const mine = await manager.post('/api/daily-close', { date: tomorrow, note: 'Azure only' });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.equal(mine.data.closed.closed_by_name, 'Manager Azure');
  assert.ok(mine.data.closed.summary, 'manager sees their own summary');

  const stored = await sql('SELECT property_ids::text[] AS ids FROM daily_closes WHERE organization_id = $1 AND close_date = $2', [orgId, tomorrow]);
  assert.deepEqual(stored[0].ids, [propA.property_id]);

  const ownerView = await owner.get(day(tomorrow));
  assert.equal(ownerView.data.closed.note, 'Azure only');
  assert.ok(ownerView.data.closed.summary);

  // An owner's close covers everything: the manager sees the note but not the numbers.
  assert.equal((await owner.post('/api/daily-close', { date: yesterday, note: 'Whole workspace' })).status, 200);
  const mgrYesterday = await manager.get(day(yesterday));
  assert.equal(mgrYesterday.data.closed.note, 'Whole workspace');
  assert.equal(mgrYesterday.data.closed.closed_by_name, 'Maria Santos');
  assert.equal(mgrYesterday.data.closed.summary, null);
});

test('history lists the closes the caller may see, newest first, without summaries', async () => {
  // A close that only covers property B: the manager must not see it.
  await sql(`INSERT INTO daily_closes (organization_id, close_date, property_ids, summary, note)
             VALUES ($1, $2, ARRAY[$3::uuid], '{}', 'Grass only')`, [orgId, addDays(today, -5), propB.property_id]);

  const range = `from=${addDays(today, -5)}&to=${tomorrow}`;
  const ownerList = await owner.get(`/api/daily-closes?${range}`);
  assert.equal(ownerList.status, 200, JSON.stringify(ownerList.data));
  assert.deepEqual(ownerList.data.closes.map((c) => c.close_date), [tomorrow, today, yesterday, addDays(today, -5)]);
  for (const c of ownerList.data.closes) {
    assert.deepEqual(Object.keys(c).sort(), ['close_date', 'closed_at', 'closed_by_name', 'note']);
    assert.match(c.close_date, /^\d{4}-\d{2}-\d{2}$/);
  }

  // Owner closes (no property list) are visible to managers; the property-B close is not.
  const mgrList = await manager.get(`/api/daily-closes?${range}`);
  assert.deepEqual(mgrList.data.closes.map((c) => c.close_date), [tomorrow, today, yesterday]);

  const otherList = await other.get(`/api/daily-closes?${range}`);
  assert.deepEqual(otherList.data.closes, []);
});

test('history range rules: end on or after start, at most 92 days inclusive', async () => {
  const backwards = await owner.get(`/api/daily-closes?from=${today}&to=${yesterday}`);
  assert.equal(backwards.status, 400);
  assert.ok(backwards.data.fields.to);

  const tooLong = await owner.get(`/api/daily-closes?from=${addDays(today, -92)}&to=${today}`);
  assert.equal(tooLong.status, 400);

  const exactly = await owner.get(`/api/daily-closes?from=${addDays(today, -91)}&to=${today}`);
  assert.equal(exactly.status, 200, JSON.stringify(exactly.data));

  const missing = await owner.get(`/api/daily-closes?from=${today}`);
  assert.equal(missing.status, 400);
});

test('a manager cannot overwrite a close wider than their properties; an owner can re-close anything', async () => {
  const wholeWorkspace = addDays(today, -10);
  assert.equal((await owner.post('/api/daily-close', { date: wholeWorkspace, note: 'Owner closed' })).status, 200);
  const blocked = await manager.post('/api/daily-close', { date: wholeWorkspace, note: 'Manager overwrite' });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, 'ALREADY_CLOSED');
  assert.match(blocked.data.error, /Only an owner/);
  assert.deepEqual(await sql('SELECT note FROM daily_closes WHERE organization_id = $1 AND close_date = $2', [orgId, wholeWorkspace]),
    [{ note: 'Owner closed' }]);

  // A close covering property B as well as A is wider than the manager's scope.
  const twoProps = addDays(today, -11);
  await sql(`INSERT INTO daily_closes (organization_id, close_date, property_ids, summary, note)
             VALUES ($1, $2, ARRAY[$3::uuid, $4::uuid], '{}', 'Both properties')`, [orgId, twoProps, propA.property_id, propB.property_id]);
  assert.equal((await manager.post('/api/daily-close', { date: twoProps, note: 'Mine' })).status, 409);

  assert.equal((await owner.post('/api/daily-close', { date: wholeWorkspace, note: 'Owner again' })).status, 200);
  assert.equal((await owner.post('/api/daily-close', { date: twoProps, note: 'Owner again' })).status, 200);

  // A manager may re-close a day that was closed with exactly their own property.
  const mine = addDays(today, -12);
  assert.equal((await manager.post('/api/daily-close', { date: mine, note: 'First' })).status, 200);
  assert.equal((await manager.post('/api/daily-close', { date: mine, note: 'Second' })).status, 200);
  assert.deepEqual(await sql('SELECT note FROM daily_closes WHERE organization_id = $1 AND close_date = $2', [orgId, mine]), [{ note: 'Second' }]);
});

test('balances: a guest still staying who owes is listed; a guest who paid in full or has checked out is not', async () => {
  const unitC = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1C', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const unitD = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1D', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const book = async (unit, checkIn, checkOut, guest, total) => {
    const r = await owner.post('/api/reservations', { unit_id: unit.unit_id, check_in: checkIn, check_out: checkOut, guest_name: guest, accommodation_total: total, channel: 'direct' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal((await owner.post(`/api/reservations/${r.data.reservation.booking_id}/stay-status`, { action: 'check_in' })).status, 200);
    return r.data.reservation;
  };

  await book(unitC, addDays(today, -1), addDays(today, 1), 'Lee Tan', '800.00');
  const paid = await book(unitD, addDays(today, -1), addDays(today, 1), 'Paid Up', '1000.00');
  assert.equal((await owner.post(`/api/reservations/${paid.booking_id}/payments`, { amount: '1000.00', payment_date: today, payment_method: 'cash' })).status, 201);
  const gone = await book(unitD, addDays(today, -3), addDays(today, -1), 'Gone Away', '500.00');
  assert.equal((await owner.post(`/api/reservations/${gone.booking_id}/stay-status`, { action: 'check_out' })).status, 200);

  const r = await owner.get(day(today));
  const balances = section(r.data, 'balances_due');
  assert.deepEqual(balances.items.map((i) => i.text), ['Maria · 2B', 'Lee · 1C', 'Juan · 1A', 'Ana · 2B']);
  // Ana's 4000.00 has the 100.00 cash payment from the close test on it.
  assert.deepEqual(balances.items.map((i) => i.amount), ['1700.00', '800.00', '2000.00', '3900.00']);
  assert.deepEqual(balances.items.map((i) => i.detail), ['Staying now', 'Staying now', `Check-in ${shortDate(today)}`, `Check-in ${shortDate(addDays(today, 2))}`]);

  // Lee is on property A, so the manager sees Lee too, and still not the property-B guests.
  const m = await manager.get(day(today));
  assert.deepEqual(itemTexts(m.data, 'balances_due'), ['Lee · 1C', 'Juan · 1A']);
});

test('sync problems: a feed that never synced counts once it is over 3 hours old; a sync that only skipped overlaps does not count', async () => {
  const unitE = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1E', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const count = async (c) => section((await c.get(day(today))).data, 'sync_problems').count;
  const ownerBefore = await count(owner);
  const managerBefore = await count(manager);

  await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, created_at)
             VALUES ($1, $2, 'agoda', 'https://example.com/e1.ics', now() - interval '4 hours')`, [orgId, unitE.unit_id]);
  await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, created_at)
             VALUES ($1, $2, 'airbnb', 'https://example.com/e2.ics', now() - interval '1 hour')`, [orgId, unitE.unit_id]);
  await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status, last_message)
             VALUES ($1, $2, 'booking', 'https://example.com/e3.ics', now(), 'error', 'Synced: 2 dates skipped')`, [orgId, unitE.unit_id]);

  const owned = await owner.get(day(today));
  assert.equal(section(owned.data, 'sync_problems').count, ownerBefore + 1);
  assert.deepEqual(itemTexts(owned.data, 'sync_problems').filter((t) => t.startsWith('1E · ')), ['1E · Agoda']);
  assert.equal(await count(manager), managerBefore + 1);
});

test('a manager with no assigned property is refused, so an empty scope never reads as a whole-workspace close', async () => {
  const idle = await accept('dc-idle@example.com', 'manager', [propA.property_id], 'Idle Manager');
  await sql('DELETE FROM property_assignments WHERE user_id = (SELECT user_id FROM users WHERE email = $1)', ['dc-idle@example.com']);
  const date = addDays(today, -13);
  const view = await idle.get(day(date));
  assert.equal(view.status, 403, JSON.stringify(view.data));
  assert.equal(view.data.code, 'FORBIDDEN');
  assert.equal(view.data.error, 'You are not assigned to any property.');
  const close = await idle.post('/api/daily-close', { date });
  assert.equal(close.status, 403, JSON.stringify(close.data));
  assert.equal(close.data.error, 'You are not assigned to any property.');
  assert.deepEqual(await sql('SELECT 1 FROM daily_closes WHERE organization_id = $1 AND close_date = $2', [orgId, date]), []);
});

test('a manager sees a stored close only when it is the whole workspace or covers their property', async () => {
  // The -5 close covers property B only: the owner sees it, the manager does not.
  assert.equal((await owner.get(day(addDays(today, -5)))).data.closed.note, 'Grass only');
  assert.equal((await manager.get(day(addDays(today, -5)))).data.closed, null);

  // A close covering both properties: the manager sees the note but not the summary.
  await sql(`INSERT INTO daily_closes (organization_id, close_date, property_ids, summary, note)
             VALUES ($1, $2, ARRAY[$3::uuid, $4::uuid], '{}', 'Both properties')`, [orgId, addDays(today, -20), propA.property_id, propB.property_id]);
  const both = (await manager.get(day(addDays(today, -20)))).data.closed;
  assert.equal(both.note, 'Both properties');
  assert.equal(both.summary, null);
});

test('sync problems leave out archived listings and properties, as GET /sync-health does', async () => {
  const dayView = async () => (await owner.get(day(today))).data;
  const before = section(await dayView(), 'sync_problems').count;

  // An active listing with a failing feed and an overlap, and a listing in another property with a stale feed and an overlap.
  const unitF = (await owner.post(`/api/properties/${propA.property_id}/units`, { unit_name: '1F', unit_type: 'studio', nightly_rate: '2000' })).data.unit;
  const oldProp = (await owner.post('/api/properties', { property_name: 'Old Wing', property_type: 'house', address: 'Pasig', city: 'Pasig', province: 'Metro Manila' })).data.property;
  const unitO = (await owner.post(`/api/properties/${oldProp.property_id}/units`, { unit_name: 'Old 1', unit_type: 'studio', nightly_rate: '1500' })).data.unit;
  const failing = (await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, last_synced_at, last_status, last_message)
                              VALUES ($1, $2, 'airbnb', 'https://example.com/f.ics', now(), 'error', 'boom') RETURNING feed_id`, [orgId, unitF.unit_id]))[0];
  const stale = (await sql(`INSERT INTO ical_feeds (organization_id, unit_id, channel, url, created_at)
                            VALUES ($1, $2, 'agoda', 'https://example.com/g.ics', now() - interval '4 hours') RETURNING feed_id`, [orgId, unitO.unit_id]))[0];
  await sql(`INSERT INTO ical_conflicts (organization_id, feed_id, unit_id, external_uid, check_in, check_out)
             VALUES ($1, $2, $3, 'uid-f', $6, $7), ($1, $4, $5, 'uid-g', $6, $7)`,
  [orgId, failing.feed_id, unitF.unit_id, stale.feed_id, unitO.unit_id, today, tomorrow]);
  assert.equal(section(await dayView(), 'sync_problems').count, before + 4, 'all four count while the listing and property are live');

  assert.equal((await owner.post(`/api/units/${unitF.unit_id}/archive`)).status, 200);
  assert.equal((await owner.post(`/api/properties/${oldProp.property_id}/archive`)).status, 200);

  const after = await dayView();
  assert.equal(section(after, 'sync_problems').count, before, 'the archived listing and property drop out');
  assert.deepEqual(itemTexts(after, 'sync_problems').filter((t) => t.startsWith('1F · ') || t.startsWith('Old 1 · ')), []);
  const health = await owner.get('/api/sync-health');
  assert.equal(health.status, 200);
  assert.equal(section(after, 'sync_problems').count, health.data.problems.length, 'the same count as the Calendar warnings');
});
